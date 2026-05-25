/**
 * Phase 8 (C3): archetype-signature mechanics.
 *
 * The trait table in archetype-traits.ts flags each archetype with an
 * optional `signature` ('performs' | 'transacts' | 'studies' | 'broods').
 * This module turns those flags into concrete sim modifiers. The
 * interaction resolver consults `computeArchetypeModifiers(roster)` once
 * per sub-tick and applies the resulting weights to its interaction-kind
 * pick.
 *
 * Implemented today:
 *   - performs (bard): a bard in the hearth zone buffs shared_drink by
 *     ×1.5 for any pair *also* in the hearth zone. The hearth lights up
 *     in the UI (subtle CSS keyframe) while the buff is live.
 *   - broods (soldier): two soldiers in the same zone amplify
 *     overheard_argument by ×1.2 — pairs nicely with the bartender's
 *     conflictMitigation, which subtracts at apply time.
 *
 * Implemented in Phase 9:
 *   - studies (scholar): a non-staff scholar at the bar occasionally
 *     surfaces a one-line rumor about a non-positive world tag — see
 *     `ScholarStudyTracker` below. Once per visit per scholar.
 *   - transacts (merchant): a merchant and a non-merchant sharing a zone
 *     occasionally strike a small deal — see `processMerchantTransaction`
 *     below. Zero affinity, coin-positive for the merchant on departure.
 *     Capped at 2 transactions per merchant per day.
 */
import type { Npc, WorldTag, ZoneName } from '@shared/types';
import { DEFAULT_ALARMING_VALUES } from '../chronicle/types.ts';
import { seededRng } from '../world/rng.ts';
import { traitsFor } from './archetype-traits.ts';

/**
 * Multiplicative modifiers applied to the interaction resolver's kind pick.
 * Compose multiplicatively with each other and with the existing weighted
 * baseline; the resolver clamps the result to non-negative before picking.
 */
export interface ArchetypeModifiers {
  /**
   * Multiplier on `shared_drink` weight when both participants share the
   * `bardPerformZone`. 1.0 means no buff. Single bard at the hearth lifts
   * this to 1.5 by default.
   */
  bardPerformBuff: number;
  /** The zone the bard is performing in (only set if bardPerformBuff > 1). */
  bardPerformZone?: ZoneName;
  /**
   * Multiplier on `overheard_argument` weight when both participants are
   * soldiers. 1.0 means no buff. 1.2 by default.
   */
  soldierBroodBuff: number;
}

export const NO_ARCHETYPE_MODIFIERS: ArchetypeModifiers = {
  bardPerformBuff: 1,
  soldierBroodBuff: 1.2,
};

/**
 * Scan the roster once per sub-tick and emit the live signature modifiers.
 * Pure; no RNG, no side-effects — safe to call from the interaction
 * resolver as well as from tests.
 *
 * Today the only spatial signal is "is any bard at the hearth?" — once a
 * bard is there, the buff is live for every pair in that zone until the
 * bard wanders off. (Bards don't pin to the hearth permanently, so the
 * buff has a natural fade.)
 */
export function computeArchetypeModifiers(roster: Npc[]): ArchetypeModifiers {
  let bardPerformBuff = 1;
  let bardPerformZone: ZoneName | undefined;
  for (const npc of roster) {
    if (npc.isStaff) continue;
    if (npc.archetype !== 'bard') continue;
    if (traitsFor(npc.archetype).signature !== 'performs') continue;
    if (npc.zone === 'hearth') {
      bardPerformBuff = 1.5;
      bardPerformZone = 'hearth';
      break;
    }
  }
  return { bardPerformBuff, bardPerformZone, soldierBroodBuff: 1.2 };
}

/**
 * Returns true if both participants are soldiers — used by the resolver to
 * decide whether to apply the brood buff.
 */
export function bothSoldiers(a: Npc | undefined, b: Npc | undefined): boolean {
  if (!a || !b) return false;
  return a.archetype === 'soldier' && b.archetype === 'soldier';
}

// ---------- Phase 9 (G1): scholar 'studies' signature ----------

export interface ScholarStudyResult {
  /** The scholar who looked up from their reading. */
  scholarId: string;
  scholarName: string;
  /** The non-positive world tag they're commenting on. */
  tagKey: string;
  tagValue: string;
  /** The one-line rumor text to introduce via RumorsManager. */
  rumorText: string;
}

/** Per-sub-tick probability that an eligible scholar surfaces a rumor.
 *  Tuned low; combined with the "non-staff scholar at the bar" gate and
 *  the once-per-visit cap, the player sees roughly one scholar-rumor per
 *  in-tavern scholar visit when alarming tags are present. */
const SCHOLAR_STUDY_PROB = 0.05;

/** Curated templates per (tagKey, tagValue) pair. Anything not matched falls
 *  through to the humanized generic so unknown tags still read like prose. */
const SCHOLAR_RUMOR_TEMPLATES: Record<string, string> = {
  'war_in_north=escalating': 'The war in the north grows worse by the day.',
  'war_in_north=simmering': 'The war in the north simmers on, unresolved.',
  'road_safety_south=poor':
    'The road south remains unsafe; merchants speak of bandits at dusk.',
  'harvest=poor':
    'The harvest is failing this year; granaries will be thin by winter.',
};

function composeScholarRumorText(tagKey: string, tagValue: string): string {
  const key = `${tagKey}=${tagValue}`;
  if (SCHOLAR_RUMOR_TEMPLATES[key]) return SCHOLAR_RUMOR_TEMPLATES[key];
  return `The ${tagKey.replace(/_/g, ' ')} remains ${tagValue}.`;
}

/**
 * Tracks which scholars have already surfaced a rumor this visit so the
 * effect fires at most once per scholar. The tracker is stateful (a
 * `Set<npcId>`) and is cleared on departure via `onDeparture(npcId)`;
 * tests reset between cases via `reset()`.
 *
 * The maybeFire path is otherwise pure: same (worldSeed, gameDay, subTick,
 * eligible scholar id) → same outcome.
 */
export class ScholarStudyTracker {
  private readonly studied = new Set<string>();

  maybeFire(input: {
    roster: Npc[];
    worldTags: WorldTag[];
    worldSeed: string;
    gameDay: number;
    subTick: number;
    alarming?: ReadonlySet<string>;
  }): ScholarStudyResult | undefined {
    const alarming = input.alarming ?? DEFAULT_ALARMING_VALUES;
    // First eligible non-staff scholar at the bar who hasn't studied this visit.
    const scholar = input.roster.find(
      (n) =>
        !n.isStaff &&
        n.archetype === 'scholar' &&
        n.zone === 'bar' &&
        traitsFor(n.archetype).signature === 'studies' &&
        !this.studied.has(n.id),
    );
    if (!scholar) return undefined;

    const concerning = input.worldTags.filter((t) => alarming.has(t.value));
    if (concerning.length === 0) return undefined;

    const rng = seededRng(
      input.worldSeed,
      'scholar-study',
      scholar.id,
      input.gameDay,
      input.subTick,
    );
    if (rng() >= SCHOLAR_STUDY_PROB) return undefined;

    // Pick deterministically. rng() returns [0,1); floor gives index.
    const tag = concerning[Math.floor(rng() * concerning.length)];

    this.studied.add(scholar.id);

    return {
      scholarId: scholar.id,
      scholarName: scholar.displayName,
      tagKey: tag.key,
      tagValue: tag.value,
      rumorText: composeScholarRumorText(tag.key, tag.value),
    };
  }

  /** Call from the npc_departed bus handler so the slot frees for a later
   *  arrival reusing the same id. */
  onDeparture(npcId: string): void {
    this.studied.delete(npcId);
  }

  /** For tests — reset between cases. */
  reset(): void {
    this.studied.clear();
  }
}

// ---------- Phase 9 (G2): merchant 'transacts' signature ----------

export interface MerchantTransactionResult {
  merchantId: string;
  customerId: string;
  zone: ZoneName;
}

/** Per-sub-tick probability that a merchant+non-merchant pair strikes a
 *  deal when one exists in the same zone. Combined with the per-day cap
 *  below, a merchant typically transacts 0–2 times per visit. */
const MERCHANT_TRANSACT_PROB = 0.02;

/** Cap on transactions per merchant per day. The runner passes the live
 *  count via `transactionsToday` and we short-circuit when it's reached. */
export const MERCHANT_DAILY_TRANSACTION_CAP = 2;

/**
 * Try to fire a merchant `transaction` interaction this sub-tick. Returns
 * the {merchant, customer, zone} candidate the resolver should emit, or
 * undefined when no eligible pair / no roll / cap reached.
 *
 * Deterministic: seededRng keyed on (worldSeed, 'merchant-transact',
 * merchantId, gameDay, subTick). Pure beyond that — `transactionsToday`
 * is read-only here; the caller (postSubTickHook) increments after a
 * successful resolve.
 */
export function processMerchantTransaction(input: {
  roster: Npc[];
  worldSeed: string;
  gameDay: number;
  subTick: number;
  /** Per-merchant count of transactions already fired today. */
  transactionsToday: Map<string, number>;
}): MerchantTransactionResult | undefined {
  for (const merchant of input.roster) {
    if (merchant.isStaff) continue;
    if (merchant.archetype !== 'merchant') continue;
    if (
      (input.transactionsToday.get(merchant.id) ?? 0) >=
      MERCHANT_DAILY_TRANSACTION_CAP
    ) {
      continue;
    }
    if (!merchant.zone) continue;
    // Find any non-merchant in the same zone (skip staff — staff don't
    // transact through this path; merchants don't deal with themselves).
    const customer = input.roster.find(
      (n) =>
        !n.isStaff &&
        n.archetype !== 'merchant' &&
        n.id !== merchant.id &&
        n.zone === merchant.zone,
    );
    if (!customer) continue;

    const rng = seededRng(
      input.worldSeed,
      'merchant-transact',
      merchant.id,
      input.gameDay,
      input.subTick,
    );
    if (rng() >= MERCHANT_TRANSACT_PROB) continue;

    return {
      merchantId: merchant.id,
      customerId: customer.id,
      zone: merchant.zone,
    };
  }
  return undefined;
}
