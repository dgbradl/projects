/**
 * Phase 8 (A5): tests for the economy + memory outcome of desire fulfilment.
 *
 *  - computeGuestSpend: a satisfied guest tips more, and the extra draws are
 *    appended after the legacy 4-draw stream so guests with zero fulfilled
 *    desires (legacy rows, staff) see no change in their spend numbers.
 *  - CharacterMemory: a stay's desire outcomes (fulfilled + denied counts)
 *    fold into the character's `desireHistory` on npc_departed.
 *  - Prosperity: desire_unfulfilled events in the rolling window pull
 *    windowSocial down (validated through the existing windowSocial path).
 */
import { describe, expect, it } from 'vitest';
import type {
  CharacterMemory,
  Interaction,
  NpcDesire,
} from '@shared/types';
import { computeGuestSpend, totalSpend } from '../src/economy/spend.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import {
  CharacterMemoryRecorder,
  emptyMemory,
  rememberDesireOutcomes,
} from '../src/npc/character-memory.ts';
import { Persistence } from '../src/persistence.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('computeGuestSpend — A5 desire tip bump', () => {
  const baseInput = {
    worldSeed: 'A5-seed',
    npcId: 'guest1',
    arrivedGameDay: 1,
    archetype: 'wanderer' as const,
    mood: 'cheerful' as const,
    visitCount: 1,
    affinitySum: 0,
    stayedOvernight: false,
  };

  it('produces identical breakdown when fulfilledDesireCount is 0 or omitted (legacy contract)', () => {
    const a = computeGuestSpend({ ...baseInput });
    const b = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 0 });
    expect(a).toEqual(b);
  });

  it('raises the tip when desires were fulfilled', () => {
    const none = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 0 });
    const one = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 1 });
    const two = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 2 });
    expect(one.tip).toBeGreaterThan(none.tip);
    expect(two.tip).toBeGreaterThan(one.tip);
  });

  it('leaves drink/meal/room unchanged regardless of fulfilledDesireCount', () => {
    const none = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 0 });
    const two = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 2 });
    expect(two.drink).toBe(none.drink);
    expect(two.meal).toBe(none.meal);
    expect(two.room).toBe(none.room);
  });

  it('is deterministic — same input → same output', () => {
    const a = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 2 });
    const b = computeGuestSpend({ ...baseInput, fulfilledDesireCount: 2 });
    expect(a).toEqual(b);
  });

  it('lifts totalSpend monotonically with fulfilled desires', () => {
    const none = totalSpend(computeGuestSpend({ ...baseInput, fulfilledDesireCount: 0 }));
    const two = totalSpend(computeGuestSpend({ ...baseInput, fulfilledDesireCount: 2 }));
    expect(two).toBeGreaterThan(none);
  });
});

describe('rememberDesireOutcomes — A5 memory increment', () => {
  it('counts fulfilled and denied separately', () => {
    const desires: NpcDesire[] = [
      { kind: 'warm_meal', fulfilledAtSubTick: 1, fulfilledBy: 'staff:waitstaff' },
      { kind: 'news_of_location', param: 'oldspire' }, // unfulfilled
    ];
    const m = rememberDesireOutcomes(emptyMemory(), desires);
    expect(m.desireHistory).toEqual({ fulfilled: 1, denied: 1 });
  });

  it('merges into an existing desireHistory', () => {
    const prior: CharacterMemory = {
      ...emptyMemory(),
      desireHistory: { fulfilled: 3, denied: 2 },
    };
    const m = rememberDesireOutcomes(prior, [
      { kind: 'warm_meal', fulfilledAtSubTick: 1, fulfilledBy: 'sim' },
      { kind: 'warm_meal', fulfilledAtSubTick: 1, fulfilledBy: 'sim' },
    ]);
    expect(m.desireHistory).toEqual({ fulfilled: 5, denied: 2 });
  });

  it('returns the input unchanged when desires is empty or undefined', () => {
    const m = emptyMemory();
    expect(rememberDesireOutcomes(m, [])).toBe(m);
    expect(rememberDesireOutcomes(m, undefined)).toBe(m);
  });
});

describe('CharacterMemoryRecorder — A5 npc_departed.desires path', () => {
  function setup() {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const recorder = new CharacterMemoryRecorder(persistence);
    recorder.attach(bus);
    persistence.upsertCharacter({
      id: 'g1',
      displayName: 'Hester',
      archetype: 'wanderer',
      firstSeenGameDay: 1,
      lastSeenGameDay: 1,
      visitCount: 1,
      memory: emptyMemory(),
    });
    return { persistence, bus };
  }

  it('folds a departing NPCs desire outcomes into their CharacterMemory', () => {
    const { persistence, bus } = setup();
    bus.publish({
      type: 'npc_departed',
      gameDay: 2,
      npcId: 'g1',
      displayName: 'Hester',
      desires: [
        { kind: 'warm_meal', fulfilledAtSubTick: 50, fulfilledBy: 'staff:waitstaff' },
        { kind: 'news_of_location', param: 'oldspire' },
      ],
    });
    const after = persistence.loadCharacter('g1')!;
    expect(after.memory.desireHistory).toEqual({ fulfilled: 1, denied: 1 });
  });

  it('accumulates across repeat visits', () => {
    const { persistence, bus } = setup();
    bus.publish({
      type: 'npc_departed',
      gameDay: 2,
      npcId: 'g1',
      desires: [{ kind: 'warm_meal', fulfilledAtSubTick: 50, fulfilledBy: 'sim' }],
    });
    bus.publish({
      type: 'npc_departed',
      gameDay: 5,
      npcId: 'g1',
      desires: [
        { kind: 'bed_for_night', fulfilledAtSubTick: 200, fulfilledBy: 'sim' },
        { kind: 'quiet_seat' }, // unfulfilled
      ],
    });
    const after = persistence.loadCharacter('g1')!;
    expect(after.memory.desireHistory).toEqual({ fulfilled: 2, denied: 1 });
  });

  it('is a no-op when the departing payload has no desires (staff path)', () => {
    const { persistence, bus } = setup();
    bus.publish({
      type: 'npc_departed',
      gameDay: 2,
      npcId: 'g1',
      // no desires field
    });
    const after = persistence.loadCharacter('g1')!;
    expect(after.memory.desireHistory).toBeUndefined();
  });
});

describe('updateProsperityForDay — A5 unfulfilled desires pull windowSocial down', () => {
  // Reach the prosperity update through the existing module — we publish a
  // mix of interactions and desire_unfulfilled events into the same window
  // and check that the resulting score is lower when desires went unmet.
  // This is a behavioural test, not a pinned-number test, because the
  // smoothing means the absolute delta is small per day.
  it('a day with unfulfilled desires settles lower than a day without', async () => {
    const { updateProsperityForDay } = await import('../src/economy/prosperity.ts');
    const { WorldStateManager } = await import('../src/state.ts');

    function bootstrap(seedKey: string) {
      const persistence = new Persistence(':memory:');
      const clock = new FakeClock(NOW);
      const stateManager = new WorldStateManager(persistence, clock, () => seedKey);
      const bus = new WorldEventBus(persistence, clock);
      // Seed an empty day-1 ledger so updateProsperity has a row to update.
      persistence.upsertDailyLedger({
        gameDay: 1,
        income: 50,
        expense: 30,
        net: 20,
        guestCount: 4,
        coinAfter: 270,
        prosperityAfter: undefined,
      });
      return { persistence, stateManager, bus };
    }

    const happy = bootstrap('happy');
    // Two friendly drinks, no arguments, no unfulfilled desires.
    const friendlyInteraction: Interaction = {
      id: 'int1',
      gameDay: 1,
      subTick: 10,
      zone: 'bar',
      participantIds: ['a', 'b'],
      kind: 'shared_drink',
    };
    happy.bus.publish({ type: 'interaction', gameDay: 1, interaction: friendlyInteraction });
    happy.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: { ...friendlyInteraction, id: 'int2', participantIds: ['c', 'd'] },
    });
    const happyResult = updateProsperityForDay(happy, 1)!;

    const sour = bootstrap('sour');
    // Same two friendly drinks, but four guests left unmet.
    sour.bus.publish({ type: 'interaction', gameDay: 1, interaction: friendlyInteraction });
    sour.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: { ...friendlyInteraction, id: 'int2', participantIds: ['c', 'd'] },
    });
    for (let i = 0; i < 4; i += 1) {
      sour.bus.publish({
        type: 'desire_unfulfilled',
        gameDay: 1,
        npcId: `g${i}`,
        desireKind: 'warm_meal',
      });
    }
    const sourResult = updateProsperityForDay(sour, 1)!;

    expect(sourResult.score).toBeLessThan(happyResult.score);
  });
});
