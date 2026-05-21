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
