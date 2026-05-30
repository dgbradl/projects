/**
 * Phase 9 (F4): the `escalate_scene` intervention.
 *
 * Costs 2 favors. Jumps a live scene that's still in `building` or
 * `underway` straight to `climax`. The keeper leans into the moment —
 * a brawl gets fiercer, a wedding bigger, a court day more dramatic.
 *
 * Resolution outcome is *not* affected: an escalated brawl still
 * burns out (just faster); an escalated wedding still completes. The
 * verb shifts the *trajectory*, not the *meaning*. F4's defuse_scene
 * is the verb that changes outcome.
 */
import type { WorldStateManager } from '../../state.ts';
import type { StageRunner } from '../../stage/runner.ts';
import type {
  EscalateScenePayload,
  InterventionDefinition,
} from '../types.ts';

export interface EscalateSceneDeps {
  stateManager: WorldStateManager;
  stageRunner: StageRunner;
}

export function buildEscalateScene(
  deps: EscalateSceneDeps,
): InterventionDefinition<EscalateScenePayload> {
  return {
    kind: 'escalate_scene',
    cost: 2,
    describe(payload) {
      return `You leant into the ${payload.stageEventId.split('_').pop() ?? 'scene'}, pushing it to its peak`;
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
      if (scene.state !== 'building' && scene.state !== 'underway') {
        return {
          ok: false,
          reason: 'too late — the scene is already past its peak',
        };
      }
      return { ok: true };
    },
    apply({ payload, gameDay }) {
      const state = deps.stateManager.getState();
      const result = deps.stageRunner.applyKeeperAction(
        payload.stageEventId,
        'escalate',
        gameDay,
        state.subTick,
      );
      if (!result) return {};
      return {};
    },
  };
}
