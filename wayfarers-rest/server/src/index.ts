import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerRoutes } from './api/routes.ts';
import { registerSSE } from './api/sse.ts';
import { RealClock } from './lib/clock.ts';
import { NpcManager } from './npc/manager.ts';
import { Persistence } from './persistence.ts';
import { WorldStateManager } from './state.ts';
import { SubTickScheduler } from './subtick.ts';
import { TickScheduler } from './tick.ts';

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

  const npcManager = new NpcManager({
    worldSeed: stateManager.getState().seed,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  });
  npcManager.hydrate(persistence.loadRoster());

  // Persist roster on every diff.
  npcManager.on('diff', () => persistence.saveRoster(npcManager.snapshot()));

  const scheduler = new TickScheduler(stateManager, clock, {
    tickIntervalMs: TICK_INTERVAL_MS,
    schedulerCheckMs: SCHEDULER_CHECK_MS,
  });

  const subTickScheduler = new SubTickScheduler(
    stateManager,
    npcManager,
    clock,
    {
      subTickIntervalMs: SUBTICK_INTERVAL_MS,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    },
  );

  const app = Fastify({ logger: true });

  app.addHook('onClose', async () => {
    subTickScheduler.stop();
    scheduler.stop();
    persistence.close();
  });

  registerRoutes(app, {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    subTickIntervalMs: SUBTICK_INTERVAL_MS,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  });
  registerSSE(app, stateManager, npcManager);

  // Bootstrap today's spawn queue if it wasn't persisted yet (cold start
  // or empty roster).
  if (npcManager.getSpawnQueue().length === 0 && npcManager.getRoster().length === 0) {
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
