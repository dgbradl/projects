import type {
  ChroniclePrologue,
  ChroniclesSinceResponse,
  DailyChronicle,
  EventLogEntry,
  FlavorMode,
  FlavorPoolStatus,
  FurniturePiece,
  InterventionOptionsResponse,
  Zone,
  InterventionRecord,
  Npc,
  Rumor,
  ScheduledArrival,
  TavernConfig,
  Thread,
  TickerEntry,
  WorldSnapshot,
  WorldState,
  WorldTag,
} from '@shared/types';
import type { Action, CoinTip, InteractionFlash } from './actions.ts';

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
  /** Phase 6: intervention UI + history. */
  interventionPickerOpen: boolean;
  interventionOptions: InterventionOptionsResponse | null;
  recentInterventions: InterventionRecord[];
  /** Wall-clock ms timestamp until which the landing animation should show. */
  landingAnimationUntil: number | null;
  /** F3: server-owned furniture layout (back→front = paint order). */
  furniture: FurniturePiece[];
  /** D1/D2: server-owned zone layout (defaults + any debug edits). */
  zones: Zone[];
  /** D2: whether the debug zone overlay is visible / draggable. */
  debugZonesEnabled: boolean;
  /** Phase 8 (QW1): floating "+N coin" tips for guest_spent events. */
  coinTips: CoinTip[];
  /** Phase 8 (B2): live ticker — server-rendered salient entries, newest first. */
  tickerEntries: TickerEntry[];
  /** Highest eventId we have in `tickerEntries` (or have polled past). */
  tickerLastEventId: number;
  /** Phase 8 (B3): NPC currently highlighted by a ticker click (null = none). */
  focusedNpcId: string | null;
  /** Phase 8 (B3): wall-clock ms at which the focused-glow expires. */
  focusedNpcExpiresAt: number;
  /** Phase 8 (B3): which thread-row in the ticker is expanded. */
  expandedThreadId: string | null;
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
  interventionPickerOpen: false,
  interventionOptions: null,
  recentInterventions: [],
  landingAnimationUntil: null,
  furniture: [],
  zones: [],
  debugZonesEnabled: false,
  coinTips: [],
  tickerEntries: [],
  tickerLastEventId: 0,
  focusedNpcId: null,
  focusedNpcExpiresAt: 0,
  expandedThreadId: null,
};

/** Cap on client-side ticker buffer — keeps the scroll list bounded. */
const TICKER_BUFFER_CAP = 80;

const LANDING_ANIMATION_MS = 1_500;

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
      // Seed the zone slice from the initial tavern config too, so the
      // debug overlay has data even before the first /world snapshot.
      return {
        ...state,
        tavern: action.payload,
        zones: state.zones.length === 0 ? action.payload.zones : state.zones,
      };
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
        furniture: action.payload.furniture ?? state.furniture,
        zones: action.payload.zones ?? state.zones,
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
    case 'COIN_TIP': {
      // Cap the list so a flurry of departures doesn't grow it unbounded.
      const next = [action.payload, ...state.coinTips].slice(0, 12);
      return { ...state, coinTips: next };
    }
    case 'EXPIRE_COIN_TIPS': {
      const cutoff = action.payload.now;
      const next = state.coinTips.filter((t) => t.expiresAt > cutoff);
      if (next.length === state.coinTips.length) return state;
      return { ...state, coinTips: next };
    }
    case 'TICKER_LOADED': {
      // Merge: new entries (newest first from server) prepended; dedup by
      // eventId; cap. lastEventId is monotonically the highest seen.
      const incoming = action.payload.entries;
      const seen = new Set<number>(state.tickerEntries.map((e) => e.eventId));
      const merged: TickerEntry[] = [];
      for (const e of incoming) {
        if (!seen.has(e.eventId)) {
          merged.push(e);
          seen.add(e.eventId);
        }
      }
      // Phase 8 (B3): drop adjacent duplicates of the rendered text — a
      // sub-tick burst can produce repeats (e.g. two NPCs depart simultaneously
      // with the same fallback sentence). Keep the first, drop near-clones.
      const reversed = merged.reverse();
      const candidate = [...reversed, ...state.tickerEntries];
      const deduped: TickerEntry[] = [];
      let lastText = '';
      for (const e of candidate) {
        if (e.text === lastText) continue;
        deduped.push(e);
        lastText = e.text;
      }
      const nextEntries = deduped.slice(0, TICKER_BUFFER_CAP);
      return {
        ...state,
        tickerEntries: nextEntries,
        tickerLastEventId: Math.max(
          state.tickerLastEventId,
          action.payload.lastEventId,
        ),
      };
    }
    case 'FOCUS_NPC':
      return {
        ...state,
        focusedNpcId: action.payload.npcId,
        focusedNpcExpiresAt: action.payload.expiresAt,
      };
    case 'EXPIRE_FOCUSED_NPC': {
      if (state.focusedNpcId === null) return state;
      if (action.payload.now < state.focusedNpcExpiresAt) return state;
      return { ...state, focusedNpcId: null, focusedNpcExpiresAt: 0 };
    }
    case 'TOGGLE_TICKER_THREAD':
      return {
        ...state,
        expandedThreadId:
          state.expandedThreadId === action.payload.threadId
            ? null
            : action.payload.threadId,
      };
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
    case 'INTERVENTION_OPTIONS_LOADED':
      return { ...state, interventionOptions: action.payload };
    case 'INTERVENTION_PICKER_OPENED':
      return { ...state, interventionPickerOpen: true };
    case 'INTERVENTION_PICKER_CLOSED':
      return { ...state, interventionPickerOpen: false };
    case 'INTERVENTION_LANDED': {
      const recent = [action.payload, ...state.recentInterventions].slice(0, 20);
      return {
        ...state,
        recentInterventions: recent,
        landingAnimationUntil: Date.now() + LANDING_ANIMATION_MS,
      };
    }
    case 'FURNITURE_SET':
      return { ...state, furniture: action.payload };
    case 'FURNITURE_UPSERT': {
      const piece = action.payload;
      const i = state.furniture.findIndex((p) => p.id === piece.id);
      const next = state.furniture.slice();
      if (i >= 0) next[i] = piece;
      else next.push(piece);
      // Keep paint order = ascending layer.
      next.sort((a, b) => a.layer - b.layer);
      return { ...state, furniture: next };
    }
    case 'FURNITURE_REMOVE':
      return {
        ...state,
        furniture: state.furniture.filter((p) => p.id !== action.payload.id),
      };
    case 'ZONES_SET':
      return { ...state, zones: action.payload };
    case 'ZONES_UPSERT': {
      const z = action.payload;
      const i = state.zones.findIndex((existing) => existing.name === z.name);
      const next = state.zones.slice();
      if (i >= 0) next[i] = z;
      else next.push(z);
      return { ...state, zones: next };
    }
    case 'ZONES_REMOVE':
      return {
        ...state,
        zones: state.zones.filter((z) => z.name !== action.payload.name),
      };
    case 'DEBUG_ZONES_TOGGLED':
      return { ...state, debugZonesEnabled: !state.debugZonesEnabled };
    default:
      return state;
  }
}
