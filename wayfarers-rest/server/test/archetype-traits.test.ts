/**
 * Phase 8 (C1): archetype trait table — shape tests.
 *
 * Pins the *relative shape* of the table: every canonical archetype is
 * present, every trait is well-formed, and the high-level "bards lean
 * hearth / scholars dwell longer than refugees" claims hold. Exact
 * numbers are tuneable and not asserted here.
 */
import { describe, expect, it } from 'vitest';
import type { NpcArchetype } from '@shared/types';
import {
  ARCHETYPE_TRAITS,
  traitsFor,
} from '../src/npc/archetype-traits.ts';

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

describe('ARCHETYPE_TRAITS — well-formedness', () => {
  it('covers every canonical archetype', () => {
    for (const a of ARCHETYPES) {
      expect(ARCHETYPE_TRAITS[a]).toBeDefined();
    }
  });

  it('every traits row has at least one preferred zone', () => {
    for (const a of ARCHETYPES) {
      expect(ARCHETYPE_TRAITS[a].preferredZones.length).toBeGreaterThan(0);
    }
  });

  it('dwell multipliers are bounded sensibly', () => {
    for (const a of ARCHETYPES) {
      const m = ARCHETYPE_TRAITS[a].dwellMultiplier;
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(2);
    }
  });

  it('cluster affinities are in [0, 1]', () => {
    for (const a of ARCHETYPES) {
      const c = ARCHETYPE_TRAITS[a].clusterAffinity;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('ARCHETYPE_TRAITS — shape claims', () => {
  it("bards lean toward the hearth", () => {
    const bard = ARCHETYPE_TRAITS.bard.preferredZones;
    const hearthCount = bard.filter((z) => z === 'hearth').length;
    expect(hearthCount).toBeGreaterThan(0);
    // Hearth at least as represented as any table zone.
    const tableCount = bard.filter((z) => z.startsWith('table_')).length;
    expect(hearthCount).toBeGreaterThanOrEqual(tableCount);
  });

  it('scholars dwell longer than refugees', () => {
    expect(ARCHETYPE_TRAITS.scholar.dwellMultiplier).toBeGreaterThan(
      ARCHETYPE_TRAITS.refugee.dwellMultiplier,
    );
  });

  it('soldiers cluster more than rogues', () => {
    expect(ARCHETYPE_TRAITS.soldier.clusterAffinity).toBeGreaterThan(
      ARCHETYPE_TRAITS.rogue.clusterAffinity,
    );
  });

  it('soldiers cluster more than wanderers (baseline = 0)', () => {
    expect(ARCHETYPE_TRAITS.soldier.clusterAffinity).toBeGreaterThan(
      ARCHETYPE_TRAITS.wanderer.clusterAffinity,
    );
  });

  it('refugees stay shorter than knights', () => {
    expect(ARCHETYPE_TRAITS.refugee.dwellMultiplier).toBeLessThan(
      ARCHETYPE_TRAITS.knight.dwellMultiplier,
    );
  });
});

describe('ARCHETYPE_TRAITS — signature flags', () => {
  it('bard has the performs signature', () => {
    expect(ARCHETYPE_TRAITS.bard.signature).toBe('performs');
  });
  it('soldier has the broods signature', () => {
    expect(ARCHETYPE_TRAITS.soldier.signature).toBe('broods');
  });
  it('scholar has the studies signature', () => {
    expect(ARCHETYPE_TRAITS.scholar.signature).toBe('studies');
  });
  it('merchant has the transacts signature', () => {
    expect(ARCHETYPE_TRAITS.merchant.signature).toBe('transacts');
  });
});

describe('traitsFor — safe lookup', () => {
  it('returns the matching row for canonical archetypes', () => {
    expect(traitsFor('bard')).toBe(ARCHETYPE_TRAITS.bard);
  });

  it('falls back to wanderer for unknown strings', () => {
    expect(traitsFor('returning_traveler')).toBe(ARCHETYPE_TRAITS.wanderer);
    expect(traitsFor(undefined)).toBe(ARCHETYPE_TRAITS.wanderer);
    expect(traitsFor('')).toBe(ARCHETYPE_TRAITS.wanderer);
  });
});
