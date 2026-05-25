import type {
  ProsperityTier,
  ScheduledArrival,
  TavernTrait,
  WorldTag,
} from '@shared/types';
import { PLACEHOLDER_NAMES } from '../data/placeholderNames.ts';
import { rngFloat, rngInt, seededRng, type Rng } from '../world/rng.ts';

export interface SpawnConfig {
  worldSeed: string;
  gameDay: number;
  subTicksPerDay: number;
  worldTags?: WorldTag[];
  /** Economy (E2): tavern prosperity tier, modulating arrival count + mix. */
  prosperityTier?: ProsperityTier;
  /** Phase 8 (D3): the keeper's chosen identity, modulating arrival mix. */
  tavernTraits?: TavernTrait[];
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

/** Economy (E2): prosperity-tier adjustment to a day's arrival count. */
const PROSPERITY_COUNT_DELTA: Record<ProsperityTier, number> = {
  struggling: -1,
  steady: 0,
  thriving: 1,
  renowned: 2,
};

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
  // Economy (E2): a thriving tavern draws a fuller house; a struggling one
  // thins out. The Math.max below still holds the loop open — no death spiral.
  count += PROSPERITY_COUNT_DELTA[cfg.prosperityTier ?? 'steady'];
  count = Math.max(1, count);

  // Tag-driven archetype injection.
  const refugeeBoost = tags.get('war_in_north') === 'escalating';
  const merchantBoost = tags.get('harvest') === 'poor';
  // Economy (E2): a well-regarded tavern pulls in more well-off merchants.
  const prosperityHigh =
    cfg.prosperityTier === 'thriving' || cfg.prosperityTier === 'renowned';

  const usedNames = new Set<string>();
  const arrivals: ScheduledArrival[] = [];
  for (let i = 0; i < count; i += 1) {
    const subTick = sampleArrivalSubTick(rng, subTicksPerDay);
    const displayName = pickName(rng, usedNames);
    const archetype = pickArchetype(rng, {
      refugeeBoost,
      merchantBoost,
      prosperityHigh,
      tavernTraits: cfg.tavernTraits,
    });
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
 * Phase 8 (D3): per-trait multiplicative archetype nudges. Each trait
 * multiplies the listed archetypes' weights in the fall-through pool; the
 * resulting distribution is normalized and any archetype exceeding 60% of
 * total share is clamped down (a safety belt for pathological stacking;
 * realistic two-trait combos land in the 15-25% range).
 */
const TRAIT_NUDGES: Record<TavernTrait, Partial<Record<string, number>>> = {
  bardic_stage: { bard: 1.3, rogue: 1.05 },
  scholars_quiet: { scholar: 1.25, pilgrim: 1.1, soldier: 0.85 },
  martial_billet: { soldier: 1.3, knight: 1.15 },
  smugglers_welcome: { rogue: 1.3, knight: 0.8 },
  hearthside_refuge: { refugee: 1.2, pilgrim: 1.1 },
  pilgrims_pause: { pilgrim: 1.25, scholar: 1.1 },
  frontier_post: { wanderer: 1.2, hunter: 1.25, refugee: 1.1 },
  arcane_haven: { mage: 1.3, scholar: 1.15, rogue: 1.1 },
  trade_crossroads: { merchant: 1.3, wanderer: 1.1 },
  hunters_lodge: { hunter: 1.35, knight: 1.1 },
};

const BASE_ARCHETYPES = [
  'wanderer',
  'merchant',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
  'mage',
  'knight',
  'bard',
  'hunter',
] as const;

/** Phase 8 (D3): max share any single archetype may claim post-trait nudge. */
const MAX_SINGLE_SHARE = 0.6;

/**
 * Picks a canonical archetype (matches the NpcArchetype union; the LLM
 * arrival pool is keyed by these strings). `refugee` is omitted from the
 * base pool — it only enters via the war-in-north boost above.
 */
function pickArchetype(
  rng: Rng,
  opts: {
    refugeeBoost: boolean;
    merchantBoost: boolean;
    prosperityHigh: boolean;
    tavernTraits?: TavernTrait[];
  },
): string {
  const r = rng();
  if (opts.refugeeBoost && r < 0.5) return 'refugee';
  if (opts.merchantBoost && r < 0.3) return 'merchant';
  if (opts.prosperityHigh && r < 0.25) return 'merchant';

  // Build the trait-aware weight table. Each archetype starts at weight 1;
  // each chosen trait multiplies the listed archetypes' weights.
  const weights: Record<string, number> = {};
  for (const a of BASE_ARCHETYPES) weights[a] = 1;
  for (const trait of opts.tavernTraits ?? []) {
    const nudges = TRAIT_NUDGES[trait];
    if (!nudges) continue;
    for (const [archetype, mult] of Object.entries(nudges)) {
      if (archetype in weights && typeof mult === 'number') {
        weights[archetype] *= mult;
      }
    }
  }
  // Safety clamp: if any single archetype exceeds MAX_SINGLE_SHARE of the
  // total, scale it down. Converges in one pass for realistic inputs.
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  for (const a of Object.keys(weights)) {
    const share = weights[a] / total;
    if (share > MAX_SINGLE_SHARE) {
      // Find the weight value that gives exactly MAX_SINGLE_SHARE:
      //   w / (w + (total - w_original)) = MAX_SINGLE_SHARE
      // → w = MAX_SINGLE_SHARE / (1 - MAX_SINGLE_SHARE) * (total - w_original)
      const others = total - weights[a];
      weights[a] =
        (MAX_SINGLE_SHARE / (1 - MAX_SINGLE_SHARE)) * others;
      total = others + weights[a];
    }
  }

  // Weighted pick.
  const draw = rng() * total;
  let cursor = 0;
  for (const a of BASE_ARCHETYPES) {
    cursor += weights[a];
    if (draw < cursor) return a;
  }
  return BASE_ARCHETYPES[BASE_ARCHETYPES.length - 1];
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
