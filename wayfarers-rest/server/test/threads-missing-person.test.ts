import { describe, expect, it } from 'vitest';
import type { Thread, WorldState } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts'; // registers production archetypes
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function fakeWorld(gameDay: number): WorldState {
  return {
    gameDay,
    lastTickAt: new Date(NOW).toISOString(),
    status: 'running',
    unattendedTicks: 0,
    seed: 'missing-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 0,
    prosperity: 0,
    tavernName: "The Wayfarer\'s Rest",
    tavernTraits: [],
  };
}

function build() {
  const p = new Persistence(':memory:');
  const bus = new WorldEventBus(p, new FakeClock(NOW));
  const runner = new ThreadRunner(
    p,
    bus,
    new WorldTagsManager(p, bus),
    new RumorsManager(p, bus),
  );
  return { p, runner };
}

function runThrough(runner: ThreadRunner, from: number, to: number) {
  for (let d = from; d <= to; d += 1) {
    runner.runDay(d, fakeWorld(d), 'missing-seed');
  }
}

describe('missing_person archetype', () => {
  it('escalates, sends a searcher, and resolves the trail', () => {
    const { p, runner } = build();
    const thread = runner.startThread({
      type: 'missing_person',
      payload: { missingName: 'Iliana Brookfoot', lastSeenLocationId: 'hollow_wood' },
      gameDay: 1,
    });
    runThrough(runner, 2, 20);

    const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(final.status).toBe('completed');
    expect(['found_safe', 'found_ill', 'lost']).toContain(final.state);
    expect(final.history.map((h) => h.state)).toContain('searching');

    // A searcher was dispatched toward the tavern.
    const arrivals = p.loadUpcomingScheduledArrivals(0, 10_000);
    expect(arrivals.length).toBeGreaterThan(0);

    // Rumours spread, naming the missing traveller.
    const rumors = p.loadAllRumors();
    expect(rumors.some((r) => r.text.includes('Iliana Brookfoot'))).toBe(true);
  });

  it('same seed produces identical history', () => {
    const a = build();
    a.runner.startThread({
      type: 'missing_person',
      payload: { missingName: 'Iliana Brookfoot' },
      gameDay: 1,
    });
    runThrough(a.runner, 2, 20);

    const b = build();
    b.runner.startThread({
      type: 'missing_person',
      payload: { missingName: 'Iliana Brookfoot' },
      gameDay: 1,
    });
    runThrough(b.runner, 2, 20);

    const aThread = a.p
      .loadAllThreads()
      .find((t) => t.type === 'missing_person') as Thread;
    const bThread = b.p
      .loadAllThreads()
      .find((t) => t.type === 'missing_person') as Thread;
    expect(aThread.history).toEqual(bThread.history);
  });

  it('a traveller lost to misfortune becomes a missing person', () => {
    const { p, runner } = build();
    // swayBias -1 forces the journey's misfortune roll, deterministically.
    runner.startThread({
      type: 'travelers_journey',
      payload: {
        displayName: 'Iliana Brookfoot',
        destinationLocationId: 'hollow_wood',
        trip: 'outbound',
        swayBias: -1,
      },
      initialNextTickDelay: 3,
      gameDay: 5,
    });
    runThrough(runner, 6, 20);

    const journey = p
      .loadAllThreads()
      .find((t) => t.type === 'travelers_journey') as Thread;
    expect(journey.history.map((h) => h.state)).toContain('met_misfortune');

    const missing = p
      .loadAllThreads()
      .find((t) => t.type === 'missing_person') as Thread | undefined;
    expect(missing).toBeDefined();
    expect(missing!.payload).toMatchObject({ missingName: 'Iliana Brookfoot' });
  });
});
