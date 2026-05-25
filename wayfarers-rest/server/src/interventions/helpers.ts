import type { WorldEventBus } from '../events/emitter.ts';
import type { DesireResolver } from '../npc/desire-resolver.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { WorldTagsManager } from '../world/tags.ts';
import type { InterventionHelpers } from './types.ts';

export interface BuildHelpersDeps {
  rumors: RumorsManager;
  threadRunner: ThreadRunner;
  worldTags: WorldTagsManager;
  bus: WorldEventBus;
  gameDay: number;
  /** Phase 8 (A4): present in the live server, omitted in stripped tests. */
  desireResolver?: DesireResolver;
  /** Phase 8 (A4): used to scan present NPCs for company_of_kind matches. */
  npcManager?: NpcManager;
  /** Phase 8 (A4): sub-tick at which fulfilment is recorded; defaults to 0
   *  (the day boundary) since interventions land between sub-ticks. */
  subTicksPerDay?: number;
  subTick?: number;
}

/**
 * Builds an immediate-mode helpers object. Each call here applies the
 * side-effect synchronously (vs. Phase 3's queued thread helpers). Used
 * by `InterventionDefinition.apply` functions.
 */
export function buildInterventionHelpers(deps: BuildHelpersDeps): InterventionHelpers {
  return {
    introduceRumor: (input) =>
      deps.rumors.introduce(
        {
          text: input.text,
          originLocationId: input.originLocationId,
          placeholderHint: {
            tagKey: input.tagKey,
            tagValue: input.tagValue,
            threadHistoryNote: input.threadHistoryNote,
          },
        },
        deps.gameDay,
      ),
    spawnThread: (input) => {
      const thread = deps.threadRunner.startThread({
        type: input.type,
        payload: input.payload,
        initialNextTickDelay: input.initialNextTickDelay,
        gameDay: deps.gameDay,
      });
      return thread.id;
    },
    setWorldTag: (key, value) => {
      deps.worldTags.set(key, value, deps.gameDay);
    },
    fulfilDesireFromRumor: (rumor, fulfilledBy) => {
      if (!deps.desireResolver || !deps.npcManager) return undefined;
      const absSubTick = absSubTickFor(deps);
      // Scan present NPCs; first matching desire wins.
      for (const npc of deps.npcManager.getRoster()) {
        if (npc.isStaff || !npc.desires) continue;
        const result = deps.desireResolver.fulfilFromRumor(
          npc.id,
          rumor,
          fulfilledBy,
          deps.gameDay,
          absSubTick,
        );
        if (result) return npc.id;
      }
      return undefined;
    },
    fulfilCompanyDesireForArchetype: (archetype, fulfilledBy) => {
      if (!deps.desireResolver || !deps.npcManager) return undefined;
      const absSubTick = absSubTickFor(deps);
      for (const npc of deps.npcManager.getRoster()) {
        if (npc.isStaff || !npc.desires) continue;
        const matching = npc.desires.find(
          (d) =>
            d.kind === 'company_of_kind' &&
            d.fulfilledAtSubTick === undefined &&
            (d.param === 'any' || d.param === archetype),
        );
        if (!matching) continue;
        const ok = deps.desireResolver.fulfilByExternal(
          npc.id,
          'company_of_kind',
          matching.param,
          fulfilledBy,
          deps.gameDay,
          absSubTick,
        );
        if (ok) return npc.id;
      }
      return undefined;
    },
  };
}

/**
 * Day-anchored absolute sub-tick for fulfilment timestamps when an
 * intervention lands. Falls back to the gameDay's first sub-tick if the
 * caller didn't pass live timing (tests, scripted runs).
 */
function absSubTickFor(deps: BuildHelpersDeps): number {
  const per = deps.subTicksPerDay ?? 0;
  const st = deps.subTick ?? 0;
  return deps.gameDay * per + st;
}
