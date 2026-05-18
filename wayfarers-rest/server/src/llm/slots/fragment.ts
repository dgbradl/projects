import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { seededRng } from '../../world/rng.ts';
import type { OllamaClient } from '../ollama.ts';

const PROMPT_TEMPLATE = readFileSync(
  fileURLToPath(new URL('./fragment.prompt.md', import.meta.url)),
  'utf8',
);

export const FRAGMENT_BATCH_SIZE = 15;

export interface FragmentInput {
  batchSize?: number;
  moodHint?: string;
  seed?: string;
}

export interface FragmentBatch {
  fragments: string[];
}

export const FRAGMENT_FORMAT = {
  type: 'object',
  required: ['fragments'],
  properties: {
    fragments: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const fragmentValidator = z.object({
  fragments: z.array(z.string().min(1)).min(1),
});

export async function generateFragments(
  client: OllamaClient,
  input: FragmentInput,
): Promise<FragmentBatch> {
  const batch = input.batchSize ?? FRAGMENT_BATCH_SIZE;
  const prompt = PROMPT_TEMPLATE
    .replace('{batchSize}', String(batch))
    .replace('{moodHint}', input.moodHint ?? 'varied');
  return client.generateStructured({
    prompt,
    schema: FRAGMENT_FORMAT,
    validator: fragmentValidator,
    temperature: 1.0,
  });
}

const PLACEHOLDER_FRAGMENTS = Object.freeze([
  "and then he says that's not a lute, that's my wife",
  'the third moon hasn\'t risen in two weeks',
  'I told her, copper or nothing',
  'they buried him with the wrong hat',
  'six oxen, all named Aldred, every one',
  'turn left at the broken cart, you can\'t miss it',
  'never trust a man who counts his eggs',
  'she said the well sang back, plain as day',
  'the inkwell froze before the door did',
  'do not, under any roof, mention the cousin',
  'I have been in this chair longer than you have lived',
  'it was a goat, not a god, but try telling that to the priest',
  'half of what they tell you north of Bellridge is weather, the other half is lies',
  'I owed him before I met him, somehow',
  'salt does the lock no favors',
]);

export function fragmentPlaceholder(input: FragmentInput): FragmentBatch {
  const batch = input.batchSize ?? FRAGMENT_BATCH_SIZE;
  const seed = input.seed ?? 'fragment-default';
  const rng = seededRng('fragment-placeholder', seed);
  const out: string[] = [];
  for (let i = 0; i < batch; i += 1) {
    out.push(
      PLACEHOLDER_FRAGMENTS[
        Math.floor(rng() * PLACEHOLDER_FRAGMENTS.length)
      ],
    );
  }
  return { fragments: out };
}

export { PROMPT_TEMPLATE as FRAGMENT_PROMPT_TEMPLATE };
