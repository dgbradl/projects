// Furniture collision helpers (F4). All coordinates are percentages of the
// tavern (0..100); bounding boxes are axis-aligned and rotation-agnostic for
// now — pieces lean square-ish anyway, and rotation-aware AABBs aren't worth
// the complexity for this first cut.

import type { FurniturePiece } from '@shared/types';
import { spriteByName } from '../assets/tavernSprites.ts';

/** Rendered width of a furniture piece as a percent of the tavern,
 *  by sprite category. Shared by Furnishings (CSS width) and the
 *  collision helper (bbox extent). */
export const WIDTH_BY_CATEGORY: Record<string, number> = {
  tables: 12,
  chairs: 8,
  barrels: 7,
  plants: 5,
  food: 4,
  glassware: 3,
  candles: 4,
  decor: 8,
  doors: 5,
};

export const DEFAULT_WIDTH_PCT = 6;

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  /** Center, in tavern percent. */
  cx: number;
  cy: number;
  /** Half-extent on each axis, in tavern percent. The tavern is 5:3, so 1pct
   *  of width != 1pct of height; we treat the AABB as percentages of each
   *  axis independently, which lines up with how pieces are positioned. */
  hw: number;
  hh: number;
}

/** Approximate AABB for a piece. Sprites are roughly square in their tile
 *  cell, so the height extent mirrors the width extent. The tiny inflation
 *  on the inside keeps NPCs from sticking flush against the edge. */
export function pieceBoundingBox(piece: FurniturePiece): BBox {
  const sprite = spriteByName[piece.sprite];
  const base = sprite ? (WIDTH_BY_CATEGORY[sprite.category] ?? DEFAULT_WIDTH_PCT) : DEFAULT_WIDTH_PCT;
  const w = base * piece.scale;
  return { cx: piece.x, cy: piece.y, hw: w / 2, hh: w / 2 };
}

export function isInside(p: Point, bbox: BBox): boolean {
  return (
    p.x >= bbox.cx - bbox.hw &&
    p.x <= bbox.cx + bbox.hw &&
    p.y >= bbox.cy - bbox.hh &&
    p.y <= bbox.cy + bbox.hh
  );
}

/** Push `p` out of `bbox` along the shortest axis. Caller decides whether to
 *  iterate; this is a single-step operation. Includes a small 0.5pct margin
 *  so the point ends up just outside the bbox, not on the edge. */
export function pushOut(p: Point, bbox: BBox): Point {
  if (!isInside(p, bbox)) return p;
  const dLeft = p.x - (bbox.cx - bbox.hw);
  const dRight = bbox.cx + bbox.hw - p.x;
  const dTop = p.y - (bbox.cy - bbox.hh);
  const dBot = bbox.cy + bbox.hh - p.y;
  const min = Math.min(dLeft, dRight, dTop, dBot);
  const margin = 0.5;
  if (min === dLeft) return { x: bbox.cx - bbox.hw - margin, y: p.y };
  if (min === dRight) return { x: bbox.cx + bbox.hw + margin, y: p.y };
  if (min === dTop) return { x: p.x, y: bbox.cy - bbox.hh - margin };
  return { x: p.x, y: bbox.cy + bbox.hh + margin };
}

function clampToTavern(p: Point): Point {
  return {
    x: Math.max(0, Math.min(100, p.x)),
    y: Math.max(0, Math.min(100, p.y)),
  };
}

/** Furniture an NPC should never visually overlap. Chairs and stools are
 *  explicitly excluded: the server-side seating logic sits NPCs on chair
 *  centres on purpose, and pushing them off here would just land them
 *  inside the table beside the chair. Sit-on-it sprites read as "seat",
 *  not "obstacle". */
function isCollisionPiece(piece: FurniturePiece): boolean {
  const sprite = piece.sprite;
  if (sprite.startsWith('chair')) return false;
  if (sprite.startsWith('stool')) return false;
  return true;
}

/** Visually displace a point so it doesn't sit inside any furniture piece.
 *  Iterates a few times since pushing out of one bbox can land you inside
 *  another. Returns the original point unchanged when no overlap occurs.
 *  Chairs are intentionally not collision-active — see isCollisionPiece. */
export function displaceFromFurniture(
  target: Point,
  furniture: FurniturePiece[],
  maxIterations = 4,
): Point {
  if (furniture.length === 0) return target;
  const bboxes = furniture.filter(isCollisionPiece).map(pieceBoundingBox);
  if (bboxes.length === 0) return target;
  let p = target;
  for (let i = 0; i < maxIterations; i++) {
    let moved = false;
    for (const bbox of bboxes) {
      if (isInside(p, bbox)) {
        p = pushOut(p, bbox);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return clampToTavern(p);
}
