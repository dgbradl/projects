import type { FastifyInstance } from 'fastify';
import type {
  InterventionExecuteResponse,
  InterventionKind,
  InterventionOptionsResponse,
  InterventionRecord,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Clock } from '../lib/clock.ts';
import { debitCoin } from '../economy/ledger.ts';
import { debitFavor } from '../interventions/favor.ts';
import { buildInterventionHelpers } from '../interventions/helpers.ts';
import { buildInterventionOptions } from '../interventions/options.ts';
import * as registry from '../interventions/registry.ts';
import type { InterventionOptions } from '../interventions/types.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { WorldTagsManager } from '../world/tags.ts';

export interface InterventionRouteDeps {
  persistence: Persistence;
  stateManager: WorldStateManager;
  npcManager: NpcManager;
  bus: WorldEventBus;
  clock: Clock;
  threadRunner: ThreadRunner;
  worldTags: WorldTagsManager;
  rumors: RumorsManager;
  favorsMax: number;
}

export function registerInterventionRoutes(
  app: FastifyInstance,
  deps: InterventionRouteDeps,
): void {
  app.get(
    '/interventions/options',
    async (): Promise<InterventionOptionsResponse> =>
      buildInterventionOptions({
        stateManager: deps.stateManager,
        persistence: deps.persistence,
        npcManager: deps.npcManager,
        favorsMax: deps.favorsMax,
      }),
  );

  app.post<{ Body: { kind: InterventionKind; payload?: Record<string, unknown> } }>(
    '/interventions',
    async (req, reply) => {
      const body = req.body ?? ({ kind: undefined } as never);
      if (!body || typeof body.kind !== 'string') {
        reply.code(400);
        return { error: 'kind is required' };
      }
      const def = registry.get(body.kind);
      if (!def) {
        reply.code(400);
        return { error: `unknown intervention kind: ${body.kind}` };
      }

      const state = deps.stateManager.getState();
      // Economy (E3): a kind is paid in favor (default) or coin.
      const currency = registry.costCurrencyOf(def);
      const balance = currency === 'coin' ? state.coin : state.favors;
      if (balance < def.cost) {
        reply.code(400);
        return {
          error: `not enough ${registry.currencyLabel(currency)} (have ${balance}, need ${def.cost})`,
        };
      }

      const options: InterventionOptions = {
        state,
        targets: buildInterventionOptions({
          stateManager: deps.stateManager,
          persistence: deps.persistence,
          npcManager: deps.npcManager,
          favorsMax: deps.favorsMax,
        }).targets,
        availableRumors: deps.persistence.loadAvailableRumors(),
      };
      const payload = (body.payload ?? {}) as never;
      const validation = def.validate(payload, state, options);
      if (!validation.ok) {
        reply.code(400);
        return { error: validation.reason };
      }

      const gameDay = state.gameDay;
      const helpers = buildInterventionHelpers({
        rumors: deps.rumors,
        threadRunner: deps.threadRunner,
        worldTags: deps.worldTags,
        bus: deps.bus,
        gameDay,
      });

      let record: InterventionRecord | null = null;
      let applyError: Error | null = null;
      try {
        deps.persistence.transaction(() => {
          if (currency === 'coin') {
            debitCoin(deps.stateManager, def.cost);
          } else {
            debitFavor(deps.stateManager, def.cost);
          }
          const effect = def.apply({
            payload,
            helpers,
            state,
            options,
            gameDay,
          });
          // Phase 6: plant_rumor adds an introducedRumorId → mark playerOrigin.
          if (
            body.kind === 'plant_rumor' &&
            effect.introducedRumorId &&
            typeof (payload as { tone?: string }).tone !== 'undefined'
          ) {
            const tone = (payload as { tone: import('@shared/types').RumorTone }).tone;
            deps.rumors.markPlayerOrigin(effect.introducedRumorId, tone);
          } else if (body.kind === 'plant_rumor' && effect.introducedRumorId) {
            deps.rumors.markPlayerOrigin(effect.introducedRumorId, 'curious');
          }
          const counter = deps.persistence.countInterventionsOnDay(gameDay);
          const id = `int_d${gameDay}_${counter}`;
          record = {
            id,
            kind: body.kind,
            gameDay,
            realTimestamp: new Date(deps.clock.now()).toISOString(),
            cost: def.cost,
            costCurrency: currency,
            payload: payload ?? {},
            effect,
          };
          deps.persistence.insertIntervention(record);
        });
      } catch (err) {
        applyError = err as Error;
      }

      if (applyError || !record) {
        reply.code(400);
        return {
          error: `intervention failed: ${applyError?.message ?? 'unknown error'}`,
        };
      }

      // Emit the event after the transaction so the SSE listeners see a
      // committed state.
      deps.bus.publish({
        type: 'intervention_used',
        gameDay,
        intervention: record,
      });

      const response: InterventionExecuteResponse = {
        intervention: record,
        state: deps.stateManager.getState(),
      };
      return response;
    },
  );
}
