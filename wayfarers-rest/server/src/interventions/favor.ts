import type { WorldEventBus } from '../events/emitter.ts';
import type { WorldStateManager } from '../state.ts';

export const FAVORS_MAX_DEFAULT = parseInt(process.env.FAVORS_MAX ?? '5', 10);
export const FAVORS_REGEN_PER_DAY_DEFAULT = parseInt(
  process.env.FAVORS_REGEN_PER_DAY ?? '1',
  10,
);
export const FAVORS_INITIAL_DEFAULT = parseInt(
  process.env.FAVORS_INITIAL ?? '3',
  10,
);

export interface FavorConfig {
  max: number;
  regenPerDay: number;
}

/**
 * If we haven't regenerated yet on `newGameDay` and we're below the cap,
 * add one favor (clamped). Emits `favor_regenerated` only when an increment
 * actually occurred.
 */
export function regenerateForDayTick(
  stateManager: WorldStateManager,
  bus: WorldEventBus,
  newGameDay: number,
  cfg: FavorConfig = { max: FAVORS_MAX_DEFAULT, regenPerDay: FAVORS_REGEN_PER_DAY_DEFAULT },
): boolean {
  const state = stateManager.getState();
  if (state.favorsLastRegenGameDay === newGameDay) return false;
  if (state.favors >= cfg.max) {
    // Still bump the day marker so we don't keep retrying on the same day.
    stateManager.setState({ ...state, favorsLastRegenGameDay: newGameDay });
    return false;
  }
  const next = Math.min(cfg.max, state.favors + cfg.regenPerDay);
  stateManager.setState({
    ...state,
    favors: next,
    favorsLastRegenGameDay: newGameDay,
  });
  bus.publish({
    type: 'favor_regenerated',
    gameDay: newGameDay,
    newTotal: next,
  });
  return true;
}

/**
 * Throws if the player can't afford the cost; otherwise debits the favor pool.
 * Caller is responsible for emitting `intervention_used` after the apply.
 */
export function debitFavor(
  stateManager: WorldStateManager,
  cost: number,
): void {
  const state = stateManager.getState();
  if (state.favors < cost) {
    throw new Error(`not enough favors: have ${state.favors}, need ${cost}`);
  }
  stateManager.setState({ ...state, favors: state.favors - cost });
}
