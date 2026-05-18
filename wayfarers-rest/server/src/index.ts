import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerRoutes } from './api/routes.ts';
import { registerSSE } from './api/sse.ts';
import { RealClock } from './lib/clock.ts';
import { Persistence } from './persistence.ts';
import { WorldStateManager } from './state.ts';
import { TickScheduler } from './tick.ts';

// Anchor the default DB path to the workspace root (wayfarers-rest/data/)
// regardless of which directory the server was launched from.
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
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const dbPathAbs = resolve(DB_PATH);
  mkdirSync(dirname(dbPathAbs), { recursive: true });

  const persistence = new Persistence(dbPathAbs);
  const clock = new RealClock();
  const stateManager = new WorldStateManager(persistence, clock);
  const scheduler = new TickScheduler(stateManager, clock, {
    tickIntervalMs: TICK_INTERVAL_MS,
    schedulerCheckMs: SCHEDULER_CHECK_MS,
  });

  const app = Fastify({ logger: true });

  app.addHook('onClose', async () => {
    scheduler.stop();
    persistence.close();
  });

  registerRoutes(app, { stateManager, scheduler, persistence, clock });
  registerSSE(app, stateManager);

  scheduler.start();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(
    {
      tickIntervalMs: TICK_INTERVAL_MS,
      schedulerCheckMs: SCHEDULER_CHECK_MS,
      dbPath: dbPathAbs,
    },
    'wayfarers-rest server ready',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
