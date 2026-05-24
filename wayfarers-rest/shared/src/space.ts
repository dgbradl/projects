// Shared tavern spatial constants. The tavern uses a 0..100 percent
// coordinate space for x and y; NPC positions, furniture, and zones all
// live in that space.

export const TAVERN_BOUNDS = { width: 100, height: 100 } as const;

/**
 * Width of the wall band on each edge, in tavern percent. Mirror of
 * `--wall-depth` in `client/src/styles/tavern.css`, which is
 * `clamp(46px, 8cqw, 96px)` ≈ 8% of the tavern's width at the design size.
 * Keep these two in sync — there's a comment in tavern.css pointing here.
 */
export const WALL_INSET_PCT = 8;

/**
 * The inner rectangle that NPCs may walk inside. Anything between the
 * tavern's outer edge (0 / 100) and WALL_INSET_PCT is inside the visual
 * wall band and must stay clear.
 */
export const WALKABLE = {
  minX: WALL_INSET_PCT,
  maxX: 100 - WALL_INSET_PCT,
  minY: WALL_INSET_PCT,
  maxY: 100 - WALL_INSET_PCT,
} as const;
