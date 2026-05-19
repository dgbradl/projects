import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { BECKON } from '../src/interventions/kinds/beckon.ts';
import { buildInterventionHelpers } from '../src/interventions/helpers.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import '../src/threads/archetypes/index.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'beckon-seed');
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  const helpers = buildInterventionHelpers({
    rumors,
    threadRunner,
    worldTags,
    bus,
    gameDay: 1,
  });
  return { persistence, stateManager, bus, threadRunner, helpers };
}

describe('beckon intervention', () => {
  it('apply spawns an approaching_stranger thread with archetype + delay', () => {
    const h = build();
    const effect = BECKON.apply({
      payload: { archetype: 'merchant', preferredDayOffset: 2 },
      helpers: h.helpers,
      state: h.stateManager.getState(),
      options: {
        state: h.stateManager.getState(),
        targets: {} as never,
        availableRumors: [],
      },
      gameDay: 1,
    });
    expect(effect.spawnedThreadId).toBeTruthy();
    const threads = h.persistence.loadAllThreads();
    const beckonThread = threads.find((t) => t.id === effect.spawnedThreadId)!;
    expect(beckonThread.type).toBe('approaching_stranger');
    expect((beckonThread.payload as Record<string, unknown>).archetype).toBe('merchant');
    expect((beckonThread.payload as Record<string, unknown>).wasBeckoned).toBe(true);
    expect(beckonThread.nextTickGameDay).toBe(1 + 2); // day + offset
  });

  it('the resulting scheduled_arrivals row carries wasBeckoned through to the spawn queue', () => {
    const h = build();
    BECKON.apply({
      payload: { archetype: 'soldier', preferredDayOffset: 1 },
      helpers: h.helpers,
      state: h.stateManager.getState(),
      options: {
        state: h.stateManager.getState(),
        targets: {} as never,
        availableRumors: [],
      },
      gameDay: 1,
    });
    // Tick the beckon thread on day 2 → it schedules an arrival.
    h.threadRunner.runDay(2, { ...h.stateManager.getState(), gameDay: 2 }, 'beckon-seed');
    const arrivals = h.persistence.loadScheduledArrivalsForDay(2);
    expect(arrivals.length).toBe(1);
    expect(arrivals[0].wasBeckoned).toBe(true);
    expect(arrivals[0].archetype).toBe('soldier');
  });

  it('validate rejects unknown archetype', () => {
    const h = build();
    const r = BECKON.validate(
      // @ts-expect-error intentionally bad payload
      { archetype: 'nobody' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r.ok).toBe(false);
  });

  it('validate rejects invalid day offset', () => {
    const h = build();
    const r = BECKON.validate(
      // @ts-expect-error intentionally bad payload
      { archetype: 'merchant', preferredDayOffset: 7 },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r.ok).toBe(false);
  });
});
