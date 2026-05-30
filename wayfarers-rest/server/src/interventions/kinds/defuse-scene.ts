/**
 * Phase 9 (F4): the `defuse_scene` intervention.
 *
 * Costs 3 favors. Collapses a live scene to `aftermath` AND flags it
 * so the resolution emits outcome=`defused_by_keeper`. The chronicle
 * credits the keeper — the scene is remembered as "the keeper stepped
 * in and defused the brawl" rather than "burned itself out."
 */
import type { WorldStateManager } from '../../state.ts';
import type { StageRunner } from '../../stage/runner.ts';
import type {
  DefuseScenePayload,
  InterventionDefinition,
} from '../types.ts';

export interface DefuseSceneDeps {
  stateManager: WorldStateManager;
  stageRunner: StageRunner;
}

export function buildDefuseScene(
  deps: DefuseSceneDeps,
): InterventionDefinition<DefuseScenePayload> {
  return {
    kind: 'defuse_scene',
    cost: 3,
    describe(payload) {
      return `You stepped in and defused the ${payload.stageEventId.split('_').pop() ?? 'scene'}`;
    },
    validate(payload) {
      if (!payload || typeof payload.stageEventId !== 'string') {
        return { ok: false, reason: 'stageEventId is required' };
      }
      const scene = deps.stageRunner
        .getLiveScenes()
        .find((s) => s.id === payload.stageEventId);
      if (!scene) {
        return { ok: false, reason: 'that scene is no longer live' };
      }
      if (scene.state === 'aftermath') {
        return {
          ok: false,
          reason: 'the scene is already winding down on its own',
        };
      }
      return { ok: true };
    },
    apply({ payload, gameDay }) {
      const state = deps.stateManager.getState();
      const result = deps.stageRunner.applyKeeperAction(
        payload.stageEventId,
        'defuse',
        gameDay,
        state.subTick,
      );
      if (!result) return {};
      return {};
    },
  };
}
