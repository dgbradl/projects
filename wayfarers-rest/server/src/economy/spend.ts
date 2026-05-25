/**
 * Economy (E1): per-guest spend.
 *
 * `computeGuestSpend` is a pure, deterministic function — its only entropy is
 * a seeded RNG keyed on `worldSeed + npcId + arrivedGameDay`. The same guest
 * on the same arrival day always spends the same amount, on any machine, so a
 * replay of the simulation reproduces the tavern's takings exactly.
 */
import type { GuestSpendBreakdown, NpcArchetype, NpcMood } from '@shared/types';
import { rngInt, seededRng } from '../world/rng.ts';

export interface GuestSpendInput {
  worldSeed: string;
  npcId: string;
  /**
   * The day the guest arrived. The spend RNG is keyed on this (not the
   * departure day) so a guest who stays across a day boundary still has a
   * single, stable tab.
   */
  arrivedGameDay: number;
  archetype: NpcArchetype;
  mood?: NpcMood;
  /** Total visits including this one; > 1 marks a returning regular. */
  visitCount: number;
  /** Sum of this character's affinity toward everyone they have met. */
  affinitySum: number;
  /** True if the stay crossed a game-day boundary (they took a room). */
  stayedOvernight: boolean;
  /** Economy (E3): larder stock level (0 = base) — lifts meal spend. */
  larderStock?: number;
  /** Economy (E3): hearth comfort level (0 = base) — lifts room spend. */
  hearthLevel?: number;
  /**
   * Phase 8 (A5): how many of this guest's desires were fulfilled during
   * their stay (0–2 today; the cap is set by the spawn-time desire count).
   * Each fulfilled desire bumps the tip — a satisfied guest is a generous
   * one. Counted at departure from the npc.desires snapshot.
   */
  fulfilledDesireCount?: number;
  /**
   * Phase 9 (G2): how many `transaction` interactions this guest closed
   * today. Only meaningful for merchants (the trigger only ever fires for
   * a merchant participant); for everyone else this is always 0. Each
   * transaction draws an extra `rngInt(3, 8)` onto the merchant's tip.
   * Appended after the A5 desire-tip draws so the RNG contract holds for
   * legacy guests with neither.
   */
  merchantTransactionCount?: number;
}

/** Per-archetype drink spend band, [min, max] inclusive. */
const DRINK_BAND: Record<NpcArchetype, readonly [number, number]> = {
  knight: [6, 12],
  merchant: [5, 11],
  soldier: [5, 11],
  bard: [4, 9],
  wanderer: [3, 8],
  rogue: [3, 8],
  mage: [3, 8],
  hunter: [3, 8],
  scholar: [3, 7],
  pilgrim: [2, 5],
  refugee: [1, 4],
};

const MEAL_BAND: readonly [number, number] = [3, 8];
const ROOM_BAND: readonly [number, number] = [8, 15];
// Tuned 2026-05-23 from [0,4] → [1,5]: every guest tips at least a little,
// so a first-time stranger with no affinity still contributes more than zero.
const TIP_BAND: readonly [number, number] = [1, 5];
/** Chance a guest who is not staying overnight still buys a meal. */
const MEAL_CHANCE = 0.55;

/** Mood scales the whole tab — a cheerful guest is a generous one. */
const MOOD_MULT: Record<NpcMood, number> = {
  cheerful: 1.2,
  smug: 1.15,
  anxious: 0.95,
  guarded: 0.85,
  weary: 0.8,
  desperate: 0.75,
};

/**
 * What a guest spent over a visit, by category. Pure and deterministic.
 *
 * The RNG draw order — drink, meal-roll, meal-amount, room, tip — is part of
 * the seed contract: five draws happen on every call regardless of which
 * branches are taken, so reordering or conditionally skipping a draw would
 * silently change every downstream number. Do not reorder.
 */
export function computeGuestSpend(input: GuestSpendInput): GuestSpendBreakdown {
  const rng = seededRng(
    input.worldSeed,
    'guest-spend',
    input.npcId,
    input.arrivedGameDay,
  );

  // 1) drink — archetype sets the band.
  const [dMin, dMax] = DRINK_BAND[input.archetype] ?? DRINK_BAND.wanderer;
  let drink = rngInt(rng, dMin, dMax + 1);

  // 2) meal — always draw both the roll and the amount so the stream position
  //    is fixed; an overnight guest always eats, otherwise it is a chance.
  //    Economy (E3): a stocked larder lifts meal spend (+15% per level —
  //    tuned 2026-05-23 from +10% so restocking pays back faster, given that
  //    the larder also decays one level per day).
  const mealRoll = rng();
  const mealAmount = rngInt(rng, MEAL_BAND[0], MEAL_BAND[1] + 1);
  const eats = input.stayedOvernight || mealRoll < MEAL_CHANCE;
  let meal = eats ? mealAmount * (1 + (input.larderStock ?? 0) * 0.15) : 0;

  // 3) room — always draw; only an overnight stay is actually charged.
  //    Economy (E3): a finer hearth lifts room spend (+12% per level).
  const roomAmount = rngInt(rng, ROOM_BAND[0], ROOM_BAND[1] + 1);
  let room = input.stayedOvernight
    ? roomAmount * (1 + (input.hearthLevel ?? 0) * 0.12)
    : 0;

  // 4) tip — regulars tip, and a warmly-disposed guest tips more.
  let tip = rngInt(rng, TIP_BAND[0], TIP_BAND[1] + 1);
  tip += Math.min(Math.max(input.visitCount - 1, 0), 4);
  if (input.affinitySum > 0) {
    tip += Math.min(Math.floor(input.affinitySum / 10), 3);
  }

  // 5) Phase 8 (A5): desire-fulfilment tip bump. Each fulfilled desire draws
  //    a small extra rngInt(2, 5) on top. This draw is *appended* after the
  //    legacy 4-draw stream so guests with no desires (legacy rows + staff)
  //    see no change in their RNG sequence — the determinism contract holds.
  const fulfilled = Math.max(0, input.fulfilledDesireCount ?? 0);
  for (let i = 0; i < fulfilled; i += 1) {
    tip += rngInt(rng, 2, 6);
  }

  // 6) Phase 9 (G2): merchant-transaction tip bump. Each closed deal draws
  //    rngInt(3, 8) onto the merchant's tip. Appended after the A5 draws,
  //    so a guest with neither desires nor transactions (legacy + non-
  //    merchants) sees the same RNG stream they did before this slice.
  const transactions = Math.max(0, input.merchantTransactionCount ?? 0);
  for (let i = 0; i < transactions; i += 1) {
    tip += rngInt(rng, 3, 9);
  }

  const mult = input.mood ? MOOD_MULT[input.mood] : 1;
  drink = Math.max(0, Math.round(drink * mult));
  meal = Math.max(0, Math.round(meal * mult));
  room = Math.max(0, Math.round(room * mult));
  tip = Math.max(0, Math.round(tip * mult));

  return { drink, meal, room, tip };
}

/** Total coin across all categories of a breakdown. */
export function totalSpend(b: GuestSpendBreakdown): number {
  return b.drink + b.meal + b.room + b.tip;
}
