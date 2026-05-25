/**
 * Phase 8 (A1): tests for deterministic NPC desire generation.
 *
 * Two contracts pinned here: (1) same (worldSeed, npcId) always produces the
 * same desires regardless of platform, (2) per-archetype pools shape the
 * distribution — soldiers want company_of_kind more than scholars do, etc.
 */
import { describe, expect, it } from 'vitest';
import type { NpcArchetype } from '@shared/types';
import { generateDesires } from '../src/npc/desires.ts';

const ARCHETYPES: NpcArchetype[] = [
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
  'mage',
  'knight',
  'bard',
  'hunter',
];

describe('generateDesires — determinism', () => {
  it('returns the same desires for the same (worldSeed, npcId)', () => {
    for (const archetype of ARCHETYPES) {
      const a = generateDesires({ archetype, npcId: 'npc-x', worldSeed: 'seed-a' });
      const b = generateDesires({ archetype, npcId: 'npc-x', worldSeed: 'seed-a' });
      expect(a).toEqual(b);
    }
  });

  it('returns different desires for different seeds (probabilistically)', () => {
    // Run a small sweep and confirm at least one pair differs — pinning a
    // specific guaranteed difference would over-couple to the RNG implementation.
    let observedDifference = false;
    for (let i = 0; i < 20; i += 1) {
      const a = generateDesires({
        archetype: 'wanderer',
        npcId: `npc_${i}`,
        worldSeed: 'seed-a',
      });
      const b = generateDesires({
        archetype: 'wanderer',
        npcId: `npc_${i}`,
        worldSeed: 'seed-b',
      });
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        observedDifference = true;
        break;
      }
    }
    expect(observedDifference).toBe(true);
  });

  it('returns 1 or 2 desires, never 0 for known archetypes', () => {
    for (const archetype of ARCHETYPES) {
      for (let i = 0; i < 20; i += 1) {
        const desires = generateDesires({
          archetype,
          npcId: `${archetype}-${i}`,
          worldSeed: 'seed',
        });
        expect(desires.length).toBeGreaterThanOrEqual(1);
        expect(desires.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('does not generate duplicate desire kinds within a single arrival', () => {
    for (const archetype of ARCHETYPES) {
      for (let i = 0; i < 50; i += 1) {
        const desires = generateDesires({
          archetype,
          npcId: `${archetype}-dup-${i}`,
          worldSeed: 'seed',
        });
        const kinds = desires.map((d) => d.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
      }
    }
  });
});

describe('generateDesires — staff short-circuit', () => {
  it('returns an empty array when isStaff is true', () => {
    const desires = generateDesires({
      archetype: 'bartender' as unknown as NpcArchetype,
      npcId: 'mirela',
      worldSeed: 'seed',
      isStaff: true,
    });
    expect(desires).toEqual([]);
  });
});

describe('generateDesires — archetype-shaped distributions', () => {
  // Helper: sample N npcs of an archetype and count desire kinds.
  function sampleKindCounts(
    archetype: NpcArchetype,
    n: number,
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i += 1) {
      const desires = generateDesires({
        archetype,
        npcId: `${archetype}-${i}`,
        worldSeed: 'dist-seed',
      });
      for (const d of desires) {
        counts[d.kind] = (counts[d.kind] ?? 0) + 1;
      }
    }
    return counts;
  }

  it('soldiers want company_of_kind more than scholars do', () => {
    const N = 200;
    const soldierCounts = sampleKindCounts('soldier', N);
    const scholarCounts = sampleKindCounts('scholar', N);
    expect(soldierCounts.company_of_kind ?? 0).toBeGreaterThan(
      scholarCounts.company_of_kind ?? 0,
    );
  });

  it('refugees want warm_meal or bed_for_night more than rogues do', () => {
    const N = 200;
    const refugeeCounts = sampleKindCounts('refugee', N);
    const rogueCounts = sampleKindCounts('rogue', N);
    const refugeeNeed =
      (refugeeCounts.warm_meal ?? 0) + (refugeeCounts.bed_for_night ?? 0);
    const rogueNeed =
      (rogueCounts.warm_meal ?? 0) + (rogueCounts.bed_for_night ?? 0);
    expect(refugeeNeed).toBeGreaterThan(rogueNeed);
  });

  it('scholars and mages want quiet_seat more than soldiers do', () => {
    const N = 200;
    const scholarCounts = sampleKindCounts('scholar', N);
    const mageCounts = sampleKindCounts('mage', N);
    const soldierCounts = sampleKindCounts('soldier', N);
    expect(scholarCounts.quiet_seat ?? 0).toBeGreaterThan(
      soldierCounts.quiet_seat ?? 0,
    );
    expect(mageCounts.quiet_seat ?? 0).toBeGreaterThan(
      soldierCounts.quiet_seat ?? 0,
    );
  });

  it('bards want company more than refugees do', () => {
    const N = 200;
    const bardCounts = sampleKindCounts('bard', N);
    const refugeeCounts = sampleKindCounts('refugee', N);
    expect(bardCounts.company_of_kind ?? 0).toBeGreaterThan(
      refugeeCounts.company_of_kind ?? 0,
    );
  });
});

describe('generateDesires — params', () => {
  it('attaches a location id to news_of_location desires', () => {
    // Scholars draw from a location-heavy pool, so this is reliable to find one
    // within a reasonable sweep without coupling to specific RNG sequencing.
    let found = false;
    for (let i = 0; i < 50; i += 1) {
      const desires = generateDesires({
        archetype: 'scholar',
        npcId: `scholar-${i}`,
        worldSeed: 'param-seed',
      });
      for (const d of desires) {
        if (d.kind === 'news_of_location') {
          expect(typeof d.param).toBe('string');
          expect(d.param!.length).toBeGreaterThan(0);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('attaches a tone string to rumor_of_tone desires', () => {
    let found = false;
    for (let i = 0; i < 50; i += 1) {
      const desires = generateDesires({
        archetype: 'rogue',
        npcId: `rogue-${i}`,
        worldSeed: 'param-seed',
      });
      for (const d of desires) {
        if (d.kind === 'rumor_of_tone') {
          expect(['foreboding', 'curious', 'mundane', 'urgent']).toContain(
            d.param,
          );
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('attaches an archetype string (or "any") to company_of_kind desires', () => {
    // Soldiers heavily lean company_of_kind:soldier — a small sweep finds one.
    let found = false;
    for (let i = 0; i < 50; i += 1) {
      const desires = generateDesires({
        archetype: 'soldier',
        npcId: `soldier-${i}`,
        worldSeed: 'param-seed',
      });
      for (const d of desires) {
        if (d.kind === 'company_of_kind') {
          expect(typeof d.param).toBe('string');
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });
});
