import { describe, expect, it } from 'vitest';
import type { NpcArchetype } from '@shared/types';
import {
  computeGuestSpend,
  totalSpend,
  type GuestSpendInput,
} from '../src/economy/spend.ts';

const BASE: GuestSpendInput = {
  worldSeed: 'econ-seed',
  npcId: 'npc_d1_0',
  arrivedGameDay: 1,
  archetype: 'wanderer',
  mood: undefined,
  visitCount: 1,
  affinitySum: 0,
  stayedOvernight: false,
};

const ALL_ARCHETYPES: NpcArchetype[] = [
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
];

describe('computeGuestSpend', () => {
  it('is deterministic for identical inputs', () => {
    expect(computeGuestSpend(BASE)).toEqual(computeGuestSpend({ ...BASE }));
  });

  it('produces non-negative integers across archetypes and days', () => {
    for (const archetype of ALL_ARCHETYPES) {
      for (let day = 1; day <= 8; day += 1) {
        const b = computeGuestSpend({
          ...BASE,
          archetype,
          arrivedGameDay: day,
          npcId: `npc_${archetype}_${day}`,
        });
        for (const v of [b.drink, b.meal, b.room, b.tip]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('diverges across npcId, arrivedGameDay, and worldSeed', () => {
    const base = totalSpend(computeGuestSpend(BASE));
    const variants = [
      totalSpend(computeGuestSpend({ ...BASE, npcId: 'npc_other' })),
      totalSpend(computeGuestSpend({ ...BASE, arrivedGameDay: 2 })),
      totalSpend(computeGuestSpend({ ...BASE, worldSeed: 'different' })),
    ];
    expect(variants.some((v) => v !== base)).toBe(true);
  });

  it('charges a room only for an overnight stay', () => {
    expect(computeGuestSpend({ ...BASE, stayedOvernight: false }).room).toBe(0);
    expect(
      computeGuestSpend({ ...BASE, stayedOvernight: true }).room,
    ).toBeGreaterThan(0);
  });

  it('a merchant out-drinks a refugee on the same seed', () => {
    const merchant = computeGuestSpend({ ...BASE, archetype: 'merchant' });
    const refugee = computeGuestSpend({ ...BASE, archetype: 'refugee' });
    expect(merchant.drink).toBeGreaterThan(refugee.drink);
  });

  it('a returning regular tips more than a first-timer', () => {
    const firstTime = computeGuestSpend({ ...BASE, visitCount: 1 });
    const regular = computeGuestSpend({ ...BASE, visitCount: 6 });
    expect(regular.tip).toBeGreaterThan(firstTime.tip);
  });

  it('positive affinity lifts the tip', () => {
    const cold = computeGuestSpend({ ...BASE, affinitySum: 0 });
    const warm = computeGuestSpend({ ...BASE, affinitySum: 30 });
    expect(warm.tip).toBeGreaterThan(cold.tip);
  });

  it('mood scales the tab — cheerful spends more than weary', () => {
    const cheerful = computeGuestSpend({ ...BASE, mood: 'cheerful' });
    const weary = computeGuestSpend({ ...BASE, mood: 'weary' });
    expect(totalSpend(cheerful)).toBeGreaterThan(totalSpend(weary));
  });
});
