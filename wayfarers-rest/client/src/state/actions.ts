import type {
  EventLogEntry,
  Npc,
  NpcDiff,
  TavernConfig,
  WorldSnapshot,
  WorldState,
} from '@shared/types';

export type Action =
  | { type: 'INIT_TAVERN'; payload: TavernConfig }
  | { type: 'INIT_STATE'; payload: WorldState }
  | { type: 'STATE_UPDATE'; payload: WorldState }
  | { type: 'NPCS_SNAPSHOT'; payload: Npc[] }
  | { type: 'NPCS_DIFF'; payload: NpcDiff }
  | { type: 'WORLD_SNAPSHOT'; payload: WorldSnapshot }
  | { type: 'WORLD_EVENT'; payload: EventLogEntry }
  | { type: 'INTERACTION_FLASH'; payload: { npcIds: string[]; expiresAt: number } }
  | { type: 'EXPIRE_INTERACTION_FLASHES'; payload: { now: number } };
