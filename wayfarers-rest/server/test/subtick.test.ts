import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { SubTickScheduler } from '../src/subtick.ts';
import { TickScheduler } from '../src/tick.ts';

const SUB_TICKS_PER_DAY = 60;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function buildHarness() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(
    persistence,
    clock,
    () => 'subtick-seed',
  );
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: stateManager.getState().seed, subTicksPerDay: SUB_TICKS_PER_DAY },
    { persistence, bus },
  );
  npcManager.onMacroTick(stateManager.getState().gameDay);
  const tickScheduler = new TickScheduler(
    stateManager,
    clock,
    { tickIntervalMs: TICK_INTERVAL, schedulerCheckMs: 50 },
    bus,
  );
  const subTickScheduler = new SubTickScheduler(
    stateManager,
    npcManager,
    clock,
    { subTickIntervalMs: SUBTICK_MS, subTicksPerDay: SUB_TICKS_PER_DAY },
  );
  return { persistence, clock, stateManager, npcManager, tickScheduler, subTickScheduler, bus };
}

describe('SubTickScheduler', () => {
  it('advances subTick every SUBTICK_INTERVAL_MS', () => {
    const h = buildHarness();
    expect(h.stateManager.getState().subTick).toBe(0);
    h.subTickScheduler.advance(SUBTICK_MS);
    expect(h.stateManager.getState().subTick).toBe(1);
    h.subTickScheduler.advance(SUBTICK_MS);
    expect(h.stateManager.getState().subTick).toBe(2);
  });

  it('resets subTick to 0 when the macro day-tick fires', () => {
    const h = buildHarness();
    // Advance ~half a day's worth of sub-ticks.
    for (let i = 0; i < 20; i += 1) h.subTickScheduler.advance(SUBTICK_MS);
    expect(h.stateManager.getState().subTick).toBe(20);

    // Now fire the macro tick: jump the clock to where the macro should fire.
    h.tickScheduler.advance(TICK_INTERVAL - 20 * SUBTICK_MS);
    expect(h.stateManager.getState().gameDay).toBe(2);
    expect(h.stateManager.getState().subTick).toBe(0);
  });

  it('does not advance subTick while paused', () => {
    const h = buildHarness();
    h.stateManager.setState({
      ...h.stateManager.getState(),
      status: 'paused',
    });
    const before = h.stateManager.getState().subTick;
    h.subTickScheduler.advance(SUBTICK_MS * 5);
    expect(h.stateManager.getState().subTick).toBe(before);
  });

  it('on resume from multi-day pause, ends at subTick=0 (snap, not replay)', () => {
    const h = buildHarness();
    // Drive to paused via 7 macro ticks.
    for (let i = 0; i < 7; i += 1) {
      h.tickScheduler.advance(TICK_INTERVAL);
    }
    expect(h.stateManager.getState().status).toBe('paused');
    expect(h.stateManager.getState().subTick).toBe(0);

    // Simulate a lot of wall-clock time passing while paused. Pre-set
    // subTick to something non-zero to prove the resume snaps it back.
    h.stateManager.setState({ ...h.stateManager.getState(), subTick: 17 });
    h.clock.advance(TICK_INTERVAL * 3);

    // Engage: macro tick catch-up should fire and reset subTick to 0 each time.
    h.stateManager.setState({
      ...h.stateManager.getState(),
      status: 'running',
      unattendedTicks: 0,
    });
    h.tickScheduler.runCatchUp();

    expect(h.stateManager.getState().subTick).toBe(0);
  });

  it('emits state events for each sub-tick', () => {
    const h = buildHarness();
    const seenSubTicks: number[] = [];
    h.stateManager.on('state', (s) => seenSubTicks.push(s.subTick));
    h.subTickScheduler.advance(SUBTICK_MS * 3);
    expect(seenSubTicks).toContain(1);
    expect(seenSubTicks).toContain(2);
    expect(seenSubTicks).toContain(3);
  });
});
