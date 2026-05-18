export interface WorldState {
  gameDay: number;
  lastTickAt: string;
  status: 'running' | 'paused';
  unattendedTicks: number;
  seed: string;
}

export type TickEventType = 'init' | 'tick' | 'pause' | 'resume';

export interface TickEvent {
  id: number;
  gameDay: number;
  realTimestamp: string;
  type: TickEventType;
  payload: Record<string, unknown>;
}
