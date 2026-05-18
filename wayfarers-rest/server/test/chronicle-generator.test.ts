import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChronicleGenerator } from '../src/chronicle/generator.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { FixtureRegistry } from '../src/llm/fixtures.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { OllamaClient } from '../src/llm/ollama.ts';
import { NpcManager } from '../src/npc/manager.ts';
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
  const npcManager = new NpcManager(
    { worldSeed: 'gen-test', subTicksPerDay: 30 },
    { persistence, bus },
  );
  const generator = new ChronicleGenerator(
    { persistence, bus, clock, client, mode, npcManager, fixtures },
    { model: 'test-model', maxEvents: 25, timeoutMs: 1_000 },
  );
  // Seed a few events for day 1.
  bus.publish({ type: 'init', gameDay: 1 });
  bus.publish({
    type: 'npc_arrived',
    gameDay: 1,
    npcId: 'npc_a',
    displayName: 'Mara',
  });
  bus.publish({
    type: 'world_tag_changed',
    gameDay: 1,
    key: 'war_in_north',
    oldValue: 'quiet',
    newValue: 'simmering',
  });
  return { persistence, bus, clock, client, mode, generator };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ChronicleGenerator', () => {
  it('placeholder mode produces a fallback chronicle without touching the LLM', async () => {
    const h = build('placeholder');
    const calls = vi.fn();
    globalThis.fetch = calls as unknown as typeof globalThis.fetch;
    const c = await h.generator.generate(1);
    expect(c.status).toBe('fallback');
    expect(c.headlines.length).toBeGreaterThanOrEqual(3);
    expect(c.footnotes.length).toBeGreaterThanOrEqual(3);
    expect(calls).not.toHaveBeenCalled();
  });

  it('recorded mode reads from chronicle fixtures and returns complete', async () => {
    const h = build('recorded');
    const c = await h.generator.generate(1);
    expect(c.status).toBe('complete');
    expect(c.headlines.length).toBeGreaterThanOrEqual(3);
    expect(c.modelUsed).toBe('test-model');
    expect(c.completionCharCount).toBeGreaterThan(0);
  });

  it('llm mode: first call fails, retry succeeds → status complete', async () => {
    const h = build('llm');
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) throw new TypeError('boom');
      return new Response(
        JSON.stringify({
          response: JSON.stringify({
            headlines: ['h1', 'h2', 'h3'],
            footnotes: ['f1', 'f2', 'f3'],
          }),
          done: true,
        }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    const c = await h.generator.generate(1);
    expect(c.status).toBe('complete');
    expect(c.failureReason).toMatch(/retry succeeded/);
    expect(callCount).toBe(2);
  }, 15_000);

  it('llm mode: both calls fail → fallback', async () => {
    const h = build('llm');
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('still no ollama');
    }) as unknown as typeof globalThis.fetch;

    const c = await h.generator.generate(1);
    expect(c.status).toBe('fallback');
    expect(c.failureReason).toMatch(/LLM failed twice/);
    expect(c.headlines.length).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it('persists the chronicle and emits chronicle_generated', async () => {
    const h = build('placeholder');
    await h.generator.generate(1);
    const persisted = h.persistence.loadChronicle(1);
    expect(persisted).not.toBeNull();
    expect(persisted!.gameDay).toBe(1);
    const events = h.persistence.getEventsSince(0).map((e) => e.event.type);
    expect(events).toContain('chronicle_generated');
  });
});
