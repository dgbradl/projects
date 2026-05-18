import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from '../src/api/routes.ts';
import { registerSSE } from '../src/api/sse.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { SubTickScheduler } from '../src/subtick.ts';
import { TickScheduler } from '../src/tick.ts';

const SUB_TICKS_PER_DAY = 60;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function buildApp() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(persistence, clock, () => 'sse-seed');
  const npcManager = new NpcManager({
    worldSeed: stateManager.getState().seed,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  });
  npcManager.onMacroTick(stateManager.getState().gameDay);
  const tickScheduler = new TickScheduler(stateManager, clock, {
    tickIntervalMs: TICK_INTERVAL,
    schedulerCheckMs: 50,
  });
  const subTickScheduler = new SubTickScheduler(stateManager, npcManager, clock, {
    subTickIntervalMs: SUBTICK_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  });
  const app = Fastify();
  app.addHook('onClose', async () => {
    persistence.close();
  });
  registerRoutes(app, {
    stateManager,
    scheduler: tickScheduler,
    persistence,
    clock,
    npcManager,
    subTickIntervalMs: SUBTICK_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  });
  registerSSE(app, stateManager, npcManager);
  return { app, clock, stateManager, npcManager, tickScheduler, subTickScheduler };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  while (openApps.length) {
    const app = openApps.pop()!;
    await app.close().catch(() => {});
  }
});

describe('SSE NPC events', () => {
  it('subscribed client receives a npcs_snapshot on connect and a npcs_diff after a sub-tick', async () => {
    const h = buildApp();
    openApps.push(h.app);

    // Fast-forward to a sub-tick at which the first arrival has not yet
    // appeared, so the diff after the next advance includes a new NPC.
    const firstArrivalSubTick = h.npcManager.getSpawnQueue()[0].scheduledSubTick;
    // Walk up to one before the arrival.
    for (let i = 0; i < firstArrivalSubTick; i += 1) {
      h.subTickScheduler.advance(SUBTICK_MS);
    }

    const address = await h.app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const received: Array<{ event: string; data: unknown }> = [];
    let buffer = '';
    const wantedEvents = new Set(['npcs_snapshot', 'npcs_diff']);

    const readPromise = (async () => {
      let snapshotsSeen = 0;
      let diffsSeen = 0;
      while (snapshotsSeen < 1 || diffsSeen < 1) {
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
          if (data && wantedEvents.has(event)) {
            received.push({ event, data: JSON.parse(data) });
            if (event === 'npcs_snapshot') snapshotsSeen += 1;
            if (event === 'npcs_diff') diffsSeen += 1;
          }
        }
      }
    })();

    // After fetch resolves the snapshot is on the wire. Trigger a sub-tick.
    await new Promise((r) => setTimeout(r, 20));
    // Advance several sub-ticks so we cross the scheduled arrival.
    for (let i = 0; i < 5; i += 1) h.subTickScheduler.advance(SUBTICK_MS);

    await readPromise;
    controller.abort();
    await reader.cancel().catch(() => {});

    const snapshot = received.find((r) => r.event === 'npcs_snapshot');
    const diff = received.find((r) => r.event === 'npcs_diff');
    expect(snapshot).toBeDefined();
    expect(diff).toBeDefined();
    const diffPayload = diff!.data as { added: unknown[]; updated: unknown[]; removed: unknown[] };
    expect(diffPayload.added.length + diffPayload.updated.length).toBeGreaterThan(0);
  });
});
