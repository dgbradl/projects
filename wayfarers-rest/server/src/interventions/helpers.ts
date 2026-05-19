import type { WorldEventBus } from '../events/emitter.ts';
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
  };
}
