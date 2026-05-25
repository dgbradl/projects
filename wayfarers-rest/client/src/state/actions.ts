import type {
  ChroniclesSinceResponse,
  DailyChronicle,
  EventLogEntry,
  FlavorMode,
  FlavorPoolStatus,
  FurniturePiece,
  InterventionOptionsResponse,
  InterventionRecord,
  Npc,
  NpcDiff,
  TavernConfig,
  TickerEntry,
  WorldSnapshot,
  WorldState,
  Zone,
} from '@shared/types';

export interface InteractionFlash {
  npcIds: string[];
  expiresAt: number;
  overheardText?: string;
}

/**
 * Phase 8 (QW1): a floating "+N coin" appears above the status-bar coin
 * counter for ~1s when a guest_spent event arrives over SSE. The store
 * keeps a list of live tips; the StatusBar renders one element per id.
 */
export interface CoinTip {
  id: string;
  amount: number;
  expiresAt: number;
}

export interface FlavorStatusPayload {
  mode: FlavorMode;
  pools: FlavorPoolStatus[];
}

export type Action =
  | { type: 'INIT_TAVERN'; payload: TavernConfig }
  | { type: 'INIT_STATE'; payload: WorldState }
  | { type: 'STATE_UPDATE'; payload: WorldState }
  | { type: 'NPCS_SNAPSHOT'; payload: Npc[] }
  | { type: 'NPCS_DIFF'; payload: NpcDiff }
  | { type: 'WORLD_SNAPSHOT'; payload: WorldSnapshot }
  | { type: 'WORLD_EVENT'; payload: EventLogEntry }
  | { type: 'INTERACTION_FLASH'; payload: InteractionFlash }
  | { type: 'EXPIRE_INTERACTION_FLASHES'; payload: { now: number } }
  // Phase 8 (QW1): floating "+N coin" feedback for guest_spent events.
  | { type: 'COIN_TIP'; payload: CoinTip }
  | { type: 'EXPIRE_COIN_TIPS'; payload: { now: number } }
  // Phase 8 (B2): live event ticker — server-rendered salient entries.
  | {
      type: 'TICKER_LOADED';
      payload: { entries: TickerEntry[]; lastEventId: number };
    }
  // Phase 8 (B3): focus an NPC (and expire it after the glow window).
  | { type: 'FOCUS_NPC'; payload: { npcId: string; expiresAt: number } }
  | { type: 'EXPIRE_FOCUSED_NPC'; payload: { now: number } }
  // Phase 8 (B3): expand/collapse a thread row in the ticker.
  | { type: 'TOGGLE_TICKER_THREAD'; payload: { threadId: string } }
  | { type: 'FLAVOR_STATUS'; payload: FlavorStatusPayload }
  | { type: 'WELCOME_OPENED'; payload: ChroniclesSinceResponse }
  | { type: 'CHRONICLE_FILLED'; payload: DailyChronicle }
  | { type: 'WELCOME_DISMISSED' }
  | { type: 'INTERVENTION_OPTIONS_LOADED'; payload: InterventionOptionsResponse }
  | { type: 'INTERVENTION_PICKER_OPENED' }
  | { type: 'INTERVENTION_PICKER_CLOSED' }
  | { type: 'INTERVENTION_LANDED'; payload: InterventionRecord }
  // F3: server-owned furniture layout, mirrored in the store.
  | { type: 'FURNITURE_SET'; payload: FurniturePiece[] }
  | { type: 'FURNITURE_UPSERT'; payload: FurniturePiece }
  | { type: 'FURNITURE_REMOVE'; payload: { id: string } }
  // D2: debug-editable zone layout, mirrored in the store.
  | { type: 'ZONES_SET'; payload: Zone[] }
  | { type: 'ZONES_UPSERT'; payload: Zone }
  | { type: 'ZONES_REMOVE'; payload: { name: string } }
  | { type: 'DEBUG_ZONES_TOGGLED' };
