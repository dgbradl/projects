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
  WorldSnapshot,
  WorldState,
} from '@shared/types';

export interface InteractionFlash {
  npcIds: string[];
  expiresAt: number;
  overheardText?: string;
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
  | { type: 'FURNITURE_REMOVE'; payload: { id: string } };
