import type { FurniturePiece, Npc, NpcStatus, StaffRole, ZoneName } from '@shared/types';
import { WALKABLE } from '@shared/space';
import { TABLE_ZONES, zoneByName } from '../world/tavern.ts';
import { rngFloat, rngInt, rngPick, seededRng } from '../world/rng.ts';
import { traitsFor, type ArchetypeTraits } from './archetype-traits.ts';
import { absoluteSubTick } from './spawn.ts';
import {
  pickFreeChair,
  positionBesideChair,
  zoneCentroidOfOthers,
} from './seating.ts';
import { filterAllowed } from './zones.ts';

/**
 * Z2: zone *preferences* per staff role (not fences). Bartender stays in
 * the bar area; waitstaff/cleaner pick from their preferences ~80% of the
 * time and drift to any allowed non-door zone the other ~20%.
 *
 * Duplicates in the bias pool weight repeated entries — e.g. bartender
 * weights `bar_back` twice so the bartender mostly stands behind the
 * counter but occasionally steps out in front.
 */
const STAFF_PREF_BY_ROLE: Record<StaffRole, ZoneName[]> = {
  // Bartender lives behind the counter and occasionally steps out front;
  // never leaves the bar area for the hearth or tables.
  bartender: ['bar_back', 'bar_back', 'bar_back', 'bar'],
  waitstaff: ['table_a', 'table_b', 'table_c', 'bar', 'hearth'],
  cleaner: ['hearth', 'table_a', 'table_b', 'table_c', 'bar'],
};

const ALL_NON_DOOR_ZONES: readonly ZoneName[] = [
  'bar',
  'bar_back',
  'hearth',
  'table_a',
  'table_b',
  'table_c',
];

const STAFF_DRIFT_PROB = 0.2;

export interface BehaviorContext {
  absSubTick: number;
  worldSeed: string;
  subTicksPerDay: number;
  /** Z3: live furniture list, used to snap seated NPCs onto chair sprites.
   *  Optional so old call sites (and tests that don't care) keep working. */
  furniture?: FurniturePiece[];
  /** Z3: current roster, used for chair-occupancy and same-zone clustering. */
  roster?: Npc[];
  /** Z3: id of the NPC whose decision is being made; excluded from
   *  centroid/occupancy calculations so an NPC doesn't cluster around
   *  itself or count its current chair as taken. */
  selfId?: string;
  /** Phase 8 (C2): archetype of the deciding NPC; used to pull `clusterAffinity`
   *  out of the trait table so soldiers cluster more than rogues. Omit for
   *  staff or test paths and the baseline (wanderer, 0) applies. */
  selfArchetype?: string;
}

const CLUSTER_BIAS_PROB = 0.6;

export interface BehaviorResult {
  npc: Npc;
  changed: boolean;
}

/**
 * Phase 8 (C2): scale a sub-tick count by an archetype's dwell multiplier,
 * pinning at a minimum of 1 so a quick-pacing archetype (refugee at ×0.7)
 * doesn't produce 0-tick dwells that would re-decide every loop.
 */
function scaledDwell(dwell: number, traits: ArchetypeTraits): number {
  return Math.max(1, Math.round(dwell * traits.dwellMultiplier));
}

/**
 * Phase 8 (C2): pick a destination biased toward `traits.preferredZones`
 * intersected with `allowed`. With probability `preferBias` (default 0.7),
 * we draw from the intersection; otherwise we fall back to `allowed`. The
 * roll is always taken from `rng` (one draw) so the RNG draw count is
 * stable for tests/snapshots, regardless of which branch the bias lands
 * in. A second draw picks the actual zone.
 */
function pickPreferredZone(
  rng: ReturnType<typeof seededRng>,
  traits: ArchetypeTraits,
  allowed: readonly ZoneName[],
  preferBias = 0.7,
): ZoneName {
  const biasRoll = rng();
  if (biasRoll < preferBias) {
    const filtered = traits.preferredZones.filter((z) => allowed.includes(z));
    if (filtered.length > 0) return rngPick(rng, filtered);
  }
  return rngPick(rng, allowed);
}

/**
 * Decide the NPC's next state. Caller is responsible for only invoking this
 * when `ctx.absSubTick >= npc.nextDecisionSubTick`.
 *
 * Dwell ranges follow the Phase 2 spec, scaled per-archetype in C2.
 */
export function decideNextState(npc: Npc, ctx: BehaviorContext): BehaviorResult {
  if (npc.isStaff) return decideStaffBehavior(npc, ctx);

  const { absSubTick, worldSeed, subTicksPerDay } = ctx;
  const departureAbs = absoluteSubTick(
    npc.plannedDepartureGameDay,
    npc.plannedDepartureSubTick,
    subTicksPerDay,
  );
  const rng = seededRng(worldSeed, 'npc', npc.id, absSubTick);

  // Departed NPCs are terminal; they should have been pruned by the manager.
  if (npc.status === 'departed') {
    return { npc, changed: false };
  }

  // Leaving NPCs finish their walk to the door and depart.
  if (npc.status === 'leaving') {
    return transition(npc, 'departed', null, rng, ctx, /* dwell */ 0);
  }

  // Anyone past their planned departure heads to the door.
  // (We already short-circuited 'leaving' and 'departed' above.)
  if (absSubTick >= departureAbs) {
    return transition(npc, 'leaving', 'door', rng, ctx, /* dwell */ 3);
  }

  const traits = traitsFor(npc.archetype);

  switch (npc.status) {
    case 'approaching':
      // Becomes 'arriving' once the scheduled sub-tick has arrived. The manager
      // promotes ScheduledArrivals directly, so this branch is a safety net.
      return transition(npc, 'arriving', 'door', rng, ctx, /* dwell */ 1);

    case 'arriving':
      return transition(npc, 'at_bar', 'bar', rng, ctx, rngInt(rng, 2, 4));

    case 'at_bar': {
      const dwell = scaledDwell(rngInt(rng, 4, 11), traits);
      if (absSubTick - npc.nextDecisionSubTick < 0) {
        return { npc, changed: false };
      }
      // Phase 8 (C2): traits-biased table pick. Allowed = tables only here.
      const seatedTable = pickPreferredZone(rng, traits, TABLE_ZONES);
      return transition(npc, 'seated', seatedTable, rng, ctx, dwell);
    }

    case 'seated': {
      // After a long dwell, get up and wander to the bar or a different table.
      // C2: the destination pool now includes the hearth so trait-preferring
      // archetypes (bards, refugees, pilgrims) can actually visit it.
      const goToBar = rng() < 0.5;
      let target: ZoneName;
      if (goToBar) {
        target = 'bar';
      } else {
        const otherTables = TABLE_ZONES.filter((t) => t !== npc.zone);
        const allowed: readonly ZoneName[] = ['hearth', ...otherTables];
        target = pickPreferredZone(rng, traits, allowed);
      }
      const nextStatus: NpcStatus = 'wandering';
      const dwell = scaledDwell(rngInt(rng, 12, 31), traits);
      return transition(npc, nextStatus, target, rng, ctx, dwell);
    }

    case 'wandering': {
      // After wandering, settle either at the bar or at a table.
      const settleAtBar = rng() < 0.45;
      const target: ZoneName = settleAtBar
        ? 'bar'
        : pickPreferredZone(rng, traits, TABLE_ZONES);
      const nextStatus: NpcStatus = settleAtBar ? 'at_bar' : 'seated';
      const dwell = settleAtBar
        ? scaledDwell(rngInt(rng, 4, 11), traits)
        : scaledDwell(rngInt(rng, 12, 31), traits);
      return transition(npc, nextStatus, target, rng, ctx, dwell);
    }

    default:
      return { npc, changed: false };
  }
}

function decideStaffBehavior(npc: Npc, ctx: BehaviorContext): BehaviorResult {
  const { absSubTick, worldSeed } = ctx;
  const rng = seededRng(worldSeed, 'staff', npc.id, absSubTick);
  const role: StaffRole = npc.staffRole ?? 'waitstaff';
  const prefs = STAFF_PREF_BY_ROLE[role] ?? TABLE_ZONES;

  switch (role) {
    case 'bartender': {
      // Bartender stays restricted to the bar-area pool — never drifts.
      const target = rngPick(rng, prefs);
      // Every destination in the bartender pool is a bar-area zone, so
      // status is always at_bar.
      return transition(npc, 'at_bar', target, rng, ctx, rngInt(rng, 8, 20));
    }
    case 'waitstaff': {
      // 80% pick from prefs, 20% drift to any allowed non-door zone.
      const drift = rng() < STAFF_DRIFT_PROB;
      const pool = drift ? filterAllowed(ALL_NON_DOOR_ZONES, npc) : prefs;
      const target = rngPick(rng, pool.length ? pool : prefs);
      const nextStatus: NpcStatus =
        target === 'bar' || target === 'bar_back' ? 'at_bar' : 'wandering';
      return transition(npc, nextStatus, target, rng, ctx, rngInt(rng, 5, 12));
    }
    case 'cleaner': {
      const drift = rng() < STAFF_DRIFT_PROB;
      const pool = drift ? filterAllowed(ALL_NON_DOOR_ZONES, npc) : prefs;
      const target = rngPick(rng, pool.length ? pool : prefs);
      return transition(npc, 'wandering', target, rng, ctx, rngInt(rng, 18, 40));
    }
    default:
      return { npc, changed: false };
  }
}

function transition(
  npc: Npc,
  nextStatus: NpcStatus,
  nextZone: ZoneName | null,
  rng: ReturnType<typeof seededRng>,
  ctx: BehaviorContext,
  dwellSubTicks: number,
): BehaviorResult {
  const position = nextZone
    ? pickPositionInZone(nextZone, rng, {
        ...ctx,
        selfId: ctx.selfId ?? npc.id,
        // Phase 8 (C2): pass the deciding NPC's archetype so pickPositionInZone
        // can apply per-archetype clusterAffinity.
        selfArchetype: ctx.selfArchetype ?? npc.archetype,
      })
    : npc.position;
  const nextDecisionSubTick = ctx.absSubTick + Math.max(1, dwellSubTicks);
  const updated: Npc = {
    ...npc,
    status: nextStatus,
    zone: nextZone,
    position,
    nextDecisionSubTick,
  };
  const changed =
    nextStatus !== npc.status ||
    nextZone !== npc.zone ||
    position.x !== npc.position.x ||
    position.y !== npc.position.y;
  return { npc: updated, changed };
}

/**
 * Pick a position inside `zoneName` taking furniture and other NPCs into
 * account. Order of preference:
 *   1. If a free chair sprite sits in the zone, snap beside it.
 *   2. Else, with probability CLUSTER_BIAS_PROB, sample within half the
 *      zone's radius of the centroid of other NPCs in that zone.
 *   3. Else fall back to a uniform jitter inside the zone (existing math).
 * All results are clamped to the walkable rectangle.
 */
/** Centre of the walkable rectangle — used as the safe fallback whenever a
 *  position is asked for inside a zone that the user has deleted. */
const WALKABLE_CENTER = {
  x: (WALKABLE.minX + WALKABLE.maxX) / 2,
  y: (WALKABLE.minY + WALKABLE.maxY) / 2,
} as const;

export function pickPositionInZone(
  zoneName: ZoneName,
  rng: ReturnType<typeof seededRng>,
  ctx: BehaviorContext,
): { x: number; y: number } {
  const zone = zoneByName(zoneName);
  // Zone removed via the debug editor — drop to the walkable centre so the
  // tick loop never throws on stale zone references.
  if (!zone) return WALKABLE_CENTER;
  const furniture = ctx.furniture ?? [];
  const roster = ctx.roster ?? [];
  const selfId = ctx.selfId ?? '';

  if (furniture.length > 0) {
    const chair = pickFreeChair(zone, furniture, roster, rng, selfId);
    if (chair) return clampToWalkable(positionBesideChair(chair, rng));
  }

  if (roster.length > 0) {
    // Phase 8 (C2): per-archetype clusterAffinity replaces the global
    // CLUSTER_BIAS_PROB. When affinity is high (> 0.5), the centroid is
    // restricted to NPCs of the same archetype so soldiers cluster with
    // soldiers; otherwise fall back to the older "anyone-in-zone" centroid.
    const traits = ctx.selfArchetype ? traitsFor(ctx.selfArchetype) : undefined;
    const affinity = traits?.clusterAffinity ?? CLUSTER_BIAS_PROB;
    const filterToSame = (traits?.clusterAffinity ?? 0) > 0.5;
    const centroid = zoneCentroidOfOthers(
      zoneName,
      roster,
      selfId,
      filterToSame ? ctx.selfArchetype : undefined,
    );
    if (centroid && rng() < affinity) {
      const angle = rngFloat(rng, 0, Math.PI * 2);
      const distance = Math.sqrt(rng()) * zone.radius * 0.5;
      return clampToWalkable({
        x: centroid.x + Math.cos(angle) * distance,
        y: centroid.y + Math.sin(angle) * distance,
      });
    }
  }

  return jitterInsideZone(zoneName, rng);
}

export function jitterInsideZone(
  zoneName: ZoneName,
  rng: ReturnType<typeof seededRng>,
): { x: number; y: number } {
  const zone = zoneByName(zoneName);
  if (!zone) return WALKABLE_CENTER;
  // Sample a uniform point inside the zone's radius.
  const angle = rngFloat(rng, 0, Math.PI * 2);
  const distance = Math.sqrt(rng()) * zone.radius;
  return clampToWalkable({
    x: zone.x + Math.cos(angle) * distance,
    y: zone.y + Math.sin(angle) * distance,
  });
}

/**
 * Clamp a point to the inner walkable rectangle (excludes the wall band).
 * Used by every position emitter so NPCs never land in wall territory.
 */
export function clampToWalkable(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: clamp(p.x, WALKABLE.minX, WALKABLE.maxX),
    y: clamp(p.y, WALKABLE.minY, WALKABLE.maxY),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
