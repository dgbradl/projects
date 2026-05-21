/**
 * Economy (E3): `upgrade_hearth` — the keeper spends coin to build up the
 * hearth and common room. A finer hearth raises what overnight guests pay for
 * a room (see `computeGuestSpend`). A permanent improvement: unlike the
 * larder, the hearth never decays once built up.
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
    describe(_payload, _options, effect) {
      // Render from the apply-time effect, not live state — `describe` runs
      // post-hoc in the chronicle, well after the upgrade.
      const level = effect?.hearthUpgradedTo;
      return level != null
        ? `You built up the hearth and common room (now at ${level}/${HEARTH_MAX}).`
        : 'You built up the hearth and common room.';
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
