import type { NpcStatus } from '@shared/types';

// --- Sheet geometry -------------------------------------------------------
// Mana Seed Farmer base sheets — and the Customizer's exports — are a 16x16
// grid of 64x64 cells. Cell index = row * SHEET_COLS + col, counted
// left-to-right then top-to-bottom, matching the pack's "cell reference".
export const SHEET_COLS = 16;
export const SHEET_ROWS = 16;

// --- Asset discovery ------------------------------------------------------
// One sheet per NPC archetype. Drop a Customizer export into
// assets/npc/<archetype>/ — any .png filename works; the folder name is what
// gets matched against Npc.archetype. New sheets appear with no code change.
const sheetModules = import.meta.glob('../assets/npc/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const sheetByArchetype: Record<string, string> = {};
for (const [path, url] of Object.entries(sheetModules)) {
  const archetype = path.split('/').at(-2);
  // `staff` is not an archetype — it gets its own per-member sheets below.
  if (archetype && archetype !== 'staff' && !sheetByArchetype[archetype]) {
    sheetByArchetype[archetype] = String(url);
  }
}

// Staff are individually-named characters, not a generic archetype. Each gets
// an optional sheet in assets/npc/staff/, named for the staff member's id
// (e.g. staff_bartender_mirela.png) — see the server staff roster.
const staffSheetModules = import.meta.glob('../assets/npc/staff/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const sheetByStaffId: Record<string, string> = {};
for (const [path, url] of Object.entries(staffSheetModules)) {
  const id = path.split('/').at(-1)?.replace(/\.png$/, '');
  if (id) sheetByStaffId[id] = String(url);
}

/** The sprite sheet for an archetype, or undefined if none has been added. */
export function spriteSheetFor(
  archetype: string | undefined,
): string | undefined {
  return archetype ? sheetByArchetype[archetype] : undefined;
}

/**
 * The sprite sheet for an NPC: a staff member's own sheet when one exists,
 * otherwise the archetype sheet. Undefined if neither has been added.
 */
export function spriteSheetForNpc(npc: {
  id: string;
  isStaff?: boolean;
  archetype?: string;
}): string | undefined {
  if (npc.isStaff && sheetByStaffId[npc.id]) return sheetByStaffId[npc.id];
  return spriteSheetFor(npc.archetype);
}

// --- Animations -----------------------------------------------------------
// Cell indices are read off the pack's "farmer base animation guide".
// Side-facing animations are drawn facing right; flip horizontally for left.
export interface SpriteAnimation {
  /** Cell indices to cycle through. */
  frames: number[];
  /** Milliseconds per frame; 0 marks a static, single-frame pose. */
  frameMs: number;
}

export const ANIMATIONS = {
  idleDown: { frames: [0], frameMs: 0 },
  idleSide: { frames: [16], frameMs: 0 },
  idleUp: { frames: [32], frameMs: 0 },
  walkDown: { frames: [48, 49, 50, 49], frameMs: 135 },
  walkUp: { frames: [52, 53, 54, 53], frameMs: 135 },
  walkSide: { frames: [64, 65, 66, 67, 68, 69], frameMs: 135 },
  sit: { frames: [195], frameMs: 0 },
  drinkBar: { frames: [94, 95], frameMs: 800 },
} satisfies Record<string, SpriteAnimation>;

export type Facing = 'down' | 'up' | 'left' | 'right';

export interface SpritePose {
  animation: SpriteAnimation;
  flipX: boolean;
}

/**
 * Picks the animation and horizontal flip for an NPC, given its status,
 * whether it is currently walking between tiles, and the direction it last
 * faced. Movement always wins over a stationary status.
 */
export function resolvePose(
  status: NpcStatus,
  moving: boolean,
  facing: Facing,
): SpritePose {
  if (moving) {
    if (facing === 'up') return { animation: ANIMATIONS.walkUp, flipX: false };
    if (facing === 'down')
      return { animation: ANIMATIONS.walkDown, flipX: false };
    return { animation: ANIMATIONS.walkSide, flipX: facing === 'left' };
  }
  if (status === 'seated') return { animation: ANIMATIONS.sit, flipX: false };
  if (status === 'at_bar')
    return { animation: ANIMATIONS.drinkBar, flipX: false };
  if (facing === 'up') return { animation: ANIMATIONS.idleUp, flipX: false };
  if (facing === 'down') return { animation: ANIMATIONS.idleDown, flipX: false };
  return { animation: ANIMATIONS.idleSide, flipX: facing === 'left' };
}

/**
 * The CSS `background-position` for a cell, as percentages — resolution
 * independent when paired with `background-size: 1600% 1600%`.
 */
export function cellPosition(cell: number): string {
  const col = cell % SHEET_COLS;
  const row = Math.floor(cell / SHEET_COLS);
  const x = (col / (SHEET_COLS - 1)) * 100;
  const y = (row / (SHEET_ROWS - 1)) * 100;
  return `${x}% ${y}%`;
}
