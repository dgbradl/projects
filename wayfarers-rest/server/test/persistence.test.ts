import { describe, expect, it } from 'vitest';
import type { WorldState } from '@shared/types';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

describe('Persistence', () => {
  it('round-trips WorldState write -> read with deep equality', () => {
    const p = new Persistence(':memory:');
    const state: WorldState = {
      gameDay: 5,
      lastTickAt: '2026-01-01T00:00:05.000Z',
      status: 'paused',
      unattendedTicks: 7,
      seed: 'abc123',
    };
    p.saveState(state);
    expect(p.loadState()).toEqual(state);
  });

  it('event log appends produce monotonically increasing ids', () => {
    const p = new Persistence(':memory:');
    const e1 = p.appendEvent({
      gameDay: 1,
      realTimestamp: 't1',
      type: 'init',
      payload: {},
    });
    const e2 = p.appendEvent({
      gameDay: 2,
      realTimestamp: 't2',
      type: 'tick',
      payload: { n: 1 },
    });
    const e3 = p.appendEvent({
      gameDay: 3,
      realTimestamp: 't3',
      type: 'tick',
      payload: { n: 2 },
    });
    expect(e2.id).toBeGreaterThan(e1.id);
    expect(e3.id).toBeGreaterThan(e2.id);
  });

  it('getEventsSince(N) returns the correct slice in ascending order', () => {
    const p = new Persistence(':memory:');
    const e1 = p.appendEvent({
      gameDay: 1,
      realTimestamp: 't1',
      type: 'tick',
      payload: {},
    });
    const e2 = p.appendEvent({
      gameDay: 2,
      realTimestamp: 't2',
      type: 'tick',
      payload: {},
    });
    const e3 = p.appendEvent({
      gameDay: 3,
      realTimestamp: 't3',
      type: 'tick',
      payload: {},
    });

    const fromZero = p.getEventsSince(0);
    expect(fromZero.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);

    const afterFirst = p.getEventsSince(e1.id);
    expect(afterFirst.map((e) => e.id)).toEqual([e2.id, e3.id]);

    const afterLast = p.getEventsSince(e3.id);
    expect(afterLast).toEqual([]);
  });

  it('event payloads JSON-round-trip including nested objects', () => {
    const p = new Persistence(':memory:');
    const payload = { reason: 'unattended_cap', detail: { count: 7 } };
    p.appendEvent({
      gameDay: 1,
      realTimestamp: 't',
      type: 'pause',
      payload,
    });
    const [evt] = p.getEventsSince(0);
    expect(evt.payload).toEqual(payload);
  });

  it('cold start with no existing state initializes default and writes one init event', () => {
    const p = new Persistence(':memory:');
    const clock = new FakeClock(Date.parse('2026-05-18T00:00:00.000Z'));
    const m = new WorldStateManager(p, clock, () => 'cold-start-seed');

    const state = m.getState();
    expect(state.gameDay).toBe(1);
    expect(state.status).toBe('running');
    expect(state.unattendedTicks).toBe(0);
    expect(state.seed).toBe('cold-start-seed');
    expect(state.lastTickAt).toBe('2026-05-18T00:00:00.000Z');

    const events = p.getEventsSince(0);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('init');
    expect(events[0].gameDay).toBe(1);
    expect(events[0].payload).toEqual({ seed: 'cold-start-seed' });
  });

  it('warm start with existing state loads it without writing a duplicate init event', () => {
    const p = new Persistence(':memory:');
    const existing: WorldState = {
      gameDay: 3,
      lastTickAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      unattendedTicks: 2,
      seed: 'persisted',
    };
    p.saveState(existing);

    const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
    const m = new WorldStateManager(p, clock, () => 'should-not-be-used');

    expect(m.getState()).toEqual(existing);
    expect(p.getEventsSince(0)).toEqual([]);
  });
});
