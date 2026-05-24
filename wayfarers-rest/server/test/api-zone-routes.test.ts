import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';
import { resetActiveZonesToDefaults, TAVERN_ZONES } from '../src/world/tavern.ts';
import { ZoneManager } from '../src/world/zone-manager.ts';

const TICK_INTERVAL = 1000;
const SUB_TICKS_PER_DAY = 10;

function buildApp() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
  const stateManager = new WorldStateManager(persistence, clock, () => 'z-seed');
  const bus = new WorldEventBus(persistence, clock);
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
  const zoneManager = new ZoneManager(persistence);
  const app = Fastify();
  app.addHook('onClose', async () => persistence.close());
  const deps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: TICK_INTERVAL / SUB_TICKS_PER_DAY,
    subTicksPerDay: SUB_TICKS_PER_DAY,
    zoneManager,
  };
  registerRoutes(app, deps);
  return { app };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  while (openApps.length) await openApps.pop()!.close().catch(() => {});
  resetActiveZonesToDefaults();
});

describe('zone routes', () => {
  it('GET /zones returns the seeded defaults', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/zones' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(TAVERN_ZONES.length);
  });

  it('POST /zones creates a custom zone', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({
      method: 'POST',
      url: '/zones',
      payload: { name: 'snug', x: 70, y: 80, radius: 4 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('snug');
  });

  it('POST /zones rejects collisions and invalid names', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const dup = await app.inject({
      method: 'POST',
      url: '/zones',
      payload: { name: 'bar', x: 1, y: 1, radius: 1 },
    });
    expect(dup.statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/zones',
      payload: { name: 'has space', x: 1, y: 1, radius: 1 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PATCH /zones/:name updates fields; 404 when missing', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/zones/bar',
      payload: { x: 40, radius: 9 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().x).toBe(40);
    expect(ok.json().radius).toBe(9);
    const missing = await app.inject({
      method: 'PATCH',
      url: '/zones/no-such',
      payload: { x: 1 },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('DELETE /zones/:name removes it; 404 if absent', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const del = await app.inject({ method: 'DELETE', url: '/zones/table_a' });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({ method: 'DELETE', url: '/zones/table_a' });
    expect(again.statusCode).toBe(404);
  });

  it('POST /zones/reset restores all defaults', async () => {
    const { app } = buildApp();
    openApps.push(app);
    await app.inject({ method: 'DELETE', url: '/zones/table_a' });
    const reset = await app.inject({ method: 'POST', url: '/zones/reset' });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().find((z: { name: string }) => z.name === 'table_a')).toBeTruthy();
  });

  it('/tavern returns the dynamic zone list after a mutation', async () => {
    const { app } = buildApp();
    openApps.push(app);
    await app.inject({
      method: 'POST',
      url: '/zones',
      payload: { name: 'snug', x: 70, y: 80, radius: 4 },
    });
    const t = await app.inject({ method: 'GET', url: '/tavern' });
    const names = t.json().zones.map((z: { name: string }) => z.name);
    expect(names).toContain('snug');
  });
});
