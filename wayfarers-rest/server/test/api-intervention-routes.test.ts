import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import {
  buildMarkNpc,
  buildStirWorld,
  buildSwayThread,
} from '../src/interventions/kinds/index.ts';
import * as interventionRegistry from '../src/interventions/registry.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import '../src/threads/archetypes/index.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { TickScheduler } from '../src/tick.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'route-seed');
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  const npcManager = new NpcManager(
    { worldSeed: 'route-seed', subTicksPerDay: 30 },
    { persistence, bus },
  );
  const scheduler = new TickScheduler(
    stateManager,
    clock,
    { tickIntervalMs: 1_000, schedulerCheckMs: 100 },
    bus,
  );

  // Register the deps-bound kinds (plant_rumor + beckon self-registered on import).
  interventionRegistry.register(buildSwayThread({ persistence }));
  interventionRegistry.register(buildStirWorld({ persistence }));
  interventionRegistry.register(buildMarkNpc({ npcManager, stateManager, bus }));
  worldTags.set('war_in_north', 'quiet', 1);

  const app = Fastify();
  app.addHook('onClose', async () => persistence.close());
  const deps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: 100,
    subTicksPerDay: 30,
    threadRunner,
    worldTags,
    rumors,
    favorsMax: 5,
  };
  registerRoutes(app, deps);
  return { app, persistence, stateManager, bus };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  while (openApps.length) {
    const app = openApps.pop()!;
    await app.close().catch(() => {});
  }
});

describe('intervention REST routes', () => {
  it('GET /interventions/options returns coherent target data', async () => {
    const h = build();
    openApps.push(h.app);
    const res = await h.app.inject({ method: 'GET', url: '/interventions/options' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.favors).toBe(3);
    expect(body.favorsMax).toBe(5);
    expect(body.kinds.length).toBe(5);
    expect(Array.isArray(body.targets.locations)).toBe(true);
    expect(body.targets.locations.length).toBeGreaterThan(0);
    expect(body.targets.worldTags.find((t: { key: string }) => t.key === 'war_in_north')).toBeDefined();
  });

  it('POST /interventions debits the favor, persists the record, emits the event', async () => {
    const h = build();
    openApps.push(h.app);
    const res = await h.app.inject({
      method: 'POST',
      url: '/interventions',
      payload: {
        kind: 'plant_rumor',
        payload: { locationId: 'oldspire', tone: 'foreboding' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intervention.kind).toBe('plant_rumor');
    expect(body.intervention.effect.introducedRumorId).toBeTruthy();
    expect(body.state.favors).toBe(2);
    const events = h.persistence.getEventsSince(0).map((e) => e.event.type);
    expect(events).toContain('intervention_used');
  });

  it('insufficient favors returns 400 with state unchanged', async () => {
    const h = build();
    openApps.push(h.app);
    h.stateManager.setState({ ...h.stateManager.getState(), favors: 0 });
    const res = await h.app.inject({
      method: 'POST',
      url: '/interventions',
      payload: { kind: 'plant_rumor', payload: { locationId: 'oldspire' } },
    });
    expect(res.statusCode).toBe(400);
    expect(h.stateManager.getState().favors).toBe(0);
  });

  it('validation rejection returns 400 atomically', async () => {
    const h = build();
    openApps.push(h.app);
    const before = h.stateManager.getState().favors;
    const res = await h.app.inject({
      method: 'POST',
      url: '/interventions',
      payload: { kind: 'plant_rumor', payload: { locationId: 'nowhere' } },
    });
    expect(res.statusCode).toBe(400);
    expect(h.stateManager.getState().favors).toBe(before);
  });
});
