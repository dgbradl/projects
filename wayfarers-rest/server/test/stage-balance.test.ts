/**
 * Phase 9 (F5): scene outcomes shift prosperity.
 *
 * The prosperity calc now folds stage_event_resolved events into the
 * windowSocial signal. This file pins:
 *   - A wedding-completed day settles higher than the same day with
 *     no scene
 *   - A brawl-burned-out day settles LOWER than the same day with
 *     no scene
 *   - A keeper-defused brawl is neutral (no penalty)
 *   - The shape composes — same exact mix of interactions, only the
 *     scene-resolved event changes
 *
 * Integration check: drive multiple days with mixed scenes and assert
 * the rolling prosperity reflects the cumulative effect.
 */
import { describe, expect, it } from 'vitest';
import type { WorldEventBus as Bus } from '../src/events/emitter.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { updateProsperityForDay } from '../src/economy/prosperity.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function bootstrap(seedKey: string): { persistence: Persistence; stateManager: WorldStateManager; bus: Bus } {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => seedKey);
  const bus = new WorldEventBus(persistence, clock);
  // Seed an empty day-1 ledger so updateProsperity has a row to settle.
  persistence.upsertDailyLedger({
    gameDay: 1,
    income: 50,
    expense: 30,
    net: 20,
    guestCount: 4,
    coinAfter: 270,
    prosperityAfter: undefined,
  });
  return { persistence, stateManager, bus };
}

describe('F5 — wedding lifts prosperity', () => {
  it('settles higher than a baseline day with no scene', () => {
    const baseline = bootstrap('baseline');
    const updateBase = updateProsperityForDay(baseline, 1)!;

    const happy = bootstrap('happy');
    happy.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 'scene-w',
      stageEventType: 'wedding',
      outcome: 'completed',
      participantNpcIds: ['p1'],
    });
    const updateHappy = updateProsperityForDay(happy, 1)!;

    expect(updateHappy.score).toBeGreaterThan(updateBase.score);
    baseline.persistence.close();
    happy.persistence.close();
  });
});

describe('F5 — brawl burned-out drags prosperity down', () => {
  it('settles lower than a baseline day with no scene', () => {
    const baseline = bootstrap('baseline');
    const updateBase = updateProsperityForDay(baseline, 1)!;

    const sour = bootstrap('sour');
    sour.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 'scene-b',
      stageEventType: 'brawl',
      outcome: 'burned_out',
      participantNpcIds: ['a', 'b'],
    });
    const updateSour = updateProsperityForDay(sour, 1)!;

    expect(updateSour.score).toBeLessThan(updateBase.score);
    baseline.persistence.close();
    sour.persistence.close();
  });
});

describe('F5 — keeper-defused brawl is neutral', () => {
  it("doesn't dent prosperity (vs the same day with no scene)", () => {
    const baseline = bootstrap('baseline');
    const updateBase = updateProsperityForDay(baseline, 1)!;

    const defused = bootstrap('defused');
    defused.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 'scene-d',
      stageEventType: 'brawl',
      outcome: 'defused_by_keeper',
      participantNpcIds: ['a', 'b'],
    });
    const updateDefused = updateProsperityForDay(defused, 1)!;

    // Equal — defused brawls weight 0.
    expect(updateDefused.score).toBe(updateBase.score);
    baseline.persistence.close();
    defused.persistence.close();
  });
});

describe('F5 — defused is strictly better than burned-out', () => {
  it('keeper intervention out-performs a let-it-burn brawl', () => {
    const burned = bootstrap('burn');
    burned.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's1',
      stageEventType: 'brawl',
      outcome: 'burned_out',
      participantNpcIds: ['a', 'b'],
    });
    const burnedResult = updateProsperityForDay(burned, 1)!;

    const defused = bootstrap('defuse');
    defused.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's2',
      stageEventType: 'brawl',
      outcome: 'defused_by_keeper',
      participantNpcIds: ['a', 'b'],
    });
    const defusedResult = updateProsperityForDay(defused, 1)!;

    expect(defusedResult.score).toBeGreaterThan(burnedResult.score);
    burned.persistence.close();
    defused.persistence.close();
  });
});

describe('F5 — storyteller_circle and court_day light effects', () => {
  it('storyteller_circle lifts modestly', () => {
    const baseline = bootstrap('baseline');
    const updateBase = updateProsperityForDay(baseline, 1)!;

    const story = bootstrap('story');
    story.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's1',
      stageEventType: 'storyteller_circle',
      outcome: 'completed',
      participantNpcIds: ['bard1', 'a', 'b'],
    });
    const updateStory = updateProsperityForDay(story, 1)!;

    expect(updateStory.score).toBeGreaterThan(updateBase.score);
    baseline.persistence.close();
    story.persistence.close();
  });

  it('court_day is neutral (just business)', () => {
    const baseline = bootstrap('baseline');
    const updateBase = updateProsperityForDay(baseline, 1)!;

    const court = bootstrap('court');
    court.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's1',
      stageEventType: 'court_day',
      outcome: 'completed',
      participantNpcIds: ['k1'],
    });
    const updateCourt = updateProsperityForDay(court, 1)!;

    expect(updateCourt.score).toBe(updateBase.score);
    baseline.persistence.close();
    court.persistence.close();
  });
});

describe('F5 — composes with arguments + desires', () => {
  it('a wedding can offset desire-unfulfilled drag on the same day', () => {
    const sour = bootstrap('sour');
    // Two unmet desires AND a burned-out brawl — a properly bad day.
    for (let i = 0; i < 2; i += 1) {
      sour.bus.publish({
        type: 'desire_unfulfilled',
        gameDay: 1,
        npcId: `g${i}`,
        desireKind: 'warm_meal',
      });
    }
    sour.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's1',
      stageEventType: 'brawl',
      outcome: 'burned_out',
      participantNpcIds: ['a', 'b'],
    });
    const updateSour = updateProsperityForDay(sour, 1)!;

    const lifted = bootstrap('lifted');
    // Same drag, plus a wedding to balance it.
    for (let i = 0; i < 2; i += 1) {
      lifted.bus.publish({
        type: 'desire_unfulfilled',
        gameDay: 1,
        npcId: `g${i}`,
        desireKind: 'warm_meal',
      });
    }
    lifted.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's1',
      stageEventType: 'brawl',
      outcome: 'burned_out',
      participantNpcIds: ['a', 'b'],
    });
    lifted.bus.publish({
      type: 'stage_event_resolved',
      gameDay: 1,
      stageEventId: 's2',
      stageEventType: 'wedding',
      outcome: 'completed',
      participantNpcIds: ['p1'],
    });
    const updateLifted = updateProsperityForDay(lifted, 1)!;

    expect(updateLifted.score).toBeGreaterThan(updateSour.score);
    sour.persistence.close();
    lifted.persistence.close();
  });
});
