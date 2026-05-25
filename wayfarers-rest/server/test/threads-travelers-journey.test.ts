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
    seed: 'tj-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 200,
    prosperity: 0,
    tavernName: "The Wayfarer\'s Rest",
    tavernTraits: [],
  };
}

function build(seed: string) {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const tags = new WorldTagsManager(p, bus);
  const rumors = new RumorsManager(p, bus);
  const runner = new ThreadRunner(p, bus, tags, rumors);
  // Force good road safety for predictability in the basic case.
  tags.set('road_safety_south', 'good', 1);
  const thread = runner.startThread({
    type: 'travelers_journey',
    payload: {
      displayName: 'Iliana Brookfoot',
      destinationLocationId: 'hollow_wood', // distanceDays 3
      trip: 'outbound',
    },
    initialNextTickDelay: 3,
    gameDay: 5,
  });
  return { p, runner, thread, seed: 'tj-seed' };
}

function runUntilDay(
  runner: ThreadRunner,
  startDay: number,
  endDay: number,
  seed: string,
) {
  for (let d = startDay; d <= endDay; d += 1) {
    runner.runDay(d, fakeWorld(d), seed);
  }
}

describe('travelers_journey archetype', () => {
  it('a journey starting day 5 with distanceDays 3 ticks on day 8', () => {
    const { p, runner, thread, seed } = build('seed-1');
    expect(thread.nextTickGameDay).toBe(8);
    runUntilDay(runner, 6, 7, seed);
    // Still pending.
    const stillActive = p
      .loadAllThreads()
      .find((t) => t.id === thread.id) as Thread;
    expect(stillActive.state).toBe('traveling');

    // Day 8: tick fires.
    runUntilDay(runner, 8, 8, seed);
    const afterTick = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(['arrived_safely', 'met_misfortune']).toContain(afterTick.state);
  });

  it('same seed produces identical history', () => {
    // Run twice with identical seeds & inputs; histories must match.
    const a = build('seed-deterministic');
    runUntilDay(a.runner, 6, 30, a.seed);
    const b = build('seed-deterministic');
    runUntilDay(b.runner, 6, 30, b.seed);

    const aThread = a.p.loadAllThreads().find((t) => t.id === a.thread.id) as Thread;
    const bThread = b.p.loadAllThreads().find((t) => t.id === b.thread.id) as Thread;
    expect(aThread.state).toBe(bThread.state);
    expect(aThread.history).toEqual(bThread.history);
  });

  it('a returning traveller is rescheduled under their original npcId', () => {
    // Phase 7: each journey that completes the return leg must reschedule the
    // arrival under the origin npcId — never a freshly-minted thread id — so
    // the same Character comes back.
    const originIds = ['npc_d1_0', 'npc_d1_4', 'npc_d2_3', 'npc_d3_7', 'npc_d4_2'];
    let returnsSeen = 0;

    for (const npcId of originIds) {
      const p = new Persistence(':memory:');
      const clock = new FakeClock(NOW);
      const bus = new WorldEventBus(p, clock);
      const tags = new WorldTagsManager(p, bus);
      const rumors = new RumorsManager(p, bus);
      const runner = new ThreadRunner(p, bus, tags, rumors);
      const thread = runner.startThread({
        type: 'travelers_journey',
        payload: {
          npcId,
          displayName: 'Iliana Brookfoot',
          destinationLocationId: 'hollow_wood',
          trip: 'outbound',
        },
        initialNextTickDelay: 3,
        gameDay: 5,
      });
      runUntilDay(runner, 6, 80, 'tj-seed');

      const arrivals = p.loadUpcomingScheduledArrivals(0, 10_000);
      // No return is ever scheduled under a minted thread arrival id.
      for (const a of arrivals) {
        expect(a.npcId.startsWith('npc_thread_')).toBe(false);
      }

      const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
      if (final.history.some((h) => h.state === 'returned_to_tavern')) {
        returnsSeen += 1;
        const mine = arrivals.find((a) => a.npcId === npcId);
        expect(mine).toBeDefined();
        expect(mine!.displayName).toBe('Iliana Brookfoot');
      }
    }

    // The return path must actually have been exercised by the sample.
    expect(returnsSeen).toBeGreaterThan(0);
  });
});
