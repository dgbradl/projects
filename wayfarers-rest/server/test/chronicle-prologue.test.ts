import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DailyChronicle } from '@shared/types';
import { PrologueGenerator } from '../src/chronicle/prologue.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { FixtureRegistry } from '../src/llm/fixtures.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { OllamaClient } from '../src/llm/ollama.ts';
import { Persistence } from '../src/persistence.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(HERE, '../src/llm/fixtures');

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build(initialMode: 'placeholder' | 'recorded' | 'llm') {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(persistence, clock);
  const client = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    model: 'test-model',
    requestTimeoutMs: 1_000,
  });
  const mode = new FlavorModeManager({
    initialMode,
    client,
    bus,
    healthCheckIntervalMs: 60_000,
    getGameDay: () => 1,
  });
  const fixtures = new FixtureRegistry(FIXTURES_DIR);
  fixtures.load();
  const prologue = new PrologueGenerator(
    { persistence, clock, client, mode, fixtures },
    { model: 'test-model', timeoutMs: 1_000 },
  );
  return { persistence, prologue };
}

function seedChronicles(persistence: Persistence, fromDay: number, toDay: number) {
  for (let d = fromDay; d <= toDay; d += 1) {
    const c: DailyChronicle = {
      gameDay: d,
      generatedAtRealTs: 'ts',
      status: 'complete',
      headlines: [`Day ${d} headline one`, `Day ${d} headline two`],
      footnotes: [`Day ${d} footnote.`],
      modelUsed: 'stub',
      promptCharCount: 0,
      completionCharCount: 0,
      generationDurationMs: 0,
      failureReason: null,
    };
    persistence.upsertChronicle(c);
  }
}

describe('PrologueGenerator', () => {
  it('returns null for spans shorter than 3 days', async () => {
    const h = build('recorded');
    expect(await h.prologue.getOrGenerate(1, 2)).toBeNull();
  });

  it('generates via fixtures in recorded mode for span >= 3 and persists', async () => {
    const h = build('recorded');
    seedChronicles(h.persistence, 1, 5);
    const a = await h.prologue.getOrGenerate(1, 5);
    expect(a).not.toBeNull();
    expect(a!.status).toBe('complete');
    expect(a!.text.length).toBeGreaterThan(50);
    const persisted = h.persistence.loadChroniclePrologue(1, 5);
    expect(persisted).not.toBeNull();
  });

  it('returns cached prologue on second call (does not re-generate)', async () => {
    const h = build('recorded');
    seedChronicles(h.persistence, 1, 5);
    const first = await h.prologue.getOrGenerate(1, 5);
    const second = await h.prologue.getOrGenerate(1, 5);
    expect(second).toEqual(first);
  });

  it('placeholder mode produces a fallback prologue', async () => {
    const h = build('placeholder');
    seedChronicles(h.persistence, 1, 4);
    const p = await h.prologue.getOrGenerate(1, 4);
    expect(p).not.toBeNull();
    expect(p!.status).toBe('fallback');
    expect(p!.text).toMatch(/Much happened/);
  });
});
