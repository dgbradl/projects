import { describe, expect, it } from 'vitest';
import type { ScheduledArrival } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { PLANT_RUMOR } from '../src/interventions/kinds/plant-rumor.ts';
import { buildInterventionHelpers } from '../src/interventions/helpers.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { seededRng } from '../src/world/rng.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'plant-seed');
  const bus = new WorldEventBus(persistence, clock);
  const worldTags = new WorldTagsManager(persistence, bus);
  const rumors = new RumorsManager(persistence, bus);
  const threadRunner = new ThreadRunner(persistence, bus, worldTags, rumors);
  rumors.setFlavorCache(null);
  const helpers = buildInterventionHelpers({
    rumors,
    threadRunner,
    worldTags,
    bus,
    gameDay: 1,
  });
  return { persistence, stateManager, bus, rumors, helpers };
}

describe('plant_rumor intervention', () => {
  it('validate rejects unknown locationId', () => {
    const h = build();
    const r = PLANT_RUMOR.validate(
      { locationId: 'nowhere' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r.ok).toBe(false);
  });

  it('apply persists a rumor; markPlayerOrigin gives it 2× carry-weight for 3 days', () => {
    const h = build();
    const effect = PLANT_RUMOR.apply({
      payload: { locationId: 'oldspire', tone: 'foreboding' },
      helpers: h.helpers,
      state: h.stateManager.getState(),
      options: {
        state: h.stateManager.getState(),
        targets: {} as never,
        availableRumors: [],
      },
      gameDay: 1,
    });
    expect(effect.introducedRumorId).toBeTruthy();
    // Mark as player origin (route handler does this after apply).
    h.rumors.markPlayerOrigin(effect.introducedRumorId!, 'foreboding');

    const rumor = h.rumors.getAll().find((r) => r.id === effect.introducedRumorId)!;
    expect(rumor.playerOrigin).toBe(true);
    expect(rumor.tone).toBe('foreboding');

    // Compute attachment probability with vs without boost.
    const arrival: ScheduledArrival = {
      npcId: 'a',
      displayName: 'x',
      scheduledGameDay: 2,
      scheduledSubTick: 0,
      originLocationId: 'iron_quay', // distanceDays = 9
    };
    let withBoost = 0;
    let withoutBoost = 0;
    for (let i = 0; i < 300; i += 1) {
      const withinWindow = h.rumors.rollAttachmentsForArrival(
        arrival,
        seededRng('boost', String(i)),
        2, // within 3-day window
      );
      const outsideWindow = h.rumors.rollAttachmentsForArrival(
        arrival,
        seededRng('boost', String(i)),
        10, // far past 3-day window
      );
      if (withinWindow.length > 0) withBoost += 1;
      if (outsideWindow.length > 0) withoutBoost += 1;
    }
    expect(withBoost).toBeGreaterThan(withoutBoost);
  });
});
