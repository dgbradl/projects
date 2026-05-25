import { afterEach, describe, expect, it } from 'vitest';
import type { WorldState } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { clearRegistry, registerThread } from '../src/threads/registry.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

const FAKE_WORLD: WorldState = {
  gameDay: 1,
  lastTickAt: '2026-01-01T00:00:00.000Z',
  status: 'running',
  unattendedTicks: 0,
  seed: 'test-seed',
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

function build() {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const tags = new WorldTagsManager(p, bus);
  const rumors = new RumorsManager(p, bus);
  const runner = new ThreadRunner(p, bus, tags, rumors);
  return { p, bus, tags, rumors, runner };
}

afterEach(() => {
  // Restore production archetypes for other test files.
  clearRegistry();
});

describe('ThreadRunner', () => {
  it('ticks a thread at its scheduled day and applies all helper side-effects', () => {
    const { p, runner, tags, rumors } = build();
    let tickCount = 0;
    registerThread({
      type: 'fake',
      initialState: 's0',
      initialNextTickDelay: 1,
      tick({ helpers }) {
        tickCount += 1;
        helpers.scheduleArrival({
          onGameDay: 5,
          displayName: 'A Stranger',
          originLocationId: 'oldspire',
        });
        helpers.setWorldTag('weather', 'storm');
        helpers.introduceRumor({
          text: 'Said in passing',
          originLocationId: 'oldspire',
        });
        return {
          nextState: 's1',
          nextTickDelay: 0,
          completes: { outcome: 'done' },
          note: 'finished',
        };
      },
    });

    runner.startThread({ type: 'fake', gameDay: 1 });
    // Not due yet at day 1 (delay 1 → next at day 2).
    runner.runDay(1, FAKE_WORLD, FAKE_WORLD.seed);
    expect(tickCount).toBe(0);

    runner.runDay(2, FAKE_WORLD, FAKE_WORLD.seed);
    expect(tickCount).toBe(1);

    const events = p.getEventsSince(0);
    expect(events.some((e) => e.event.type === 'thread_started')).toBe(true);
    expect(events.some((e) => e.event.type === 'thread_progressed')).toBe(true);
    expect(events.some((e) => e.event.type === 'thread_completed')).toBe(true);
    expect(events.some((e) => e.event.type === 'world_tag_changed')).toBe(true);
    expect(events.some((e) => e.event.type === 'rumor_introduced')).toBe(true);

    expect(tags.get('weather')?.value).toBe('storm');
    expect(rumors.getAvailable().length).toBe(1);
    expect(p.loadScheduledArrivalsForDay(5).length).toBe(1);
  });

  it('does not re-tick the same thread within one runDay invocation', () => {
    const { runner } = build();
    let calls = 0;
    registerThread({
      type: 'fake',
      initialState: 's0',
      initialNextTickDelay: 1,
      tick() {
        calls += 1;
        return { nextState: 's0', nextTickDelay: 1 };
      },
    });
    runner.startThread({ type: 'fake', gameDay: 1 });
    runner.runDay(2, FAKE_WORLD, FAKE_WORLD.seed);
    runner.runDay(2, FAKE_WORLD, FAKE_WORLD.seed); // same day called twice
    expect(calls).toBe(1);
  });

  it('helper-spawned threads start in the active table and emit thread_started', () => {
    const { p, runner } = build();
    registerThread({
      type: 'spawner',
      initialState: 's0',
      initialNextTickDelay: 1,
      tick({ helpers }) {
        helpers.spawnThread({ type: 'child', payload: { x: 1 } });
        return { nextState: 'done', nextTickDelay: 0, completes: { outcome: 'spawned' } };
      },
    });
    registerThread({
      type: 'child',
      initialState: 'idle',
      initialNextTickDelay: 5,
      tick() {
        return { nextState: 'idle', nextTickDelay: 5 };
      },
    });

    runner.startThread({ type: 'spawner', gameDay: 1 });
    runner.runDay(2, FAKE_WORLD, FAKE_WORLD.seed);

    const allThreads = p.loadAllThreads();
    expect(allThreads.find((t) => t.type === 'child')).toBeDefined();
    const started = p.getEventsSince(0).filter((e) => e.event.type === 'thread_started');
    expect(started.length).toBe(2);
  });
});
