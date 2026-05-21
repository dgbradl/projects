import { describe, expect, it } from 'vitest';
import type { EventLogEntry, Npc, Thread, WorldEvent } from '@shared/types';
import { score, select } from '../src/chronicle/salience.ts';
import { DEFAULT_ALARMING_VALUES } from '../src/chronicle/types.ts';

function entry(id: number, event: WorldEvent): EventLogEntry {
  return { id, realTimestamp: '2026-01-01T00:00:00.000Z', event };
}

function npc(id: string, overrides: Partial<Npc> = {}): Npc {
  return {
    id,
    displayName: id,
    status: 'seated',
    position: { x: 50, y: 50 },
    zone: 'bar',
    arrivedGameDay: 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 2,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 99,
    carriedRumorIds: [],
    ...overrides,
  };
}

const ctx = {
  npcsById: new Map<string, Npc>([
    ['a', npc('a', { carriedRumorIds: ['r1'] })],
    ['b', npc('b', { archetype: 'soldier' })],
    ['c', npc('c', { arrivedGameDay: 1 })],
  ]),
  threadsById: new Map<string, Thread>(),
  alarmingValues: DEFAULT_ALARMING_VALUES,
};

describe('salience.score', () => {
  it('is 0 for excluded event types', () => {
    expect(score({ type: 'init', gameDay: 1 }, ctx)).toBe(0);
    expect(score({ type: 'tick', gameDay: 1 }, ctx)).toBe(0);
    expect(score({ type: 'pause', gameDay: 1 }, ctx)).toBe(0);
    expect(score({ type: 'resume', gameDay: 1 }, ctx)).toBe(0);
    expect(
      score(
        {
          type: 'flavor_cache_miss',
          gameDay: 1,
          slot: 'arrival',
        },
        ctx,
      ),
    ).toBe(0);
    expect(
      score(
        {
          type: 'flavor_mode_changed',
          gameDay: 1,
          oldMode: 'llm',
          newMode: 'placeholder',
          reason: 'x',
        },
        ctx,
      ),
    ).toBe(0);
  });

  it('boosts world_tag_changed when transitioning into an alarming value', () => {
    const calm = score(
      {
        type: 'world_tag_changed',
        gameDay: 1,
        key: 'season',
        oldValue: 'spring',
        newValue: 'summer',
      },
      ctx,
    );
    const alarming = score(
      {
        type: 'world_tag_changed',
        gameDay: 1,
        key: 'war_in_north',
        oldValue: 'simmering',
        newValue: 'escalating',
      },
      ctx,
    );
    expect(calm).toBe(8);
    expect(alarming).toBe(10);
  });

  it('boosts npc_arrived when the NPC carries a rumor or has a notable archetype', () => {
    const plain = score(
      { type: 'npc_arrived', gameDay: 1, npcId: 'c', displayName: 'c' },
      ctx,
    );
    const rumorCarrier = score(
      { type: 'npc_arrived', gameDay: 1, npcId: 'a', displayName: 'a' },
      ctx,
    );
    const notableArchetype = score(
      { type: 'npc_arrived', gameDay: 1, npcId: 'b', displayName: 'b' },
      ctx,
    );
    expect(plain).toBe(2);
    expect(rumorCarrier).toBe(5);
    expect(notableArchetype).toBe(5);
  });

  it('scores npc_returned above npc_arrived and rewards visit count', () => {
    const arrived = score(
      { type: 'npc_arrived', gameDay: 1, npcId: 'c', displayName: 'c' },
      ctx,
    );
    const returnedOnce = score(
      { type: 'npc_returned', gameDay: 1, npcId: 'c', displayName: 'c', visitCount: 2 },
      ctx,
    );
    const returnedRegular = score(
      { type: 'npc_returned', gameDay: 1, npcId: 'c', displayName: 'c', visitCount: 6 },
      ctx,
    );
    expect(arrived).toBe(2);
    expect(returnedOnce).toBe(5); // base 4 + min(2-1, 3)
    expect(returnedRegular).toBe(7); // base 4 + min(6-1, 3)
    expect(returnedOnce).toBeGreaterThan(arrived);
  });

  it('rewards interaction kind + spawned thread', () => {
    const plain = score(
      {
        type: 'interaction',
        gameDay: 1,
        interaction: {
          id: 'int_1',
          gameDay: 1,
          subTick: 1,
          zone: 'bar',
          participantIds: ['a', 'b'],
          kind: 'shared_drink',
        },
      },
      ctx,
    );
    const whispered = score(
      {
        type: 'interaction',
        gameDay: 1,
        interaction: {
          id: 'int_2',
          gameDay: 1,
          subTick: 1,
          zone: 'bar',
          participantIds: ['a', 'b'],
          kind: 'whispered_exchange',
          spawnedThreadId: 'thread_z',
        },
      },
      ctx,
    );
    expect(plain).toBe(1);
    expect(whispered).toBe(9); // 1 + 3 (kind) + 5 (spawned)
  });

  it('scores ledger_closed, with a boost when the day ran a loss', () => {
    const surplus = score(
      {
        type: 'ledger_closed',
        gameDay: 1,
        income: 80,
        expense: 30,
        net: 50,
        coinBefore: 200,
        coinAfter: 250,
        guestCount: 5,
      },
      ctx,
    );
    const shortfall = score(
      {
        type: 'ledger_closed',
        gameDay: 1,
        income: 10,
        expense: 40,
        net: -30,
        coinBefore: 200,
        coinAfter: 170,
        guestCount: 1,
      },
      ctx,
    );
    expect(surplus).toBe(4);
    expect(shortfall).toBe(6); // 4 + 2 when net < 0
  });

  it('excludes per-event economy noise (guest_spent, tavern_upkeep)', () => {
    expect(
      score(
        {
          type: 'guest_spent',
          gameDay: 1,
          npcId: 'a',
          amount: 12,
          breakdown: { drink: 8, meal: 0, room: 0, tip: 4 },
        },
        ctx,
      ),
    ).toBe(0);
    expect(
      score({ type: 'tavern_upkeep', gameDay: 1, amount: 20, occupancy: 4 }, ctx),
    ).toBe(0);
  });
});

describe('salience.select', () => {
  it('returns top-N in chronological order, with deterministic tie-break by id', () => {
    const entries: EventLogEntry[] = [
      entry(1, { type: 'tick', gameDay: 1 }), // excluded
      entry(2, { type: 'npc_arrived', gameDay: 1, npcId: 'a', displayName: 'a' }), // 5
      entry(3, { type: 'npc_arrived', gameDay: 1, npcId: 'c', displayName: 'c' }), // 2
      entry(4, {
        type: 'world_tag_changed',
        gameDay: 1,
        key: 'k',
        oldValue: 'v',
        newValue: 'w',
      }), // 8
      entry(5, {
        type: 'thread_completed',
        gameDay: 1,
        threadId: 'thread_1',
        outcome: 'misfortune',
      }), // 9
      entry(6, { type: 'rumor_introduced', gameDay: 1, rumorId: 'r1' }), // 5
    ];
    const out = select(entries, ctx, { maxEvents: 4 });
    // Top scores by id: 5 (=9), 4 (=8), 2 (=5), 6 (=5).
    // Within tie [2,6], id-asc: 2 then 6.
    expect(out.map((e) => e.id)).toEqual([2, 4, 5, 6]);
  });

  it('filters out zero-score events entirely', () => {
    const entries: EventLogEntry[] = [
      entry(1, { type: 'tick', gameDay: 1 }),
      entry(2, { type: 'init', gameDay: 1 }),
    ];
    expect(select(entries, ctx)).toEqual([]);
  });

  it('is deterministic across calls', () => {
    const entries: EventLogEntry[] = [
      entry(2, { type: 'npc_arrived', gameDay: 1, npcId: 'a', displayName: 'a' }),
      entry(4, {
        type: 'world_tag_changed',
        gameDay: 1,
        key: 'k',
        oldValue: 'v',
        newValue: 'w',
      }),
      entry(5, { type: 'rumor_introduced', gameDay: 1, rumorId: 'r1' }),
    ];
    const a = select(entries, ctx).map((e) => e.id);
    const b = select(entries, ctx).map((e) => e.id);
    expect(a).toEqual(b);
  });
});
