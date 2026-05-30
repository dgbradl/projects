/**
 * Phase 9 (F4): escalate_scene + defuse_scene tests.
 *
 *  - StageRunner.applyKeeperAction enforces state preconditions
 *    (escalate before climax, defuse before aftermath)
 *  - escalate_scene jumps the scene to climax + emits progressed
 *  - defuse_scene jumps to aftermath, sets payload.defusedByKeeper,
 *    and the eventual resolve outcome is 'defused_by_keeper'
 *  - The intervention definitions validate state-precondition errors
 *    cleanly and call into the runner
 */
import { describe, expect, it } from 'vitest';
import type { EventLogEntry, WorldEvent } from '@shared/types';
import { buildDefuseScene } from '../src/interventions/kinds/defuse-scene.ts';
import { buildEscalateScene } from '../src/interventions/kinds/escalate-scene.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { StageRunner } from '../src/stage/runner.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SUBTICKS_PER_DAY = 360;

function setup() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'f4-seed');
  const bus = new WorldEventBus(persistence, clock);
  const stageRunner = new StageRunner({
    persistence,
    bus,
    worldSeed: 'f4-seed',
    subTicksPerDay: SUBTICKS_PER_DAY,
  });
  stageRunner.attach();
  // Seed one brawl directly so tests can act on it.
  const scene = stageRunner.startScene({
    type: 'brawl',
    zone: 'bar',
    participantNpcIds: ['a', 'b'],
    gameDay: 1,
    subTick: 10,
  });
  const events: WorldEvent[] = [];
  bus.on('world_event', (entry: EventLogEntry) => events.push(entry.event));
  return { persistence, bus, stateManager, stageRunner, scene, events };
}

const EMPTY_OPTIONS = {
  state: {} as never,
  targets: {} as never,
  availableRumors: [],
};

describe('applyKeeperAction', () => {
  it('escalate from building jumps to climax + emits progressed', () => {
    const h = setup();
    const result = h.stageRunner.applyKeeperAction(
      h.scene.id,
      'escalate',
      1,
      30,
    );
    expect(result).toEqual({ fromState: 'building', toState: 'climax' });
    expect(h.stageRunner.getLiveScenes()[0].state).toBe('climax');
    const progressed = h.events.find((e) => e.type === 'stage_event_progressed') as
      | (WorldEvent & { type: 'stage_event_progressed' })
      | undefined;
    expect(progressed).toBeDefined();
    expect(progressed!.toState).toBe('climax');
    h.persistence.close();
  });

  it('escalate refuses if already in aftermath/climax', () => {
    const h = setup();
    // Force the scene into climax then try to escalate.
    h.stageRunner.applyKeeperAction(h.scene.id, 'escalate', 1, 20);
    const result = h.stageRunner.applyKeeperAction(h.scene.id, 'escalate', 1, 21);
    expect(result).toBeUndefined();
    h.persistence.close();
  });

  it('defuse jumps to aftermath + payload.defusedByKeeper = true', () => {
    const h = setup();
    h.stageRunner.applyKeeperAction(h.scene.id, 'defuse', 1, 30);
    const scene = h.stageRunner.getLiveScenes()[0];
    expect(scene.state).toBe('aftermath');
    expect(scene.payload.defusedByKeeper).toBe(true);
    h.persistence.close();
  });

  it("defused scene resolves with outcome 'defused_by_keeper'", () => {
    const h = setup();
    h.stageRunner.applyKeeperAction(h.scene.id, 'defuse', 1, 30);
    // Walk forward through the aftermath dwell.
    for (let st = 30; st < 60; st += 1) {
      h.stageRunner.onSubTick(1, st, []);
    }
    const resolved = h.events.find((e) => e.type === 'stage_event_resolved') as
      | (WorldEvent & { type: 'stage_event_resolved' })
      | undefined;
    expect(resolved).toBeDefined();
    expect(resolved!.outcome).toBe('defused_by_keeper');
    h.persistence.close();
  });

  it('returns undefined for unknown scene id', () => {
    const h = setup();
    expect(
      h.stageRunner.applyKeeperAction('not-a-scene', 'escalate', 1, 30),
    ).toBeUndefined();
    h.persistence.close();
  });
});

describe('escalate_scene intervention', () => {
  it('validate accepts a valid scene', () => {
    const h = setup();
    const def = buildEscalateScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    const r = def.validate(
      { stageEventId: h.scene.id },
      h.stateManager.getState(),
      EMPTY_OPTIONS,
    );
    expect(r.ok).toBe(true);
    h.persistence.close();
  });

  it('validate rejects unknown id', () => {
    const h = setup();
    const def = buildEscalateScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    const r = def.validate(
      { stageEventId: 'nope' },
      h.stateManager.getState(),
      EMPTY_OPTIONS,
    );
    expect(r.ok).toBe(false);
    h.persistence.close();
  });

  it("validate rejects when scene is past its peak", () => {
    const h = setup();
    h.stageRunner.applyKeeperAction(h.scene.id, 'escalate', 1, 20);
    const def = buildEscalateScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    const r = def.validate(
      { stageEventId: h.scene.id },
      h.stateManager.getState(),
      EMPTY_OPTIONS,
    );
    expect(r.ok).toBe(false);
    h.persistence.close();
  });

  it('apply lands the action through the runner', () => {
    const h = setup();
    const def = buildEscalateScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    def.apply({
      payload: { stageEventId: h.scene.id },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: EMPTY_OPTIONS,
      gameDay: 1,
    });
    expect(h.stageRunner.getLiveScenes()[0].state).toBe('climax');
    h.persistence.close();
  });

  it('costs 2 favors', () => {
    const h = setup();
    const def = buildEscalateScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    expect(def.cost).toBe(2);
    h.persistence.close();
  });
});

describe('defuse_scene intervention', () => {
  it('apply lands the action + sets defused flag', () => {
    const h = setup();
    const def = buildDefuseScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    def.apply({
      payload: { stageEventId: h.scene.id },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: EMPTY_OPTIONS,
      gameDay: 1,
    });
    const scene = h.stageRunner.getLiveScenes()[0];
    expect(scene.state).toBe('aftermath');
    expect(scene.payload.defusedByKeeper).toBe(true);
    h.persistence.close();
  });

  it('validate rejects a scene already in aftermath', () => {
    const h = setup();
    h.stageRunner.applyKeeperAction(h.scene.id, 'defuse', 1, 10);
    const def = buildDefuseScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    const r = def.validate(
      { stageEventId: h.scene.id },
      h.stateManager.getState(),
      EMPTY_OPTIONS,
    );
    expect(r.ok).toBe(false);
    h.persistence.close();
  });

  it('costs 3 favors', () => {
    const h = setup();
    const def = buildDefuseScene({
      stateManager: h.stateManager,
      stageRunner: h.stageRunner,
    });
    expect(def.cost).toBe(3);
    h.persistence.close();
  });
});
