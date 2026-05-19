import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { buildSwayThread } from '../src/interventions/kinds/sway-thread.ts';
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
  const stateManager = new WorldStateManager(persistence, clock, () => 'sway-seed');
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  const sway = buildSwayThread({ persistence });
  return { persistence, stateManager, bus, threadRunner, sway };
}

describe('sway_thread intervention', () => {
  it('apply sets payload.swayBias on the named thread', () => {
    const h = build();
    const thread = h.threadRunner.startThread({
      type: 'travelers_journey',
      payload: {
        displayName: 'Wren',
        destinationLocationId: 'oldspire',
        trip: 'outbound',
      },
      gameDay: 1,
    });
    const effect = h.sway.apply({
      payload: { threadId: thread.id, direction: 'bless' },
      helpers: buildInterventionHelpers({
        rumors: {} as never,
        threadRunner: h.threadRunner,
        worldTags: {} as never,
        bus: h.bus,
        gameDay: 1,
      }),
      state: h.stateManager.getState(),
      options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.swayedThreadId).toBe(thread.id);
    const updated = h.persistence.loadAllThreads().find((t) => t.id === thread.id)!;
    expect((updated.payload as Record<string, unknown>).swayBias).toBe(0.3);
  });

  it('blessed travelers_journey threads suffer less misfortune than cursed ones (statistical)', () => {
    const trials = 200;
    let blessedMisfortune = 0;
    let cursedMisfortune = 0;
    for (let i = 0; i < trials; i += 1) {
      const h = build();
      const blessed = h.threadRunner.startThread({
        type: 'travelers_journey',
        payload: {
          displayName: `B${i}`,
          destinationLocationId: 'oldspire',
          trip: 'outbound',
        },
        gameDay: 1,
      });
      const cursed = h.threadRunner.startThread({
        type: 'travelers_journey',
        payload: {
          displayName: `C${i}`,
          destinationLocationId: 'oldspire',
          trip: 'outbound',
        },
        gameDay: 1,
      });
      h.sway.apply({
        payload: { threadId: blessed.id, direction: 'bless' },
        helpers: buildInterventionHelpers({
          rumors: {} as never,
          threadRunner: h.threadRunner,
          worldTags: {} as never,
          bus: h.bus,
          gameDay: 1,
        }),
        state: h.stateManager.getState(),
        options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
        gameDay: 1,
      });
      h.sway.apply({
        payload: { threadId: cursed.id, direction: 'curse' },
        helpers: buildInterventionHelpers({
          rumors: {} as never,
          threadRunner: h.threadRunner,
          worldTags: {} as never,
          bus: h.bus,
          gameDay: 1,
        }),
        state: h.stateManager.getState(),
        options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
        gameDay: 1,
      });
      // Use a poor-road-safety modifier to amplify misfortune chance and make the
      // bias signal show up more clearly within the trial budget.
      const thb = h.persistence.loadAllThreads().find((t) => t.id === blessed.id)!;
      const thc = h.persistence.loadAllThreads().find((t) => t.id === cursed.id)!;
      h.persistence.saveThread({
        ...thb,
        payload: { ...thb.payload, __roadSafety: 'poor' },
      });
      h.persistence.saveThread({
        ...thc,
        payload: { ...thc.payload, __roadSafety: 'poor' },
      });
      // Step the trip-day ahead and run each thread; capture outcome.
      h.threadRunner.runDay(
        blessed.nextTickGameDay,
        { ...h.stateManager.getState(), gameDay: blessed.nextTickGameDay },
        `sway-seed-${i}`,
      );
      const afterB = h.persistence.loadAllThreads().find((t) => t.id === blessed.id)!;
      const afterC = h.persistence.loadAllThreads().find((t) => t.id === cursed.id)!;
      if (afterB.state === 'met_misfortune') blessedMisfortune += 1;
      if (afterC.state === 'met_misfortune') cursedMisfortune += 1;
    }
    expect(cursedMisfortune).toBeGreaterThan(blessedMisfortune);
  });

  it('validate rejects double-sway', () => {
    const h = build();
    const t = h.threadRunner.startThread({
      type: 'travelers_journey',
      payload: {
        displayName: 'W',
        destinationLocationId: 'oldspire',
        trip: 'outbound',
      },
      gameDay: 1,
    });
    h.sway.apply({
      payload: { threadId: t.id, direction: 'bless' },
      helpers: buildInterventionHelpers({
        rumors: {} as never,
        threadRunner: h.threadRunner,
        worldTags: {} as never,
        bus: h.bus,
        gameDay: 1,
      }),
      state: h.stateManager.getState(),
      options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    const r = h.sway.validate(
      { threadId: t.id, direction: 'curse' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r.ok).toBe(false);
  });
});
