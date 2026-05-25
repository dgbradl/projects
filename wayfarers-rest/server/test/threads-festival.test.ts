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
    seed: 'festival-seed',
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

function runThrough(runner: ThreadRunner, lastDay: number) {
  for (let d = 2; d <= lastDay; d += 1) {
    runner.runDay(d, fakeWorld(d), 'festival-seed');
  }
}

describe('festival archetype', () => {
  it('runs its arc and drives the festival world tag', () => {
    const { p, runner } = build();
    const thread = runner.startThread({
      type: 'festival',
      initialNextTickDelay: 3,
      gameDay: 1,
    });
    runThrough(runner, 18);

    const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(final.status).toBe('completed');
    const states = final.history.map((h) => h.state);
    expect(states).toContain('imminent');
    expect(states).toContain('underway');
    expect(states).toContain('concluded');

    // The tag ends 'past' once the festival has wound down.
    expect(p.getWorldTag('festival')?.value).toBe('past');

    // Each beat spread a rumour about the festival.
    expect(p.loadAllRumors().some((r) => r.text.includes('festival'))).toBe(true);
  });

  it('schedules the next festival when it concludes', () => {
    const { p, runner } = build();
    runner.startThread({ type: 'festival', initialNextTickDelay: 3, gameDay: 1 });
    runThrough(runner, 18);

    // The original has completed; a fresh festival is queued for later.
    const festivals = p.loadAllThreads().filter((t) => t.type === 'festival');
    expect(festivals).toHaveLength(2);
    expect(festivals.some((t) => t.status === 'completed')).toBe(true);
    expect(festivals.some((t) => t.status === 'active')).toBe(true);
  });
});
