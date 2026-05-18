import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DailyChronicle } from '@shared/types';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { ChronicleGenerator } from '../src/chronicle/generator.ts';
import { ChroniclePipeline } from '../src/chronicle/pipeline.ts';
import { PrologueGenerator } from '../src/chronicle/prologue.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { FixtureRegistry } from '../src/llm/fixtures.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { OllamaClient } from '../src/llm/ollama.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(HERE, '../src/llm/fixtures');
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'route-seed');
  const bus = new WorldEventBus(persistence, clock);
  const client = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    model: 'm',
    requestTimeoutMs: 1_000,
  });
  const mode = new FlavorModeManager({
    initialMode: 'recorded',
    client,
    bus,
    healthCheckIntervalMs: 60_000,
    getGameDay: () => stateManager.getState().gameDay,
  });
  const fixtures = new FixtureRegistry(FIXTURES_DIR);
  fixtures.load();
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
  const generator = new ChronicleGenerator(
    { persistence, bus, clock, client, mode, npcManager, fixtures },
    { model: 'm', maxEvents: 25, timeoutMs: 1_000 },
  );
  const prologue = new PrologueGenerator(
    { persistence, clock, client, mode, fixtures },
    { model: 'm', timeoutMs: 1_000 },
  );
  const pipeline = new ChroniclePipeline(
    persistence,
    stateManager,
    generator,
    { workerIntervalMs: 50 },
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
    subTickIntervalMs: 100,
    subTicksPerDay: 30,
    chroniclePipeline: pipeline,
    prologueGenerator: prologue,
    chronicleMaxEvents: 25,
  };
  registerRoutes(app, deps);
  return { app, persistence, stateManager, bus, generator, prologue, pipeline };
}

function makeChronicle(gameDay: number, status: DailyChronicle['status'] = 'complete'): DailyChronicle {
  return {
    gameDay,
    generatedAtRealTs: 'ts',
    status,
    headlines: [`Day ${gameDay} h1`, `Day ${gameDay} h2`, `Day ${gameDay} h3`],
    footnotes: [`Day ${gameDay} f1`, `Day ${gameDay} f2`, `Day ${gameDay} f3`],
    modelUsed: 'stub',
    promptCharCount: 0,
    completionCharCount: 0,
    generationDurationMs: 0,
    failureReason: null,
  };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  while (openApps.length) {
    const app = openApps.pop()!;
    await app.close().catch(() => {});
  }
});

describe('chronicle REST routes', () => {
  it('GET /chronicles/:gameDay returns 404 when missing, 200 with ledger when present', async () => {
    const h = build();
    openApps.push(h.app);
    const missing = await h.app.inject({ method: 'GET', url: '/chronicles/3' });
    expect(missing.statusCode).toBe(404);

    h.persistence.upsertChronicle(makeChronicle(3));
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 3,
      npcId: 'a',
      displayName: 'X',
    });
    const ok = await h.app.inject({ method: 'GET', url: '/chronicles/3' });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { chronicle: DailyChronicle; ledger: unknown[] };
    expect(body.chronicle.gameDay).toBe(3);
    expect(Array.isArray(body.ledger)).toBe(true);
    expect(body.ledger.length).toBeGreaterThan(0);
  });

  it('GET /chronicles/since excludes the current day and partitions complete vs pending', async () => {
    const h = build();
    openApps.push(h.app);
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 5 });
    // Days 1-3 complete; day 4 pending.
    h.persistence.upsertChronicle(makeChronicle(1));
    h.persistence.upsertChronicle(makeChronicle(2));
    h.persistence.upsertChronicle(makeChronicle(3));
    h.persistence.upsertChronicle({ ...makeChronicle(4), status: 'pending' });

    const res = await h.app.inject({ method: 'GET', url: '/chronicles/since' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      fromGameDay: number;
      toGameDay: number;
      chronicles: DailyChronicle[];
      pendingDays: number[];
      prologue: { text: string } | null;
    };
    expect(body.fromGameDay).toBe(1);
    expect(body.toGameDay).toBe(4); // current=5, exclude today
    expect(body.chronicles.map((c) => c.gameDay)).toEqual([1, 2, 3]);
    expect(body.pendingDays).toEqual([4]);
    // Span is 4 days (1..4) >= 3, so a prologue is generated.
    expect(body.prologue).not.toBeNull();
  });

  it('POST /chronicles/acknowledge rejects backward moves and advances state on forward', async () => {
    const h = build();
    openApps.push(h.app);
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 5, lastAcknowledgedGameDay: 2 });

    const backward = await h.app.inject({
      method: 'POST',
      url: '/chronicles/acknowledge',
      payload: { acknowledgedGameDay: 1 },
    });
    expect(backward.statusCode).toBe(400);

    const future = await h.app.inject({
      method: 'POST',
      url: '/chronicles/acknowledge',
      payload: { acknowledgedGameDay: 99 },
    });
    expect(future.statusCode).toBe(400);

    const forward = await h.app.inject({
      method: 'POST',
      url: '/chronicles/acknowledge',
      payload: { acknowledgedGameDay: 4 },
    });
    expect(forward.statusCode).toBe(200);
    expect(h.stateManager.getState().lastAcknowledgedGameDay).toBe(4);

    const events = h.persistence.getEventsSince(0).map((e) => e.event.type);
    expect(events).toContain('chronicle_acknowledged');
  });

  it('POST /chronicles/:day/regenerate marks the row pending', async () => {
    const h = build();
    openApps.push(h.app);
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 5 });
    h.persistence.upsertChronicle(makeChronicle(2));

    const res = await h.app.inject({
      method: 'POST',
      url: '/chronicles/2/regenerate',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const row = h.persistence.loadChronicle(2);
    expect(row!.status).toBe('pending');
  });
});
