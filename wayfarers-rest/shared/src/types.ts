export interface WorldState {
  gameDay: number;
  lastTickAt: string;
  status: 'running' | 'paused';
  unattendedTicks: number;
  seed: string;
  subTick: number;
}

export type TickEventType = 'init' | 'tick' | 'pause' | 'resume';

export interface TickEvent {
  id: number;
  gameDay: number;
  realTimestamp: string;
  type: TickEventType;
  payload: Record<string, unknown>;
}

export type ZoneName =
  | 'door'
  | 'bar'
  | 'hearth'
  | 'table_a'
  | 'table_b'
  | 'table_c';

export interface Zone {
  name: ZoneName;
  x: number;
  y: number;
  radius: number;
}

export type NpcStatus =
  | 'approaching'
  | 'arriving'
  | 'at_bar'
  | 'seated'
  | 'wandering'
  | 'leaving'
  | 'departed';

export interface Npc {
  id: string;
  displayName: string;
  status: NpcStatus;
  position: { x: number; y: number };
  zone: ZoneName | null;
  arrivedGameDay: number;
  arrivedSubTick: number;
  plannedDepartureGameDay: number;
  plannedDepartureSubTick: number;
  nextDecisionSubTick: number;
}

export interface ScheduledArrival {
  npcId: string;
  displayName: string;
  scheduledGameDay: number;
  scheduledSubTick: number;
}

export interface TavernConfig {
  zones: Zone[];
  subTickIntervalMs: number;
  subTicksPerDay: number;
}

export interface NpcDiff {
  added: Npc[];
  updated: Npc[];
  removed: string[];
}
