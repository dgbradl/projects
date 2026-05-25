/**
 * Phase 8 (A1): NPC desires.
 *
 * Every arriving traveller carries 1–2 desires. They are visible to the
 * keeper, satisfiable by the sim, staff, or interventions (slices A2/A3/A4),
 * and feed back into the economy on departure (A5).
 *
 * Generation is deterministic: keyed on `worldSeed + npcId`. The same
 * traveller arriving on the same world always wants the same things, on any
 * machine, so a replay of the simulation reproduces desires exactly. Staff
 * NPCs do not generate desires (they live here).
 *
 * The per-archetype pools below are tuneable — each entry is (kind, weight,
 * paramPicker?). A picker is invoked with the RNG to produce a kind-specific
 * `param` (location id, archetype, or tone). Pickers MUST consume a fixed
 * number of RNG draws per call so adding new kinds doesn't shift downstream
 * numbers.
 */
import type { NpcArchetype, NpcDesire, RumorTone } from '@shared/types';
import { LOCATIONS } from '../world/locations.ts';
import { rngPick, seededRng, type Rng } from '../world/rng.ts';

const ALL_LOCATION_IDS: readonly string[] = LOCATIONS.map((l) => l.id);
const TONES: readonly RumorTone[] = ['foreboding', 'curious', 'mundane', 'urgent'];

/** A weighted entry in an archetype's desire pool. */
interface DesireEntry {
  kind: NpcDesire['kind'];
  weight: number;
  /** Optional param picker; omit for kinds whose param is undefined. */
  pickParam?: (rng: Rng) => string;
}

const PICK_LOCATION = (rng: Rng): string => rngPick(rng, ALL_LOCATION_IDS);
const PICK_TONE_FOREBODING = (): string => 'foreboding';
const PICK_TONE_CURIOUS = (): string => 'curious';
const PICK_TONE_URGENT = (): string => 'urgent';
const PICK_COMPANY = (archetype: string) => (): string => archetype;

/**
 * Per-archetype weighted desire pools. Weights are relative; entries with
 * higher weight are picked proportionally more often. Tune freely — the
 * tests assert *relative ordering*, not exact counts.
 */
const DESIRE_POOLS: Record<NpcArchetype, DesireEntry[]> = {
  wanderer: [
    { kind: 'warm_meal', weight: 2 },
    { kind: 'news_of_location', weight: 3, pickParam: PICK_LOCATION },
    { kind: 'bed_for_night', weight: 2 },
    { kind: 'company_of_kind', weight: 1, pickParam: PICK_COMPANY('any') },
  ],
  merchant: [
    { kind: 'warm_meal', weight: 2 },
    { kind: 'news_of_location', weight: 4, pickParam: PICK_LOCATION },
    { kind: 'bed_for_night', weight: 2 },
    { kind: 'rumor_of_tone', weight: 1, pickParam: PICK_TONE_CURIOUS },
  ],
  refugee: [
    { kind: 'warm_meal', weight: 4 },
    { kind: 'bed_for_night', weight: 4 },
    { kind: 'quiet_seat', weight: 1 },
  ],
  pilgrim: [
    { kind: 'bed_for_night', weight: 4 },
    { kind: 'quiet_seat', weight: 2 },
    { kind: 'news_of_location', weight: 2, pickParam: PICK_LOCATION },
  ],
  soldier: [
    { kind: 'company_of_kind', weight: 3, pickParam: PICK_COMPANY('soldier') },
    { kind: 'warm_meal', weight: 2 },
    { kind: 'rumor_of_tone', weight: 2, pickParam: PICK_TONE_URGENT },
  ],
  scholar: [
    { kind: 'news_of_location', weight: 3, pickParam: PICK_LOCATION },
    { kind: 'quiet_seat', weight: 3 },
    { kind: 'rumor_of_tone', weight: 2, pickParam: PICK_TONE_CURIOUS },
  ],
  rogue: [
    { kind: 'quiet_seat', weight: 2 },
    { kind: 'rumor_of_tone', weight: 3, pickParam: PICK_TONE_FOREBODING },
    { kind: 'company_of_kind', weight: 1, pickParam: PICK_COMPANY('rogue') },
  ],
  mage: [
    { kind: 'quiet_seat', weight: 3 },
    { kind: 'news_of_location', weight: 2, pickParam: PICK_LOCATION },
    { kind: 'rumor_of_tone', weight: 2, pickParam: PICK_TONE_FOREBODING },
  ],
  knight: [
    { kind: 'warm_meal', weight: 2 },
    { kind: 'company_of_kind', weight: 2, pickParam: PICK_COMPANY('knight') },
    { kind: 'bed_for_night', weight: 2 },
    { kind: 'rumor_of_tone', weight: 1, pickParam: PICK_TONE_URGENT },
  ],
  bard: [
    { kind: 'company_of_kind', weight: 4, pickParam: PICK_COMPANY('any') },
    { kind: 'warm_meal', weight: 1 },
    { kind: 'news_of_location', weight: 2, pickParam: PICK_LOCATION },
  ],
  hunter: [
    { kind: 'warm_meal', weight: 2 },
    { kind: 'quiet_seat', weight: 2 },
    { kind: 'news_of_location', weight: 2, pickParam: PICK_LOCATION },
  ],
};

/**
 * Probability that an arrival carries TWO desires instead of one. Tuned so
 * the player's tooltip stays scannable (one chip is common, two is interesting).
 */
const TWO_DESIRES_PROB = 0.35;

/**
 * Pure, deterministic. Generates 1–2 desires for an arriving traveller.
 *
 * Staff never carry desires — callers must short-circuit on `isStaff` before
 * calling this, and it'll return an empty array if asked anyway (defence-in-depth).
 *
 * RNG draw order is fixed:
 *   1) "two or one?" roll
 *   2) first desire kind (weighted pick)
 *   3) first desire param (if the kind has a picker — picker may consume >1 draw)
 *   4) second desire kind (if present, sampled from the *remaining* pool to
 *      avoid duplicates)
 *   5) second desire param (if present)
 *
 * Do not reorder; existing tests pin specific arrivals to specific desires.
 */
export function generateDesires(input: {
  archetype: NpcArchetype;
  npcId: string;
  worldSeed: string;
  /** Set true to skip generation (staff path). Defaults to false. */
  isStaff?: boolean;
}): NpcDesire[] {
  if (input.isStaff) return [];
  const pool = DESIRE_POOLS[input.archetype];
  if (!pool || pool.length === 0) return [];
  const rng = seededRng(input.worldSeed, 'desire', input.npcId);

  const wantsTwo = rng() < TWO_DESIRES_PROB;

  const first = pickWeighted(pool, rng);
  if (!first) return [];
  const desires: NpcDesire[] = [makeDesire(first, rng)];

  if (wantsTwo) {
    const remaining = pool.filter((e) => e.kind !== first.kind);
    if (remaining.length > 0) {
      const second = pickWeighted(remaining, rng);
      if (second) desires.push(makeDesire(second, rng));
    }
  }

  return desires;
}

function makeDesire(entry: DesireEntry, rng: Rng): NpcDesire {
  const param = entry.pickParam ? entry.pickParam(rng) : undefined;
  return { kind: entry.kind, param };
}

function pickWeighted(pool: DesireEntry[], rng: Rng): DesireEntry | undefined {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return pool[0];
  const target = rng() * total;
  let cursor = 0;
  for (const entry of pool) {
    cursor += entry.weight;
    if (target < cursor) return entry;
  }
  return pool[pool.length - 1];
}

/**
 * Short, evocative summary of a single desire — used by the chronicle prompt
 * and by the client tooltip's "tip" overlay. Keep under ~40 chars.
 */
export function describeDesire(desire: NpcDesire): string {
  switch (desire.kind) {
    case 'warm_meal':
      return 'wants a warm meal';
    case 'bed_for_night':
      return 'wants a bed for the night';
    case 'quiet_seat':
      return 'wants a quiet seat';
    case 'company_of_kind':
      return desire.param && desire.param !== 'any'
        ? `wants company of a ${desire.param}`
        : 'wants company';
    case 'news_of_location':
      return desire.param
        ? `wants news of ${displayLocation(desire.param)}`
        : 'wants news of distant places';
    case 'rumor_of_tone':
      return desire.param
        ? `wants a ${desire.param} rumor`
        : 'wants a rumor';
  }
}

/** One-glyph icon (kept ASCII/emoji-light) used by the tooltip chip. */
export function iconForDesire(desire: NpcDesire): string {
  switch (desire.kind) {
    case 'warm_meal':
      return '🍲';
    case 'bed_for_night':
      return '🛏';
    case 'quiet_seat':
      return '🪑';
    case 'company_of_kind':
      return '🤝';
    case 'news_of_location':
      return '📜';
    case 'rumor_of_tone':
      return '🜁';
  }
}

function displayLocation(id: string): string {
  const loc = LOCATIONS.find((l) => l.id === id);
  return loc?.displayName ?? id;
}
