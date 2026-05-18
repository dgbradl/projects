import type {
  Npc,
  NpcDiff,
  TavernConfig,
  WorldState,
} from '@shared/types';

export type Action =
  | { type: 'INIT_TAVERN'; payload: TavernConfig }
  | { type: 'INIT_STATE'; payload: WorldState }
  | { type: 'STATE_UPDATE'; payload: WorldState }
  | { type: 'NPCS_SNAPSHOT'; payload: Npc[] }
  | { type: 'NPCS_DIFF'; payload: NpcDiff };
