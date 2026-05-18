import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from '../src/api/routes.ts';
import { registerSSE } from '../src/api/sse.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';

const TICK_INTERVAL = 1000;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function buildApp() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(
    persistence,
    clock,
    () => 'api-test-seed',
  );
  const scheduler = new TickScheduler(stateManager, clock, {
    tickIntervalMs: TICK_INTERVAL,
    schedulerCheckMs: 100,
  });
  const app = Fastify();
  app.addHook('onClose', async () => {
    persistence.close();
  });
  registerRoutes(app, { stateManager, scheduler, persistence, clock });
  registerSSE(app, stateManager);
  return { app, persistence, clock, stateManager, scheduler };
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

  it('POST /engagement resets unattendedTicks, resumes if paused, and logs a resume event', async () => {
    const { app, clock, scheduler, persistence } = buildApp();
    openApps.push(app);

    // Drive to paused.
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
    expect(events.some((e) => e.type === 'resume')).toBe(true);
  });

  it('POST /engagement on a running state resets unattendedTicks without writing resume', async () => {
    const { app, clock, scheduler, persistence } = buildApp();
    openApps.push(app);

    clock.advance(TICK_INTERVAL * 2);
    scheduler.runCatchUp();
    expect(persistence.getEventsSince(0).some((e) => e.type === 'resume')).toBe(
      false,
    );

    const res = await app.inject({ method: 'POST', url: '/engagement' });
    const body = res.json();
    expect(body.status).toBe('running');
    expect(body.unattendedTicks).toBe(0);
    expect(persistence.getEventsSince(0).some((e) => e.type === 'resume')).toBe(
      false,
    );
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
    expect(all.length).toBeGreaterThanOrEqual(3); // init + 2 ticks

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

  it('GET /events with no `since` defaults to 0', async () => {
    const { app } = buildApp();
    openApps.push(app);
    const res = await app.inject({ method: 'GET', url: '/events' });
    const events = res.json() as Array<{ type: string }>;
    expect(events[0].type).toBe('init');
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

    const readUntilTwo = (async () => {
      while (received.length < 2) {
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
          if (data) received.push({ event, data: JSON.parse(data) });
        }
      }
    })();

    // Trigger a tick after the subscriber has had a chance to attach.
    await new Promise((r) => setTimeout(r, 20));
    clock.advance(TICK_INTERVAL);
    scheduler.runCatchUp();

    await readUntilTwo;
    controller.abort();
    await reader.cancel().catch(() => {});

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[0].event).toBe('state');
    expect((received[0].data as { gameDay: number }).gameDay).toBe(1);
    expect(received[1].event).toBe('state');
    expect((received[1].data as { gameDay: number }).gameDay).toBe(2);
  });
});
