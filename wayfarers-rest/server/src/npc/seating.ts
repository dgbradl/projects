// Furniture- and roster-aware position helpers (Z3). These are pure functions
// over data: they don't mutate the world or pick randomness themselves
// beyond what the caller's seeded RNG provides. behavior.ts combines them
// into the actual `pickPositionInZone` call site.

import type { FurniturePiece, Npc, Zone, ZoneName } from '@shared/types';
import type { seededRng } from '../world/rng.ts';
import { rngFloat, rngPick } from '../world/rng.ts';

/**
 * Half-extent of a chair sprite in tavern percent. Mirror of
 * WIDTH_BY_CATEGORY.chairs (=8) in client/src/furniture/bbox.ts; if the
 * client constant ever changes, update this in lockstep. We treat chairs
 * as roughly square for occupancy purposes.
 */
export const CHAIR_HW = 4;

export interface Point {
  x: number;
  y: number;
}

type Rng = ReturnType<typeof seededRng>;

/** A piece is "in" a zone if its center is within the zone's radius
 *  (with a small margin so chairs straddling the edge still count). */
export function chairsInZone(zone: Zone, furniture: FurniturePiece[]): FurniturePiece[] {
  const r = zone.radius + CHAIR_HW;
  return furniture
    .filter((p) => isChairSprite(p.sprite))
    .filter((p) => distance(p, zone) <= r);
}

function isChairSprite(sprite: string): boolean {
  return sprite.startsWith('chair');
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** True if any roster NPC (excluding selfId) is within CHAIR_HW of `chair`. */
function chairIsTaken(chair: Point, roster: Npc[], selfId: string): boolean {
  for (const n of roster) {
    if (n.id === selfId) continue;
    if (distance(n.position, chair) <= CHAIR_HW) return true;
  }
  return false;
}

/**
 * Pick a chair in this zone not currently occupied by another NPC. Returns
 * null if there are no chairs or every chair is taken. Chairs are sorted by
 * `piece.id` before sampling so SQLite row order can't perturb the RNG
 * sequence (determinism).
 */
export function pickFreeChair(
  zone: Zone,
  furniture: FurniturePiece[],
  roster: Npc[],
  rng: Rng,
  selfId: string,
): FurniturePiece | null {
  const chairs = chairsInZone(zone, furniture)
    .filter((c) => !chairIsTaken(c, roster, selfId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (chairs.length === 0) return null;
  return rngPick(rng, chairs);
}

/**
 * Position the NPC just outside the chair sprite, in a random direction.
 * Caller is responsible for clamping into the walkable rect.
 */
export function positionBesideChair(chair: FurniturePiece, rng: Rng): Point {
  const angle = rngFloat(rng, 0, Math.PI * 2);
  const offset = CHAIR_HW + 0.5;
  return {
    x: chair.x + Math.cos(angle) * offset,
    y: chair.y + Math.sin(angle) * offset,
  };
}

/**
 * Centroid of the positions of other NPCs whose `zone` matches. Returns null
 * when nobody else is in the zone (so the caller falls back to jitter).
 */
export function zoneCentroidOfOthers(
  zone: ZoneName,
  roster: Npc[],
  selfId: string,
): Point | null {
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (const npc of roster) {
    if (npc.id === selfId) continue;
    if (npc.zone !== zone) continue;
    sumX += npc.position.x;
    sumY += npc.position.y;
    n += 1;
  }
  if (n === 0) return null;
  return { x: sumX / n, y: sumY / n };
}
