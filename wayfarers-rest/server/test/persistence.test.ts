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
      subTick: 42,
      lastAcknowledgedGameDay: 0,
      favors: 3,
      favorsLastRegenGameDay: 0,
      markedNpcIds: [],
      coin: 200,
      prosperity: 0,
    tavernName: "The Wayfarer\'s Rest",
    tavernTraits: [],
    };
    p.saveState(state);
    expect(p.loadState()).toEqual(state);
  });

  it('round-trips a DailyLedger write -> read', () => {
    const p = new Persistence(':memory:');
    const ledger = {
      gameDay: 4,
      income: 88,
      expense: 34,
      net: 54,
      guestCount: 6,
      coinAfter: 254,
    };
    p.upsertDailyLedger(ledger);
    expect(p.loadDailyLedger(4)).toEqual(ledger);
    expect(p.loadDailyLedger(99)).toBeNull();

    // Upsert overwrites in place.
    p.upsertDailyLedger({ ...ledger, income: 100, net: 66, coinAfter: 266 });
    expect(p.loadDailyLedger(4)).toEqual({
      ...ledger,
      income: 100,
      net: 66,
      coinAfter: 266,
    });
  });

  it('event log appends produce monotonically increasing ids', () => {
    const p = new Persistence(':memory:');
    const e1 = p.appendWorldEvent({ type: 'init', gameDay: 1 }, 't1');
    const e2 = p.appendWorldEvent({ type: 'tick', gameDay: 2 }, 't2');
    const e3 = p.appendWorldEvent({ type: 'tick', gameDay: 3 }, 't3');
    expect(e2.id).toBeGreaterThan(e1.id);
    expect(e3.id).toBeGreaterThan(e2.id);
  });

  it('getEventsSince(N) returns the correct slice in ascending order', () => {
    const p = new Persistence(':memory:');
    const e1 = p.appendWorldEvent({ type: 'init', gameDay: 1 }, 't1');
    const e2 = p.appendWorldEvent({ type: 'tick', gameDay: 2 }, 't2');
    const e3 = p.appendWorldEvent({ type: 'tick', gameDay: 3 }, 't3');

    const fromZero = p.getEventsSince(0);
    expect(fromZero.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);

    const afterFirst = p.getEventsSince(e1.id);
    expect(afterFirst.map((e) => e.id)).toEqual([e2.id, e3.id]);

    const afterLast = p.getEventsSince(e3.id);
    expect(afterLast).toEqual([]);
  });

  it('event payloads JSON-round-trip including discriminated payloads', () => {
    const p = new Persistence(':memory:');
    const entry = p.appendWorldEvent(
      {
        type: 'world_tag_changed',
        gameDay: 1,
        key: 'war_in_north',
        oldValue: 'quiet',
        newValue: 'simmering',
      },
      't',
    );
    const [back] = p.getEventsSince(0);
    expect(back).toEqual(entry);
  });

  it('cold start initializes default WorldState without writing any events itself', () => {
    const p = new Persistence(':memory:');
    const clock = new FakeClock(Date.parse('2026-05-18T00:00:00.000Z'));
    const m = new WorldStateManager(p, clock, () => 'cold-start-seed');

    const state = m.getState();
    expect(state.gameDay).toBe(1);
    expect(state.status).toBe('running');
    expect(state.unattendedTicks).toBe(0);
    expect(state.seed).toBe('cold-start-seed');
    expect(state.subTick).toBe(0);
    expect(state.lastTickAt).toBe('2026-05-18T00:00:00.000Z');

    // The init event is now emitted by the wiring layer (index.ts), not by
    // WorldStateManager. The cold-start signal is exposed via isColdStart().
    expect(m.isColdStart()).toBe(true);
    expect(p.getEventsSince(0)).toEqual([]);
  });

  it('warm start with existing state loads it and reports not-cold-start', () => {
    const p = new Persistence(':memory:');
    const existing: WorldState = {
      gameDay: 3,
      lastTickAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      unattendedTicks: 2,
      seed: 'persisted',
      subTick: 0,
      lastAcknowledgedGameDay: 0,
      favors: 3,
      favorsLastRegenGameDay: 0,
      markedNpcIds: [],
      coin: 200,
      prosperity: 0,
    tavernName: "The Wayfarer\'s Rest",
    tavernTraits: [],
    };
    p.saveState(existing);

    const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
    const m = new WorldStateManager(p, clock, () => 'should-not-be-used');

    expect(m.getState()).toEqual(existing);
    expect(m.isColdStart()).toBe(false);
  });
});
