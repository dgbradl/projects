/**
 * Phase 9 (G2): merchant 'transacts' signature tests.
 *
 *  - processMerchantTransaction detects valid pairs, honours the per-day
 *    cap, and stays silent for non-merchants / no customer / staff.
 *  - computeGuestSpend adds tip per transaction without changing the
 *    drink/meal/room buckets; non-transactors stay identical to baseline.
 *  - InteractionResolver respects ResolverContext.forcedKind.
 */
import { describe, expect, it } from 'vitest';
import type { Npc, ZoneName } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { InteractionResolver } from '../src/interactions/resolver.ts';
import {
  MERCHANT_DAILY_TRANSACTION_CAP,
  processMerchantTransaction,
} from '../src/npc/archetype-signatures.ts';
import { computeGuestSpend, totalSpend } from '../src/economy/spend.ts';
import { Persistence } from '../src/persistence.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { WorldTagsManager } from '../src/world/tags.ts';
import '../src/threads/archetypes/index.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function npc(input: {
  id: string;
  archetype: string;
  zone: ZoneName;
  isStaff?: boolean;
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: 'at_bar',
    position: { x: 50, y: 50 },
    zone: input.zone,
    arrivedGameDay: 0,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 999,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype,
    visitCount: 1,
    isStaff: input.isStaff,
  };
}

describe('processMerchantTransaction — eligibility', () => {
  it('returns undefined when no merchant is in the roster', () => {
    const tally = new Map<string, number>();
    for (let s = 0; s < 200; s += 1) {
      const r = processMerchantTransaction({
        roster: [npc({ id: 'w', archetype: 'wanderer', zone: 'bar' })],
        worldSeed: 'no-merchant',
        gameDay: 1,
        subTick: s,
        transactionsToday: tally,
      });
      expect(r).toBeUndefined();
    }
  });

  it('returns undefined when no non-merchant shares the zone', () => {
    const tally = new Map<string, number>();
    for (let s = 0; s < 200; s += 1) {
      const r = processMerchantTransaction({
        roster: [
          npc({ id: 'm1', archetype: 'merchant', zone: 'bar' }),
          npc({ id: 'm2', archetype: 'merchant', zone: 'bar' }),
          // a customer in a DIFFERENT zone — should be ignored
          npc({ id: 'w', archetype: 'wanderer', zone: 'table_a' }),
        ],
        worldSeed: 'no-zone-share',
        gameDay: 1,
        subTick: s,
        transactionsToday: tally,
      });
      expect(r).toBeUndefined();
    }
  });

  it('ignores staff (staff have their own paths)', () => {
    const tally = new Map<string, number>();
    for (let s = 0; s < 200; s += 1) {
      const r = processMerchantTransaction({
        roster: [
          npc({ id: 'm', archetype: 'merchant', zone: 'bar', isStaff: true }),
          npc({ id: 'w', archetype: 'wanderer', zone: 'bar' }),
        ],
        worldSeed: 'staff-merchant',
        gameDay: 1,
        subTick: s,
        transactionsToday: tally,
      });
      expect(r).toBeUndefined();
    }
  });
});

describe('processMerchantTransaction — fire + cap', () => {
  it('eventually fires for a valid pair', () => {
    const tally = new Map<string, number>();
    let result;
    for (let s = 0; s < 500 && !result; s += 1) {
      result = processMerchantTransaction({
        roster: [
          npc({ id: 'merc', archetype: 'merchant', zone: 'bar' }),
          npc({ id: 'cust', archetype: 'wanderer', zone: 'bar' }),
        ],
        worldSeed: 'fire',
        gameDay: 1,
        subTick: s,
        transactionsToday: tally,
      });
    }
    expect(result).toBeDefined();
    expect(result!.merchantId).toBe('merc');
    expect(result!.customerId).toBe('cust');
    expect(result!.zone).toBe('bar');
  });

  it('respects the per-day cap', () => {
    const tally = new Map<string, number>();
    // Pre-fill the tally to the cap; the function should refuse.
    tally.set('merc', MERCHANT_DAILY_TRANSACTION_CAP);
    for (let s = 0; s < 500; s += 1) {
      const r = processMerchantTransaction({
        roster: [
          npc({ id: 'merc', archetype: 'merchant', zone: 'bar' }),
          npc({ id: 'cust', archetype: 'wanderer', zone: 'bar' }),
        ],
        worldSeed: 'cap',
        gameDay: 1,
        subTick: s,
        transactionsToday: tally,
      });
      expect(r).toBeUndefined();
    }
  });

  it('is deterministic per (seed, gameDay, subTick, merchantId)', () => {
    function runOnce() {
      const tally = new Map<string, number>();
      for (let s = 0; s < 500; s += 1) {
        const r = processMerchantTransaction({
          roster: [
            npc({ id: 'merc', archetype: 'merchant', zone: 'bar' }),
            npc({ id: 'cust', archetype: 'wanderer', zone: 'bar' }),
          ],
          worldSeed: 'det',
          gameDay: 1,
          subTick: s,
          transactionsToday: tally,
        });
        if (r) return s;
      }
      return -1;
    }
    expect(runOnce()).toBe(runOnce());
  });
});

describe('computeGuestSpend — G2 transaction tip bump', () => {
  const baseInput = {
    worldSeed: 'g2-seed',
    npcId: 'm1',
    arrivedGameDay: 1,
    archetype: 'merchant' as const,
    mood: 'cheerful' as const,
    visitCount: 1,
    affinitySum: 0,
    stayedOvernight: false,
  };

  it('zero transactions produces the same breakdown as omitting the field', () => {
    const a = computeGuestSpend(baseInput);
    const b = computeGuestSpend({ ...baseInput, merchantTransactionCount: 0 });
    expect(a).toEqual(b);
  });

  it('raises the tip when transactions are reported', () => {
    const none = computeGuestSpend({ ...baseInput, merchantTransactionCount: 0 });
    const one = computeGuestSpend({ ...baseInput, merchantTransactionCount: 1 });
    const two = computeGuestSpend({ ...baseInput, merchantTransactionCount: 2 });
    expect(one.tip).toBeGreaterThan(none.tip);
    expect(two.tip).toBeGreaterThan(one.tip);
  });

  it('leaves drink / meal / room buckets unchanged', () => {
    const none = computeGuestSpend({ ...baseInput, merchantTransactionCount: 0 });
    const two = computeGuestSpend({ ...baseInput, merchantTransactionCount: 2 });
    expect(two.drink).toBe(none.drink);
    expect(two.meal).toBe(none.meal);
    expect(two.room).toBe(none.room);
  });

  it('composes with the A5 desire bump (both append after legacy)', () => {
    const a = computeGuestSpend({
      ...baseInput,
      fulfilledDesireCount: 1,
      merchantTransactionCount: 2,
    });
    const b = computeGuestSpend({
      ...baseInput,
      fulfilledDesireCount: 0,
      merchantTransactionCount: 0,
    });
    expect(totalSpend(a)).toBeGreaterThan(totalSpend(b));
  });
});

describe('InteractionResolver — forcedKind path', () => {
  it('uses ctx.forcedKind instead of picking from weights', () => {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const worldTags = new WorldTagsManager(persistence, bus);
    const rumors = new RumorsManager(persistence, bus);
    rumors.setFlavorCache(null);
    const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
    const resolver = new InteractionResolver(bus, threadRunner, undefined, persistence);

    const a = npc({ id: 'A', archetype: 'merchant', zone: 'bar' });
    const b = npc({ id: 'B', archetype: 'wanderer', zone: 'bar' });
    const interaction = resolver.resolve(
      { zone: 'bar', participantIds: [a.id, b.id] },
      {
        worldSeed: 'forced',
        gameDay: 1,
        subTick: 5,
        npcsById: new Map([[a.id, a], [b.id, b]]),
        perDayCounter: { value: 0 },
        forcedKind: 'transaction',
      },
    );
    expect(interaction.kind).toBe('transaction');
    persistence.close();
  });
});
