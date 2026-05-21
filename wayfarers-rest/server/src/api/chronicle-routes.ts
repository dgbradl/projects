import type { FastifyInstance } from 'fastify';
import type {
  ChronicleLedgerEntry,
  ChroniclesSinceResponse,
  DailyChronicle,
  DailyChronicleWithLedger,
  Npc,
} from '@shared/types';
import type { ChroniclePipeline } from '../chronicle/pipeline.ts';
import type { PrologueGenerator } from '../chronicle/prologue.ts';
import { scoreEntries, select } from '../chronicle/salience.ts';
import { DEFAULT_ALARMING_VALUES } from '../chronicle/types.ts';
import type { WorldEventBus } from '../events/emitter.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';

export interface ChronicleRouteDeps {
  persistence: Persistence;
  stateManager: WorldStateManager;
  npcManager: NpcManager;
  pipeline: ChroniclePipeline;
  prologue: PrologueGenerator;
  bus: WorldEventBus;
  maxEvents: number;
}

export function registerChronicleRoutes(
  app: FastifyInstance,
  deps: ChronicleRouteDeps,
): void {
  app.get<{ Params: { gameDay: string } }>(
    '/chronicles/:gameDay',
    async (req, reply) => {
      const day = parseInt(req.params.gameDay, 10);
      if (!Number.isFinite(day) || day < 1) {
        reply.code(400);
        return { error: 'invalid gameDay' };
      }
      const chronicle = deps.persistence.loadChronicle(day);
      if (!chronicle) {
        reply.code(404);
        return { error: `no chronicle for day ${day}` };
      }
      const ledger = buildLedger(deps, day);
      return { chronicle, ledger } satisfies DailyChronicleWithLedger;
    },
  );

  app.get('/chronicles/since', async (): Promise<ChroniclesSinceResponse> => {
    const state = deps.stateManager.getState();
    const fromGameDay = state.lastAcknowledgedGameDay + 1;
    const toGameDay = state.gameDay - 1; // don't show today
    if (fromGameDay > toGameDay) {
      return {
        fromGameDay,
        toGameDay,
        chronicles: [],
        prologue: null,
        pendingDays: [],
      };
    }
    const rows = deps.persistence.loadChroniclesBetween(fromGameDay, toGameDay);
    const byDay = new Map(rows.map((r) => [r.gameDay, r]));
    const chronicles: DailyChronicle[] = [];
    const pendingDays: number[] = [];
    for (let d = fromGameDay; d <= toGameDay; d += 1) {
      const row = byDay.get(d);
      if (!row) {
        pendingDays.push(d);
        continue;
      }
      if (row.status === 'complete' || row.status === 'fallback') {
        chronicles.push(row);
      } else {
        pendingDays.push(d);
      }
    }
    const prologue = await deps.prologue.getOrGenerate(fromGameDay, toGameDay);
    return { fromGameDay, toGameDay, chronicles, prologue, pendingDays };
  });

  app.post<{ Body: { acknowledgedGameDay: number } }>(
    '/chronicles/acknowledge',
    async (req, reply) => {
      const body = req.body ?? ({ acknowledgedGameDay: 0 } as { acknowledgedGameDay: number });
      const ack = Number(body.acknowledgedGameDay);
      if (!Number.isFinite(ack) || ack < 0) {
        reply.code(400);
        return { error: 'invalid acknowledgedGameDay' };
      }
      const state = deps.stateManager.getState();
      if (ack < state.lastAcknowledgedGameDay) {
        reply.code(400);
        return { error: 'acknowledgement may only move forward' };
      }
      if (ack > state.gameDay - 1) {
        reply.code(400);
        return { error: "cannot acknowledge today; it is still in progress" };
      }
      const next = deps.stateManager.setState({
        ...state,
        lastAcknowledgedGameDay: ack,
      });
      deps.bus.publish({
        type: 'chronicle_acknowledged',
        gameDay: state.gameDay,
        acknowledgedUpTo: ack,
      });
      return next;
    },
  );

  // Dev-only: force a regeneration. Marks the row pending so the worker
  // picks it up.
  app.post<{ Params: { gameDay: string } }>(
    '/chronicles/:gameDay/regenerate',
    async (req, reply) => {
      const day = parseInt(req.params.gameDay, 10);
      if (!Number.isFinite(day) || day < 1) {
        reply.code(400);
        return { error: 'invalid gameDay' };
      }
      const state = deps.stateManager.getState();
      if (day >= state.gameDay) {
        reply.code(400);
        return { error: 'cannot regenerate the current or a future day' };
      }
      const existing = deps.persistence.loadChronicle(day);
      deps.persistence.upsertChronicle({
        gameDay: day,
        generatedAtRealTs: existing?.generatedAtRealTs ?? null,
        status: 'pending',
        headlines: [],
        footnotes: [],
        modelUsed: null,
        promptCharCount: null,
        completionCharCount: null,
        generationDurationMs: null,
        failureReason: null,
      });
      return { ok: true, queued: day };
    },
  );
}

function buildLedger(
  deps: ChronicleRouteDeps,
  gameDay: number,
): ChronicleLedgerEntry[] {
  const allEvents = deps.persistence.getEventsSince(0);
  const dayEvents = allEvents.filter(
    (e) => 'gameDay' in e.event && e.event.gameDay === gameDay,
  );
  const npcsById = new Map<string, Npc>(
    deps.npcManager.getRoster().map((n) => [n.id, n]),
  );
  for (const entry of allEvents) {
    if (
      entry.event.type !== 'npc_arrived' &&
      entry.event.type !== 'npc_returned'
    ) {
      continue;
    }
    if (npcsById.has(entry.event.npcId)) continue;
    npcsById.set(entry.event.npcId, {
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
  const threadsById = new Map(
    deps.persistence.loadAllThreads().map((t) => [t.id, t]),
  );
  const ctx = {
    npcsById,
    threadsById,
    alarmingValues: DEFAULT_ALARMING_VALUES,
  };
  const selected = select(dayEvents, ctx, { maxEvents: deps.maxEvents });
  const selectedIds = new Set(selected.map((s) => s.id));
  const scored = scoreEntries(dayEvents, ctx);
  const scoreById = new Map(scored.map((s) => [s.entry.id, s.score]));
  return selected.map((entry) => ({
    eventId: entry.id,
    realTimestamp: entry.realTimestamp,
    event: entry.event,
    score: scoreById.get(entry.id) ?? 0,
  }));
}
