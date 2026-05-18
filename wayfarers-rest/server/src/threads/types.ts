import type { Thread, WorldEvent, WorldState } from '@shared/types';
import type { Rng } from '../world/rng.ts';

export interface ScheduleArrivalInput {
  onGameDay: number;
  displayName?: string;
  archetype?: string;
  originLocationId?: string;
  carriedRumorIds?: string[];
}

export interface IntroduceRumorHelperInput {
  /** Optional explicit text override. If absent, the rumor cache supplies it. */
  text?: string;
  originLocationId?: string;
  /** Hints for the placeholder when the cache is in placeholder mode. */
  tagKey?: string;
  tagValue?: string;
  threadHistoryNote?: string;
}

export interface SpawnThreadHelperInput {
  type: string;
  payload?: Record<string, unknown>;
  initialNextTickDelay?: number;
}

export interface ThreadHelpers {
  scheduleArrival(input: ScheduleArrivalInput): string;
  setWorldTag(key: string, value: string): void;
  introduceRumor(input: IntroduceRumorHelperInput): string;
  spawnThread(input: SpawnThreadHelperInput): string;
}

export interface ThreadTickInput {
  thread: Thread;
  world: WorldState;
  rng: Rng;
  helpers: ThreadHelpers;
}

export interface ThreadTickResult {
  nextState: string;
  /** Days until the next tick. 0 means complete immediately. */
  nextTickDelay: number;
  payloadPatch?: Record<string, unknown>;
  emit?: WorldEvent[];
  completes?: { outcome: string };
  /** Note recorded in the thread's history alongside the transition. */
  note?: string;
}

export interface ThreadDefinition {
  type: string;
  initialState: string;
  initialNextTickDelay: number;
  tick(input: ThreadTickInput): ThreadTickResult;
}
