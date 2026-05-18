import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { ChroniclesSinceResponse } from '@shared/types';
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

describe('chronicle pipeline end-to-end (recorded mode)', () => {
  it('5-day simulation generates 5 chronicles; /chronicles/since returns 4; acknowledge advances the window', async () => {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const stateManager = new WorldStateManager(persistence, clock, () => 'e2e-seed');
    const bus = new WorldEventBus(persistence, clock);
    const client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'e2e-model',
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
      { worldSeed: 'e2e-seed', subTicksPerDay: 30 },
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
      { model: 'e2e-model', maxEvents: 25, timeoutMs: 1_000 },
    );
    const prologue = new PrologueGenerator(
      { persistence, clock, client, mode, fixtures },
      { model: 'e2e-model', timeoutMs: 1_000 },
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

    // Seed a few events per day, then advance through 5 game days.
    bus.publish({ type: 'init', gameDay: 1 });
    for (let day = 1; day <= 5; day += 1) {
      bus.publish({
        type: 'npc_arrived',
        gameDay: day,
        npcId: `npc_d${day}_0`,
        displayName: `Visitor d${day}`,
      });
      bus.publish({
        type: 'world_tag_changed',
        gameDay: day,
        key: 'season',
        oldValue: day === 1 ? null : 'spring',
        newValue: 'spring',
      });
      // Advance day.
      stateManager.setState({
        ...stateManager.getState(),
        gameDay: day + 1,
      });
    }
    // gameDay is now 6, so chronicles for days 1..5 are pending.
    // Drain the pipeline.
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await pipeline.tickOnce();
      if (!result) break;
    }

    expect(persistence.loadAllChronicleGameDays().length).toBe(5);
    expect(persistence.loadPendingChronicleGameDays().length).toBe(0);

    const since = await app.inject({ method: 'GET', url: '/chronicles/since' });
    const body = since.json() as ChroniclesSinceResponse;
    expect(body.fromGameDay).toBe(1);
    expect(body.toGameDay).toBe(5); // current=6
    expect(body.chronicles.length).toBe(5);
    expect(body.pendingDays).toEqual([]);
    expect(body.prologue).not.toBeNull();

    // Acknowledge through day 3; next /chronicles/since returns days 4..5 only.
    const ack = await app.inject({
      method: 'POST',
      url: '/chronicles/acknowledge',
      payload: { acknowledgedGameDay: 3 },
    });
    expect(ack.statusCode).toBe(200);
    const sinceAfter = await app.inject({
      method: 'GET',
      url: '/chronicles/since',
    });
    const bodyAfter = sinceAfter.json() as ChroniclesSinceResponse;
    expect(bodyAfter.fromGameDay).toBe(4);
    expect(bodyAfter.toGameDay).toBe(5);
    expect(bodyAfter.chronicles.length).toBe(2);
    expect(bodyAfter.prologue).toBeNull(); // span < 3

    await app.close();
  });
});
