import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ArrivalGarnish, LocationKind, NpcArchetype, NpcMood } from '@shared/types';
import { PLACEHOLDER_NAMES } from '../../data/placeholderNames.ts';
import { seededRng, type Rng } from '../../world/rng.ts';
import type { OllamaClient } from '../ollama.ts';

const PROMPT_TEMPLATE = readFileSync(
  fileURLToPath(new URL('./arrival.prompt.md', import.meta.url)),
  'utf8',
);

export interface ArrivalInput {
  archetype: NpcArchetype;
  mood: NpcMood;
  originLocationDisplayName: string;
  originLocationKind: LocationKind;
  newsContext?: string;
  /** Used by placeholder mode to keep output deterministic for a given NPC. */
  seed?: string;
}

export const ARRIVAL_FORMAT = {
  type: 'object',
  required: ['name', 'tagline', 'item'],
  properties: {
    name: { type: 'string' },
    tagline: { type: 'string' },
    item: { type: 'string' },
  },
} as const;

export const arrivalValidator = z.object({
  name: z.string().min(1),
  tagline: z.string().min(1),
  item: z.string().min(1),
});

export async function generateArrival(
  client: OllamaClient,
  input: ArrivalInput,
): Promise<ArrivalGarnish> {
  const prompt = PROMPT_TEMPLATE
    .replace('{archetype}', input.archetype)
    .replace('{mood}', input.mood)
    .replace('{originLocationDisplayName}', input.originLocationDisplayName)
    .replace('{originLocationKind}', input.originLocationKind)
    .replace(
      '{newsContext}',
      input.newsContext ?? 'nothing in particular',
    );
  return client.generateStructured({
    prompt,
    schema: ARRIVAL_FORMAT,
    validator: arrivalValidator,
    temperature: 0.9,
  });
}

const TAGLINES: Record<NpcArchetype, string[]> = {
  wanderer: [
    'a long road behind, no road ahead',
    'sleeps light, walks lighter',
    'has been everywhere, knows no one',
  ],
  merchant: [
    'beads in three pouches, none for show',
    'weighs every coin twice',
    'always pricing the room',
  ],
  refugee: [
    'carries north on their boots',
    'left more behind than they brought',
    'tired in a way only fear does',
  ],
  pilgrim: [
    'counts the bells of every village',
    'speaks of a saint nobody else does',
    'walks for someone, not for somewhere',
  ],
  soldier: [
    'stands like the wall is still there',
    'paid by silence, kept by habit',
    'two scars on the off hand',
  ],
  scholar: [
    'ink on three fingers, words on the rest',
    'looking for a chapter no one wrote',
    'argues with absent men',
  ],
  rogue: [
    'has counted every exit since the door',
    'smiles like a debt collector',
    'lighter than they look',
  ],
  mage: [
    'reads the fire like a page',
    'speaks low to things that are not there',
    'a staff worn smooth at the grip',
  ],
  knight: [
    'bows to no one in this room',
    'armour kept, oath half-kept',
    'a crest scratched off the shield',
  ],
  bard: [
    'knows a song for every wound',
    'paid in coin or in stories, never refuses',
    'tunes the room before the lute',
  ],
  hunter: [
    'smells the weather a day early',
    'counts the exits like game trails',
    'quieter than the dog at their heel',
  ],
};

const ITEMS: Record<NpcArchetype, string[]> = {
  wanderer: ['a battered tin cup', 'a folded map missing the edges', 'a flint stone, well-used'],
  merchant: ['a small brass scale', 'a corked vial of spice', 'a ledger sewn in oilcloth'],
  refugee: ['a child\'s wooden toy', 'a single key on a string', 'a bundle of crushed herbs'],
  pilgrim: ['a wax-stained candle stub', 'a chain of small carved beads', 'a pressed flower in paper'],
  soldier: ['a whetstone wrapped in leather', 'a folded oilcloth knife', 'half a regimental ribbon'],
  scholar: ['a quill and stoppered ink bottle', 'three sheets of vellum', 'a worn copy of someone\'s sermons'],
  rogue: ['a set of bone dice', 'a slim iron pick', 'a coin that is not quite a coin'],
  mage: ['a candle that burns the wrong colour', 'a chalk stub worn to nothing', 'a clouded glass lens'],
  knight: ['a dented gauntlet, oiled daily', 'a folded banner, colours faded', 'a signet ring turned inward'],
  bard: ['a lute string coiled in a tin', 'a songbook swollen with old rain', 'a coin from a city that fell'],
  hunter: ['a snare wire wound on a stick', 'a single fang strung on sinew', 'a quiver with three good arrows'],
};

/**
 * Deterministic placeholder. Given the same `seed`, returns the same garnish.
 * The displayName follows the Phase 1-3 PLACEHOLDER_NAMES pool so determinism
 * tests in `placeholder` mode still pass.
 */
export function arrivalPlaceholder(input: ArrivalInput): ArrivalGarnish {
  const seed = input.seed ?? `${input.archetype}|${input.mood}`;
  const rng: Rng = seededRng('arrival-placeholder', seed);
  const name = PLACEHOLDER_NAMES[Math.floor(rng() * PLACEHOLDER_NAMES.length)];
  const taglines = TAGLINES[input.archetype];
  const items = ITEMS[input.archetype];
  return {
    name,
    tagline: taglines[Math.floor(rng() * taglines.length)],
    item: items[Math.floor(rng() * items.length)],
  };
}

export const ARRIVAL_BATCH_SIZE = 1;

export { PROMPT_TEMPLATE as ARRIVAL_PROMPT_TEMPLATE };
