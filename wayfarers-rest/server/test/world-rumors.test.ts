import { describe, expect, it } from 'vitest';
import type { ScheduledArrival } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { seededRng } from '../src/world/rng.ts';
import { RumorsManager } from '../src/world/rumors.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const rumors = new RumorsManager(p, bus);
  return { p, bus, rumors };
}

describe('RumorsManager', () => {
  it('introduce persists and emits rumor_introduced', () => {
    const { p, rumors } = build();
    const id = rumors.introduce(
      { text: 'A test rumor.', originLocationId: 'oldspire' },
      3,
    );
    expect(id).toMatch(/^rumor_d3_\d+$/);
    const all = p.getEventsSince(0);
    expect(all.some((e) => e.event.type === 'rumor_introduced')).toBe(true);
    expect(rumors.getAvailable().length).toBe(1);
  });

  it('markUnavailable removes the rumor from getAvailable but keeps it in getAll', () => {
    const { rumors } = build();
    const id = rumors.introduce({ text: 'A rumor', originLocationId: 'oldspire' }, 1);
    rumors.markUnavailable(id);
    expect(rumors.getAvailable()).toHaveLength(0);
    expect(rumors.getAll()).toHaveLength(1);
  });

  it('attachment probability rises with arrival distanceDays', () => {
    const { rumors } = build();
    // Rumor origin distanceDays = 10 (the_long_road).
    rumors.introduce({ text: 'Far-off news', originLocationId: 'the_long_road' }, 1);

    const trials = 200;
    let nearMatches = 0;
    let farMatches = 0;

    for (let i = 0; i < trials; i += 1) {
      const nearArrival: ScheduledArrival = {
        npcId: `near_${i}`,
        displayName: 'x',
        scheduledGameDay: 2,
        scheduledSubTick: 0,
        originLocationId: 'the_kettle', // distanceDays = 1
      };
      const farArrival: ScheduledArrival = {
        npcId: `far_${i}`,
        displayName: 'y',
        scheduledGameDay: 2,
        scheduledSubTick: 0,
        originLocationId: 'iron_quay', // distanceDays = 9
      };
      const nearAttached = rumors.rollAttachmentsForArrival(
        nearArrival,
        seededRng('seed', 'near', i),
      );
      const farAttached = rumors.rollAttachmentsForArrival(
        farArrival,
        seededRng('seed', 'far', i),
      );
      if (nearAttached.length > 0) nearMatches += 1;
      if (farAttached.length > 0) farMatches += 1;
    }

    expect(farMatches).toBeGreaterThan(nearMatches);
  });
});
