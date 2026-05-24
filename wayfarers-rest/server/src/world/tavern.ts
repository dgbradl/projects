import type { Zone, ZoneName } from '@shared/types';
import { TAVERN_BOUNDS as SHARED_BOUNDS, WALKABLE } from '@shared/space';

// Re-export so server-internal modules have one canonical import for both.
export const TAVERN_BOUNDS = SHARED_BOUNDS;
export { WALKABLE };

// Default zone centers and radii. Each must fit inside WALKABLE
// (centerX ± radius within [WALKABLE.minX, WALKABLE.maxX] and the same for
// y). These seed the runtime zone table on first boot; the user can then
// edit positions/radii or add/remove zones through the debug overlay.
export const TAVERN_ZONES: readonly Zone[] = Object.freeze([
  { name: 'door', x: 50, y: 86, radius: 6 },
  // bar_back sits above the bar (staff-only — see server/src/npc/zones.ts).
  // Centered at y=14 with radius 5 → y range 9..19, just inside the walkable
  // rectangle's top edge (WALKABLE.minY = 8).
  { name: 'bar_back', x: 50, y: 14, radius: 5 },
  { name: 'bar', x: 50, y: 20, radius: 12 },
  { name: 'hearth', x: 16, y: 50, radius: 8 },
  { name: 'table_a', x: 30, y: 60, radius: 7 },
  { name: 'table_b', x: 50, y: 65, radius: 7 },
  { name: 'table_c', x: 70, y: 60, radius: 7 },
]);

/** Names of zones the NPC behaviour state machine references directly.
 *  Custom (added) zones are visual markers and don't drive behaviour. */
export const KNOWN_ZONE_NAMES: ReadonlySet<ZoneName> = new Set([
  'door',
  'bar',
  'bar_back',
  'hearth',
  'table_a',
  'table_b',
  'table_c',
]);

export const TABLE_ZONES: readonly ZoneName[] = ['table_a', 'table_b', 'table_c'];

// Mutable registry of active zones. Defaults to TAVERN_ZONES; the
// ZoneManager swaps these in on construction and on every mutation so
// behavior.ts / spawn.ts / pickPositionInZone all see the live list
// without threading a manager through their signatures.
let ACTIVE_ZONES = new Map<string, Zone>(
  TAVERN_ZONES.map((z) => [z.name, z]),
);

export function zoneByName(name: string): Zone | undefined {
  return ACTIVE_ZONES.get(name);
}

export function activeZones(): Zone[] {
  return [...ACTIVE_ZONES.values()];
}

/** Used by ZoneManager. Tests can also call this directly to seed a fixed
 *  set of zones without spinning up the full manager. */
export function setActiveZones(zones: readonly Zone[]): void {
  ACTIVE_ZONES = new Map(zones.map((z) => [z.name, z]));
}

/** Restore the active registry to TAVERN_ZONES defaults. Used in tests
 *  that mutated zones, to avoid leaking state across test cases. */
export function resetActiveZonesToDefaults(): void {
  setActiveZones(TAVERN_ZONES);
}
