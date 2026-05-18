import type {
  EventLogEntry,
  Npc,
  Rumor,
  ScheduledArrival,
  TavernConfig,
  Thread,
  WorldSnapshot,
  WorldState,
  WorldTag,
} from '@shared/types';
import type { Action } from './actions.ts';

const RECENT_EVENT_CAP = 100;

export interface AppState {
  tavern: TavernConfig | null;
  world: WorldState | null;
  npcs: Record<string, Npc>;
  worldTags: WorldTag[];
  threads: Thread[];
  pendingArrivals: ScheduledArrival[];
  rumors: Rumor[];
  recentEvents: EventLogEntry[];
  /** npcId -> wall-clock expiry timestamp (ms since epoch). */
  interactingNpcs: Record<string, number>;
}

export const initialState: AppState = {
  tavern: null,
  world: null,
  npcs: {},
  worldTags: [],
  threads: [],
  pendingArrivals: [],
  rumors: [],
  recentEvents: [],
  interactingNpcs: {},
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
    case 'WORLD_SNAPSHOT':
      return {
        ...state,
        worldTags: action.payload.worldTags,
        threads: action.payload.threads,
        pendingArrivals: action.payload.pendingArrivals,
        rumors: action.payload.rumors,
      };
    case 'WORLD_EVENT': {
      const trimmed = [action.payload, ...state.recentEvents].slice(
        0,
        RECENT_EVENT_CAP,
      );
      return { ...state, recentEvents: trimmed };
    }
    case 'INTERACTION_FLASH': {
      const next = { ...state.interactingNpcs };
      for (const id of action.payload.npcIds) {
        next[id] = action.payload.expiresAt;
      }
      return { ...state, interactingNpcs: next };
    }
    case 'EXPIRE_INTERACTION_FLASHES': {
      const next: Record<string, number> = {};
      for (const [id, expires] of Object.entries(state.interactingNpcs)) {
        if (expires > action.payload.now) next[id] = expires;
      }
      return { ...state, interactingNpcs: next };
    }
    default:
      return state;
  }
}
