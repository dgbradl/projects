import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FurnitureManager } from '../src/furniture/manager.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';

const TICK_INTERVAL = 1000;
const SUB_TICKS_PER_DAY = 10;

function buildApp() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
  const stateManager = new WorldStateManager(persistence, clock, () => 'furn-seed');
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
  const furnitureManager = new FurnitureManager(persistence);
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
    furnitureManager,
  };
  registerRoutes(app, deps);
  return { app, furnitureManager };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  while (openApps.length) await openApps.pop()!.close().catch(() => {});
});

describe('furniture routes', () => {
  it('GET /furniture returns an empty list on a fresh tavern', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/furniture' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /furniture creates a piece with assigned id and layer 1', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({
      method: 'POST',
      url: '/furniture',
      payload: { sprite: 'table_round_01', x: 30, y: 40 },
    });
    expect(res.statusCode).toBe(201);
    const piece = res.json();
    expect(piece.id).toBeTruthy();
    expect(piece.layer).toBe(1);
  });

  it('POST /furniture rejects an invalid sprite with 400', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({
      method: 'POST',
      url: '/furniture',
      payload: { sprite: '', x: 0, y: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /furniture/:id updates fields; 404 when missing', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/furniture',
        payload: { sprite: 'plant_02', x: 5, y: 5 },
      })
    ).json();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/furniture/${created.id}`,
      payload: { x: 12, scale: 0.5 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().x).toBe(12);
    expect(patched.json().scale).toBe(0.5);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/furniture/no-such-id',
      payload: { x: 1 },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /furniture/:id/layer restacks via "back" and returns new order', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const ids: string[] = [];
    for (const sprite of ['a', 'b', 'c']) {
      const r = await app.inject({
        method: 'POST',
        url: '/furniture',
        payload: { sprite, x: 0, y: 0 },
      });
      ids.push(r.json().id);
    }
    const res = await app.inject({
      method: 'POST',
      url: `/furniture/${ids[2]}/layer`,
      payload: { move: 'back' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { id: string }) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('POST /furniture/:id/layer rejects an unknown move', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/furniture',
        payload: { sprite: 's', x: 0, y: 0 },
      })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: `/furniture/${created.id}/layer`,
      payload: { move: 'sideways' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /furniture/:id returns 204; 404 if absent', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/furniture',
        payload: { sprite: 's', x: 0, y: 0 },
      })
    ).json();
    const del = await app.inject({ method: 'DELETE', url: `/furniture/${created.id}` });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({ method: 'DELETE', url: `/furniture/${created.id}` });
    expect(again.statusCode).toBe(404);
  });
});
