import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { registerSSE } from '../src/api/sse.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';

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
    () => 'api-test-seed',
  );
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
  const app = Fastify();
  app.addHook('onClose', async () => {
    persistence.close();
  });
  const deps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: SUBTICK_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  };
  // Emit the init event so /events?since=0 has something on cold start.
  bus.publish({ type: 'init', gameDay: stateManager.getState().gameDay });
  registerRoutes(app, deps);
  registerSSE(app, stateManager, npcManager, bus, deps);
  return { app, persistence, clock, stateManager, scheduler, npcManager, bus };
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  while (openApps.length) {
    const app = openApps.pop()!;
    await app.close().catch(() => {});
  }
});

describe('REST API', () => {
  it('GET /state returns the current world state', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/state' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gameDay).toBe(1);
    expect(body.status).toBe('running');
    expect(body.unattendedTicks).toBe(0);
    expect(body.seed).toBe('api-test-seed');
  });

  it('GET /tavern returns the zones and sub-tick config', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/tavern' });
    const body = res.json();
    expect(body.zones).toHaveLength(6);
    expect(body.subTicksPerDay).toBe(SUB_TICKS_PER_DAY);
    expect(body.subTickIntervalMs).toBe(SUBTICK_MS);
  });

  it('GET /world returns the world snapshot shape', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/world' });
    const body = res.json();
    expect(body).toHaveProperty('worldTags');
    expect(body).toHaveProperty('threads');
    expect(body).toHaveProperty('pendingArrivals');
    expect(body).toHaveProperty('rumors');
  });

  it('POST /engagement resets unattendedTicks, resumes if paused, and logs a resume event', async () => {
    const { app, clock, scheduler, persistence } = buildApp();
    openApps.push(app);

    for (let i = 0; i < 7; i += 1) {
      clock.advance(TICK_INTERVAL);
      scheduler.runCatchUp();
    }

    const res = await app.inject({ method: 'POST', url: '/engagement' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('running');
    expect(body.unattendedTicks).toBe(0);

    const events = persistence.getEventsSince(0);
    expect(events.some((e) => e.event.type === 'resume')).toBe(true);
  });

  it('POST /engagement on a running state resets unattendedTicks without writing resume', async () => {
    const { app, clock, scheduler, persistence } = buildApp();
    openApps.push(app);

    clock.advance(TICK_INTERVAL * 2);
    scheduler.runCatchUp();
    expect(
      persistence.getEventsSince(0).some((e) => e.event.type === 'resume'),
    ).toBe(false);

    const res = await app.inject({ method: 'POST', url: '/engagement' });
    const body = res.json();
    expect(body.status).toBe('running');
    expect(body.unattendedTicks).toBe(0);
    expect(
      persistence.getEventsSince(0).some((e) => e.event.type === 'resume'),
    ).toBe(false);
  });

  it('GET /events?since=N filters correctly', async () => {
    const { app, clock, scheduler } = buildApp();
    openApps.push(app);

    clock.advance(TICK_INTERVAL);
    scheduler.runCatchUp();
    clock.advance(TICK_INTERVAL);
    scheduler.runCatchUp();

    const allRes = await app.inject({ method: 'GET', url: '/events?since=0' });
    const all = allRes.json() as Array<{ id: number }>;
    expect(all.length).toBeGreaterThanOrEqual(3);

    const firstId = all[0].id;
    const filteredRes = await app.inject({
      method: 'GET',
      url: `/events?since=${firstId}`,
    });
    const filtered = filteredRes.json() as Array<{ id: number }>;
    expect(filtered.length).toBe(all.length - 1);
    expect(filtered.every((e) => e.id > firstId)).toBe(true);

    const emptyRes = await app.inject({
      method: 'GET',
      url: `/events?since=${all[all.length - 1].id}`,
    });
    expect(emptyRes.json()).toEqual([]);
  });

  it('GET /events with no `since` defaults to 0 and returns EventLogEntry shape', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/events' });
    const events = res.json() as Array<{ id: number; event: { type: string } }>;
    expect(events[0].event.type).toBe('init');
  });
});

describe('SSE /stream', () => {
  it('subscribed client receives a state event after a manually-triggered tick', async () => {
    const { app, clock, scheduler } = buildApp();
    openApps.push(app);

    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const controller = new AbortController();
    const response = await fetch(`${address}/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const received: Array<{ event: string; data: unknown }> = [];
    let buffer = '';

    const readUntilTwoStates = (async () => {
      let stateCount = 0;
      while (stateCount < 2) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!frame.trim() || frame.startsWith(':')) continue;
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (data) {
            received.push({ event, data: JSON.parse(data) });
            if (event === 'state') stateCount += 1;
          }
        }
      }
    })();

    await new Promise((r) => setTimeout(r, 20));
    clock.advance(TICK_INTERVAL);
    scheduler.runCatchUp();

    await readUntilTwoStates;
    controller.abort();
    await reader.cancel().catch(() => {});

    const stateEvents = received.filter((e) => e.event === 'state');
    expect(stateEvents.length).toBeGreaterThanOrEqual(2);
    expect((stateEvents[0].data as { gameDay: number }).gameDay).toBe(1);
    expect((stateEvents[1].data as { gameDay: number }).gameDay).toBe(2);
  });
});
