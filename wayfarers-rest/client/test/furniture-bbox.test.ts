import { describe, expect, it } from 'vitest';
import type { FurniturePiece } from '@shared/types';
import {
  displaceFromFurniture,
  isInside,
  pieceBoundingBox,
  pushOut,
} from '../src/furniture/bbox.ts';

function p(overrides: Partial<FurniturePiece> & { id: string }): FurniturePiece {
  return {
    id: overrides.id,
    sprite: overrides.sprite ?? 'table_round_01',
    x: overrides.x ?? 50,
    y: overrides.y ?? 50,
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? 1,
    layer: overrides.layer ?? 1,
  };
}

describe('furniture bbox', () => {
  it('pieceBoundingBox uses category width times scale', () => {
    const tbl = pieceBoundingBox(p({ id: 't', sprite: 'table_round_01', scale: 1 })); // tables=12
    expect(tbl.hw).toBeCloseTo(6); // 12 / 2
    expect(tbl.hh).toBeCloseTo(6);
    const big = pieceBoundingBox(p({ id: 'b', sprite: 'table_round_01', scale: 2 }));
    expect(big.hw).toBeCloseTo(12);
    const unknown = pieceBoundingBox(p({ id: 'u', sprite: 'no-such-sprite' }));
    expect(unknown.hw).toBeCloseTo(3); // DEFAULT 6 / 2
  });

  it('isInside checks an axis-aligned box', () => {
    const bbox = { cx: 50, cy: 50, hw: 5, hh: 5 };
    expect(isInside({ x: 50, y: 50 }, bbox)).toBe(true);
    expect(isInside({ x: 55, y: 55 }, bbox)).toBe(true);    // edge
    expect(isInside({ x: 56, y: 55 }, bbox)).toBe(false);
    expect(isInside({ x: 44, y: 50 }, bbox)).toBe(false);
  });

  it('pushOut moves a point to the nearest outside edge', () => {
    const bbox = { cx: 50, cy: 50, hw: 5, hh: 5 };
    expect(pushOut({ x: 49, y: 50 }, bbox).x).toBeLessThan(45); // nearest = left
    expect(pushOut({ x: 51, y: 50 }, bbox).x).toBeGreaterThan(55); // nearest = right
    expect(pushOut({ x: 50, y: 49 }, bbox).y).toBeLessThan(45); // nearest = top
    expect(pushOut({ x: 50, y: 51 }, bbox).y).toBeGreaterThan(55); // nearest = bottom
    // No-op when already outside
    const outside = { x: 30, y: 30 };
    expect(pushOut(outside, bbox)).toEqual(outside);
  });

  it('displaceFromFurniture leaves a free position untouched', () => {
    const pieces = [p({ id: 't', sprite: 'table_round_01', x: 30, y: 30 })];
    const free = { x: 60, y: 60 };
    expect(displaceFromFurniture(free, pieces)).toEqual(free);
  });

  it('displaceFromFurniture nudges a point sitting in a piece outside its bbox', () => {
    const pieces = [p({ id: 't', sprite: 'table_round_01', x: 50, y: 50 })];
    const result = displaceFromFurniture({ x: 50, y: 50 }, pieces);
    expect(isInside(result, pieceBoundingBox(pieces[0]))).toBe(false);
  });

  it('displaceFromFurniture resolves multiple-piece overlap within a few iterations', () => {
    const pieces = [
      p({ id: 'a', sprite: 'table_round_01', x: 50, y: 50 }),
      p({ id: 'b', sprite: 'table_round_01', x: 56, y: 50 }), // overlaps a's right edge
    ];
    const result = displaceFromFurniture({ x: 50, y: 50 }, pieces);
    for (const piece of pieces) {
      expect(isInside(result, pieceBoundingBox(piece))).toBe(false);
    }
  });

  it('displaceFromFurniture clamps the result inside the tavern', () => {
    const pieces = [p({ id: 'edge', sprite: 'table_round_01', x: 3, y: 3, scale: 2 })];
    const result = displaceFromFurniture({ x: 3, y: 3 }, pieces);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x).toBeLessThanOrEqual(100);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeLessThanOrEqual(100);
  });

  it('displaceFromFurniture treats chairs as seats, not obstacles', () => {
    // NPC sitting on a chair must stay on the chair, otherwise the seating
    // logic on the server (which sits NPCs at chair centres) is undone.
    const pieces = [p({ id: 'c', sprite: 'chair_01', x: 50, y: 50 })];
    const seated = { x: 50, y: 50 };
    expect(displaceFromFurniture(seated, pieces)).toEqual(seated);
  });

  it('displaceFromFurniture still pushes out of tables even with a chair on top', () => {
    // A chair-on-table layout: the table is the obstacle; the chair is a seat.
    const pieces = [
      p({ id: 't', sprite: 'table_round_01', x: 50, y: 50 }), // hw=6
      p({ id: 'c', sprite: 'chair_01', x: 50, y: 50 }),       // skipped
    ];
    const result = displaceFromFurniture({ x: 50, y: 50 }, pieces);
    // Pushed out of the table bbox.
    expect(isInside(result, pieceBoundingBox(pieces[0]))).toBe(false);
  });
});
