// Zone permissions per archetype/staff. Lives in its own module so the rules
// table is one stop-and-shop and so behavior.ts/manager.ts can stay small
// (minimising merge surface with concurrent work on the NPC system).

import type { Npc, NpcArchetype, ZoneName } from '@shared/types';

export interface ZoneRule {
  /** Only staff (any role) may be assigned to this zone. */
  staffOnly?: boolean;
  /** Z4: if present, only NPCs with these archetypes may enter. Staff are
   *  treated as exempt — `isStaff` overrides archetype gating. */
  allowedArchetypes?: readonly NpcArchetype[];
  /** Z4: if present, NPCs with these archetypes are forbidden. Same staff
   *  exemption applies. `forbidden` wins when both lists name the same
   *  archetype (defensive — wouldn't normally happen). */
  forbiddenArchetypes?: readonly NpcArchetype[];
}

/**
 * The audience rule for each zone. Default: everyone allowed. `bar_back`
 * is staff-only; no archetype rules ship by default — Z4 only delivers the
 * mechanism. Specific defaults (e.g. "merchants don't loiter at the hearth")
 * land alongside the parallel session's Fantasy archetype work.
 */
export const ZONE_RULES: Record<ZoneName, ZoneRule> = {
  door: {},
  bar: {},
  bar_back: { staffOnly: true },
  hearth: {},
  table_a: {},
  table_b: {},
  table_c: {},
};

/**
 * Pure predicate over a ZoneRule (separated from ZONE_RULES so tests can
 * synthesise rules without mutating the live table).
 */
export function isAudienceAllowed(rule: ZoneRule, npc: Npc): boolean {
  if (rule.staffOnly && !npc.isStaff) return false;
  // Staff are exempt from archetype gating — they go where their role takes
  // them. Customers (non-staff) are filtered by allow/deny lists.
  if (!npc.isStaff) {
    const archetype = npc.archetype as NpcArchetype | undefined;
    if (
      rule.forbiddenArchetypes &&
      archetype &&
      rule.forbiddenArchetypes.includes(archetype)
    ) {
      return false;
    }
    if (
      rule.allowedArchetypes &&
      (!archetype || !rule.allowedArchetypes.includes(archetype))
    ) {
      return false;
    }
  }
  return true;
}

/** Returns true if `npc` is allowed to be assigned to `zone`. */
export function isZoneAllowed(zone: ZoneName, npc: Npc): boolean {
  return isAudienceAllowed(ZONE_RULES[zone] ?? {}, npc);
}

/** Filter a list of candidate zones down to those allowed for `npc`. */
export function filterAllowed(
  zones: readonly ZoneName[],
  npc: Npc,
): ZoneName[] {
  return zones.filter((z) => isZoneAllowed(z, npc));
}
