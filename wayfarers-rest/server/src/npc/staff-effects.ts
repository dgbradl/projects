/**
 * Epic E (E2/E3): skill-driven passive effects for tavern staff.
 *
 * Effects wired here:
 *  - gossipNetwork       (bartender): propagate rumors between travelers at bar
 *  - hospitality         (waitstaff): extend a new traveler's planned stay
 *  - conflictMitigation  (bartender): reduce argument chance in resolver
 *  - observant           (cleaner):   create a rumor from a departing traveler
 *  - thoroughness        (cleaner):   daily coin bonus from meticulous service
 */
import type { Npc, StaffSkills } from '@shared/types';
import { seededRng } from '../world/rng.ts';

// ---------- helpers ----------

/** Get the first active-staff Npc for a given role, or undefined. */
function staffByRole(
  roster: Npc[],
  role: 'bartender' | 'waitstaff' | 'cleaner',
): Npc | undefined {
  return roster.find((n) => n.isStaff && n.staffRole === role);
}

function skill(npc: Npc | undefined, key: keyof StaffSkills): number {
  return npc?.skills?.[key] ?? 0;
}

// ---------- gossipNetwork ----------

export interface GossipResult {
  recipientId: string;
  rumorId: string;
  donorId: string;
}

/**
 * If the bartender is at the bar with skill > 0, try to pass one rumor from a
 * traveler at the bar to another traveler at the bar who doesn't already have
 * it. Returns the transfer record if one occurred, undefined otherwise.
 *
 * Probability per sub-tick = gossipNetwork / 10 * 0.25  (max 25% at skill 10).
 */
export function processGossipNetwork(
  roster: Npc[],
  worldSeed: string,
  gameDay: number,
  subTick: number,
): GossipResult | undefined {
  const bartender = staffByRole(roster, 'bartender');
  if (!bartender || bartender.zone !== 'bar') return undefined;
  const gossip = skill(bartender, 'gossipNetwork');
  if (gossip === 0) return undefined;

  const rng = seededRng(worldSeed, 'gossip', gameDay, subTick);
  if (rng() >= (gossip / 10) * 0.25) return undefined;

  // Travelers (non-staff) currently at the bar.
  const atBar = roster.filter(
    (n) => !n.isStaff && n.zone === 'bar' && n.carriedRumorIds.length > 0,
  );
  if (atBar.length < 2) return undefined;

  const donorIdx = Math.floor(rng() * atBar.length);
  const donor = atBar[donorIdx];

  // Find a recipient who is missing at least one of the donor's rumors.
  const others = atBar.filter((n) => n.id !== donor.id);
  for (const recipient of others) {
    const missing = donor.carriedRumorIds.filter(
      (id) => !recipient.carriedRumorIds.includes(id),
    );
    if (missing.length === 0) continue;
    const rumorId = missing[Math.floor(rng() * missing.length)];
    return { recipientId: recipient.id, rumorId, donorId: donor.id };
  }
  return undefined;
}

// ---------- hospitality ----------

/**
 * Compute the sub-tick departure extension granted by waitstaff hospitality.
 * Called on npc_arrived / npc_returned before roster is committed.
 *
 * Extension = floor(hospitality * 3) sub-ticks, capped at 30.
 * Returns 0 if no waitstaff is present or their skill is 0.
 */
export function computeHospitalityExtension(roster: Npc[]): number {
  const waiter = staffByRole(roster, 'waitstaff');
  if (!waiter) {
    // Check for a second waitstaff slot.
    const waiters = roster.filter((n) => n.isStaff && n.staffRole === 'waitstaff');
    if (waiters.length === 0) return 0;
    const best = Math.max(...waiters.map((w) => skill(w, 'hospitality')));
    return Math.min(30, Math.floor(best * 3));
  }
  // Grab the highest hospitality among any waitstaff on the floor.
  const waiters = roster.filter((n) => n.isStaff && n.staffRole === 'waitstaff');
  if (waiters.length === 0) return 0;
  const best = Math.max(...waiters.map((w) => skill(w, 'hospitality')));
  return Math.min(30, Math.floor(best * 3));
}

// ---------- conflictMitigation ----------

/**
 * How much to reduce `overheard_argument` weight in the interaction resolver.
 * Applied when the bartender is present in the tavern (any zone counts —
 * their reputation keeps things calmer even when they step away from the bar).
 *
 * Reduction = conflictMitigation / 10 * 0.5  (max 0.3 at skill 6, 0.5 at 10).
 */
export function computeConflictMitigation(roster: Npc[]): number {
  const bartender = staffByRole(roster, 'bartender');
  if (!bartender) return 0;
  const cm = skill(bartender, 'conflictMitigation');
  return (cm / 10) * 0.5;
}

// ---------- observant ----------

export interface ObservantResult {
  /** The cleaner who noticed something. */
  cleanerId: string;
  /** Departing traveler's name to weave into the rumor text. */
  displayName: string;
  /** A rumor text fragment for RumorsManager to save. */
  rumorText: string;
}

const OBSERVANT_TEMPLATES = [
  (name: string) =>
    `${name} was seen slipping something into their pack before leaving at dawn.`,
  (name: string) =>
    `${name} left a folded note under their pillow — then seemed to think better of it and took it back.`,
  (name: string) =>
    `${name} asked Oskar to keep quiet about a late-night visitor. He said nothing, as usual.`,
  (name: string) =>
    `Before departing, ${name} spent a long time studying the road south through the common-room window.`,
  (name: string) =>
    `${name} tipped generously but avoided eye contact on the way out. Tells you something.`,
];

/**
 * When a traveler departs, the cleaner may notice something worth repeating.
 * Returns a result if the cleaner is present, observant > 5, and probability
 * fires. Probability = observant / 10 * 0.35 (max 35% at skill 10).
 */
export function checkObservant(
  roster: Npc[],
  departingNpcId: string,
  departingDisplayName: string,
  worldSeed: string,
  gameDay: number,
): ObservantResult | undefined {
  const cleaner = staffByRole(roster, 'cleaner');
  if (!cleaner) return undefined;
  const obs = skill(cleaner, 'observant');
  if (obs <= 5) return undefined;

  const rng = seededRng(worldSeed, 'observant', gameDay, departingNpcId);
  if (rng() >= (obs / 10) * 0.35) return undefined;

  const templateIdx = Math.floor(rng() * OBSERVANT_TEMPLATES.length);
  return {
    cleanerId: cleaner.id,
    displayName: departingDisplayName,
    rumorText: OBSERVANT_TEMPLATES[templateIdx](departingDisplayName),
  };
}

// ---------- thoroughness ----------

/**
 * Coin bonus from the cleaner's thoroughness — clean premises mean guests
 * linger and spend a little more.
 *
 * Bonus = floor(thoroughness * 0.8) coin per day (max 7 at skill 9, 8 at 10).
 * Returns 0 if no cleaner is present or skill is 0.
 */
export function computeThoroughnessBonus(roster: Npc[]): number {
  const cleaner = staffByRole(roster, 'cleaner');
  if (!cleaner) return 0;
  const th = skill(cleaner, 'thoroughness');
  return Math.floor(th * 0.8);
}
