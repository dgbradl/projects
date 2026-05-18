import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { seededRng } from '../../world/rng.ts';
import type { OllamaClient } from '../ollama.ts';

const PROMPT_TEMPLATE = readFileSync(
  fileURLToPath(new URL('./rumor.prompt.md', import.meta.url)),
  'utf8',
);

export interface RumorInput {
  locationDisplayName: string;
  tagKey: string;
  tagValue: string;
  threadHistoryNote?: string;
  /** Used by placeholder mode for determinism. */
  seed?: string;
}

export interface RumorOutput {
  text: string;
}

export const RUMOR_FORMAT = {
  type: 'object',
  required: ['text'],
  properties: { text: { type: 'string' } },
} as const;

export const rumorValidator = z.object({ text: z.string().min(1) });

export async function generateRumor(
  client: OllamaClient,
  input: RumorInput,
): Promise<RumorOutput> {
  const prompt = PROMPT_TEMPLATE
    .replace('{locationDisplayName}', input.locationDisplayName)
    .replace('{tagKey}', input.tagKey)
    .replace('{tagValue}', input.tagValue)
    .replace('{threadHistoryNote}', input.threadHistoryNote ?? 'none');
  return client.generateStructured({
    prompt,
    schema: RUMOR_FORMAT,
    validator: rumorValidator,
    temperature: 0.85,
  });
}

const TEMPLATES = [
  'Word from {loc}: {key} has gone {value}, or so they say.',
  'A traveler from {loc} swore that {key} turned {value} two nights back.',
  'They say {key} is {value} out past {loc} — though half the tellers don\'t agree.',
  'You hear it more than once now: {key} {value} near {loc}.',
];

export function rumorPlaceholder(input: RumorInput): RumorOutput {
  const seed = input.seed ?? `${input.locationDisplayName}|${input.tagKey}|${input.tagValue}`;
  const rng = seededRng('rumor-placeholder', seed);
  const tpl = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  return {
    text: tpl
      .replace('{loc}', input.locationDisplayName)
      .replace('{key}', input.tagKey)
      .replace('{value}', input.tagValue),
  };
}

export { PROMPT_TEMPLATE as RUMOR_PROMPT_TEMPLATE };
