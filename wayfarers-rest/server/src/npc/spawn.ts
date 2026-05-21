import type { ScheduledArrival, WorldTag } from '@shared/types';
import { PLACEHOLDER_NAMES } from '../data/placeholderNames.ts';
import { rngFloat, rngInt, seededRng, type Rng } from '../world/rng.ts';

export interface SpawnConfig {
  worldSeed: string;
  gameDay: number;
  subTicksPerDay: number;
  worldTags?: WorldTag[];
}

export interface DepartureConfig {
  worldSeed: string;
  npcId: string;
  arrivedAbsoluteSubTick: number;
  subTicksPerDay: number;
}

const MIN_ARRIVALS = 4;
const MAX_ARRIVALS = 10;
const EVENING_BIAS = 0.6;
const MIN_STAY = 40;
const MAX_STAY = 200;

export function generateSpawnQueue(cfg: SpawnConfig): ScheduledArrival[] {
  const { worldSeed, gameDay, subTicksPerDay } = cfg;
  const tags = new Map(
    (cfg.worldTags ?? []).map((t): [string, string] => [t.key, t.value]),
  );

  const rng = seededRng(worldSeed, 'spawn', gameDay);
  const baseCount = rngInt(rng, MIN_ARRIVALS, MAX_ARRIVALS + 1);

  // Tag effects on count.
  let count = baseCount;
  if (tags.get('war_in_north') === 'escalating') count += 2;
  if (tags.get('road_safety_south') === 'poor') count -= 1;
  // Phase 7 (D3): a festival underway packs the tavern.
  if (tags.get('festival') === 'underway') count += 3;
  count = Math.max(1, count);

  // Tag-driven archetype injection.
  const refugeeBoost = tags.get('war_in_north') === 'escalating';
  const merchantBoost = tags.get('harvest') === 'poor';

  const usedNames = new Set<string>();
  const arrivals: ScheduledArrival[] = [];
  for (let i = 0; i < count; i += 1) {
    const subTick = sampleArrivalSubTick(rng, subTicksPerDay);
    const displayName = pickName(rng, usedNames);
    const archetype = pickArchetype(rng, { refugeeBoost, merchantBoost });
    arrivals.push({
      npcId: `npc_d${gameDay}_${i}`,
      displayName,
      scheduledGameDay: gameDay,
      scheduledSubTick: subTick,
      archetype,
    });
  }

  arrivals.sort((a, b) => a.scheduledSubTick - b.scheduledSubTick);
  return arrivals;
}

function sampleArrivalSubTick(rng: Rng, subTicksPerDay: number): number {
  const half = Math.floor(subTicksPerDay / 2);
  const evening = rng() < EVENING_BIAS;
  if (evening) return rngInt(rng, half, subTicksPerDay);
  return rngInt(rng, 0, half);
}

function pickName(rng: Rng, used: Set<string>): string {
  const total = PLACEHOLDER_NAMES.length;
  for (let attempt = 0; attempt < total; attempt += 1) {
    const candidate = PLACEHOLDER_NAMES[Math.floor(rng() * total)];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const offset = Math.floor(rng() * total);
  for (let i = 0; i < total; i += 1) {
    const candidate = PLACEHOLDER_NAMES[(offset + i) % total];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error('placeholderNames exhausted');
}

/**
 * Picks one of the 7 canonical archetypes (matches Phase 4's NpcArchetype
 * union; the LLM arrival pool is keyed by these strings).
 */
function pickArchetype(
  rng: Rng,
  opts: { refugeeBoost: boolean; merchantBoost: boolean },
): string {
  const r = rng();
  if (opts.refugeeBoost && r < 0.5) return 'refugee';
  if (opts.merchantBoost && r < 0.3) return 'merchant';
  // Otherwise pick from the full canonical archetype set.
  const archetypes = [
    'wanderer',
    'merchant',
    'pilgrim',
    'soldier',
    'scholar',
    'rogue',
  ];
  return archetypes[Math.floor(rng() * archetypes.length)];
}

export function generateDeparture(cfg: DepartureConfig): {
  plannedDepartureGameDay: number;
  plannedDepartureSubTick: number;
} {
  const { worldSeed, npcId, arrivedAbsoluteSubTick, subTicksPerDay } = cfg;
  const rng = seededRng(worldSeed, 'depart', npcId);
  const stayDuration = Math.floor(rngFloat(rng, MIN_STAY, MAX_STAY + 1));
  const departAbs = arrivedAbsoluteSubTick + stayDuration;
  return {
    plannedDepartureGameDay: Math.floor(departAbs / subTicksPerDay),
    plannedDepartureSubTick: departAbs % subTicksPerDay,
  };
}

export function absoluteSubTick(
  gameDay: number,
  subTick: number,
  subTicksPerDay: number,
): number {
  return gameDay * subTicksPerDay + subTick;
}
