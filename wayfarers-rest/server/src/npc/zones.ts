// Zone permissions per archetype/staff. Lives in its own module so the rules
// table is one stop-and-shop and so behavior.ts/manager.ts can stay small
// (minimising merge surface with concurrent work on the NPC system).

import type { Npc, ZoneName } from '@shared/types';

export interface ZoneRule {
  /** Only staff (any role) may be assigned to this zone. */
  staffOnly?: boolean;
}

/**
 * The audience rule for each zone. Default: everyone allowed. `bar_back`
 * is the canonical example of staff-only — customers should never appear
 * behind the counter. Z4 will extend ZoneRule with archetype-level
 * allow/deny lists once the parallel session's archetype work settles.
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

/** Returns true if `npc` is allowed to be assigned to `zone`. */
export function isZoneAllowed(zone: ZoneName, npc: Npc): boolean {
  const rule = ZONE_RULES[zone];
  if (!rule) return true;
  if (rule.staffOnly && !npc.isStaff) return false;
  return true;
}

/** Filter a list of candidate zones down to those allowed for `npc`. */
export function filterAllowed(
  zones: readonly ZoneName[],
  npc: Npc,
): ZoneName[] {
  return zones.filter((z) => isZoneAllowed(z, npc));
}
