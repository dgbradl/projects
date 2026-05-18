import type { FastifyInstance } from 'fastify';
import type { TavernConfig } from '@shared/types';
import type { Clock } from '../lib/clock.ts';
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
  subTickIntervalMs: number;
  subTicksPerDay: number;
}

export function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/state', async () => deps.stateManager.getState());

  app.post('/engagement', async () =>
    engage(deps.stateManager, deps.scheduler, deps.clock),
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
}
