import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { buildStirWorld } from '../src/interventions/kinds/stir-world.ts';
import { buildInterventionHelpers } from '../src/interventions/helpers.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'stir-seed');
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  const stir = buildStirWorld({ persistence });
  worldTags.set('war_in_north', 'quiet', 1);
  return { persistence, stateManager, bus, worldTags, threadRunner, stir };
}

describe('stir_world intervention', () => {
  it('apply changes the tag and emits world_tag_changed', () => {
    const h = build();
    const helpers = buildInterventionHelpers({
      rumors: {} as never,
      threadRunner: h.threadRunner,
      worldTags: h.worldTags,
      bus: h.bus,
      gameDay: 1,
    });
    const effect = h.stir.apply({
      payload: { tagKey: 'war_in_north', newValue: 'escalating' },
      helpers,
      state: h.stateManager.getState(),
      options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.changedTag).toEqual({
      key: 'war_in_north',
      oldValue: 'quiet',
      newValue: 'escalating',
    });
    expect(h.worldTags.get('war_in_north')?.value).toBe('escalating');
    expect(
      h.persistence.getEventsSince(0).some((e) => e.event.type === 'world_tag_changed'),
    ).toBe(true);
  });

  it('validate rejects unknown tags and non-whitelisted values', () => {
    const h = build();
    const r1 = h.stir.validate(
      { tagKey: 'made_up', newValue: 'x' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r1.ok).toBe(false);
    const r2 = h.stir.validate(
      { tagKey: 'season', newValue: 'monsoon' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r2.ok).toBe(false);
  });

  it('validate rejects no-op (newValue === currentValue)', () => {
    const h = build();
    const r = h.stir.validate(
      { tagKey: 'war_in_north', newValue: 'quiet' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r.ok).toBe(false);
  });
});
