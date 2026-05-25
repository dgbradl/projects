/**
 * Phase 9 (G4): the `shift_focus` intervention.
 *
 * Swap one current tavern trait for another. The keeper picks their identity
 * once at onboarding (D2); this verb lets them shift it without restarting
 * — at a cost. 3 favors is a meaningful chunk (more than half a max pool),
 * so the change feels weighty rather than casual.
 *
 * Validation gates:
 *   - Both `dropTrait` and `addTrait` must be in TAVERN_TRAITS.
 *   - `dropTrait` must currently be owned (state.tavernTraits.includes).
 *   - `addTrait` must NOT currently be owned (no-op guard).
 *   - The two must differ.
 *
 * Apply:
 *   - Replace dropTrait with addTrait in WorldState.tavernTraits (preserving
 *     the position of the other trait if any).
 *   - Emit `tavern_named` with the new trait set — the chronicle salience
 *     scorer (D2 wiring) already rates this 9, so the shift lands prominently.
 */
import type { WorldEventBus } from '../../events/emitter.ts';
import type { WorldStateManager } from '../../state.ts';
import type { TavernTrait } from '@shared/types';
import { TAVERN_TRAITS } from '@shared/types';
import { register } from '../registry.ts';
import type {
  InterventionDefinition,
  ShiftFocusPayload,
} from '../types.ts';

export interface ShiftFocusDeps {
  stateManager: WorldStateManager;
  bus: WorldEventBus;
}

const VALID_TRAITS = new Set<string>(TAVERN_TRAITS);

function humanizeTrait(t: string): string {
  return t.replace(/_/g, ' ');
}

export function buildShiftFocus(
  deps: ShiftFocusDeps,
): InterventionDefinition<ShiftFocusPayload> {
  return {
    kind: 'shift_focus',
    cost: 3,
    describe(payload) {
      return `You shifted the tavern's focus from ${humanizeTrait(payload.dropTrait)} to ${humanizeTrait(payload.addTrait)}`;
    },
    validate(payload, state) {
      if (!payload || typeof payload.dropTrait !== 'string' || typeof payload.addTrait !== 'string') {
        return { ok: false, reason: 'dropTrait and addTrait are required' };
      }
      if (!VALID_TRAITS.has(payload.dropTrait)) {
        return { ok: false, reason: `unknown trait: ${payload.dropTrait}` };
      }
      if (!VALID_TRAITS.has(payload.addTrait)) {
        return { ok: false, reason: `unknown trait: ${payload.addTrait}` };
      }
      if (payload.dropTrait === payload.addTrait) {
        return { ok: false, reason: 'pick a different trait to take its place' };
      }
      if (!state.tavernTraits.includes(payload.dropTrait as TavernTrait)) {
        return {
          ok: false,
          reason: `the tavern does not currently have the ${humanizeTrait(payload.dropTrait)} trait`,
        };
      }
      if (state.tavernTraits.includes(payload.addTrait as TavernTrait)) {
        return {
          ok: false,
          reason: `the tavern already has the ${humanizeTrait(payload.addTrait)} trait`,
        };
      }
      return { ok: true };
    },
    apply({ payload, gameDay }) {
      const current = deps.stateManager.getState();
      const nextTraits = current.tavernTraits.map((t) =>
        t === payload.dropTrait ? (payload.addTrait as TavernTrait) : t,
      );
      deps.stateManager.setState({
        ...current,
        tavernTraits: nextTraits,
      });
      deps.bus.publish({
        type: 'tavern_named',
        gameDay,
        tavernName: current.tavernName,
        tavernTraits: nextTraits,
      });
      return {};
    },
  };
}
