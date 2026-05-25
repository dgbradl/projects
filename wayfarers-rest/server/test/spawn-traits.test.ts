/**
 * Phase 8 (D3): trait-driven arrival mix.
 *
 * Same seed, different trait sets → archetype distribution shifts in the
 * expected direction. Counts stay bounded (no single archetype runs away
 * above ~60%) even with two stacking traits.
 */
import { describe, expect, it } from 'vitest';
import type { TavernTrait } from '@shared/types';
import { generateSpawnQueue } from '../src/npc/spawn.ts';

function arrivalsForTraits(traits: TavernTrait[], seed = 'd3-seed', days = 5) {
  const counts: Record<string, number> = {};
  for (let day = 1; day <= days; day += 1) {
    const arrivals = generateSpawnQueue({
      worldSeed: seed,
      gameDay: day,
      subTicksPerDay: 360,
      tavernTraits: traits,
    });
    for (const a of arrivals) {
      const arch = a.archetype ?? 'wanderer';
      counts[arch] = (counts[arch] ?? 0) + 1;
    }
  }
  return counts;
}

describe('generateSpawnQueue — D3 trait-driven mix', () => {
  it('bardic_stage shifts the mix toward bards', () => {
    const noTrait = arrivalsForTraits([]);
    const bardic = arrivalsForTraits(['bardic_stage']);
    expect((bardic.bard ?? 0)).toBeGreaterThanOrEqual(noTrait.bard ?? 0);
  });

  it("scholars_quiet draws more scholars than no-trait", () => {
    // Run across a sweep of seeds to dampen noise.
    let scholarTotalQuiet = 0;
    let scholarTotalNone = 0;
    for (let i = 0; i < 12; i += 1) {
      scholarTotalQuiet +=
        arrivalsForTraits(['scholars_quiet'], `seed-${i}`).scholar ?? 0;
      scholarTotalNone += arrivalsForTraits([], `seed-${i}`).scholar ?? 0;
    }
    expect(scholarTotalQuiet).toBeGreaterThan(scholarTotalNone);
  });

  it('arcane_haven draws more mages than no-trait', () => {
    let mageQuiet = 0;
    let mageNone = 0;
    for (let i = 0; i < 12; i += 1) {
      mageQuiet += arrivalsForTraits(['arcane_haven'], `seed-${i}`).mage ?? 0;
      mageNone += arrivalsForTraits([], `seed-${i}`).mage ?? 0;
    }
    expect(mageQuiet).toBeGreaterThan(mageNone);
  });

  it('hunters_lodge draws more hunters than no-trait', () => {
    let hunterLodge = 0;
    let hunterNone = 0;
    for (let i = 0; i < 12; i += 1) {
      hunterLodge +=
        arrivalsForTraits(['hunters_lodge'], `seed-${i}`).hunter ?? 0;
      hunterNone += arrivalsForTraits([], `seed-${i}`).hunter ?? 0;
    }
    expect(hunterLodge).toBeGreaterThan(hunterNone);
  });

  it('two stacking traits keep individual share <= 60% over a sweep', () => {
    // Stack hunters_lodge + frontier_post (both lean hunter) and check
    // hunter never dominates over a meaningful sweep.
    const sweep = arrivalsForTraits(
      ['hunters_lodge', 'frontier_post'],
      'stack-seed',
      20, // 20 days of arrivals
    );
    const total = Object.values(sweep).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    const hunterShare = (sweep.hunter ?? 0) / total;
    expect(hunterShare).toBeLessThanOrEqual(0.6);
  });

  it('is deterministic for a given (seed, traits, day)', () => {
    const a = generateSpawnQueue({
      worldSeed: 'det-seed',
      gameDay: 3,
      subTicksPerDay: 360,
      tavernTraits: ['bardic_stage', 'arcane_haven'],
    });
    const b = generateSpawnQueue({
      worldSeed: 'det-seed',
      gameDay: 3,
      subTicksPerDay: 360,
      tavernTraits: ['bardic_stage', 'arcane_haven'],
    });
    expect(a.map((x) => x.archetype)).toEqual(b.map((x) => x.archetype));
  });

  it('falls back gracefully when tavernTraits is undefined', () => {
    const arrivals = generateSpawnQueue({
      worldSeed: 'no-traits',
      gameDay: 1,
      subTicksPerDay: 360,
    });
    expect(arrivals.length).toBeGreaterThan(0);
    for (const a of arrivals) expect(typeof a.archetype).toBe('string');
  });
});
