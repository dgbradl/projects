import type { Npc, Thread, WorldEvent } from '@shared/types';

export interface SalienceContext {
  npcsById: Map<string, Npc>;
  threadsById: Map<string, Thread>;
  alarmingValues: ReadonlySet<string>;
  /** Phase 6: NPC ids the player has marked; participant events get +5. */
  markedNpcIds?: ReadonlySet<string>;
}

export interface ScoredEvent {
  event: WorldEvent;
  eventId: number;
  realTimestamp: string;
  score: number;
}

export const DEFAULT_ALARMING_VALUES: ReadonlySet<string> = new Set([
  'escalating',
  'poor',
  'collapsing',
  'failing',
  'storm',
  'plague',
]);
