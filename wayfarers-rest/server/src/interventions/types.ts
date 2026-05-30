import type {
  CostCurrency,
  InterventionEffect,
  InterventionKind,
  InterventionTargets,
  NpcArchetype,
  Rumor,
  RumorTone,
  SwayDirection,
  WorldState,
} from '@shared/types';

export type { RumorTone };

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Resources/snapshots a kind module needs to validate and apply.
 * Built once per request by `buildInterventionOptions` and passed through.
 */
export interface InterventionOptions {
  state: WorldState;
  targets: InterventionTargets;
  availableRumors: Rumor[];
}

/**
 * Immediate-mode helpers for intervention apply functions. Mirrors the shape
 * of Phase 3's ThreadHelpers but applies side-effects synchronously instead
 * of queueing them.
 */
export interface InterventionHelpers {
  /** Returns the introduced rumor id (so caller can patch player_origin). */
  introduceRumor(input: {
    text?: string;
    originLocationId?: string;
    tagKey?: string;
    tagValue?: string;
    threadHistoryNote?: string;
  }): string;
  /** Returns the spawned thread's id. */
  spawnThread(input: {
    type: string;
    payload?: Record<string, unknown>;
    initialNextTickDelay?: number;
  }): string;
  setWorldTag(key: string, value: string): void;
  /**
   * Phase 8 (A4): scan present NPCs for a `news_of_location` or
   * `rumor_of_tone` desire matching the just-introduced rumor; fulfil the
   * first match. Returns the npc id whose desire flipped, or undefined.
   * Called by `plant_rumor` after `introduceRumor`.
   */
  fulfilDesireFromRumor?(
    rumor: { originLocationId?: string; tone?: RumorTone },
    fulfilledBy: string,
  ): string | undefined;
  /**
   * Phase 8 (A4): scan present NPCs for an unfulfilled `company_of_kind`
   * desire whose param is 'any' or matches `archetype`; fulfil the first
   * match. Returns the npc id whose desire flipped, or undefined. Called
   * by `beckon` so the keeper's act of summoning is felt immediately even
   * though the summoned NPC arrives 1-3 days later.
   */
  fulfilCompanyDesireForArchetype?(
    archetype: string,
    fulfilledBy: string,
  ): string | undefined;
}

export interface InterventionApplyInput<TPayload> {
  payload: TPayload;
  helpers: InterventionHelpers;
  state: WorldState;
  options: InterventionOptions;
  gameDay: number;
}

export interface InterventionDefinition<TPayload = Record<string, unknown>> {
  kind: InterventionKind;
  cost: number;
  /** Economy (E3): resource the cost is paid in; defaults to 'favor'. */
  costCurrency?: CostCurrency;
  /**
   * Renders a one-line summary of an intervention. Called post-hoc by the
   * chronicle generator against a historical record, so it must derive
   * everything from its arguments — never from live world state. `effect` is
   * the apply-time result; pass it for kinds whose summary needs the outcome.
   */
  describe(
    payload: TPayload,
    options: InterventionOptions,
    effect?: InterventionEffect,
  ): string;
  validate(
    payload: TPayload,
    state: WorldState,
    options: InterventionOptions,
  ): ValidationResult;
  apply(input: InterventionApplyInput<TPayload>): InterventionEffect;
}

// ---------- Payload shapes per kind ----------

export interface PlantRumorPayload {
  locationId: string;
  tone?: RumorTone;
}

export interface BeckonPayload {
  archetype: NpcArchetype;
  preferredDayOffset?: 1 | 2 | 3;
  carriedRumorId?: string;
}

export interface SwayThreadPayload {
  threadId: string;
  direction: SwayDirection;
}

export interface StirWorldPayload {
  tagKey: string;
  newValue: string;
}

export interface MarkNpcPayload {
  npcId: string;
}

/** Economy (E3): restock_larder and upgrade_hearth take no parameters. */
export type RestockLarderPayload = Record<string, never>;
export type UpgradeHearthPayload = Record<string, never>;

/** Phase 9 (G4): swap one current tavern trait for another. */
export interface ShiftFocusPayload {
  /** The currently-owned trait to drop. Must be in state.tavernTraits. */
  dropTrait: string;
  /** The new trait to take its place. Must be a valid TavernTrait,
   *  must not already be owned, and must differ from dropTrait. */
  addTrait: string;
}

/** Phase 9 (F4): the id of the live stage event to act on. */
export interface EscalateScenePayload {
  stageEventId: string;
}
export interface DefuseScenePayload {
  stageEventId: string;
}
