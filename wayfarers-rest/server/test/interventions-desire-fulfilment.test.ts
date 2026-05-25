/**
 * Phase 8 (A4): verb-side desire fulfilment.
 *
 * Two paths covered: plant_rumor matches news_of_location / rumor_of_tone
 * on present NPCs; beckon matches company_of_kind on present NPCs. Both
 * surface via `InterventionEffect.fulfilledDesireOnNpcId` and emit
 * desire_fulfilled with `keeper:<kind>` provenance.
 */
import { describe, expect, it } from 'vitest';
import type { EventLogEntry, Npc, NpcDesire, WorldEvent } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { buildInterventionHelpers } from '../src/interventions/helpers.ts';
import { BECKON } from '../src/interventions/kinds/beckon.ts';
import { PLANT_RUMOR } from '../src/interventions/kinds/plant-rumor.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { DesireResolver } from '../src/npc/desire-resolver.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SUBTICKS_PER_DAY = 360;

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  rumors.setFlavorCache(null);
  const npcManager = new NpcManager(
    { worldSeed: 'test', subTicksPerDay: SUBTICKS_PER_DAY },
    { persistence, bus },
  );
  const desireResolver = new DesireResolver({
    npcManager,
    bus,
    subTicksPerDay: SUBTICKS_PER_DAY,
  });
  desireResolver.attach();
  const helpers = buildInterventionHelpers({
    rumors,
    threadRunner,
    worldTags,
    bus,
    gameDay: 1,
    desireResolver,
    npcManager,
    subTicksPerDay: SUBTICKS_PER_DAY,
    subTick: 100,
  });
  const events: WorldEvent[] = [];
  bus.on('world_event', (entry: EventLogEntry) => events.push(entry.event));
  return { persistence, bus, npcManager, helpers, events };
}

function makeGuest(input: {
  id: string;
  archetype: string;
  desires: NpcDesire[];
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: 'at_bar',
    position: { x: 50, y: 50 },
    zone: 'bar',
    arrivedGameDay: 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 1,
    plannedDepartureSubTick: SUBTICKS_PER_DAY - 1,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype,
    visitCount: 1,
    desires: input.desires,
  };
}

describe('plant_rumor — A4 desire fulfilment', () => {
  it('fulfils a present NPC waiting on news of that location', () => {
    const h = build();
    h.npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'lana',
          archetype: 'scholar',
          desires: [{ kind: 'news_of_location', param: 'oldspire' }],
        }),
      ],
      spawnQueue: [],
    });

    const effect = PLANT_RUMOR.apply({
      payload: { locationId: 'oldspire', tone: 'curious' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });

    expect(effect.fulfilledDesireOnNpcId).toBe('lana');
    expect(effect.introducedRumorId).toBeTruthy();

    const fulfilled = h.events.filter((e) => e.type === 'desire_fulfilled');
    expect(fulfilled).toHaveLength(1);
    const ev = fulfilled[0] as WorldEvent & { type: 'desire_fulfilled' };
    expect(ev.fulfilledBy).toBe('keeper:plant_rumor');
    expect(ev.desireKind).toBe('news_of_location');
  });

  it('fulfils a rumor_of_tone desire when the planted tone matches', () => {
    const h = build();
    h.npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'rook',
          archetype: 'rogue',
          desires: [{ kind: 'rumor_of_tone', param: 'foreboding' }],
        }),
      ],
      spawnQueue: [],
    });
    const effect = PLANT_RUMOR.apply({
      payload: { locationId: 'whitepike', tone: 'foreboding' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.fulfilledDesireOnNpcId).toBe('rook');
  });

  it('returns undefined when no present NPC matches', () => {
    const h = build();
    h.npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'lana',
          archetype: 'scholar',
          desires: [{ kind: 'news_of_location', param: 'iron_quay' }],
        }),
      ],
      spawnQueue: [],
    });
    const effect = PLANT_RUMOR.apply({
      payload: { locationId: 'oldspire', tone: 'curious' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.fulfilledDesireOnNpcId).toBeUndefined();
    expect(h.events.some((e) => e.type === 'desire_fulfilled')).toBe(false);
  });

  it('still works without the optional desireResolver wiring (no fulfilment)', () => {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const worldTags = new WorldTagsManager(persistence, bus);
    const rumors = new RumorsManager(persistence, bus);
    const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
    rumors.setFlavorCache(null);
    const helpers = buildInterventionHelpers({
      rumors,
      threadRunner,
      worldTags,
      bus,
      gameDay: 1,
      // no desireResolver, no npcManager
    });
    const effect = PLANT_RUMOR.apply({
      payload: { locationId: 'oldspire' },
      helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.introducedRumorId).toBeTruthy();
    expect(effect.fulfilledDesireOnNpcId).toBeUndefined();
  });
});

describe('beckon — A4 desire fulfilment', () => {
  it("fulfils a present NPC's company_of_kind when the beckoned archetype matches", () => {
    const h = build();
    h.npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'aren',
          archetype: 'soldier',
          desires: [{ kind: 'company_of_kind', param: 'bard' }],
        }),
      ],
      spawnQueue: [],
    });
    const effect = BECKON.apply({
      payload: { archetype: 'bard' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.fulfilledDesireOnNpcId).toBe('aren');
    const fulfilled = h.events.filter((e) => e.type === 'desire_fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(
      (fulfilled[0] as WorldEvent & { type: 'desire_fulfilled' }).fulfilledBy,
    ).toBe('keeper:beckon');
  });

  it("matches when param is 'any'", () => {
    const h = build();
    h.npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'bard1',
          archetype: 'bard',
          desires: [{ kind: 'company_of_kind', param: 'any' }],
        }),
      ],
      spawnQueue: [],
    });
    const effect = BECKON.apply({
      payload: { archetype: 'soldier' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.fulfilledDesireOnNpcId).toBe('bard1');
  });

  it('returns undefined when no present NPC wants company of that kind', () => {
    const h = build();
    h.npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'lana',
          archetype: 'scholar',
          desires: [{ kind: 'quiet_seat' }],
        }),
      ],
      spawnQueue: [],
    });
    const effect = BECKON.apply({
      payload: { archetype: 'merchant' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.fulfilledDesireOnNpcId).toBeUndefined();
    expect(effect.spawnedThreadId).toBeTruthy();
  });

  it('still spawns the approaching_stranger thread when no fulfilment happens', () => {
    const h = build();
    h.npcManager.hydrate({ npcs: [], spawnQueue: [] });
    const effect = BECKON.apply({
      payload: { archetype: 'wanderer' },
      helpers: h.helpers,
      state: {} as never,
      options: { state: {} as never, targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.spawnedThreadId).toBeTruthy();
    expect(effect.fulfilledDesireOnNpcId).toBeUndefined();
  });
});
