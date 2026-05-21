/**
 * Throwaway probe: sends each LLM slot's real payload to Ollama and prints
 * the prompt + response so we can review output quality. Run from server/:
 *   npx tsx --env-file-if-exists=.env probe-llm.ts
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { OllamaClient } from './src/llm/ollama.ts';
import {
  ARRIVAL_PROMPT_TEMPLATE,
  ARRIVAL_FORMAT,
  arrivalValidator,
} from './src/llm/slots/arrival.ts';
import {
  RUMOR_PROMPT_TEMPLATE,
  RUMOR_FORMAT,
  rumorValidator,
} from './src/llm/slots/rumor.ts';
import {
  FRAGMENT_PROMPT_TEMPLATE,
  FRAGMENT_FORMAT,
  fragmentValidator,
} from './src/llm/slots/fragment.ts';
import {
  NAME_PROMPT_TEMPLATE,
  NAME_FORMAT,
  nameValidator,
  nameAvoidBlock,
} from './src/llm/slots/name.ts';

const client = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL ?? 'wayfarers-flavor',
  requestTimeoutMs: 90_000,
});
const CHRONICLE_MODEL = process.env.CHRONICLE_MODEL ?? 'wayfarers-keeper';

const CHRONICLE_FORMAT = {
  type: 'object',
  required: ['headlines', 'footnotes'],
  properties: {
    headlines: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
    footnotes: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
  },
};
const chronicleValidator = z.object({
  headlines: z.array(z.string().min(1)),
  footnotes: z.array(z.string().min(1)),
});

const DAILY_TEMPLATE = readFileSync(
  new URL('./src/chronicle/prompts/daily.prompt.md', import.meta.url),
  'utf8',
);

function fill(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(`{${k}}`, () => v);
  }
  return out;
}

function banner(s: string): void {
  console.log('\n' + '='.repeat(74));
  console.log(s);
  console.log('='.repeat(74));
}

async function run(
  label: string,
  prompt: string,
  schema: unknown,
  validator: z.ZodTypeAny,
  temperature: number,
  model?: string,
): Promise<void> {
  const only = process.argv[2];
  if (only && !label.toLowerCase().startsWith(only.toLowerCase())) return;
  banner(`${label}   [model: ${model ?? process.env.OLLAMA_MODEL ?? 'wayfarers-flavor'}, temp: ${temperature}]`);
  console.log('--- PROMPT SENT (system prompt lives in the Modelfile) ---');
  console.log(prompt.trim());
  const t0 = Date.now();
  try {
    const data = await client.generateStructured({
      prompt,
      schema: schema as Record<string, unknown>,
      validator,
      temperature,
      modelOverride: model,
    });
    console.log(`\n--- RESPONSE (${Date.now() - t0}ms) ---`);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`\n--- ERROR (${Date.now() - t0}ms) ---`);
    console.log(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
}

async function main(): Promise<void> {
  // ---- arrival ----
  await run(
    'ARRIVAL — desperate refugee from a dangerous road',
    fill(ARRIVAL_PROMPT_TEMPLATE, {
      archetype: 'refugee',
      mood: 'desperate',
      originLocationDisplayName: 'Northern Pass',
      originLocationKind: 'road',
      newsContext: 'the war in the north is escalating',
    }),
    ARRIVAL_FORMAT,
    arrivalValidator,
    0.9,
  );
  await run(
    'ARRIVAL — smug rogue from a town',
    fill(ARRIVAL_PROMPT_TEMPLATE, {
      archetype: 'rogue',
      mood: 'smug',
      originLocationDisplayName: 'Oldspire',
      originLocationKind: 'town',
      newsContext: 'nothing in particular',
    }),
    ARRIVAL_FORMAT,
    arrivalValidator,
    0.9,
  );

  // ---- rumor ----
  await run(
    'RUMOR — road safety',
    fill(RUMOR_PROMPT_TEMPLATE, {
      locationDisplayName: 'Salt Ferry',
      tagKey: 'road_safety_south',
      tagValue: 'poor',
      threadHistoryNote: 'a merchant caravan went missing two weeks ago',
    }),
    RUMOR_FORMAT,
    rumorValidator,
    0.85,
  );
  await run(
    'RUMOR — harvest',
    fill(RUMOR_PROMPT_TEMPLATE, {
      locationDisplayName: 'Gilden Field',
      tagKey: 'harvest',
      tagValue: 'plentiful',
      threadHistoryNote: 'none',
    }),
    RUMOR_FORMAT,
    rumorValidator,
    0.85,
  );

  // ---- fragment ----
  await run(
    'FRAGMENT — overheard dialogue (batch of 15)',
    fill(FRAGMENT_PROMPT_TEMPLATE, { batchSize: '15', moodHint: 'varied' }),
    FRAGMENT_FORMAT,
    fragmentValidator,
    1.0,
  );

  // ---- name ----
  await run(
    'NAME — locations (batch of 10)',
    fill(NAME_PROMPT_TEMPLATE, {
      batchSize: '10',
      kind: 'location',
      avoidBlock: nameAvoidBlock('location'),
      styleHint: 'rivers, ridges, hollows, fords, lone trees',
    }),
    NAME_FORMAT,
    nameValidator,
    0.9,
  );
  await run(
    'NAME — songs (batch of 6)',
    fill(NAME_PROMPT_TEMPLATE, {
      batchSize: '6',
      kind: 'song',
      avoidBlock: nameAvoidBlock('song'),
      styleHint: 'old ballads, drinking songs, lullabies remembered wrong',
    }),
    NAME_FORMAT,
    nameValidator,
    0.9,
  );

  // ---- chronicle (keeper model) ----
  await run(
    'CHRONICLE — daily ledger entry',
    fill(DAILY_TEMPLATE, {
      gameDay: '12',
      tagsAtDawn: '- road_safety_south: fair\n- war_in_north: simmering',
      tagsAtDusk: '- road_safety_south: poor\n- war_in_north: escalating',
      yesterdayHeadlines: '- A grain wagon from Gilden Field arrived half-empty.',
      activeThreadHeadlines: '- Wren is on the road to Oldspire',
      interventionDescriptions: '(you did not intervene)',
      eventList: [
        '[d12] arrived: Halrent Crow (desperate refugee from Northern Pass) — left more behind than they brought',
        '[d12] arrived: Pip Ashdown (cheerful merchant from Grayreach) — weighs every coin twice',
        '[d12] world tag: road_safety_south fair → poor',
        '[d12] world tag: war_in_north simmering → escalating',
        '[d12] conversation between Pip Ashdown and Tomas Vell at the bar — overheard: the tolls past Salt Ferry have doubled',
        '[d12] brawl between Halrent Crow and Tomas Vell at the hearth',
        '[d12] rumor introduced: a caravan vanished on the southern road',
        '[d12] thread: wren-journey on_the_road → returning',
        '[d12] departed: Sera Lantern (toward Salt Ferry)',
      ].join('\n'),
    }),
    CHRONICLE_FORMAT,
    chronicleValidator,
    0.75,
    CHRONICLE_MODEL,
  );
}

main();
