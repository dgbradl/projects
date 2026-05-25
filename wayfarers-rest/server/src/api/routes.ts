import type { FastifyInstance } from 'fastify';
import type {
  Character,
  EventLogEntry,
  FlavorMode,
  FlavorPoolStatus,
  Npc,
  StaffMember,
  StaffRoster,
  StaffSwapRequest,
  TavernConfig,
  TavernTrait,
  Thread,
  TickerEntry,
  TickerResponse,
  WorldSnapshot,
} from '@shared/types';
import { TAVERN_TRAITS } from '@shared/types';
import { renderSentence } from '../chronicle/fallback.ts';
import { score as scoreSalience } from '../chronicle/salience.ts';
import { DEFAULT_ALARMING_VALUES } from '../chronicle/types.ts';
import type { ChroniclePipeline } from '../chronicle/pipeline.ts';
import type { PrologueGenerator } from '../chronicle/prologue.ts';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Clock } from '../lib/clock.ts';
import type { FlavorCache } from '../llm/cache/manager.ts';
import type { FlavorModeManager } from '../llm/mode.ts';
import type { FurnitureManager } from '../furniture/manager.ts';
import type { DesireResolver } from '../npc/desire-resolver.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import { engage, TickScheduler } from '../tick.ts';
import { pauseGame, resetGame, stopGame, type ControlDeps } from '../control.ts';
import type { SubTickScheduler } from '../subtick.ts';
import { TAVERN_ZONES } from '../world/tavern.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { WorldTagsManager } from '../world/tags.ts';
import type { ZoneManager } from '../world/zone-manager.ts';
import { registerChronicleRoutes } from './chronicle-routes.ts';
import { registerFurnitureRoutes } from './furniture-routes.ts';
import { registerInterventionRoutes } from './intervention-routes.ts';
import { registerZoneRoutes } from './zone-routes.ts';

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
  furnitureManager?: FurnitureManager;
  zoneManager?: ZoneManager;
  favorsMax?: number;
  /** Optional: enables POST /control/reset to snap day-tracking on the sub-tick scheduler. */
  subTickScheduler?: SubTickScheduler;
  /** Phase 8 (A4): plumbed through to intervention helpers so verbs can
   *  fulfil matching desires on present NPCs. Optional so test harnesses
   *  that don't construct one stay valid. */
  desireResolver?: DesireResolver;
}

export interface FlavorStatus {
  mode: FlavorMode;
  pools: FlavorPoolStatus[];
}

const SNAPSHOT_WINDOW_DAYS = 7;

export function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/state', async () => deps.stateManager.getState());

  app.post('/engagement', async () =>
    engage(deps.stateManager, deps.scheduler, deps.bus, deps.clock),
  );

  // ----- Phase 7 menu: Pause / Stop / Resume / Reset -----
  //
  // Resume is implemented via the existing engage() — same semantics whether
  // the keeper paused manually, the tavern auto-paused, or the keeper stopped.
  // The reset route requires the world/threads/runner wiring; if those aren't
  // present (a stripped-down test harness), it's omitted.
  if (deps.threadRunner && deps.worldTags) {
    const controlDeps: ControlDeps = {
      persistence: deps.persistence,
      clock: deps.clock,
      bus: deps.bus,
      stateManager: deps.stateManager,
      npcManager: deps.npcManager,
      threadRunner: deps.threadRunner,
      worldTags: deps.worldTags,
      chroniclePipeline: deps.chroniclePipeline,
      subTickScheduler: deps.subTickScheduler,
    };
    app.post('/control/reset', async () => resetGame(controlDeps));
    app.post('/control/pause', async () => pauseGame(controlDeps));
    app.post('/control/stop', async () => stopGame(controlDeps));
    app.post('/control/resume', async () =>
      engage(deps.stateManager, deps.scheduler, deps.bus, deps.clock),
    );
  }

  app.get<{ Querystring: { since?: string } }>(
    '/events',
    async (request) => {
      const raw = request.query.since;
      const parsed = raw === undefined ? 0 : parseInt(raw, 10);
      const since = Number.isFinite(parsed) ? parsed : 0;
      return deps.persistence.getEventsSince(since);
    },
  );

  // Phase 8 (B1): salience-filtered, prose-rendered recent events for the
  // live ticker. The client polls this on connect (sinceEventId=0) for a
  // hot-start buffer and then appends incrementally via the SSE world_event
  // stream. Cap of 50 keeps the hot-start payload bounded.
  app.get<{ Querystring: { sinceEventId?: string; limit?: string } }>(
    '/events/recent',
    async (request): Promise<TickerResponse> =>
      buildTickerResponse(deps, {
        sinceEventId: parseInteger(request.query.sinceEventId, 0),
        limit: parseInteger(request.query.limit, 50),
      }),
  );

  app.get('/npcs', async () => deps.npcManager.getRoster());

  app.get('/tavern', async (): Promise<TavernConfig> => ({
    zones: deps.zoneManager?.list() ?? [...TAVERN_ZONES],
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

  // Phase 8 (D2): tavern identity. Accepts a name + 0-2 traits, validates,
  // writes to WorldState, emits tavern_named. Idempotent — re-posting with
  // the same payload is a no-op the player can't observe.
  app.post<{
    Body: { tavernName?: string; tavernTraits?: string[] };
  }>('/tavern/identity', async (req, reply) => {
    const body = req.body ?? {};
    const name =
      typeof body.tavernName === 'string' ? body.tavernName.trim() : '';
    if (!name || name.length > 64) {
      return reply.status(400).send({
        error: 'tavernName must be a non-empty string up to 64 characters',
      });
    }
    const requestedTraits = Array.isArray(body.tavernTraits)
      ? body.tavernTraits
      : [];
    if (requestedTraits.length > 2) {
      return reply.status(400).send({ error: 'pick at most two traits' });
    }
    const knownTraits = new Set<string>(TAVERN_TRAITS);
    const validTraits: TavernTrait[] = [];
    for (const t of requestedTraits) {
      if (typeof t !== 'string' || !knownTraits.has(t)) {
        return reply.status(400).send({ error: `unknown trait: ${t}` });
      }
      if (!validTraits.includes(t as TavernTrait)) {
        validTraits.push(t as TavernTrait);
      }
    }
    const current = deps.stateManager.getState();
    deps.stateManager.setState({
      ...current,
      tavernName: name,
      tavernTraits: validTraits,
    });
    deps.bus.publish({
      type: 'tavern_named',
      gameDay: current.gameDay,
      tavernName: name,
      tavernTraits: validTraits,
    });
    return {
      tavernName: name,
      tavernTraits: validTraits,
      state: deps.stateManager.getState(),
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
      desireResolver: deps.desireResolver,
      subTicksPerDay: deps.subTicksPerDay,
    });
  }

  if (deps.furnitureManager) {
    registerFurnitureRoutes(app, deps.furnitureManager);
  }

  if (deps.zoneManager) {
    registerZoneRoutes(app, deps.zoneManager);
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
    furniture: deps.furnitureManager?.list() ?? [],
    zones: deps.zoneManager?.list() ?? [...TAVERN_ZONES],
  };
}

// ---------- Phase 8 (B1): recent salient events ----------

/** Minimum salience score required for an event to surface in the ticker. */
export const TICKER_SCORE_THRESHOLD = 2;

interface RecentOpts {
  sinceEventId: number;
  limit: number;
}

/**
 * Phase 8 (B1): build the `/events/recent` payload. Pure (modulo the
 * persistence reads) so it can be unit-tested without spinning up Fastify.
 *
 * - Loads events newer than `sinceEventId`
 * - Builds an npcsById map from the live roster + arrival-event log so
 *   departed travellers can still be named in prose
 * - Scores each event via chronicle/salience; drops anything below the
 *   threshold
 * - Renders the surviving entries through chronicle/fallback.renderSentence
 * - Caps at `limit` (default 50)
 */
export function buildTickerResponse(
  deps: ApiDeps,
  opts: RecentOpts,
): TickerResponse {
  const all = deps.persistence.getEventsSince(opts.sinceEventId);
  const npcsById = buildNpcsByIdForTicker(deps, all);
  const threadsById = new Map<string, Thread>(
    deps.persistence.loadAllThreads().map((t) => [t.id, t]),
  );
  const ctx = {
    npcsById,
    threadsById,
    alarmingValues: DEFAULT_ALARMING_VALUES,
    markedNpcIds: new Set(deps.stateManager.getState().markedNpcIds),
  };

  const entries: TickerEntry[] = [];
  let lastEventId = opts.sinceEventId;
  for (const entry of all) {
    if (entry.id > lastEventId) lastEventId = entry.id;
    const s = scoreSalience(entry.event, ctx);
    if (s < TICKER_SCORE_THRESHOLD) continue;
    const text = renderSentence(entry, npcsById);
    if (!text) continue;
    const gameDay =
      'gameDay' in entry.event && typeof entry.event.gameDay === 'number'
        ? entry.event.gameDay
        : 0;
    entries.push({
      eventId: entry.id,
      gameDay,
      realTimestamp: entry.realTimestamp,
      score: s,
      text,
      event: entry.event,
    });
    if (entries.length >= opts.limit) break;
  }

  return { entries, lastEventId };
}

/**
 * Best-effort npcsById for prose: live roster + every arrival event seen
 * in the log (so departed travellers can still be named by displayName).
 * Mirrors the chronicle generator's augmentation logic; kept local to
 * routes.ts to avoid a circular import.
 */
function buildNpcsByIdForTicker(
  deps: ApiDeps,
  events: EventLogEntry[],
): Map<string, Npc> {
  const m = new Map<string, Npc>(
    deps.npcManager.getRoster().map((n) => [n.id, n]),
  );
  for (const entry of events) {
    if (
      entry.event.type !== 'npc_arrived' &&
      entry.event.type !== 'npc_returned'
    ) {
      continue;
    }
    if (m.has(entry.event.npcId)) continue;
    m.set(entry.event.npcId, {
      id: entry.event.npcId,
      displayName: entry.event.displayName,
      status: 'departed',
      position: { x: 0, y: 0 },
      zone: null,
      arrivedGameDay: entry.event.gameDay,
      arrivedSubTick: 0,
      plannedDepartureGameDay: 0,
      plannedDepartureSubTick: 0,
      nextDecisionSubTick: 0,
      carriedRumorIds: [],
    });
  }
  return m;
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
