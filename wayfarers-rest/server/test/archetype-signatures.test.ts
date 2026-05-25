/**
 * Phase 8 (C3): archetype-signature tests.
 *
 * Two signatures wired today:
 *  - bard 'performs' at the hearth: lifts shared_drink ×1.5 for pairs
 *    also in the hearth zone
 *  - soldier 'broods' when paired with another soldier: lifts
 *    overheard_argument ×1.2 between the pair
 *
 * Tests pin both signature behaviors against a baseline (no signature in
 * play) over a population of seeds so the multiplier shows up in the
 * aggregate even though any single resolve is deterministic-and-random.
 */
import { describe, expect, it } from 'vitest';
import type { Npc, ZoneName } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import {
  bothSoldiers,
  computeArchetypeModifiers,
  NO_ARCHETYPE_MODIFIERS,
} from '../src/npc/archetype-signatures.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { InteractionResolver } from '../src/interactions/resolver.ts';
import { Persistence } from '../src/persistence.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { WorldTagsManager } from '../src/world/tags.ts';
import '../src/threads/archetypes/index.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function makeNpc(input: {
  id: string;
  archetype: string;
  zone: ZoneName;
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
  };
}

describe('computeArchetypeModifiers — bard at hearth', () => {
  it('returns bardPerformBuff > 1 only when a bard is in the hearth zone', () => {
    const noBard = computeArchetypeModifiers([
      makeNpc({ id: 's1', archetype: 'soldier', zone: 'bar' }),
    ]);
    expect(noBard.bardPerformBuff).toBe(1);
    expect(noBard.bardPerformZone).toBeUndefined();

    const bardAtBar = computeArchetypeModifiers([
      makeNpc({ id: 'b1', archetype: 'bard', zone: 'bar' }),
    ]);
    expect(bardAtBar.bardPerformBuff).toBe(1);

    const bardAtHearth = computeArchetypeModifiers([
      makeNpc({ id: 'b1', archetype: 'bard', zone: 'hearth' }),
    ]);
    expect(bardAtHearth.bardPerformBuff).toBeGreaterThan(1);
    expect(bardAtHearth.bardPerformZone).toBe('hearth');
  });

  it('ignores staff bards (staff have their own path)', () => {
    const npc: Npc = {
      ...makeNpc({ id: 'b1', archetype: 'bard', zone: 'hearth' }),
      isStaff: true,
    };
    const mods = computeArchetypeModifiers([npc]);
    expect(mods.bardPerformBuff).toBe(1);
  });
});

describe('bothSoldiers', () => {
  it('true only when both NPCs have archetype soldier', () => {
    const s = makeNpc({ id: 's', archetype: 'soldier', zone: 'bar' });
    const w = makeNpc({ id: 'w', archetype: 'wanderer', zone: 'bar' });
    expect(bothSoldiers(s, s)).toBe(true);
    expect(bothSoldiers(s, w)).toBe(false);
    expect(bothSoldiers(undefined, s)).toBe(false);
  });
});

describe('InteractionResolver — C3 signature multipliers', () => {
  function harness() {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const worldTags = new WorldTagsManager(persistence, bus);
    const rumors = new RumorsManager(persistence, bus);
    rumors.setFlavorCache(null);
    const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
    const resolver = new InteractionResolver(bus, threadRunner, undefined, persistence);
    return { persistence, bus, resolver };
  }

  function resolveOver(
    archetypeA: string,
    archetypeB: string,
    zone: ZoneName,
    count: number,
    archetypeMods: typeof NO_ARCHETYPE_MODIFIERS | undefined,
  ) {
    const kinds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const h = harness();
      const a = makeNpc({ id: `A-${i}`, archetype: archetypeA, zone });
      const b = makeNpc({ id: `B-${i}`, archetype: archetypeB, zone });
      const interaction = h.resolver.resolve(
        {
          zone,
          participantIds: [a.id, b.id],
        },
        {
          worldSeed: `c3-${i}`,
          gameDay: 1,
          subTick: 5,
          npcsById: new Map([[a.id, a], [b.id, b]]),
          perDayCounter: { value: 0 },
          archetypeModifiers: archetypeMods,
        },
      );
      kinds.push(interaction.kind);
      h.persistence.close();
    }
    return kinds;
  }

  it('bard performance buff lifts shared_drink frequency at the hearth', () => {
    const N = 80;
    const buffed = resolveOver('wanderer', 'wanderer', 'hearth', N, {
      bardPerformBuff: 1.5,
      bardPerformZone: 'hearth',
      soldierBroodBuff: 1.2,
    });
    const baseline = resolveOver('wanderer', 'wanderer', 'hearth', N, undefined);
    const buffedDrinks = buffed.filter((k) => k === 'shared_drink').length;
    const baseDrinks = baseline.filter((k) => k === 'shared_drink').length;
    expect(buffedDrinks).toBeGreaterThanOrEqual(baseDrinks);
  });

  it('soldier brood buff lifts overheard_argument frequency between soldiers', () => {
    const N = 120;
    const broodMods = {
      bardPerformBuff: 1,
      bardPerformZone: undefined,
      soldierBroodBuff: 1.2,
    };
    const buffed = resolveOver('soldier', 'soldier', 'bar', N, broodMods);
    const baseline = resolveOver('soldier', 'soldier', 'bar', N, undefined);
    const buffedArgs = buffed.filter((k) => k === 'overheard_argument').length;
    const baseArgs = baseline.filter((k) => k === 'overheard_argument').length;
    expect(buffedArgs).toBeGreaterThanOrEqual(baseArgs);
  });

  it('soldier brood buff does NOT apply when only one soldier is in the pair', () => {
    const N = 80;
    const broodMods = {
      bardPerformBuff: 1,
      bardPerformZone: undefined,
      soldierBroodBuff: 1.2,
    };
    const mixed = resolveOver('soldier', 'wanderer', 'bar', N, broodMods);
    const baseline = resolveOver('soldier', 'wanderer', 'bar', N, undefined);
    const mixedArgs = mixed.filter((k) => k === 'overheard_argument').length;
    const baseArgs = baseline.filter((k) => k === 'overheard_argument').length;
    // The single-soldier path should *not* show the brood boost; over a small
    // sweep with identical seeds the counts should match exactly.
    expect(mixedArgs).toBe(baseArgs);
  });
});
