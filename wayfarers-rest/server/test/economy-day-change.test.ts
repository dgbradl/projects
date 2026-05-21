import { describe, expect, it } from 'vitest';
import { closeLedgerForDay } from '../src/economy/ledger.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { regenerateForDayTick } from '../src/interventions/favor.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { SubTickScheduler } from '../src/subtick.ts';
import { TickScheduler } from '../src/tick.ts';

const SUB_TICKS_PER_DAY = 20;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const SEED = 'day-change-seed';

function appendGuestSpent(
  persistence: Persistence,
  gameDay: number,
  npcId: string,
  amount: number,
): void {
  persistence.appendWorldEvent(
    {
      type: 'guest_spent',
      gameDay,
      npcId,
      amount,
      breakdown: { drink: amount, meal: 0, room: 0, tip: 0 },
    },
    't',
  );
}

/**
 * Wires the macro/sub-tick schedulers exactly as `index.ts` does, including
 * the `onDayChange` closure that settles the ledger and regenerates favor.
 * This guards the integration the per-module tests cannot see.
 */
describe('economy day-change wiring', () => {
  it('settles the ledger from the onDayChange hook as macro days advance', () => {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(START);
    const stateManager = new WorldStateManager(persistence, clock, () => SEED);
    const bus = new WorldEventBus(persistence, clock);
    const npcManager = new NpcManager(
      { worldSeed: SEED, subTicksPerDay: SUB_TICKS_PER_DAY },
      { persistence, bus },
    );
    npcManager.onMacroTick(1);
    const tickScheduler = new TickScheduler(
      stateManager,
      clock,
      { tickIntervalMs: TICK_INTERVAL, schedulerCheckMs: 50 },
      bus,
    );
    // Same closure index.ts wires as the 6th SubTickScheduler arg.
    new SubTickScheduler(
      stateManager,
      npcManager,
      clock,
      { subTickIntervalMs: SUBTICK_MS, subTicksPerDay: SUB_TICKS_PER_DAY },
      undefined,
      (newGameDay) => {
        closeLedgerForDay(
          { persistence, stateManager, bus, worldSeed: SEED },
          newGameDay - 1,
        );
        regenerateForDayTick(stateManager, bus, newGameDay);
      },
    );

    // Each of days 1-3 takes in some coin.
    appendGuestSpent(persistence, 1, 'a', 20);
    appendGuestSpent(persistence, 1, 'b', 15);
    appendGuestSpent(persistence, 2, 'c', 40);
    appendGuestSpent(persistence, 3, 'd', 8);

    const coinStart = stateManager.getState().coin;

    // Advance three macro days: 1 -> 4. Before each, push subTick off zero —
    // as a real day of sub-ticks would — so the macro tick fires with a
    // non-zero subTick, the case where the day-change subTick reset must not
    // clobber the favor/coin updates the same hook just made.
    for (let i = 0; i < 3; i += 1) {
      stateManager.setState({ ...stateManager.getState(), subTick: 7 });
      tickScheduler.advance(TICK_INTERVAL);
    }
    expect(stateManager.getState().gameDay).toBe(4);
    expect(stateManager.getState().subTick).toBe(0);

    // Each elapsed day has a settled ledger row.
    expect(persistence.loadDailyLedger(1)?.income).toBe(35);
    expect(persistence.loadDailyLedger(2)?.income).toBe(40);
    expect(persistence.loadDailyLedger(3)?.income).toBe(8);
    expect(persistence.loadDailyLedger(4)).toBeNull();

    // The purse moved, and a ledger_closed event fired for each closed day.
    expect(stateManager.getState().coin).not.toBe(coinStart);
    const closedDays = persistence
      .getEventsSince(0)
      .filter((e) => e.event.type === 'ledger_closed')
      .map((e) => (e.event as { gameDay: number }).gameDay);
    expect(closedDays).toEqual([1, 2, 3]);

    // The same hook also regenerated favor — proof it ran end to end and
    // that the subTick reset did not clobber it (3 -> 4 -> 5, capped at 5).
    expect(stateManager.getState().favorsLastRegenGameDay).toBe(4);
    expect(stateManager.getState().favors).toBe(5);
  });
});
