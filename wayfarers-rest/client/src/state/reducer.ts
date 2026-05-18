import type {
  ChroniclePrologue,
  ChroniclesSinceResponse,
  DailyChronicle,
  EventLogEntry,
  FlavorMode,
  FlavorPoolStatus,
  Npc,
  Rumor,
  ScheduledArrival,
  TavernConfig,
  Thread,
  WorldSnapshot,
  WorldState,
  WorldTag,
} from '@shared/types';
import type { Action, InteractionFlash } from './actions.ts';

export interface WelcomeSlice {
  fromGameDay: number;
  toGameDay: number;
  chronicles: Record<number, DailyChronicle | 'pending'>;
  prologue: ChroniclePrologue | null;
  show: boolean;
}

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
  /** npcId -> { expiry timestamp, overheardText | undefined }. */
  interactingNpcs: Record<string, InteractionFlash>;
  flavorMode: FlavorMode;
  flavorPools: FlavorPoolStatus[];
  welcome: WelcomeSlice | null;
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
  flavorMode: 'placeholder',
  flavorPools: [],
  welcome: null,
};

function buildWelcome(payload: ChroniclesSinceResponse): WelcomeSlice {
  const map: Record<number, DailyChronicle | 'pending'> = {};
  for (const c of payload.chronicles) map[c.gameDay] = c;
  for (const d of payload.pendingDays) map[d] = 'pending';
  return {
    fromGameDay: payload.fromGameDay,
    toGameDay: payload.toGameDay,
    chronicles: map,
    prologue: payload.prologue,
    show: payload.fromGameDay <= payload.toGameDay,
  };
}

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
        next[id] = action.payload;
      }
      return { ...state, interactingNpcs: next };
    }
    case 'EXPIRE_INTERACTION_FLASHES': {
      const next: Record<string, InteractionFlash> = {};
      for (const [id, flash] of Object.entries(state.interactingNpcs)) {
        if (flash.expiresAt > action.payload.now) next[id] = flash;
      }
      return { ...state, interactingNpcs: next };
    }
    case 'FLAVOR_STATUS':
      return {
        ...state,
        flavorMode: action.payload.mode,
        flavorPools: action.payload.pools,
      };
    case 'WELCOME_OPENED':
      return { ...state, welcome: buildWelcome(action.payload) };
    case 'CHRONICLE_FILLED': {
      if (!state.welcome) return state;
      const day = action.payload.gameDay;
      if (day < state.welcome.fromGameDay || day > state.welcome.toGameDay) {
        return state;
      }
      return {
        ...state,
        welcome: {
          ...state.welcome,
          chronicles: { ...state.welcome.chronicles, [day]: action.payload },
        },
      };
    }
    case 'WELCOME_DISMISSED':
      if (!state.welcome) return state;
      return { ...state, welcome: { ...state.welcome, show: false } };
    default:
      return state;
  }
}
