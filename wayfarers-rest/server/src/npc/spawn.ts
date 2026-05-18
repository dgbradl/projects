import type { ScheduledArrival } from '@shared/types';
import { PLACEHOLDER_NAMES } from '../data/placeholderNames.ts';
import { rngFloat, rngInt, seededRng, type Rng } from '../world/rng.ts';

export interface SpawnConfig {
  worldSeed: string;
  gameDay: number;
  subTicksPerDay: number;
}

export interface DepartureConfig {
  worldSeed: string;
  npcId: string;
  arrivedAbsoluteSubTick: number;
  subTicksPerDay: number;
}

const MIN_ARRIVALS = 4;
const MAX_ARRIVALS = 10;
const EVENING_BIAS = 0.6; // probability that an arrival is sampled from the second half of the day
const MIN_STAY = 40;
const MAX_STAY = 200;

export function generateSpawnQueue(cfg: SpawnConfig): ScheduledArrival[] {
  const { worldSeed, gameDay, subTicksPerDay } = cfg;
  const rng = seededRng(worldSeed, 'spawn', gameDay);
  const count = rngInt(rng, MIN_ARRIVALS, MAX_ARRIVALS + 1); // 4..10 inclusive
  const usedNames = new Set<string>();

  const arrivals: ScheduledArrival[] = [];
  for (let i = 0; i < count; i += 1) {
    const subTick = sampleArrivalSubTick(rng, subTicksPerDay);
    const displayName = pickName(rng, usedNames);
    arrivals.push({
      npcId: `npc_d${gameDay}_${i}`,
      displayName,
      scheduledGameDay: gameDay,
      scheduledSubTick: subTick,
    });
  }

  arrivals.sort((a, b) => a.scheduledSubTick - b.scheduledSubTick);
  return arrivals;
}

function sampleArrivalSubTick(rng: Rng, subTicksPerDay: number): number {
  const half = Math.floor(subTicksPerDay / 2);
  const evening = rng() < EVENING_BIAS;
  if (evening) {
    return rngInt(rng, half, subTicksPerDay);
  }
  return rngInt(rng, 0, half);
}

function pickName(rng: Rng, used: Set<string>): string {
  const total = PLACEHOLDER_NAMES.length;
  // Try up to `total` random picks before falling back to a linear scan.
  for (let attempt = 0; attempt < total; attempt += 1) {
    const candidate = PLACEHOLDER_NAMES[Math.floor(rng() * total)];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  // Fallback: deterministic linear scan from a random offset.
  const offset = Math.floor(rng() * total);
  for (let i = 0; i < total; i += 1) {
    const candidate = PLACEHOLDER_NAMES[(offset + i) % total];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  // Should be unreachable while count <= PLACEHOLDER_NAMES.length.
  throw new Error('placeholderNames exhausted');
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
