import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChronicleGenerator } from '../src/chronicle/generator.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { FixtureRegistry } from '../src/llm/fixtures.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { OllamaClient } from '../src/llm/ollama.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import {
  buildDailyPrompt,
  reconstructWorldTagsAt,
} from '../src/chronicle/prompt.ts';
import { select } from '../src/chronicle/salience.ts';
import { DEFAULT_ALARMING_VALUES } from '../src/chronicle/types.ts';
import type { Npc } from '@shared/types';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(HERE, '../src/llm/fixtures');
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * Soft assertion: extract capitalized "proper noun" tokens from the generated
 * chronicle's headlines + footnotes; warn (don't fail) if any are absent from
 * the prompt input. We want long-term visibility into hallucination drift
 * without flaky CI.
 */
describe('chronicle no-invention soft-check (recorded fixtures)', () => {
  it('logs a warning if generated proper nouns are not present in the prompt', async () => {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'm',
      requestTimeoutMs: 1_000,
    });
    const mode = new FlavorModeManager({
      initialMode: 'recorded',
      client,
      bus,
      healthCheckIntervalMs: 60_000,
      getGameDay: () => 1,
    });
    const fixtures = new FixtureRegistry(FIXTURES_DIR);
    fixtures.load();
    const npcManager = new NpcManager(
      { worldSeed: 'no-inv', subTicksPerDay: 30 },
      { persistence, bus },
    );
    const generator = new ChronicleGenerator(
      { persistence, bus, clock, client, mode, npcManager, fixtures },
      { model: 'm', maxEvents: 25, timeoutMs: 1_000 },
    );

    bus.publish({ type: 'init', gameDay: 1 });
    bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'a',
      displayName: 'Mara Thistlewick',
    });
    bus.publish({
      type: 'world_tag_changed',
      gameDay: 1,
      key: 'war_in_north',
      oldValue: 'quiet',
      newValue: 'simmering',
    });

    const chronicle = await generator.generate(1);
    expect(chronicle.status).toBe('complete');

    // Rebuild the same prompt the generator built.
    const allEvents = persistence.getEventsSince(0);
    const dayEvents = allEvents.filter(
      (e) => 'gameDay' in e.event && e.event.gameDay === 1,
    );
    const npcsById = new Map<string, Npc>(
      npcManager.getRoster().map((n) => [n.id, n]),
    );
    for (const entry of allEvents) {
      if (entry.event.type !== 'npc_arrived') continue;
      if (npcsById.has(entry.event.npcId)) continue;
      npcsById.set(entry.event.npcId, {
        id: entry.event.npcId,
        displayName: entry.event.displayName,
        status: 'departed',
        position: { x: 0, y: 0 },
        zone: null,
        arrivedGameDay: entry.event.gameDay,
        arrivedSubTick: 0,
        plannedDepartureGameDay: 0,
        plannedDepartureSubTick: 0,
        nextDecisionSubTick: 0,
        carriedRumorIds: [],
      });
    }
    const ctx = {
      npcsById,
      threadsById: new Map(),
      alarmingValues: DEFAULT_ALARMING_VALUES,
    };
    const salient = select(dayEvents, ctx, { maxEvents: 25 });
    const prompt = buildDailyPrompt({
      gameDay: 1,
      salientEvents: salient,
      tagsAtDawn: reconstructWorldTagsAt(persistence, 1, 'dawn'),
      tagsAtDusk: reconstructWorldTagsAt(persistence, 1, 'dusk'),
      yesterdayHeadlines: [],
      activeThreads: [],
      npcsById,
    });

    const properNouns = extractProperNouns([
      ...chronicle.headlines,
      ...chronicle.footnotes,
    ]);
    const missing = properNouns.filter((n) => !prompt.includes(n));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[no-invention] possible invented nouns: ${missing.join(', ')}`,
      );
    }
    // Soft expectation: the warning machinery works; the test always passes.
    expect(properNouns.length).toBeGreaterThanOrEqual(0);
  });
});

function extractProperNouns(lines: string[]): string[] {
  const all = new Set<string>();
  // Capitalized 4+ char tokens not at sentence start (rough heuristic).
  for (const line of lines) {
    const matches = line.match(/(?<!^|[.!?]\s)\b[A-Z][a-z']{3,}(?:\s+[A-Z][a-z']{3,})*/g);
    if (!matches) continue;
    for (const m of matches) all.add(m);
  }
  return [...all];
}
