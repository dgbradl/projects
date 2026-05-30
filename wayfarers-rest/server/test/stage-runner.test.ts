/**
 * Phase 9 (F1): stage runner + brawl tests.
 *
 *  - Brawl trigger fires on overheard_argument (probabilistic; pin via
 *    scenarioRng override so tests are deterministic)
 *  - State machine advances building → underway → climax → aftermath →
 *    resolved on schedule; each transition emits the right WorldEvent
 *  - Daily cap caps brawl count per game day
 *  - At-most-one live brawl gate prevents stacking
 *  - Resolved scenes are deleted from persistence (table reflects live only)
 *  - Persistence load on attach picks up an in-progress scene
 */
import { describe, expect, it } from 'vitest';
import type {
  EventLogEntry,
  Interaction,
  StageEvent,
  WorldEvent,
} from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { StageRunner } from '../src/stage/runner.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SUBTICKS_PER_DAY = 360;

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: 'int-1',
    gameDay: 1,
    subTick: 10,
    zone: 'bar',
    participantIds: ['a', 'b'],
    kind: 'overheard_argument',
    ...overrides,
  };
}

function setup(opts: { rngHit?: boolean } = {}) {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(persistence, clock);
  // scenarioRng override: returns 0 (always under any probability) when
  // rngHit is true; returns 0.99 (always over) otherwise.
  const scenarioRng = opts.rngHit !== undefined
    ? () => (opts.rngHit ? 0 : 0.99)
    : undefined;
  const runner = new StageRunner({
    persistence,
    bus,
    worldSeed: 'f1-seed',
    subTicksPerDay: SUBTICKS_PER_DAY,
    scenarioRng,
  });
  runner.attach();
  const events: WorldEvent[] = [];
  bus.on('world_event', (entry: EventLogEntry) => events.push(entry.event));
  return { persistence, bus, runner, events };
}

describe('StageRunner — brawl trigger', () => {
  it('does NOT fire when the probability roll misses', () => {
    const h = setup({ rngHit: false });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction(),
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    expect(h.events.some((e) => e.type === 'stage_event_started')).toBe(false);
    h.persistence.close();
  });

  it('fires on overheard_argument when the roll hits', () => {
    const h = setup({ rngHit: true });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction(),
    });
    expect(h.runner.getLiveScenes()).toHaveLength(1);
    const started = h.events.find((e) => e.type === 'stage_event_started');
    expect(started).toBeDefined();
    const ev = started as WorldEvent & { type: 'stage_event_started' };
    expect(ev.stageEventType).toBe('brawl');
    expect(ev.zone).toBe('bar');
    expect(ev.participantNpcIds).toEqual(['a', 'b']);
    h.persistence.close();
  });

  it('does NOT fire for non-argument interactions even on a hit', () => {
    const h = setup({ rngHit: true });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ kind: 'shared_drink' }),
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('refuses a second brawl while one is live', () => {
    const h = setup({ rngHit: true });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ id: 'int-1' }),
    });
    expect(h.runner.getLiveScenes()).toHaveLength(1);
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ id: 'int-2', subTick: 20 }),
    });
    expect(h.runner.getLiveScenes()).toHaveLength(1);
    h.persistence.close();
  });

  it('honours the daily brawl cap', () => {
    const h = setup({ rngHit: true });
    // Spawn two and let them resolve so the in-flight gate releases.
    for (let i = 0; i < 2; i += 1) {
      h.bus.publish({
        type: 'interaction',
        gameDay: 1,
        interaction: makeInteraction({ id: `int-${i}`, subTick: i * 100 }),
      });
      // Run all the way through (13 sub-ticks max).
      for (let st = 0; st < 360; st += 1) {
        h.runner.onSubTick(1, st, []);
      }
    }
    // Third attempt — cap reached, should refuse.
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ id: 'int-cap', subTick: 250 }),
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });
});

describe('StageRunner — brawl state machine', () => {
  it('progresses building → underway → climax → aftermath → resolved on schedule', () => {
    const h = setup({ rngHit: true });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ subTick: 0 }),
    });
    const initial = h.runner.getLiveScenes()[0];
    expect(initial.state).toBe('building');

    // Walk sub-ticks forward; the runner's onSubTick should advance
    // the scene as its nextTransitionAbsSubTick is reached.
    const transitions: string[] = [];
    for (let st = 0; st < 30; st += 1) {
      h.runner.onSubTick(1, st, []);
    }
    for (const ev of h.events) {
      if (ev.type === 'stage_event_progressed') {
        transitions.push(`${ev.fromState}→${ev.toState}`);
      }
    }
    expect(transitions).toEqual([
      'building→underway',
      'underway→climax',
      'climax→aftermath',
    ]);
    // After aftermath the scene resolves — emitted as resolved, not progressed.
    expect(h.events.some((e) => e.type === 'stage_event_resolved')).toBe(true);
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('emits stage_event_resolved with outcome: burned_out on natural end', () => {
    const h = setup({ rngHit: true });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ subTick: 0 }),
    });
    for (let st = 0; st < 30; st += 1) {
      h.runner.onSubTick(1, st, []);
    }
    const resolved = h.events.find((e) => e.type === 'stage_event_resolved') as
      | (WorldEvent & { type: 'stage_event_resolved' })
      | undefined;
    expect(resolved).toBeDefined();
    expect(resolved!.outcome).toBe('burned_out');
    h.persistence.close();
  });
});

describe('StageRunner — persistence', () => {
  it('removes the row when a scene resolves', () => {
    const h = setup({ rngHit: true });
    h.bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: makeInteraction({ subTick: 0 }),
    });
    expect(h.persistence.loadActiveStageEvents()).toHaveLength(1);
    for (let st = 0; st < 30; st += 1) {
      h.runner.onSubTick(1, st, []);
    }
    expect(h.persistence.loadActiveStageEvents()).toHaveLength(0);
    h.persistence.close();
  });

  it('round-trips an in-progress scene on attach', () => {
    // Hand-craft a row in the DB; build a fresh runner; attach should load it.
    const persistence = new Persistence(':memory:');
    const seedScene: StageEvent = {
      id: 'scene-x',
      type: 'brawl',
      state: 'underway',
      zone: 'bar',
      startedGameDay: 2,
      startedSubTick: 5,
      nextTransitionAbsSubTick: 9999,
      participantNpcIds: ['a', 'b', 'c'],
      payload: { triggerInteractionId: 'int-x' },
    };
    persistence.upsertStageEvent(seedScene);

    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const runner = new StageRunner({
      persistence,
      bus,
      worldSeed: 'h',
      subTicksPerDay: SUBTICKS_PER_DAY,
    });
    runner.attach();

    const live = runner.getLiveScenes();
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe('scene-x');
    expect(live[0].state).toBe('underway');
    expect(live[0].participantNpcIds).toEqual(['a', 'b', 'c']);
    persistence.close();
  });
});

describe('startScene — direct spawn (used by future verbs/scenarios)', () => {
  it('persists, indexes, and emits stage_event_started', () => {
    const h = setup();
    const scene = h.runner.startScene({
      type: 'brawl',
      zone: 'hearth',
      participantNpcIds: ['x', 'y'],
      gameDay: 3,
      subTick: 50,
    });
    expect(scene.state).toBe('building');
    expect(scene.zone).toBe('hearth');
    expect(h.runner.getLiveScenes()).toHaveLength(1);
    expect(h.persistence.loadActiveStageEvents()).toHaveLength(1);
    expect(h.events.some((e) => e.type === 'stage_event_started')).toBe(true);
    h.persistence.close();
  });
});
