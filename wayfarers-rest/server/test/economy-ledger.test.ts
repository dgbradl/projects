import { describe, expect, it } from 'vitest';
import { closeLedgerForDay, computeUpkeep } from '../src/economy/ledger.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

function setup(seed = 'ledger-seed') {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
  const stateManager = new WorldStateManager(persistence, clock, () => seed);
  const bus = new WorldEventBus(persistence, clock);
  return {
    persistence,
    stateManager,
    bus,
    deps: { persistence, stateManager, bus, worldSeed: seed },
  };
}

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

function appendArrival(
  persistence: Persistence,
  gameDay: number,
  npcId: string,
): void {
  persistence.appendWorldEvent(
    { type: 'npc_arrived', gameDay, npcId, displayName: npcId },
    't',
  );
}

describe('computeUpkeep', () => {
  it('is deterministic for identical inputs', () => {
    const a = computeUpkeep({ worldSeed: 's', gameDay: 3, occupancy: 4 });
    const b = computeUpkeep({ worldSeed: 's', gameDay: 3, occupancy: 4 });
    expect(a).toBe(b);
  });

  it('rises with occupancy and is always positive', () => {
    const quiet = computeUpkeep({ worldSeed: 's', gameDay: 3, occupancy: 0 });
    const busy = computeUpkeep({ worldSeed: 's', gameDay: 3, occupancy: 10 });
    expect(busy).toBeGreaterThan(quiet);
    expect(quiet).toBeGreaterThan(0);
  });
});

describe('closeLedgerForDay', () => {
  it('settles a day: sums income, debits upkeep, moves the purse', () => {
    const { persistence, stateManager, deps } = setup();
    appendGuestSpent(persistence, 1, 'a', 20);
    appendGuestSpent(persistence, 1, 'b', 30);
    appendGuestSpent(persistence, 1, 'c', 10);
    appendArrival(persistence, 1, 'a');
    appendArrival(persistence, 1, 'b');

    const ledger = closeLedgerForDay(deps, 1);
    const expense = computeUpkeep({
      worldSeed: 'ledger-seed',
      gameDay: 1,
      occupancy: 2,
    });

    expect(ledger).not.toBeNull();
    expect(ledger).toEqual({
      gameDay: 1,
      income: 60,
      expense,
      net: 60 - expense,
      guestCount: 3,
      coinAfter: 200 + 60 - expense,
    });
    expect(stateManager.getState().coin).toBe(200 + 60 - expense);
    expect(persistence.loadDailyLedger(1)).toEqual(ledger);
  });

  it('emits tavern_upkeep and ledger_closed events for the closed day', () => {
    const { persistence, deps } = setup();
    appendGuestSpent(persistence, 1, 'a', 40);
    closeLedgerForDay(deps, 1);

    const events = persistence.getEventsSince(0).map((e) => e.event);
    expect(events.some((e) => e.type === 'tavern_upkeep' && e.gameDay === 1)).toBe(
      true,
    );
    const closed = events.find((e) => e.type === 'ledger_closed');
    expect(closed).toMatchObject({ gameDay: 1, income: 40, coinBefore: 200 });
  });

  it('only counts events from the closing day', () => {
    const { persistence, deps } = setup();
    appendGuestSpent(persistence, 1, 'a', 25);
    appendGuestSpent(persistence, 2, 'b', 999);
    const ledger = closeLedgerForDay(deps, 1);
    expect(ledger?.income).toBe(25);
    expect(ledger?.guestCount).toBe(1);
  });

  it('is idempotent — re-closing a day does not move the purse again', () => {
    const { persistence, stateManager, deps } = setup();
    appendGuestSpent(persistence, 1, 'a', 50);
    const first = closeLedgerForDay(deps, 1);
    const coinAfterFirst = stateManager.getState().coin;
    const closedCount = () =>
      persistence
        .getEventsSince(0)
        .filter((e) => e.event.type === 'ledger_closed').length;
    expect(closedCount()).toBe(1);

    const second = closeLedgerForDay(deps, 1);
    expect(second).toEqual(first);
    expect(stateManager.getState().coin).toBe(coinAfterFirst);
    expect(closedCount()).toBe(1);
  });

  it('depletes the larder by one level each day (Economy E3)', () => {
    const { stateManager, deps } = setup();
    stateManager.setState({ ...stateManager.getState(), larderStock: 3 });
    closeLedgerForDay(deps, 1);
    expect(stateManager.getState().larderStock).toBe(2);
  });

  it('clamps larder depletion at zero', () => {
    const { stateManager, deps } = setup();
    // A fresh tavern's larder is already at 0 — closing must not go negative.
    closeLedgerForDay(deps, 1);
    expect(stateManager.getState().larderStock).toBe(0);
  });

  it('does not deplete the larder twice when a day is re-closed', () => {
    const { stateManager, deps } = setup();
    stateManager.setState({ ...stateManager.getState(), larderStock: 3 });
    closeLedgerForDay(deps, 1);
    closeLedgerForDay(deps, 1);
    expect(stateManager.getState().larderStock).toBe(2);
  });

  it('clamps the purse at zero — a soft economy never goes negative', () => {
    const { stateManager, deps } = setup();
    stateManager.setState({ ...stateManager.getState(), coin: 5 });
    // No income this day; upkeep alone exceeds the purse.
    const ledger = closeLedgerForDay(deps, 1);
    expect(ledger?.income).toBe(0);
    expect(ledger?.coinAfter).toBe(0);
    expect(stateManager.getState().coin).toBe(0);
  });

  it('returns null for a non-day (day 0)', () => {
    const { deps } = setup();
    expect(closeLedgerForDay(deps, 0)).toBeNull();
  });

  it('is reproducible — same seed and events yield an identical ledger', () => {
    const runOnce = () => {
      const { persistence, deps } = setup('repro-seed');
      appendGuestSpent(persistence, 1, 'a', 17);
      appendGuestSpent(persistence, 1, 'b', 23);
      appendArrival(persistence, 1, 'a');
      return closeLedgerForDay(deps, 1);
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
