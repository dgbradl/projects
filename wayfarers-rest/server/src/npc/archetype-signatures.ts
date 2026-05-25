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
 * Deferred (signature flags exist on the trait table but no sim wiring):
 *   - studies (scholar): a scholar at the bar may emit a tag-flavoured
 *     rumor; out of scope for this slice, slated for a follow-up.
 *   - transacts (merchant): a low-affinity, coin-positive interaction
 *     between a merchant and a non-merchant; needs a new InteractionKind
 *     and ledger plumbing — out of scope here.
 */
import type { Npc, ZoneName } from '@shared/types';
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
