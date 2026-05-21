/**
 * Throwaway bake-off: runs real flavor-slot payloads against several base
 * models, all carrying the same baked-in game SYSTEM context, and scores the
 * outputs against the prompt rules so we can compare model quality.
 *
 * Runs SAMPLES draws per slot per model so run-to-run variance and mode
 * collapse (a model reusing the same name/item across calls) show up.
 *
 * Run from server/:
 *   npx tsx --env-file-if-exists=.env probe-bakeoff.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
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

const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const MODELS = ['llama3.1:8b', 'qwen3:8b', 'gemma3:12b'];
const SAMPLES = 3;
const TIMEOUT_MS = 180_000;

// Pull the baked-in game context out of the flavor Modelfile so every model
// under test gets the exact standing instructions the custom model carries.
const modelfile = readFileSync(
  fileURLToPath(new URL('./ollama/wayfarers-flavor.Modelfile', import.meta.url)),
  'utf8',
);
const SYSTEM = modelfile.match(/SYSTEM """([\s\S]*?)"""/)?.[1]?.trim() ?? '';
if (!SYSTEM) throw new Error('could not extract SYSTEM block from Modelfile');

function fill(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, () => v);
  return out;
}

const wc = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string): string => s.trim().toLowerCase().replace(/[^a-z\s]/g, '');

// ---- rule data lifted straight from the flavor Modelfile's SYSTEM block -----
const BAD_SUFFIXES = [
  'fist', 'hunter', 'blade', 'storm', 'keep', 'stitch', 'bane', 'shadow', 'fall',
];
// SYSTEM lists these as example surnames; "never echo an example's ... names".
const EXAMPLE_SURNAMES = ['crow', 'reed', 'vell', 'thatcher', 'lantern', 'ashdown'];
// SYSTEM's WORLD CANON places; the name slot must coin NEW places, not these.
const CANON_PLACES = new Set(
  [
    'Cradle Hollow', 'Low Ford', 'Gilden Field', 'Oldspire', 'Grayreach',
    'Iron Quay', 'The Marshes', 'Hollow Wood', 'West Marches', 'Northern Pass',
    'Salt Ferry', 'The Long Road', 'The Kettle', 'Whitepike', 'Bell Ridge',
  ].map(norm),
);

// ---- per-slot rule checks: return a list of human-readable rule violations --
function checkArrival(d: { name: string; tagline: string; item: string }): string[] {
  const issues: string[] = [];
  const words = wc(d.tagline);
  if (words < 4 || words > 10) issues.push(`tagline ${words}w (want 4-10)`);
  if (/\b(I|my|me|we|our)\b/i.test(d.tagline)) issues.push('tagline not 3rd person');
  const surname = d.name.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() ?? '';
  if (BAD_SUFFIXES.some((s) => surname !== s && surname.endsWith(s))) {
    issues.push(`heroic surname "${d.name}"`);
  }
  if (EXAMPLE_SURNAMES.includes(surname.replace(/[^a-z]/g, ''))) {
    issues.push(`surname "${d.name}" echoes a SYSTEM example`);
  }
  return issues;
}

function checkRumor(d: { text: string }): string[] {
  const issues: string[] = [];
  const sentences = d.text.split(/[.!?]+/).filter((s) => s.trim()).length;
  if (sentences > 2) issues.push(`${sentences} sentences (want 1-2)`);
  return issues;
}

const FRAGMENT_EXAMPLES = ["that's not a lute", 'third moon', 'copper or nothing'];

function checkFragments(d: { fragments: string[] }, want: number): string[] {
  const issues: string[] = [];
  if (d.fragments.length !== want) {
    issues.push(`${d.fragments.length} fragments (want ${want})`);
  }
  const offLen = d.fragments.filter((f) => wc(f) < 5 || wc(f) > 15).length;
  if (offLen) issues.push(`${offLen} fragments outside 5-15w`);
  const echoed = d.fragments.filter((f) =>
    FRAGMENT_EXAMPLES.some((e) => f.toLowerCase().includes(e)),
  ).length;
  if (echoed) issues.push(`${echoed} echo the prompt's examples`);
  return issues;
}

function checkNames(d: { names: string[] }, want: number): string[] {
  const issues: string[] = [];
  if (d.names.length !== want) issues.push(`${d.names.length} names (want ${want})`);
  const offLen = d.names.filter((n) => wc(n) < 1 || wc(n) > 4).length;
  if (offLen) issues.push(`${offLen} names outside 1-4w`);
  const dupes = d.names.length - new Set(d.names.map((n) => norm(n))).size;
  if (dupes) issues.push(`${dupes} duplicate names`);
  const canon = d.names.filter((n) => CANON_PLACES.has(norm(n)));
  if (canon.length) issues.push(`returns canon place(s): ${canon.join(', ')}`);
  return issues;
}

interface SlotTest {
  label: string;
  prompt: string;
  schema: Record<string, unknown>;
  validator: z.ZodTypeAny;
  temperature: number;
  check: (data: unknown) => string[];
}

const FRAG_BATCH = 8;
const NAME_BATCH = 8;

const TESTS: SlotTest[] = [
  {
    label: 'arrival/refugee',
    prompt: fill(ARRIVAL_PROMPT_TEMPLATE, {
      archetype: 'refugee',
      mood: 'desperate',
      originLocationDisplayName: 'Northern Pass',
      originLocationKind: 'road',
      newsContext: 'the war in the north is escalating',
    }),
    schema: ARRIVAL_FORMAT as Record<string, unknown>,
    validator: arrivalValidator,
    temperature: 0.9,
    check: (d) => checkArrival(d as never),
  },
  {
    label: 'arrival/rogue',
    prompt: fill(ARRIVAL_PROMPT_TEMPLATE, {
      archetype: 'rogue',
      mood: 'smug',
      originLocationDisplayName: 'Oldspire',
      originLocationKind: 'town',
      newsContext: 'nothing in particular',
    }),
    schema: ARRIVAL_FORMAT as Record<string, unknown>,
    validator: arrivalValidator,
    temperature: 0.9,
    check: (d) => checkArrival(d as never),
  },
  {
    label: 'rumor/road',
    prompt: fill(RUMOR_PROMPT_TEMPLATE, {
      locationDisplayName: 'Salt Ferry',
      tagKey: 'road_safety_south',
      tagValue: 'poor',
      threadHistoryNote: 'a merchant caravan went missing two weeks ago',
    }),
    schema: RUMOR_FORMAT as Record<string, unknown>,
    validator: rumorValidator,
    temperature: 0.85,
    check: (d) => checkRumor(d as never),
  },
  {
    label: 'fragment/x8',
    prompt: fill(FRAGMENT_PROMPT_TEMPLATE, {
      batchSize: String(FRAG_BATCH),
      moodHint: 'varied',
    }),
    schema: FRAGMENT_FORMAT as Record<string, unknown>,
    validator: fragmentValidator,
    temperature: 1.0,
    check: (d) => checkFragments(d as never, FRAG_BATCH),
  },
  {
    label: 'name/locations-x8',
    prompt: fill(NAME_PROMPT_TEMPLATE, {
      batchSize: String(NAME_BATCH),
      kind: 'location',
      avoidBlock: nameAvoidBlock('location'),
      styleHint: 'rivers, ridges, hollows, fords, lone trees',
    }),
    schema: NAME_FORMAT as Record<string, unknown>,
    validator: nameValidator,
    temperature: 0.9,
    check: (d) => checkNames(d as never, NAME_BATCH),
  },
];

interface RunResult {
  ms: number;
  cold: boolean;
  data?: unknown;
  issues?: string[];
  error?: string;
  raw?: string;
}

async function generate(
  model: string,
  test: SlotTest,
  cold: boolean,
): Promise<RunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const body: Record<string, unknown> = {
    model,
    system: SYSTEM,
    prompt: test.prompt,
    format: test.schema,
    stream: false,
    options: { temperature: test.temperature, top_p: 0.9 },
  };
  // qwen3 is a hybrid reasoning model — turn thinking off for short JSON slots.
  if (model.startsWith('qwen3')) body.think = false;

  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, cold, error: `HTTP ${res.status} ${res.statusText}` };
    const outer = (await res.json()) as { response: string };
    let data: unknown;
    try {
      data = JSON.parse(outer.response);
    } catch {
      return { ms, cold, error: 'output not JSON', raw: outer.response };
    }
    const v = test.validator.safeParse(data);
    if (!v.success) return { ms, cold, error: 'schema validation failed', data };
    return { ms, cold, data: v.data, issues: test.check(v.data) };
  } catch (err) {
    const ms = Date.now() - t0;
    const name = (err as Error).name;
    return {
      ms,
      cold,
      error: name === 'AbortError' ? 'timeout' : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function show(data: unknown, indent = '      '): string {
  if (data && typeof data === 'object' && 'fragments' in data) {
    return (data as { fragments: string[] }).fragments
      .map((f) => `${indent}· ${f}`)
      .join('\n');
  }
  if (data && typeof data === 'object' && 'names' in data) {
    return (data as { names: string[] }).names
      .map((n) => `${indent}· ${n}`)
      .join('\n');
  }
  if (data && typeof data === 'object' && 'text' in data) {
    return `${indent}${(data as { text: string }).text}`;
  }
  if (data && typeof data === 'object' && 'name' in data) {
    const d = data as { name: string; tagline: string; item: string };
    return `${indent}${d.name} — ${d.tagline} — [${d.item}]`;
  }
  return `${indent}${JSON.stringify(data)}`;
}

const STOPWORDS = new Set([
  'with', 'that', 'this', 'from', 'their', 'they', 'them', 'some', 'into',
  'made', 'half', 'three', 'four', 'five', 'over', 'about',
]);

/** Report mode-collapse: items/surnames a model reuses across arrival draws. */
function repetitionReport(arrivals: RunResult[]): string[] {
  const out: string[] = [];
  const items: string[] = [];
  const surnames: string[] = [];
  for (const r of arrivals) {
    if (!r.data || typeof r.data !== 'object' || !('name' in r.data)) continue;
    const d = r.data as { name: string; item: string };
    items.push(d.item);
    surnames.push(d.name.trim().split(/\s+/).slice(-1)[0] ?? '');
  }
  // Repeated surnames across draws.
  const sCount = new Map<string, number>();
  for (const s of surnames) sCount.set(norm(s), (sCount.get(norm(s)) ?? 0) + 1);
  const repSur = [...sCount.entries()].filter(([, n]) => n > 1);
  if (repSur.length) {
    out.push(`reused surname(s): ${repSur.map(([s, n]) => `${s} x${n}`).join(', ')}`);
  }
  // Content words shared across multiple item descriptions (mode collapse).
  const wordHits = new Map<string, number>();
  for (const it of items) {
    const seen = new Set<string>();
    for (const w of norm(it).split(/\s+/)) {
      if (w.length >= 4 && !STOPWORDS.has(w)) seen.add(w);
    }
    for (const w of seen) wordHits.set(w, (wordHits.get(w) ?? 0) + 1);
  }
  const shared = [...wordHits.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);
  if (shared.length) {
    out.push(
      `item words repeated across draws: ${shared
        .map(([w, n]) => `${w} x${n}`)
        .join(', ')}`,
    );
  }
  return out;
}

async function main(): Promise<void> {
  console.log(
    `Bake-off — ${MODELS.length} models x ${TESTS.length} slots x ${SAMPLES} samples`,
  );
  console.log(`Ollama: ${BASE_URL}\n`);

  // results[testLabel][model] = RunResult[]
  const results: Record<string, Record<string, RunResult[]>> = {};

  for (const model of MODELS) {
    process.stdout.write(`running ${model}`);
    let first = true;
    for (const test of TESTS) {
      for (let s = 0; s < SAMPLES; s += 1) {
        const r = await generate(model, test, first);
        first = false;
        ((results[test.label] ??= {})[model] ??= []).push(r);
        process.stdout.write(r.error ? ' ✗' : ' ✓');
      }
    }
    process.stdout.write('\n');
  }

  // ---- per-slot comparison --------------------------------------------------
  for (const test of TESTS) {
    console.log('\n' + '='.repeat(78));
    console.log(`SLOT: ${test.label}   (temp ${test.temperature})`);
    console.log('='.repeat(78));
    for (const model of MODELS) {
      const runs = results[test.label][model];
      console.log(`\n  [${model}]`);
      runs.forEach((r, i) => {
        const issues = r.issues ?? [];
        const verdict = r.error
          ? `ERROR: ${r.error}`
          : issues.length === 0
            ? 'clean'
            : `${issues.length} issue(s): ${issues.join('; ')}`;
        console.log(`    sample ${i + 1}  ${r.ms}ms  — ${verdict}`);
        if (r.raw) console.log(`        raw: ${r.raw.slice(0, 160)}`);
        if (r.data) console.log(show(r.data, '        '));
      });
    }
  }

  // ---- mode-collapse report (arrival items/surnames reused per model) -------
  console.log('\n' + '='.repeat(78));
  console.log('REPETITION ACROSS DRAWS (arrival slots)');
  console.log('='.repeat(78));
  for (const model of MODELS) {
    const arrivals = [
      ...(results['arrival/refugee'][model] ?? []),
      ...(results['arrival/rogue'][model] ?? []),
    ];
    const rep = repetitionReport(arrivals);
    console.log(`\n  [${model}]`);
    if (rep.length === 0) console.log('    no reuse detected');
    else for (const line of rep) console.log(`    ${line}`);
  }

  // ---- scoreboard -----------------------------------------------------------
  console.log('\n' + '='.repeat(78));
  console.log('SCOREBOARD');
  console.log('='.repeat(78));
  console.log(
    `  ${'model'.padEnd(16)} ${'errors'.padEnd(8)} ${'rule issues'.padEnd(13)} warm avg ms`,
  );
  for (const model of MODELS) {
    let errors = 0;
    let issues = 0;
    let warmMs = 0;
    let warmN = 0;
    for (const test of TESTS) {
      for (const r of results[test.label][model]) {
        if (r.error) errors += 1;
        issues += r.issues?.length ?? 0;
        if (!r.cold) {
          warmMs += r.ms;
          warmN += 1;
        }
      }
    }
    const avg = warmN ? Math.round(warmMs / warmN) : 0;
    console.log(
      `  ${model.padEnd(16)} ${String(errors).padEnd(8)} ${String(issues).padEnd(13)} ${avg}`,
    );
  }
  console.log(
    `\n  errors/issues summed over ${TESTS.length * SAMPLES} draws; warm avg excludes`,
  );
  console.log('  each model\'s cold-start call. Rule issues = prompt-rule violations,');
  console.log('  not prose quality — read the slot sections for voice/feel.');
}

main();
