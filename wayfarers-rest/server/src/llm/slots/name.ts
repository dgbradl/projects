import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LOCATIONS } from '../../world/locations.ts';
import { seededRng } from '../../world/rng.ts';
import type { OllamaClient } from '../ollama.ts';

const PROMPT_TEMPLATE = readFileSync(
  fileURLToPath(new URL('./name.prompt.md', import.meta.url)),
  'utf8',
);

export type NameKind = 'location' | 'faction' | 'song' | 'dish' | 'item';

export const NAME_BATCH_SIZE: Record<NameKind, number> = {
  location: 10,
  faction: 6,
  song: 6,
  dish: 6,
  item: 10,
};

export interface NameInput {
  kind: NameKind;
  batchSize?: number;
  styleHint?: string;
  seed?: string;
}

export interface NameBatch {
  names: string[];
}

export const NAME_FORMAT = {
  type: 'object',
  required: ['names'],
  properties: { names: { type: 'array', items: { type: 'string' } } },
} as const;

export const nameValidator = z.object({
  names: z.array(z.string().min(1)).min(1),
});

const STYLE_HINTS: Record<NameKind, string> = {
  location: 'rivers, ridges, hollows, fords, lone trees',
  faction: 'crests, oaths, old guilds, half-mythic chapters',
  song: 'old ballads, drinking songs, lullabies remembered wrong',
  dish: 'tavern fare, peasant food, local specialty bowls',
  item: 'pocket-sized, characterful, mundane-with-history',
};

/** WORLD CANON place names that the `location` kind must never re-coin. */
const CANON_LOCATION_NAMES = LOCATIONS.map((l) => l.displayName).join(', ');

/** Names the LLM must avoid for a given kind, injected into the name prompt. */
export function nameAvoidBlock(kind: NameKind): string {
  return kind === 'location'
    ? `These names already exist — never output them or a variation of them:\n${CANON_LOCATION_NAMES}\n`
    : '';
}

export async function generateNames(
  client: OllamaClient,
  input: NameInput,
): Promise<NameBatch> {
  const batch = input.batchSize ?? NAME_BATCH_SIZE[input.kind];
  const prompt = PROMPT_TEMPLATE
    .replace('{batchSize}', String(batch))
    .replace('{kind}', input.kind)
    .replace('{avoidBlock}', nameAvoidBlock(input.kind))
    .replace('{styleHint}', input.styleHint ?? STYLE_HINTS[input.kind]);
  return client.generateStructured({
    prompt,
    schema: NAME_FORMAT,
    validator: nameValidator,
    temperature: 0.9,
  });
}

const PLACEHOLDER_NAME_POOLS: Record<NameKind, readonly string[]> = {
  location: [
    'Black Reed Crossing',
    'Greypeel',
    'Two Lanterns',
    'Wether Hollow',
    'The Lampline',
    'Mossfall',
    'Coldwheel',
    'Hen Bridge',
    'Yarrow Step',
    'The Shrouded Ford',
  ],
  faction: [
    'The Cinder Watch',
    'House Vellum',
    'The Quiet Hand',
    'Ferrier\'s Order',
    'The Long Council',
    'Margrave\'s Hounds',
  ],
  song: [
    'The Salt and the Sparrow',
    'Eight Fingers, Three Coins',
    'Down by Aldred\'s Wheel',
    'Lullaby for an Old Goat',
    'The Lantern That Walks',
    'Cousin Mae\'s Lament',
  ],
  dish: [
    'shepherd\'s pottage',
    'pickled river-onion',
    'black bread and crumbcake',
    'split pea with smoked hare',
    'a bowl of \'whatever the cook found\'',
    'old-bread soup',
  ],
  item: [
    'a cracked horn comb',
    'a felted glove with three fingers',
    'a tinder kit, mostly empty',
    'a brass tongue-scraper',
    'an inkwell shaped like a beetle',
    'a roll of stitched leather',
    'a coin from somewhere east',
    'a slate fragment with a tally on it',
    'a tooth, neither human nor wolf',
    'a folded letter, unsealed',
  ],
};

export function namePlaceholder(input: NameInput): NameBatch {
  const batch = input.batchSize ?? NAME_BATCH_SIZE[input.kind];
  const seed = input.seed ?? input.kind;
  const rng = seededRng('name-placeholder', input.kind, seed);
  const pool = PLACEHOLDER_NAME_POOLS[input.kind];
  const out: string[] = [];
  for (let i = 0; i < batch; i += 1) {
    out.push(pool[Math.floor(rng() * pool.length)]);
  }
  return { names: out };
}

export { PROMPT_TEMPLATE as NAME_PROMPT_TEMPLATE };
