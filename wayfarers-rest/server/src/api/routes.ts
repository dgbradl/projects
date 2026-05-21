import type { FastifyInstance } from 'fastify';
import type {
  Character,
  FlavorMode,
  FlavorPoolStatus,
  StaffMember,
  StaffRoster,
  StaffSwapRequest,
  TavernConfig,
  WorldSnapshot,
} from '@shared/types';
import type { ChroniclePipeline } from '../chronicle/pipeline.ts';
import type { PrologueGenerator } from '../chronicle/prologue.ts';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Clock } from '../lib/clock.ts';
import type { FlavorCache } from '../llm/cache/manager.ts';
import type { FlavorModeManager } from '../llm/mode.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import { engage, TickScheduler } from '../tick.ts';
import { TAVERN_ZONES } from '../world/tavern.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { WorldTagsManager } from '../world/tags.ts';
import { registerChronicleRoutes } from './chronicle-routes.ts';
import { registerInterventionRoutes } from './intervention-routes.ts';

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
  chroniclePipeline?: ChroniclePipeline;
  prologueGenerator?: PrologueGenerator;
  chronicleMaxEvents?: number;
  threadRunner?: ThreadRunner;
  worldTags?: WorldTagsManager;
  rumors?: RumorsManager;
  favorsMax?: number;
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

  // Epic E (E3): staff roster and hire/fire.
  app.get('/staff', async (): Promise<StaffRoster> => {
    const all = deps.persistence.loadStaffCharacters();
    const rosterIds = new Set(deps.npcManager.getRoster().map((n) => n.id));
    const toMember = (c: Character): StaffMember => ({
      id: c.id,
      displayName: c.displayName,
      role: c.staffRole!,
      skills: c.skills!,
      personality: c.personality ?? '',
      isActive: !!c.isActiveStaff,
      isOnDuty: rosterIds.has(c.id),
    });
    return {
      active: all.filter((c) => c.isActiveStaff).map(toMember),
      reserve: all.filter((c) => !c.isActiveStaff).map(toMember),
    };
  });

  app.post<{ Body: StaffSwapRequest }>('/staff/swap', async (req, reply) => {
    const { fireId, hireId } = req.body ?? {};
    if (!fireId || !hireId) {
      return reply.status(400).send({ error: 'fireId and hireId required' });
    }
    const allStaff = deps.persistence.loadStaffCharacters();
    const fireChar = allStaff.find((c) => c.id === fireId);
    const hireChar = allStaff.find((c) => c.id === hireId);
    if (!fireChar || !hireChar) {
      return reply.status(404).send({ error: 'Staff member not found' });
    }
    if (fireChar.staffRole !== hireChar.staffRole) {
      return reply.status(400).send({ error: 'Cannot swap staff of different roles' });
    }
    deps.persistence.setStaffInactive(fireId);
    deps.persistence.setStaffActive(hireId);
    deps.npcManager.removeFromRoster(fireId);
    const state = deps.stateManager.getState();
    deps.npcManager.ensureStaffOnDuty(state.gameDay, state.subTick);
    return { ok: true };
  });

  if (deps.chroniclePipeline && deps.prologueGenerator) {
    registerChronicleRoutes(app, {
      persistence: deps.persistence,
      stateManager: deps.stateManager,
      npcManager: deps.npcManager,
      pipeline: deps.chroniclePipeline,
      prologue: deps.prologueGenerator,
      bus: deps.bus,
      maxEvents: deps.chronicleMaxEvents ?? 25,
    });
  }

  if (deps.threadRunner && deps.worldTags && deps.rumors) {
    registerInterventionRoutes(app, {
      persistence: deps.persistence,
      stateManager: deps.stateManager,
      npcManager: deps.npcManager,
      bus: deps.bus,
      clock: deps.clock,
      threadRunner: deps.threadRunner,
      worldTags: deps.worldTags,
      rumors: deps.rumors,
      favorsMax: deps.favorsMax ?? 5,
    });
  }
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
