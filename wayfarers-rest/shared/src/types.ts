export interface WorldState {
  gameDay: number;
  lastTickAt: string;
  status: 'running' | 'paused';
  unattendedTicks: number;
  seed: string;
  subTick: number;
  /** Last game day whose chronicle the player has acknowledged. Default 0. */
  lastAcknowledgedGameDay: number;
  /** Phase 6: current favor pool, [0, FAVORS_MAX]. */
  favors: number;
  /** Phase 6: gameDay on which a favor was last added by regen. */
  favorsLastRegenGameDay: number;
  /** Phase 6: NPCs currently marked for the keeper's attention. */
  markedNpcIds: string[];
  /** Economy (E1): the tavern's purse, in coin. Settled once per day. */
  coin: number;
  /** Economy (E2): tavern prosperity, a rolling score in [0, 100]. */
  prosperity: number;
  /** Economy (E3): larder stock level (0 = base); raises guest meal spend. */
  larderStock?: number;
  /** Economy (E3): hearth comfort level (0 = base); raises guest room spend. */
  hearthLevel?: number;
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
  /** Phase 6: true if summoned by a `beckon` intervention. */
  wasBeckoned?: boolean;
  /** Phase 7 (A3): total visits including this one; >1 marks a returning regular. */
  visitCount?: number;
  /** Epic E: true for permanent tavern staff (never departs). */
  isStaff?: boolean;
  /** Epic E: role within the staff roster. */
  staffRole?: StaffRole;
  /** Epic E (E2): skill ratings carried for fast effect lookup. */
  skills?: StaffSkills;
}

export type NpcMood =
  | 'cheerful'
  | 'anxious'
  | 'weary'
  | 'guarded'
  | 'desperate'
  | 'smug';

export type StaffRole = 'bartender' | 'waitstaff' | 'cleaner';

export interface StaffSkills {
  pourQuality?: number;
  gossipNetwork?: number;
  conflictMitigation?: number;
  hospitality?: number;
  attentiveness?: number;
  thoroughness?: number;
  observant?: number;
}

export interface ScheduledArrival {
  npcId: string;
  displayName: string;
  scheduledGameDay: number;
  scheduledSubTick: number;
  archetype?: string;
  originLocationId?: string;
  carriedRumorIds?: string[];
  /** Phase 6: true if originated from a `beckon` intervention. */
  wasBeckoned?: boolean;
}

/**
 * Phase 7: a durable person. An `Npc` is a character's *current presence* in
 * the tavern and is discarded when they depart; a `Character` persists across
 * visits so a returning traveller keeps their identity and history.
 * Invariant: `Npc.id === Character.id`.
 */
export interface Character {
  id: string;
  displayName: string;
  archetype: NpcArchetype;
  firstSeenGameDay: number;
  lastSeenGameDay: number;
  /** Number of times this character has arrived at the tavern. */
  visitCount: number;
  /** Phase 7 (A2): what this character carries forward between visits. */
  memory: CharacterMemory;
  /** Epic E: true for permanent tavern staff. */
  isStaff?: boolean;
  /** Epic E: role within the staff roster. */
  staffRole?: StaffRole;
  /** Epic E: skill ratings that affect gameplay (wired in E2). */
  skills?: StaffSkills;
  /** Epic E: one-liner personality description shown as tagline. */
  personality?: string;
  /** Epic E (E3): true if this staff member is currently on the active roster. */
  isActiveStaff?: boolean;
}

/** Phase 7 (A2): one other character this character has crossed paths with. */
export interface CharacterEncounter {
  /** The other character met. */
  characterId: string;
  /** Most recent interaction kind shared with them. */
  lastKind: InteractionKind;
  /** Total interactions shared with them. */
  count: number;
  /** Game day of the most recent interaction. */
  lastGameDay: number;
  /**
   * Phase 7 (B1): cumulative relationship score, clamped to [-25, 25].
   * Positive is warmth (drinks, recognition), negative is friction
   * (arguments). Drives interaction bias (B2) and relationship threads (B3).
   */
  affinity: number;
}

/**
 * Phase 7 (A2): a character's accumulated memory. Recorded as events flow and
 * surfaced (A3) in arrival flavor, the chronicle, and interaction bias.
 */
export interface CharacterMemory {
  /** Rumor ids this character has carried into the tavern (deduped, capped). */
  rumorsHeard: string[];
  /** Other characters they have interacted with, aggregated per character. */
  encounters: CharacterEncounter[];
  /** Times the keeper summoned this character with a `beckon`. */
  timesBeckoned: number;
  /** Times the keeper marked this character for attention. */
  timesMarked: number;
  /** Location this character last departed toward, if any. */
  lastDestinationLocationId?: string;
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

export type RumorTone = 'foreboding' | 'curious' | 'mundane' | 'urgent';

export interface Rumor {
  id: string;
  text: string;
  introducedGameDay: number;
  sourceThreadId?: string;
  available: boolean;
  originLocationId?: string;
  /** Phase 6: rumor was seeded by a player intervention (carries 2× for 3 days). */
  playerOrigin?: boolean;
  /** Phase 6: tone hint from the player. */
  tone?: RumorTone;
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

// ---------- Economy (E1) ----------

/** What a single guest spent during a visit, broken out by category. */
export interface GuestSpendBreakdown {
  drink: number;
  meal: number;
  room: number;
  tip: number;
}

/** A settled day's income and expense. One row per game day. */
export interface DailyLedger {
  gameDay: number;
  income: number;
  expense: number;
  net: number;
  guestCount: number;
  coinAfter: number;
  /** Economy (E2): prosperity score after this day was settled, if computed. */
  prosperityAfter?: number;
}

/** Economy (E2): the tavern's standing, derived from its prosperity score. */
export type ProsperityTier = 'struggling' | 'steady' | 'thriving' | 'renowned';

/**
 * Map a [0, 100] prosperity score to its tier. Shared so the server's
 * feedback logic and the client's display always agree on the boundaries.
 */
export function tierForScore(score: number): ProsperityTier {
  if (score < 25) return 'struggling';
  if (score < 55) return 'steady';
  if (score < 80) return 'thriving';
  return 'renowned';
}

// ---------- Phase 3: Events ----------

export type WorldEvent =
  | { type: 'init'; gameDay: number }
  | { type: 'tick'; gameDay: number }
  | { type: 'pause'; gameDay: number }
  | { type: 'resume'; gameDay: number }
  | { type: 'npc_arrived'; gameDay: number; npcId: string; displayName: string }
  | {
      type: 'npc_returned';
      gameDay: number;
      npcId: string;
      displayName: string;
      /** How many times this character has now visited the tavern (>= 2). */
      visitCount: number;
    }
  | {
      type: 'npc_departed';
      gameDay: number;
      npcId: string;
      displayName?: string;
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
    }
  | {
      type: 'chronicle_generated';
      gameDay: number;
      status: ChronicleGenerationStatus;
      durationMs: number;
    }
  | {
      type: 'chronicle_acknowledged';
      gameDay: number;
      acknowledgedUpTo: number;
    }
  | {
      type: 'intervention_used';
      gameDay: number;
      intervention: InterventionRecord;
    }
  | { type: 'favor_regenerated'; gameDay: number; newTotal: number }
  | { type: 'npc_marked'; gameDay: number; npcId: string }
  | {
      type: 'npc_unmarked';
      gameDay: number;
      npcId: string;
      reason: 'departed' | 'manual';
    }
  | {
      /** Economy (E1): a departing guest settled their tab. */
      type: 'guest_spent';
      gameDay: number;
      npcId: string;
      amount: number;
      breakdown: GuestSpendBreakdown;
    }
  | {
      /** Economy (E1): the tavern's daily running cost. */
      type: 'tavern_upkeep';
      gameDay: number;
      amount: number;
      occupancy: number;
    }
  | {
      /** Economy (E1): a game day's ledger was settled. */
      type: 'ledger_closed';
      gameDay: number;
      income: number;
      expense: number;
      net: number;
      coinBefore: number;
      coinAfter: number;
      guestCount: number;
    }
  | {
      /** Epic E (E3): a staff member's skill added to the day's income. */
      type: 'staff_service_income';
      gameDay: number;
      staffId: string;
      amount: number;
      source: 'thoroughness';
    }
  | {
      /** Economy (E2): the tavern's prosperity tier shifted. */
      type: 'prosperity_changed';
      gameDay: number;
      score: number;
      tier: ProsperityTier;
      previousTier: ProsperityTier;
    };

// ---------- Phase 6: Interventions ----------

export type InterventionKind =
  | 'plant_rumor'
  | 'beckon'
  | 'sway_thread'
  | 'stir_world'
  | 'mark_npc'
  | 'restock_larder'
  | 'upgrade_hearth';

export type SwayDirection = 'bless' | 'curse';

/** Economy (E3): which resource an intervention is paid with. */
export type CostCurrency = 'favor' | 'coin';

export interface InterventionEffect {
  spawnedThreadId?: string;
  introducedRumorId?: string;
  changedTag?: { key: string; oldValue: string; newValue: string };
  markedNpcId?: string;
  swayedThreadId?: string;
  /** Economy (E3): larder stock level after a restock. */
  larderRestockedTo?: number;
  /** Economy (E3): hearth comfort level after an upgrade. */
  hearthUpgradedTo?: number;
}

export interface InterventionRecord {
  id: string;
  kind: InterventionKind;
  gameDay: number;
  realTimestamp: string;
  cost: number;
  /** Economy (E3): the resource this intervention was paid with. */
  costCurrency: CostCurrency;
  payload: Record<string, unknown>;
  effect: InterventionEffect;
}

export interface InterventionKindStatus {
  kind: InterventionKind;
  cost: number;
  /** Economy (E3): the resource this kind is paid with. */
  costCurrency: CostCurrency;
  available: boolean;
  unavailableReason?: string;
}

export interface InterventionTargets {
  locations: Array<{ id: string; displayName: string; kind: string }>;
  archetypes: NpcArchetype[];
  activeThreads: Array<{
    id: string;
    type: string;
    state: string;
    describable: string;
    canSway: boolean;
  }>;
  worldTags: Array<{
    key: string;
    currentValue: string;
    permittedValues: string[];
  }>;
  npcsInTavern: Array<{
    id: string;
    displayName: string;
    archetype: string;
    status: NpcStatus;
    isMarked: boolean;
  }>;
}

export interface InterventionOptionsResponse {
  favors: number;
  favorsMax: number;
  /** Economy (E3): the tavern's coin purse, for coin-costed interventions. */
  coin: number;
  kinds: InterventionKindStatus[];
  targets: InterventionTargets;
  rumorsForBeckoning: Array<{ id: string; text: string }>;
}

export interface InterventionExecuteResponse {
  intervention: InterventionRecord;
  state: WorldState;
}

// ---------- Phase 5: Chronicle ----------

export type ChronicleGenerationStatus =
  | 'pending'
  | 'in_progress'
  | 'complete'
  | 'fallback'
  | 'failed';

export interface DailyChronicle {
  gameDay: number;
  generatedAtRealTs: string | null;
  status: ChronicleGenerationStatus;
  headlines: string[];
  footnotes: string[];
  modelUsed: string | null;
  promptCharCount: number | null;
  completionCharCount: number | null;
  generationDurationMs: number | null;
  failureReason: string | null;
}

export interface ChroniclePrologue {
  fromGameDay: number;
  toGameDay: number;
  text: string;
  generatedAtRealTs: string;
  status: 'complete' | 'fallback' | 'failed';
}

export interface ChronicleLedgerEntry {
  eventId: number;
  realTimestamp: string;
  event: WorldEvent;
  score: number;
}

export interface DailyChronicleWithLedger {
  chronicle: DailyChronicle;
  ledger: ChronicleLedgerEntry[];
}

export interface ChroniclesSinceResponse {
  fromGameDay: number;
  toGameDay: number;
  chronicles: DailyChronicle[];
  prologue: ChroniclePrologue | null;
  pendingDays: number[];
}

// ---------- Phase 4: Flavor ----------

export type FlavorMode = 'llm' | 'placeholder' | 'recorded';

export type NpcArchetype =
  | 'wanderer'
  | 'merchant'
  | 'refugee'
  | 'pilgrim'
  | 'soldier'
  | 'scholar'
  | 'rogue'
  | 'mage'
  | 'knight'
  | 'bard'
  | 'hunter';

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

// ---------- Epic E: Staff ----------

export interface StaffMember {
  id: string;
  displayName: string;
  role: StaffRole;
  personality: string;
  skills: StaffSkills;
  isActive: boolean;
  /** True if this staff member is currently in the tavern roster. */
  isOnDuty: boolean;
}

export interface StaffRoster {
  active: StaffMember[];
  reserve: StaffMember[];
}

export interface StaffSwapRequest {
  fireId: string;
  hireId: string;
}
