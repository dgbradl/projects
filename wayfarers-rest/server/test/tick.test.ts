import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler, engage } from '../src/tick.ts';

const TICK_INTERVAL = 1000;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function buildHarness(opts?: { startTime?: number; seed?: string }) {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(opts?.startTime ?? START);
  const stateManager = new WorldStateManager(
    persistence,
    clock,
    () => opts?.seed ?? 'seed-fixed',
  );
  const scheduler = new TickScheduler(stateManager, clock, {
    tickIntervalMs: TICK_INTERVAL,
    schedulerCheckMs: 100,
  });
  return { persistence, clock, stateManager, scheduler };
}

describe('TickScheduler', () => {
  it('first tick increments gameDay from 1 to 2', () => {
    const h = buildHarness();
    expect(h.stateManager.getState().gameDay).toBe(1);
    h.scheduler.advance(TICK_INTERVAL);
    expect(h.stateManager.getState().gameDay).toBe(2);
  });

  it('seven consecutive unattended ticks transition status to paused on the seventh; an eighth does not fire', () => {
    const h = buildHarness();
    for (let i = 0; i < 6; i += 1) {
      h.scheduler.advance(TICK_INTERVAL);
      expect(h.stateManager.getState().status).toBe('running');
    }
    h.scheduler.advance(TICK_INTERVAL);
    const paused = h.stateManager.getState();
    expect(paused.status).toBe('paused');
    expect(paused.unattendedTicks).toBe(7);
    expect(paused.gameDay).toBe(8);

    // Advancing further should NOT fire another tick.
    const fired = h.scheduler.advance(TICK_INTERVAL * 5);
    expect(fired).toBe(0);
    expect(h.stateManager.getState().gameDay).toBe(8);
  });

  it('POST /engagement on a paused state resumes and resets unattendedTicks', () => {
    const h = buildHarness();
    h.scheduler.advance(TICK_INTERVAL * 7);
    expect(h.stateManager.getState().status).toBe('paused');

    engage(h.stateManager, h.scheduler, h.clock);
    const s = h.stateManager.getState();
    expect(s.status).toBe('running');
    expect(s.unattendedTicks).toBe(0);

    const events = h.persistence.getEventsSince(0);
    expect(events.some((e) => e.type === 'resume')).toBe(true);
  });

  it('catch-up: if 4 tick intervals elapse before boot, 4 ticks fire on boot', () => {
    const h = buildHarness();
    const fired = h.scheduler.advance(TICK_INTERVAL * 4);
    expect(fired).toBe(4);
    const s = h.stateManager.getState();
    expect(s.gameDay).toBe(5);
    expect(s.unattendedTicks).toBe(4);
    expect(s.status).toBe('running');
  });

  it('catch-up respects the cap: 10 elapsed intervals fire 7 ticks and end paused', () => {
    const h = buildHarness();
    const fired = h.scheduler.advance(TICK_INTERVAL * 10);
    expect(fired).toBe(7);
    const s = h.stateManager.getState();
    expect(s.gameDay).toBe(8);
    expect(s.unattendedTicks).toBe(7);
    expect(s.status).toBe('paused');
  });

  it('tick scheduling is deterministic: same start state + elapsed time -> identical state including lastTickAt', () => {
    const a = buildHarness();
    const b = buildHarness();
    a.scheduler.advance(TICK_INTERVAL * 3);
    b.scheduler.advance(TICK_INTERVAL * 3);
    expect(a.stateManager.getState()).toEqual(b.stateManager.getState());

    // Test catch-up versus piecewise: advancing all at once vs step-by-step
    // should produce the same lastTickAt thanks to scheduled-time math.
    const c = buildHarness();
    const d = buildHarness();
    c.scheduler.advance(TICK_INTERVAL * 4);
    for (let i = 0; i < 4; i += 1) {
      d.scheduler.advance(TICK_INTERVAL);
    }
    expect(c.stateManager.getState().lastTickAt).toBe(
      d.stateManager.getState().lastTickAt,
    );
    expect(c.stateManager.getState()).toEqual(d.stateManager.getState());
  });

  it('pause event is appended before tick event on the seventh tick', () => {
    const h = buildHarness();
    h.scheduler.advance(TICK_INTERVAL * 7);
    const all = h.persistence.getEventsSince(0);
    const pauseIdx = all.findIndex((e) => e.type === 'pause');
    const lastTickIdx = all.map((e) => e.type).lastIndexOf('tick');
    expect(pauseIdx).toBeGreaterThan(-1);
    expect(pauseIdx).toBeLessThan(lastTickIdx);
  });
});
