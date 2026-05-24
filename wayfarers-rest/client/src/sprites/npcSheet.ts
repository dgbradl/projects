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

// Multiple sheets per archetype are supported — drop in as many variants as
// you like and individual NPCs deterministically pick one based on their id,
// so a returning regular looks like themselves visit after visit.
const sheetsByArchetype: Record<string, string[]> = {};
for (const [path, url] of Object.entries(sheetModules)) {
  const archetype = path.split('/').at(-2);
  // `staff` is not an archetype — it gets its own per-member sheets below.
  if (archetype && archetype !== 'staff') {
    (sheetsByArchetype[archetype] ??= []).push(String(url));
  }
}
// Sort each variant list so the per-id pick is stable across machines (the
// glob result order is not guaranteed).
for (const list of Object.values(sheetsByArchetype)) list.sort();

/** Stable djb2-ish hash for picking a sprite variant from an NPC id. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// Staff are individually-named characters, not a generic archetype. Each gets
// an optional sheet in assets/npc/staff/. The filename can be either the
// staff member's character id (`staff_bartender_mirela.png`) or just their
// display name (`Mirela.png`) — whichever you prefer; case and accents are
// ignored.
const staffSheetModules = import.meta.glob('../assets/npc/staff/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Lowercase + strip diacritics, so `Tomás` and `tomas` collide. */
function staffKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const sheetByStaffKey: Record<string, string> = {};
for (const [path, url] of Object.entries(staffSheetModules)) {
  const name = path.split('/').at(-1)?.replace(/\.png$/, '');
  if (name) sheetByStaffKey[staffKey(name)] = String(url);
}

/**
 * The sprite sheet for an archetype, or undefined if none has been added.
 * When multiple variants exist in the archetype folder, one is picked
 * deterministically from `npcId` so the same NPC always renders the same.
 */
export function spriteSheetFor(
  archetype: string | undefined,
  npcId?: string,
): string | undefined {
  if (!archetype) return undefined;
  const variants = sheetsByArchetype[archetype];
  if (!variants || variants.length === 0) return undefined;
  if (variants.length === 1 || !npcId) return variants[0];
  return variants[hashString(npcId) % variants.length];
}

/**
 * The sprite sheet for an NPC: a staff member's own sheet when one exists
 * (matched by either character id or display name), otherwise the archetype
 * sheet. Undefined if neither has been added.
 */
export function spriteSheetForNpc(npc: {
  id: string;
  displayName?: string;
  isStaff?: boolean;
  archetype?: string;
}): string | undefined {
  if (npc.isStaff) {
    const byId = sheetByStaffKey[staffKey(npc.id)];
    if (byId) return byId;
    if (npc.displayName) {
      const byName = sheetByStaffKey[staffKey(npc.displayName)];
      if (byName) return byName;
    }
  }
  return spriteSheetFor(npc.archetype, npc.id);
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
