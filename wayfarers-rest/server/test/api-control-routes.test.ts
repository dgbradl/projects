import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { WorldTagsManager } from '../src/world/tags.ts';
import '../src/threads/archetypes/index.ts';

const TICK_INTERVAL = 1000;
const SUB_TICKS_PER_DAY = 10;
const SUBTICK_MS = TICK_INTERVAL / SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function buildApp() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(
    persistence,
    clock,
    () => 'control-seed',
  );
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  const npcManager = new NpcManager(
    { worldSeed: stateManager.getState().seed, subTicksPerDay: SUB_TICKS_PER_DAY },
    { persistence, bus },
  );
  const scheduler = new TickScheduler(
    stateManager,
    clock,
    { tickIntervalMs: TICK_INTERVAL, schedulerCheckMs: 100 },
    bus,
  );
  const app = Fastify();
  app.addHook('onClose', async () => persistence.close());
  const deps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: SUBTICK_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
    threadRunner,
    worldTags,
    rumors,
  };
  bus.publish({ type: 'init', gameDay: stateManager.getState().gameDay });
  registerRoutes(app, deps);
  return { app, persistence, clock, stateManager, scheduler, npcManager, bus, threadRunner, worldTags };
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  while (openApps.length) {
    const app = openApps.pop()!;
    await app.close().catch(() => {});
  }
});

describe('control routes', () => {
  it('POST /control/pause flips status to paused without changing gameDay', async () => {
    const { app, stateManager, persistence } = buildApp();
    openApps.push(app);

    const res = await app.inject({ method: 'POST', url: '/control/pause' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('paused');
    expect(body.gameDay).toBe(stateManager.getState().gameDay);
    expect(
      persistence
        .getEventsSince(0)
        .some((e) => e.event.type === 'pause'),
    ).toBe(true);
  });

  it('POST /control/stop flips status to stopped', async () => {
    const { app, persistence } = buildApp();
    openApps.push(app);

    const res = await app.inject({ method: 'POST', url: '/control/stop' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('stopped');
    expect(
      persistence
        .getEventsSince(0)
        .some((e) => e.event.type === 'pause'),
    ).toBe(true);
  });

  it('POST /control/resume from paused restores running', async () => {
    const { app, persistence } = buildApp();
    openApps.push(app);

    await app.inject({ method: 'POST', url: '/control/pause' });
    const res = await app.inject({ method: 'POST', url: '/control/resume' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('running');
    expect(
      persistence
        .getEventsSince(0)
        .filter((e) => e.event.type === 'resume').length,
    ).toBe(1);
  });

  it('POST /control/resume from stopped restores running', async () => {
    const { app } = buildApp();
    openApps.push(app);

    await app.inject({ method: 'POST', url: '/control/stop' });
    const res = await app.inject({ method: 'POST', url: '/control/resume' });
    expect(res.json().status).toBe('running');
  });

  it('POST /control/reset wipes gameDay to 1 and re-seeds world tags', async () => {
    const { app, stateManager, scheduler, clock, persistence } = buildApp();
    openApps.push(app);

    // Advance some game days and add a marker rumor so we can confirm wipe.
    for (let i = 0; i < 3; i += 1) {
      clock.advance(TICK_INTERVAL);
      scheduler.runCatchUp();
    }
    expect(stateManager.getState().gameDay).toBe(4);
    persistence.saveRumor({
      id: 'rumor-pre-reset',
      text: 'a marker rumor',
      introducedGameDay: 2,
      available: true,
    });
    expect(persistence.loadAllRumors().some((r) => r.id === 'rumor-pre-reset'))
      .toBe(true);

    const res = await app.inject({ method: 'POST', url: '/control/reset' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gameDay).toBe(1);
    expect(body.status).toBe('running');

    // Marker rumor is gone; the world tags are seeded fresh.
    expect(persistence.loadAllRumors().some((r) => r.id === 'rumor-pre-reset'))
      .toBe(false);
    const tagKeys = persistence.getAllWorldTags().map((t) => t.key);
    expect(tagKeys).toContain('season');
  });
});
