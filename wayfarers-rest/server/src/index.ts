import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { Npc } from '@shared/types';
import { registerRoutes, type ApiDeps } from './api/routes.ts';
import { registerSSE } from './api/sse.ts';
import { WorldEventBus } from './events/emitter.ts';
import { detectInteractions } from './interactions/detector.ts';
import { InteractionResolver } from './interactions/resolver.ts';
import { RealClock } from './lib/clock.ts';
import { NpcManager } from './npc/manager.ts';
import { Persistence } from './persistence.ts';
import { WorldStateManager } from './state.ts';
import { SubTickScheduler } from './subtick.ts';
import './threads/archetypes/index.ts'; // registers archetypes
import { ThreadRunner } from './threads/runner.ts';
import { TickScheduler } from './tick.ts';
import { RumorsManager } from './world/rumors.ts';
import { WorldTagsManager } from './world/tags.ts';
import { seedPhase3World } from './world/world-init.ts';

const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
const WORKSPACE_ROOT = resolve(SERVER_DIR, '../..');
const DEFAULT_DB_PATH = resolve(WORKSPACE_ROOT, 'data/world.db');

const TICK_INTERVAL_MS = parseInt(
  process.env.TICK_INTERVAL_MS ?? '3600000',
  10,
);
const SCHEDULER_CHECK_MS = parseInt(
  process.env.SCHEDULER_CHECK_MS ?? '60000',
  10,
);
const SUBTICK_INTERVAL_MS = parseInt(
  process.env.SUBTICK_INTERVAL_MS ?? '10000',
  10,
);
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const SUB_TICKS_PER_DAY = Math.max(
  1,
  Math.floor(TICK_INTERVAL_MS / SUBTICK_INTERVAL_MS),
);

async function main(): Promise<void> {
  const dbPathAbs = DB_PATH === ':memory:' ? DB_PATH : resolve(DB_PATH);
  if (dbPathAbs !== ':memory:') {
    mkdirSync(dirname(dbPathAbs), { recursive: true });
  }

  const persistence = new Persistence(dbPathAbs);
  const clock = new RealClock();
  const stateManager = new WorldStateManager(persistence, clock);
  const bus = new WorldEventBus(persistence, clock);

  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);

  const npcManager = new NpcManager(
    {
      worldSeed: stateManager.getState().seed,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    },
    {
      persistence,
      bus,
      rumors,
      threadRunner,
    },
  );
  npcManager.hydrate(persistence.loadRoster());

  const interactionResolver = new InteractionResolver(bus, threadRunner);
  const interactionCounter = { value: 0 };

  // Attach the post-sub-tick hook now that the resolver exists.
  (npcManager as unknown as { deps: { postSubTickHook: typeof postSubTickHook } }).deps.postSubTickHook = postSubTickHook;

  function postSubTickHook(gameDay: number, subTick: number, roster: Npc[]) {
    const candidates = detectInteractions(roster, {
      worldSeed: stateManager.getState().seed,
      gameDay,
      subTick,
      countsToday: npcManager.interactionsToday,
      pairsToday: npcManager.pairsToday,
    });
    if (candidates.length === 0) return;
    const npcsById = new Map(roster.map((n) => [n.id, n]));
    for (const candidate of candidates) {
      interactionResolver.resolve(candidate, {
        worldSeed: stateManager.getState().seed,
        gameDay,
        subTick,
        npcsById,
        perDayCounter: interactionCounter,
      });
    }
  }

  npcManager.on('diff', () => persistence.saveRoster(npcManager.snapshot()));

  const scheduler = new TickScheduler(
    stateManager,
    clock,
    {
      tickIntervalMs: TICK_INTERVAL_MS,
      schedulerCheckMs: SCHEDULER_CHECK_MS,
    },
    bus,
  );

  const subTickScheduler = new SubTickScheduler(
    stateManager,
    npcManager,
    clock,
    {
      subTickIntervalMs: SUBTICK_INTERVAL_MS,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    },
    threadRunner,
  );

  const app = Fastify({ logger: true });

  const apiDeps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: SUBTICK_INTERVAL_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  };

  app.addHook('onClose', async () => {
    subTickScheduler.stop();
    scheduler.stop();
    persistence.close();
  });

  registerRoutes(app, apiDeps);
  registerSSE(app, stateManager, npcManager, bus, apiDeps);

  // First boot under Phase 3: if no world tags exist, seed them and the
  // starter threads, plus emit the init event.
  const isFirstPhase3Boot = persistence.getAllWorldTags().length === 0;
  if (stateManager.isColdStart() || isFirstPhase3Boot) {
    if (stateManager.isColdStart()) {
      bus.publish({ type: 'init', gameDay: stateManager.getState().gameDay });
    }
    if (isFirstPhase3Boot) {
      seedPhase3World({
        worldSeed: stateManager.getState().seed,
        gameDay: stateManager.getState().gameDay,
        worldTags,
        threadRunner,
      });
    }
  }

  // Bootstrap today's spawn queue if it wasn't persisted yet.
  if (
    npcManager.getSpawnQueue().length === 0 &&
    npcManager.getRoster().length === 0
  ) {
    npcManager.onMacroTick(stateManager.getState().gameDay);
    persistence.saveRoster(npcManager.snapshot());
  }

  scheduler.start();
  subTickScheduler.start();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(
    {
      tickIntervalMs: TICK_INTERVAL_MS,
      schedulerCheckMs: SCHEDULER_CHECK_MS,
      subTickIntervalMs: SUBTICK_INTERVAL_MS,
      subTicksPerDay: SUB_TICKS_PER_DAY,
      dbPath: dbPathAbs,
    },
    'wayfarers-rest server ready',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
