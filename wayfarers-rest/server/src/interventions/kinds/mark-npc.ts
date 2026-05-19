import type { WorldEventBus } from '../../events/emitter.ts';
import type { NpcManager } from '../../npc/manager.ts';
import type { WorldStateManager } from '../../state.ts';
import { register } from '../registry.ts';
import type {
  InterventionDefinition,
  MarkNpcPayload,
} from '../types.ts';

export interface MarkNpcDeps {
  npcManager: NpcManager;
  stateManager: WorldStateManager;
  bus: WorldEventBus;
}

export function buildMarkNpc(deps: MarkNpcDeps): InterventionDefinition<MarkNpcPayload> {
  return {
    kind: 'mark_npc',
    cost: 1,
    describe(payload, options) {
      const npc = options.targets.npcsInTavern.find((n) => n.id === payload.npcId);
      const name = npc?.displayName ?? payload.npcId;
      return `You marked ${name} for the keeper's attention`;
    },
    validate(payload, state) {
      if (!payload || typeof payload.npcId !== 'string') {
        return { ok: false, reason: 'npcId is required' };
      }
      const npc = deps.npcManager.getRoster().find((n) => n.id === payload.npcId);
      if (!npc) {
        return { ok: false, reason: `NPC not found: ${payload.npcId}` };
      }
      if (npc.status === 'departed') {
        return { ok: false, reason: 'cannot mark a departed NPC' };
      }
      if (state.markedNpcIds.includes(payload.npcId)) {
        return { ok: false, reason: 'NPC is already marked' };
      }
      return { ok: true };
    },
    apply({ payload, gameDay }) {
      const current = deps.stateManager.getState();
      deps.stateManager.setState({
        ...current,
        markedNpcIds: [...current.markedNpcIds, payload.npcId],
      });
      deps.bus.publish({
        type: 'npc_marked',
        gameDay,
        npcId: payload.npcId,
      });
      return { markedNpcId: payload.npcId };
    },
  };
}
