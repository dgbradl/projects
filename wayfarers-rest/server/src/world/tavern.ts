import type { Zone, ZoneName } from '@shared/types';

export const TAVERN_BOUNDS = { width: 100, height: 100 } as const;

export const TAVERN_ZONES: readonly Zone[] = Object.freeze([
  { name: 'door', x: 50, y: 95, radius: 6 },
  { name: 'bar', x: 50, y: 20, radius: 12 },
  { name: 'hearth', x: 12, y: 50, radius: 8 },
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
