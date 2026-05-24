import type { Zone, ZoneName } from '@shared/types';
import { TAVERN_BOUNDS as SHARED_BOUNDS, WALKABLE } from '@shared/space';

// Re-export so server-internal modules have one canonical import for both.
export const TAVERN_BOUNDS = SHARED_BOUNDS;
export { WALKABLE };

// Zone centers and radii must fit inside WALKABLE (centerX ± radius within
// [WALKABLE.minX, WALKABLE.maxX] and the same for y). Z1: door moved up from
// y=95 → y=86 (centerY + radius = 92 = WALKABLE.maxY exactly) and hearth
// moved right from x=12 → x=16 so the full zone circle stays clear of the
// wall band.
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

export const TABLE_ZONES: readonly ZoneName[] = ['table_a', 'table_b', 'table_c'];

const ZONE_BY_NAME = new Map<ZoneName, Zone>(
  TAVERN_ZONES.map((z) => [z.name, z]),
);

export function zoneByName(name: ZoneName): Zone {
  const zone = ZONE_BY_NAME.get(name);
  if (!zone) throw new Error(`Unknown zone: ${name}`);
  return zone;
}
