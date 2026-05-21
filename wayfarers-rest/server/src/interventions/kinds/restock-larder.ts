/**
 * Economy (E3): `restock_larder` — the keeper spends coin to restock the
 * larder. A fuller larder lifts what guests spend on meals (see
 * `computeGuestSpend`), but it depletes by one level each day the tavern is
 * open (see `LARDER_DECAY_PER_DAY`), so the keeper restocks to keep it up.
 * One of the coin-costed "economic verbs".
 */
import type { WorldStateManager } from '../../state.ts';
import type {
  InterventionDefinition,
  RestockLarderPayload,
} from '../types.ts';

/** Highest larder stock level. */
export const LARDER_MAX = 5;
/** Coin cost of one restock. */
export const RESTOCK_LARDER_COST = 40;

export interface RestockLarderDeps {
  stateManager: WorldStateManager;
}

export function buildRestockLarder(
  deps: RestockLarderDeps,
): InterventionDefinition<RestockLarderPayload> {
  return {
    kind: 'restock_larder',
    cost: RESTOCK_LARDER_COST,
    costCurrency: 'coin',
    describe(_payload, _options, effect) {
      // Render from the apply-time effect, not live state — `describe` runs
      // post-hoc in the chronicle, by when the larder has moved on (decayed).
      const level = effect?.larderRestockedTo;
      return level != null
        ? `You restocked the larder (now at ${level}/${LARDER_MAX}).`
        : 'You restocked the larder.';
    },
    validate(_payload, state) {
      if ((state.larderStock ?? 0) >= LARDER_MAX) {
        return { ok: false, reason: 'the larder is already well stocked' };
      }
      return { ok: true };
    },
    apply() {
      const current = deps.stateManager.getState();
      const larderStock = Math.min(LARDER_MAX, (current.larderStock ?? 0) + 1);
      deps.stateManager.setState({ ...current, larderStock });
      return { larderRestockedTo: larderStock };
    },
  };
}
