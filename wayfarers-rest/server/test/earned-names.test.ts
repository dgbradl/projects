/**
 * Phase 9 (H2): earned regular names tests.
 *
 *  - buildEarnedName produces deterministic output per (worldSeed, characterId)
 *  - Each archetype has at least one template; output substitutes {name}
 *  - Unknown archetype returns undefined (caller falls back to placeholder)
 *  - Persistence round-trips earnedName + earnedTagline
 */
import { describe, expect, it } from 'vitest';
import type { Character, NpcArchetype } from '@shared/types';
import {
  buildEarnedName,
  EARNED_NAME_THRESHOLD,
} from '../src/npc/earned-names.ts';
import { emptyMemory } from '../src/npc/character-memory.ts';
import { Persistence } from '../src/persistence.ts';

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

describe('buildEarnedName — determinism', () => {
  it('produces the same output for the same (worldSeed, characterId)', () => {
    const a = buildEarnedName({
      baseDisplayName: 'Marrick',
      archetype: 'wanderer',
      characterId: 'npc_d1_0',
      worldSeed: 'h2-seed',
    });
    const b = buildEarnedName({
      baseDisplayName: 'Marrick',
      archetype: 'wanderer',
      characterId: 'npc_d1_0',
      worldSeed: 'h2-seed',
    });
    expect(a).toEqual(b);
  });

  it('produces different outputs for different ids (same seed)', () => {
    let foundDifference = false;
    for (let i = 0; i < 20 && !foundDifference; i += 1) {
      const a = buildEarnedName({
        baseDisplayName: 'Name',
        archetype: 'soldier',
        characterId: `id-A-${i}`,
        worldSeed: 'shared',
      });
      const b = buildEarnedName({
        baseDisplayName: 'Name',
        archetype: 'soldier',
        characterId: `id-B-${i}`,
        worldSeed: 'shared',
      });
      if (a?.displayName !== b?.displayName) foundDifference = true;
    }
    expect(foundDifference).toBe(true);
  });
});

describe('buildEarnedName — coverage', () => {
  it('returns a valid result for every canonical archetype', () => {
    for (const a of ARCHETYPES) {
      const result = buildEarnedName({
        baseDisplayName: 'Test',
        archetype: a,
        characterId: `${a}-1`,
        worldSeed: 'coverage',
      });
      expect(result).toBeDefined();
      expect(result!.displayName).toContain('Test');
      expect(result!.tagline.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for unknown archetype strings (defence-in-depth)', () => {
    const r = buildEarnedName({
      baseDisplayName: 'X',
      archetype: 'returning_traveler', // not in EPITHETS_BY_ARCHETYPE
      characterId: 'x',
      worldSeed: 's',
    });
    expect(r).toBeUndefined();
  });

  it('always substitutes the base displayName into the template', () => {
    for (const a of ARCHETYPES) {
      const r = buildEarnedName({
        baseDisplayName: 'BobBob',
        archetype: a,
        characterId: `${a}-2`,
        worldSeed: 's',
      });
      expect(r!.displayName).toContain('BobBob');
    }
  });
});

describe('EARNED_NAME_THRESHOLD', () => {
  it('is a sensible positive integer', () => {
    expect(Number.isInteger(EARNED_NAME_THRESHOLD)).toBe(true);
    expect(EARNED_NAME_THRESHOLD).toBeGreaterThanOrEqual(2);
    expect(EARNED_NAME_THRESHOLD).toBeLessThanOrEqual(10);
  });
});

describe('Persistence — earnedName/earnedTagline round-trip', () => {
  function baseCharacter(): Character {
    return {
      id: 'p-1',
      displayName: 'Hester',
      archetype: 'pilgrim',
      firstSeenGameDay: 1,
      lastSeenGameDay: 5,
      visitCount: 4,
      memory: emptyMemory(),
    };
  }

  it('stores undefined earnedName/earnedTagline cleanly', () => {
    const p = new Persistence(':memory:');
    p.upsertCharacter(baseCharacter());
    const loaded = p.loadCharacter('p-1')!;
    expect(loaded.earnedName).toBeUndefined();
    expect(loaded.earnedTagline).toBeUndefined();
    p.close();
  });

  it('round-trips a populated earned name + tagline', () => {
    const p = new Persistence(':memory:');
    p.upsertCharacter({
      ...baseCharacter(),
      earnedName: 'Brother Hester',
      earnedTagline: 'walks toward something further every year',
    });
    const loaded = p.loadCharacter('p-1')!;
    expect(loaded.earnedName).toBe('Brother Hester');
    expect(loaded.earnedTagline).toBe('walks toward something further every year');
    p.close();
  });
});
