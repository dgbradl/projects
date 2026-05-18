import { describe, expect, it } from 'vitest';
import type { EventLogEntry, WorldEvent } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
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
import { seedPhase3World } from '../src/world/world-init.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const SUB_TICKS_PER_DAY = 30;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const SEED = 'determinism-seed';

function bootWorld() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(persistence, clock, () => SEED);
  const bus = new WorldEventBus(persistence, clock);
  const tags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const runner = new ThreadRunner(persistence, bus, tags, rumors);
  const resolver = new InteractionResolver(bus, runner);

  const npcManager = new NpcManager(
    { worldSeed: SEED, subTicksPerDay: SUB_TICKS_PER_DAY },
    {
      persistence,
      bus,
      rumors,
      threadRunner: runner,
    },
  );
  const interactionCounter = { value: 0 };
  (npcManager as unknown as {
    deps: { postSubTickHook?: typeof postSubTickHook };
  }).deps.postSubTickHook = postSubTickHook;
  function postSubTickHook(gameDay: number, subTick: number, roster: import('@shared/types').Npc[]) {
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
  npcManager.on('diff', () => persistence.saveRoster(npcManager.snapshot()));

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

  return { persistence, clock, ticks, subTicks };
}

function stripTimestamps(events: EventLogEntry[]): WorldEvent[] {
  return events.map((e) => e.event);
}

describe('Event-log determinism', () => {
  it('two boots with the same seed produce identical event sequences over 5 game days', () => {
    const runOnce = () => {
      const { persistence, ticks, subTicks } = bootWorld();
      // Advance ~5 game days of sub-ticks.
      for (let i = 0; i < SUB_TICKS_PER_DAY * 5; i += 1) {
        subTicks.advance(SUBTICK_MS);
      }
      // The macro tick fires when wall-clock crosses TICK_INTERVAL; subTicks
      // have already advanced the clock. Run catch-up:
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
