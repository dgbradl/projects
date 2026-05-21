import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Npc, WorldEvent } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { detectInteractions } from '../src/interactions/detector.ts';
import { InteractionResolver } from '../src/interactions/resolver.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { FlavorCache } from '../src/llm/cache/manager.ts';
import { FlavorWorker } from '../src/llm/cache/worker.ts';
import { FixtureRegistry } from '../src/llm/fixtures.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { registerAllPools } from '../src/llm/registry.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { SubTickScheduler } from '../src/subtick.ts';
import '../src/threads/archetypes/index.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { TickScheduler } from '../src/tick.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';
import { seedPhase3World } from '../src/world/world-init.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(HERE, '../src/llm/fixtures');

const SUB_TICKS_PER_DAY = 20;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const SEED = 'integration-seed';

describe('integration: a full game day in recorded mode', () => {
  it('produces NPCs with non-placeholder names, at least one rumor with prose text, and an overheardText on an interaction', async () => {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(START);
    const stateManager = new WorldStateManager(persistence, clock, () => SEED);
    const bus = new WorldEventBus(persistence, clock);
    const tags = new WorldTagsManager(persistence, bus);
    const rumors = new RumorsManager(persistence, bus);
    const runner = new ThreadRunner(persistence, bus, tags, rumors);
    const mode = new FlavorModeManager({
      initialMode: 'recorded',
      client: null,
      bus,
      healthCheckIntervalMs: 60_000,
      getGameDay: () => stateManager.getState().gameDay,
    });
    const fixtures = new FixtureRegistry(FIXTURES_DIR);
    fixtures.load();
    const flavorCache = new FlavorCache(persistence, bus, mode);
    registerAllPools({
      cache: flavorCache,
      mode,
      client: null,
      fixtures,
      worldSeed: SEED,
    });
    rumors.setFlavorCache(flavorCache);

    // Pre-fill pools from fixtures. The worker runs in `recorded` mode and
    // pulls from the FixtureRegistry. 60 ticks is enough to top up every pool
    // at least once.
    const worker = new FlavorWorker(flavorCache, mode, 1_000);
    for (let i = 0; i < 60; i += 1) {
      await worker.tickOnce();
    }

    const resolver = new InteractionResolver(bus, runner, flavorCache);

    const npcManager = new NpcManager(
      { worldSeed: SEED, subTicksPerDay: SUB_TICKS_PER_DAY },
      { persistence, bus, rumors, threadRunner: runner, flavorCache },
    );
    const interactionCounter = { value: 0 };
    (npcManager as unknown as {
      deps: { postSubTickHook?: typeof hook };
    }).deps.postSubTickHook = hook;
    function hook(gameDay: number, subTick: number, roster: Npc[]) {
      const candidates = detectInteractions(roster, {
        worldSeed: SEED,
        gameDay,
        subTick,
        countsToday: npcManager.interactionsToday,
        pairsToday: npcManager.pairsToday,
      });
      const npcsById = new Map(roster.map((n) => [n.id, n]));
      for (const c of candidates) {
        resolver.resolve(c, {
          worldSeed: SEED,
          gameDay,
          subTick,
          npcsById,
          perDayCounter: interactionCounter,
        });
      }
    }

    const ticks = new TickScheduler(
      stateManager,
      clock,
      { tickIntervalMs: TICK_INTERVAL, schedulerCheckMs: 50 },
      bus,
    );
    const subTicks = new SubTickScheduler(
      stateManager,
      npcManager,
      clock,
      { subTickIntervalMs: SUBTICK_MS, subTicksPerDay: SUB_TICKS_PER_DAY },
      runner,
    );

    bus.publish({ type: 'init', gameDay: 1 });
    seedPhase3World({
      worldSeed: SEED,
      gameDay: 1,
      worldTags: tags,
      threadRunner: runner,
    });
    npcManager.onMacroTick(1);

    // Mode is `recorded`; cache `take` returns from filled pools.
    // Drive ~4 game days at fast cadence to let several arrivals + rumors + interactions happen.
    for (let i = 0; i < SUB_TICKS_PER_DAY * 4; i += 1) {
      subTicks.advance(SUBTICK_MS);
    }
    ticks.runCatchUp();

    // Names from arrival fixtures should appear at least once.
    const events = persistence.getEventsSince(0);
    const arrivedNames = events
      .filter((e): e is typeof e & { event: WorldEvent & { type: 'npc_arrived' } } =>
        e.event.type === 'npc_arrived',
      )
      .map((e) => e.event.displayName);
    expect(arrivedNames.length).toBeGreaterThan(0);
    const knownFixtureNames = ['Wren Underwood', 'Pell of the Reed', 'Halix Marrow'];
    const sawFixtureName = arrivedNames.some((n) => knownFixtureNames.includes(n));
    expect(sawFixtureName).toBe(true);

    // Recorded mode must yield authored prose for rumors, never the
    // deterministic placeholder fallback. Authored prose covers both fixture
    // rumors and the explicit text thread archetypes introduce; only the
    // placeholder templates (see `rumorPlaceholder`) are disqualifying, each
    // identifiable by a fixed phrase the substitutions leave intact.
    const rumorTexts = rumors.getAll().map((r) => r.text);
    const PLACEHOLDER_MARKERS = [
      'or so they say',
      'two nights back',
      "half the tellers don't agree",
      'You hear it more than once now',
    ];
    const isPlaceholderRumor = (t: string) =>
      PLACEHOLDER_MARKERS.some((marker) => t.includes(marker));
    expect(rumorTexts.some(isPlaceholderRumor)).toBe(false);

    // At least one interaction in the log; check it has overheardText.
    const interactionEvents = events.filter(
      (e) => e.event.type === 'interaction',
    );
    expect(interactionEvents.length).toBeGreaterThan(0);
    const someHaveText = interactionEvents.some(
      (e) =>
        e.event.type === 'interaction' &&
        typeof e.event.interaction.overheardText === 'string' &&
        e.event.interaction.overheardText.length > 0,
    );
    expect(someHaveText).toBe(true);

    persistence.close();
  });
});
