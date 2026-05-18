import type { FastifyInstance } from 'fastify';
import type {
  FlavorMode,
  FlavorPoolStatus,
  TavernConfig,
  WorldSnapshot,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Clock } from '../lib/clock.ts';
import type { FlavorCache } from '../llm/cache/manager.ts';
import type { FlavorModeManager } from '../llm/mode.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { engage, TickScheduler } from '../tick.ts';
import { TAVERN_ZONES } from '../world/tavern.ts';

export interface ApiDeps {
  stateManager: WorldStateManager;
  scheduler: TickScheduler;
  persistence: Persistence;
  clock: Clock;
  npcManager: NpcManager;
  bus: WorldEventBus;
  subTickIntervalMs: number;
  subTicksPerDay: number;
  flavorCache?: FlavorCache;
  flavorMode?: FlavorModeManager;
}

export interface FlavorStatus {
  mode: FlavorMode;
  pools: FlavorPoolStatus[];
}

const SNAPSHOT_WINDOW_DAYS = 7;

export function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/state', async () => deps.stateManager.getState());

  app.post('/engagement', async () =>
    engage(deps.stateManager, deps.scheduler, deps.bus),
  );

  app.get<{ Querystring: { since?: string } }>(
    '/events',
    async (request) => {
      const raw = request.query.since;
      const parsed = raw === undefined ? 0 : parseInt(raw, 10);
      const since = Number.isFinite(parsed) ? parsed : 0;
      return deps.persistence.getEventsSince(since);
    },
  );

  app.get('/npcs', async () => deps.npcManager.getRoster());

  app.get('/tavern', async (): Promise<TavernConfig> => ({
    zones: [...TAVERN_ZONES],
    subTickIntervalMs: deps.subTickIntervalMs,
    subTicksPerDay: deps.subTicksPerDay,
  }));

  app.get('/world', async (): Promise<WorldSnapshot> => buildWorldSnapshot(deps));

  app.get('/flavor', async (): Promise<FlavorStatus> => buildFlavorStatus(deps));
}

export function buildFlavorStatus(deps: ApiDeps): FlavorStatus {
  return {
    mode: deps.flavorMode?.getMode() ?? 'placeholder',
    pools: deps.flavorCache?.getStatus() ?? [],
  };
}

export function buildWorldSnapshot(deps: ApiDeps): WorldSnapshot {
  const today = deps.stateManager.getState().gameDay;
  return {
    worldTags: deps.persistence.getAllWorldTags(),
    threads: deps.persistence.loadActiveThreads(),
    pendingArrivals: deps.persistence.loadUpcomingScheduledArrivals(
      today,
      SNAPSHOT_WINDOW_DAYS,
    ),
    rumors: deps.persistence.loadAllRumors(),
  };
}
