import type { Location, LocationKind } from '@shared/types';
import { rngPick, type Rng } from './rng.ts';

export const LOCATIONS: readonly Location[] = Object.freeze([
  { id: 'cradle_hollow', displayName: 'Cradle Hollow', kind: 'village', distanceDays: 2 },
  { id: 'the_marshes', displayName: 'The Marshes', kind: 'wilderness', distanceDays: 3 },
  { id: 'northern_pass', displayName: 'Northern Pass', kind: 'road', distanceDays: 5 },
  { id: 'oldspire', displayName: 'Oldspire', kind: 'town', distanceDays: 7 },
  { id: 'the_kettle', displayName: 'The Kettle', kind: 'landmark', distanceDays: 1 },
  { id: 'salt_ferry', displayName: 'Salt Ferry', kind: 'road', distanceDays: 1 },
  { id: 'gilden_field', displayName: 'Gilden Field', kind: 'village', distanceDays: 4 },
  { id: 'grayreach', displayName: 'Grayreach', kind: 'town', distanceDays: 6 },
  { id: 'hollow_wood', displayName: 'Hollow Wood', kind: 'wilderness', distanceDays: 3 },
  { id: 'whitepike', displayName: 'Whitepike', kind: 'landmark', distanceDays: 8 },
  { id: 'west_marches', displayName: 'West Marches', kind: 'wilderness', distanceDays: 6 },
  { id: 'low_ford', displayName: 'Low Ford', kind: 'village', distanceDays: 2 },
  { id: 'bell_ridge', displayName: 'Bell Ridge', kind: 'landmark', distanceDays: 4 },
  { id: 'iron_quay', displayName: 'Iron Quay', kind: 'town', distanceDays: 9 },
  { id: 'the_long_road', displayName: 'The Long Road', kind: 'road', distanceDays: 10 },
]);

const BY_ID = new Map<string, Location>(LOCATIONS.map((l) => [l.id, l]));

export function locationById(id: string): Location | undefined {
  return BY_ID.get(id);
}

export interface RandomLocationOpts {
  kind?: LocationKind;
  excludeId?: string;
}

export function randomLocation(rng: Rng, opts: RandomLocationOpts = {}): Location {
  const pool = LOCATIONS.filter(
    (l) =>
      (opts.kind ? l.kind === opts.kind : true) &&
      (opts.excludeId ? l.id !== opts.excludeId : true),
  );
  if (pool.length === 0) return rngPick(rng, LOCATIONS);
  return rngPick(rng, pool);
}
