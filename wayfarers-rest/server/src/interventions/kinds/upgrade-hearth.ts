/**
 * Economy (E3): `upgrade_hearth` — the keeper spends coin to build up the
 * hearth and common room. A finer hearth raises what overnight guests pay for
 * a room (see `computeGuestSpend`). A permanent improvement, unlike the
 * larder, which depletes-and-restocks in spirit.
 */
import type { WorldStateManager } from '../../state.ts';
import type {
  InterventionDefinition,
  UpgradeHearthPayload,
} from '../types.ts';

/** Highest hearth comfort level. */
export const HEARTH_MAX = 5;
/** Coin cost of one upgrade. */
export const UPGRADE_HEARTH_COST = 80;

export interface UpgradeHearthDeps {
  stateManager: WorldStateManager;
}

export function buildUpgradeHearth(
  deps: UpgradeHearthDeps,
): InterventionDefinition<UpgradeHearthPayload> {
  return {
    kind: 'upgrade_hearth',
    cost: UPGRADE_HEARTH_COST,
    costCurrency: 'coin',
    describe() {
      const next = Math.min(
        HEARTH_MAX,
        (deps.stateManager.getState().hearthLevel ?? 0) + 1,
      );
      return `You built up the hearth and common room (now at ${next}/${HEARTH_MAX}).`;
    },
    validate(_payload, state) {
      if ((state.hearthLevel ?? 0) >= HEARTH_MAX) {
        return { ok: false, reason: 'the hearth is as fine as it can be' };
      }
      return { ok: true };
    },
    apply() {
      const current = deps.stateManager.getState();
      const hearthLevel = Math.min(HEARTH_MAX, (current.hearthLevel ?? 0) + 1);
      deps.stateManager.setState({ ...current, hearthLevel });
      return { hearthUpgradedTo: hearthLevel };
    },
  };
}
