import type { Npc, NpcStatus, ZoneName } from '@shared/types';
import { TABLE_ZONES, zoneByName } from '../world/tavern.ts';
import { rngFloat, rngInt, rngPick, seededRng } from '../world/rng.ts';
import { absoluteSubTick } from './spawn.ts';

const STAFF_ZONES_BY_ROLE: Record<string, ZoneName[]> = {
  bartender: ['bar', 'hearth'],
  waitstaff: ['table_a', 'table_b', 'table_c', 'bar'],
  cleaner: ['hearth', 'table_a', 'table_b', 'table_c'],
};

export interface BehaviorContext {
  absSubTick: number;
  worldSeed: string;
  subTicksPerDay: number;
}

export interface BehaviorResult {
  npc: Npc;
  changed: boolean;
}

/**
 * Decide the NPC's next state. Caller is responsible for only invoking this
 * when `ctx.absSubTick >= npc.nextDecisionSubTick`.
 *
 * Dwell ranges follow the Phase 2 spec.
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

  switch (npc.status) {
    case 'approaching':
      // Becomes 'arriving' once the scheduled sub-tick has arrived. The manager
      // promotes ScheduledArrivals directly, so this branch is a safety net.
      return transition(npc, 'arriving', 'door', rng, ctx, /* dwell */ 1);

    case 'arriving':
      return transition(npc, 'at_bar', 'bar', rng, ctx, rngInt(rng, 2, 4));

    case 'at_bar': {
      const dwell = rngInt(rng, 4, 11);
      if (absSubTick - npc.nextDecisionSubTick < 0) {
        return { npc, changed: false };
      }
      const seatedTable = rngPick(rng, TABLE_ZONES);
      return transition(npc, 'seated', seatedTable, rng, ctx, dwell);
    }

    case 'seated': {
      // After a long dwell, get up and wander to the bar or another table.
      const goToBar = rng() < 0.5;
      const target: ZoneName = goToBar
        ? 'bar'
        : rngPick(
            rng,
            TABLE_ZONES.filter((t) => t !== npc.zone),
          );
      const nextStatus: NpcStatus = goToBar ? 'wandering' : 'wandering';
      const dwell = rngInt(rng, 12, 31);
      return transition(npc, nextStatus, target, rng, ctx, dwell);
    }

    case 'wandering': {
      // After wandering, settle either at the bar or at a table.
      const settleAtBar = rng() < 0.45;
      const target: ZoneName = settleAtBar ? 'bar' : rngPick(rng, TABLE_ZONES);
      const nextStatus: NpcStatus = settleAtBar ? 'at_bar' : 'seated';
      const dwell = settleAtBar ? rngInt(rng, 4, 11) : rngInt(rng, 12, 31);
      return transition(npc, nextStatus, target, rng, ctx, dwell);
    }

    default:
      return { npc, changed: false };
  }
}

function decideStaffBehavior(npc: Npc, ctx: BehaviorContext): BehaviorResult {
  const { absSubTick, worldSeed } = ctx;
  const rng = seededRng(worldSeed, 'staff', npc.id, absSubTick);
  const role = npc.staffRole ?? 'waitstaff';
  const zones = STAFF_ZONES_BY_ROLE[role] ?? TABLE_ZONES;

  switch (role) {
    case 'bartender': {
      const stayAtBar = rng() > 0.15;
      const target: ZoneName = stayAtBar ? 'bar' : 'hearth';
      const nextStatus: NpcStatus = stayAtBar ? 'at_bar' : 'wandering';
      return transition(npc, nextStatus, target, rng, ctx, rngInt(rng, 8, 20));
    }
    case 'waitstaff': {
      const target = rngPick(rng, zones);
      const nextStatus: NpcStatus = target === 'bar' ? 'at_bar' : 'wandering';
      return transition(npc, nextStatus, target, rng, ctx, rngInt(rng, 5, 12));
    }
    case 'cleaner': {
      const target = rngPick(rng, zones);
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
    ? jitterInsideZone(nextZone, rng)
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

export function jitterInsideZone(
  zoneName: ZoneName,
  rng: ReturnType<typeof seededRng>,
): { x: number; y: number } {
  const zone = zoneByName(zoneName);
  // Sample a uniform point inside the zone's radius.
  const angle = rngFloat(rng, 0, Math.PI * 2);
  const distance = Math.sqrt(rng()) * zone.radius;
  return {
    x: clamp(zone.x + Math.cos(angle) * distance, 0, 100),
    y: clamp(zone.y + Math.sin(angle) * distance, 0, 100),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
