/**
 * Phase 9 (H2): earned regular names.
 *
 * After enough visits (`EARNED_NAME_THRESHOLD`), a regular's placeholder
 * display name gets dressed up with an honorific or epithet — "Old Marrick"
 * instead of "Marrick", or "Sir Aldred" instead of "Aldred". The sprite
 * label + tooltip use the earned form when present, so the player sees
 * the same regular as a recognisable named character across visits.
 *
 * Generation is deterministic per (worldSeed, characterId). LLM-cached
 * generation is a follow-up; today's path is a deterministic table per
 * archetype with curated epithets that compose with the existing
 * placeholder name pool.
 */
import type { NpcArchetype } from '@shared/types';
import { seededRng } from '../world/rng.ts';

/**
 * Number of visits at which an earned name is awarded. Picked so a regular
 * stops being a placeholder before the player loses track of them as one
 * person across visits, but late enough that random one-time returners
 * don't all earn names.
 */
export const EARNED_NAME_THRESHOLD = 4;

interface EpithetTemplate {
  /** "{name}" placeholder gets replaced with the character's base displayName. */
  template: string;
  /** A short tagline that pairs with this epithet. */
  tagline: string;
}

const EPITHETS_BY_ARCHETYPE: Record<NpcArchetype, EpithetTemplate[]> = {
  wanderer: [
    { template: 'Old {name}', tagline: 'always walking, never settling' },
    { template: '{name} the Wayward', tagline: "never tells you where they're from" },
    { template: 'Long {name}', tagline: 'has been on the road longer than you' },
  ],
  merchant: [
    { template: 'Goodman {name}', tagline: 'knows the price of everything' },
    { template: '{name} of the Roads', tagline: 'sells what others left behind' },
    { template: 'Master {name}', tagline: 'a coin for a coin, every time' },
  ],
  refugee: [
    { template: 'Tired {name}', tagline: 'still asks if the road north is open' },
    { template: '{name} the Last', tagline: 'left more than they brought' },
  ],
  pilgrim: [
    { template: 'Brother {name}', tagline: 'walks toward something further every year' },
    { template: 'Sister {name}', tagline: 'walks toward something further every year' },
    { template: '{name} the Pilgrim', tagline: 'one step at a time' },
  ],
  soldier: [
    { template: 'Captain {name}', tagline: 'drinks like the war is still on' },
    { template: '{name} of the Watch', tagline: 'always reaches the bar first' },
    { template: 'Old {name}', tagline: "doesn't talk about the campaigns" },
  ],
  scholar: [
    { template: 'Master {name}', tagline: 'reads even at the bar' },
    { template: '{name} the Quiet', tagline: 'takes the corner table without asking' },
    { template: '{name} the Lettered', tagline: 'collects stories the way others collect coin' },
  ],
  rogue: [
    { template: 'Quick {name}', tagline: 'always knows the back way out' },
    { template: '{name} the Sharp', tagline: 'never pays full price' },
    { template: 'Lucky {name}', tagline: 'has yet to be caught' },
  ],
  mage: [
    { template: '{name} the Lettered', tagline: 'speaks softly, listens carefully' },
    { template: 'Old {name}', tagline: 'asks strange questions about the weather' },
    { template: '{name} the Veiled', tagline: 'keeps the cowl up indoors' },
  ],
  knight: [
    { template: 'Sir {name}', tagline: 'takes the long bench by the hearth' },
    { template: '{name} of the Hall', tagline: 'wears the colours even in peacetime' },
    { template: 'Captain {name}', tagline: 'still drills before dawn' },
  ],
  bard: [
    { template: '{name} the Lark', tagline: 'sings for their supper, eats well' },
    { template: 'Long {name}', tagline: 'knows every song you half-remember' },
    { template: '{name} the Stringless', tagline: "plays whatever's at hand" },
  ],
  hunter: [
    { template: '{name} the Tracker', tagline: 'reads the weather before you see the clouds' },
    { template: 'Long {name}', tagline: 'sleeps lighter than the door does' },
    { template: 'Old {name}', tagline: 'has more scars than stories' },
  ],
};

export interface EarnedName {
  displayName: string;
  tagline: string;
}

/**
 * Build an honorific name for a regular. Deterministic per
 * (worldSeed, characterId) so a given character always earns the same
 * epithet across replays.
 *
 * Returns undefined if the archetype is unknown or has no templates —
 * caller keeps the placeholder name in that case.
 */
export function buildEarnedName(input: {
  baseDisplayName: string;
  archetype: NpcArchetype | string;
  characterId: string;
  worldSeed: string;
}): EarnedName | undefined {
  const pool = EPITHETS_BY_ARCHETYPE[input.archetype as NpcArchetype];
  if (!pool || pool.length === 0) return undefined;
  const rng = seededRng(input.worldSeed, 'earned-name', input.characterId);
  const choice = pool[Math.floor(rng() * pool.length)];
  const displayName = choice.template.replace('{name}', input.baseDisplayName);
  return { displayName, tagline: choice.tagline };
}
