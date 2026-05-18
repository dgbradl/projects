import type { Npc, TavernConfig, WorldState } from '@shared/types';
import type { Action } from './actions.ts';

export interface AppState {
  tavern: TavernConfig | null;
  world: WorldState | null;
  npcs: Record<string, Npc>;
}

export const initialState: AppState = {
  tavern: null,
  world: null,
  npcs: {},
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT_TAVERN':
      return { ...state, tavern: action.payload };
    case 'INIT_STATE':
    case 'STATE_UPDATE':
      return { ...state, world: action.payload };
    case 'NPCS_SNAPSHOT': {
      const npcs: Record<string, Npc> = {};
      for (const n of action.payload) npcs[n.id] = n;
      return { ...state, npcs };
    }
    case 'NPCS_DIFF': {
      const npcs = { ...state.npcs };
      for (const n of action.payload.added) npcs[n.id] = n;
      for (const n of action.payload.updated) npcs[n.id] = n;
      for (const id of action.payload.removed) delete npcs[id];
      return { ...state, npcs };
    }
    default:
      return state;
  }
}
