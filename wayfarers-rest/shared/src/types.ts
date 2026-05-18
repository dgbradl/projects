export interface WorldState {
  gameDay: number;
  lastTickAt: string;
  status: 'running' | 'paused';
  unattendedTicks: number;
  seed: string;
  subTick: number;
}

/** @deprecated Replaced by EventLogEntry + WorldEvent. Kept for migration. */
export type TickEventType = 'init' | 'tick' | 'pause' | 'resume';

/** @deprecated Replaced by EventLogEntry + WorldEvent. Kept for migration. */
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
  carriedRumorIds: string[];
  originLocationId?: string;
  archetype?: string;
  /** Phase 4: short descriptor of who this person is (LLM or placeholder). */
  tagline?: string;
  /** Phase 4: one item in their pack (LLM or placeholder). */
  item?: string;
  /** Phase 4: how they were feeling on arrival. */
  mood?: NpcMood;
}

export type NpcMood =
  | 'cheerful'
  | 'anxious'
  | 'weary'
  | 'guarded'
  | 'desperate'
  | 'smug';

export interface ScheduledArrival {
  npcId: string;
  displayName: string;
  scheduledGameDay: number;
  scheduledSubTick: number;
  archetype?: string;
  originLocationId?: string;
  carriedRumorIds?: string[];
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

// ---------- Phase 3: World ----------

export type LocationKind =
  | 'village'
  | 'town'
  | 'wilderness'
  | 'road'
  | 'landmark';

export interface Location {
  id: string;
  displayName: string;
  kind: LocationKind;
  distanceDays: number;
}

export interface WorldTag {
  key: string;
  value: string;
  setOnGameDay: number;
}

export interface Rumor {
  id: string;
  text: string;
  introducedGameDay: number;
  sourceThreadId?: string;
  available: boolean;
  originLocationId?: string;
}

// ---------- Phase 3: Threads ----------

export type ThreadStatus = 'active' | 'completed' | 'aborted';

export interface ThreadHistoryEntry {
  gameDay: number;
  state: string;
  note: string;
}

export interface Thread {
  id: string;
  type: string;
  status: ThreadStatus;
  state: string;
  startedGameDay: number;
  nextTickGameDay: number;
  payload: Record<string, unknown>;
  history: ThreadHistoryEntry[];
}

// ---------- Phase 3: Interactions ----------

export type InteractionKind =
  | 'shared_drink'
  | 'overheard_argument'
  | 'whispered_exchange'
  | 'silent_recognition';

export interface Interaction {
  id: string;
  gameDay: number;
  subTick: number;
  zone: ZoneName;
  participantIds: string[];
  kind: InteractionKind;
  spawnedThreadId?: string;
  /** Phase 4: an overheard snippet attached at resolution. */
  overheardText?: string;
}

// ---------- Phase 3: Events ----------

export type WorldEvent =
  | { type: 'init'; gameDay: number }
  | { type: 'tick'; gameDay: number }
  | { type: 'pause'; gameDay: number }
  | { type: 'resume'; gameDay: number }
  | { type: 'npc_arrived'; gameDay: number; npcId: string; displayName: string }
  | {
      type: 'npc_departed';
      gameDay: number;
      npcId: string;
      destinationLocationId?: string;
    }
  | { type: 'interaction'; gameDay: number; interaction: Interaction }
  | {
      type: 'thread_started';
      gameDay: number;
      threadId: string;
      threadType: string;
    }
  | {
      type: 'thread_progressed';
      gameDay: number;
      threadId: string;
      fromState: string;
      toState: string;
      note: string;
    }
  | {
      type: 'thread_completed';
      gameDay: number;
      threadId: string;
      outcome: string;
    }
  | {
      type: 'world_tag_changed';
      gameDay: number;
      key: string;
      oldValue: string | null;
      newValue: string;
    }
  | { type: 'rumor_introduced'; gameDay: number; rumorId: string }
  | {
      type: 'flavor_cache_miss';
      gameDay: number;
      slot: string;
      subKey?: string;
    }
  | {
      type: 'flavor_mode_changed';
      gameDay: number;
      oldMode: string;
      newMode: string;
      reason: string;
    };

// ---------- Phase 4: Flavor ----------

export type FlavorMode = 'llm' | 'placeholder' | 'recorded';

export type NpcArchetype =
  | 'wanderer'
  | 'merchant'
  | 'refugee'
  | 'pilgrim'
  | 'soldier'
  | 'scholar'
  | 'rogue';

export interface ArrivalGarnish {
  name: string;
  tagline: string;
  item: string;
}

export interface FlavorPoolStatus {
  kind: string;
  subKey: string;
  size: number;
  target: number;
  refillThreshold: number;
  /** ISO timestamp of the last successful refill, if any. */
  lastRefillAt?: string;
  /** Consecutive failures; non-zero means the pool is in backoff. */
  recentFailures: number;
}

export interface EventLogEntry {
  id: number;
  realTimestamp: string;
  event: WorldEvent;
}

export interface WorldSnapshot {
  worldTags: WorldTag[];
  threads: Thread[];
  pendingArrivals: ScheduledArrival[];
  rumors: Rumor[];
}
