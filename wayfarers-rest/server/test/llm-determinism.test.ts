import { describe, expect, it } from 'vitest';
import type { EventLogEntry, Npc, WorldEvent } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FlavorCache } from '../src/llm/cache/manager.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { registerAllPools } from '../src/llm/registry.ts';
import { detectInteractions } from '../src/interactions/detector.ts';
import { InteractionResolver } from '../src/interactions/resolver.ts';
import { FakeClock } from '../src/lib/clock.ts';
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

const SUB_TICKS_PER_DAY = 30;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const SEED = 'phase4-determinism-seed';

function boot() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(persistence, clock, () => SEED);
  const bus = new WorldEventBus(persistence, clock);
  const tags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const runner = new ThreadRunner(persistence, bus, tags, rumors);
  const mode = new FlavorModeManager({
    initialMode: 'placeholder',
    client: null,
    bus,
    healthCheckIntervalMs: 60_000,
    getGameDay: () => stateManager.getState().gameDay,
  });
  const flavorCache = new FlavorCache(persistence, bus, mode);
  registerAllPools({ cache: flavorCache, mode, client: null, fixtures: null, worldSeed: SEED });
  rumors.setFlavorCache(flavorCache);
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
  seedPhase3World({ worldSeed: SEED, gameDay: 1, worldTags: tags, threadRunner: runner });
  npcManager.onMacroTick(1);

  return { persistence, clock, ticks, subTicks };
}

function stripTimestamps(events: EventLogEntry[]): WorldEvent[] {
  return events.map((e) => e.event);
}

describe('Phase 4 determinism in placeholder mode', () => {
  it('two boots with identical seed produce identical event sequences across 5 game days', () => {
    const runOnce = () => {
      const { persistence, ticks, subTicks } = boot();
      for (let i = 0; i < SUB_TICKS_PER_DAY * 5; i += 1) {
        subTicks.advance(SUBTICK_MS);
      }
      ticks.runCatchUp();
      const events = stripTimestamps(persistence.getEventsSince(0));
      persistence.close();
      return events;
    };

    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
