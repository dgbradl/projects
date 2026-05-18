import { describe, expect, it } from 'vitest';
import type { Npc, WorldState } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { InteractionResolver } from '../src/interactions/resolver.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts';
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
    seed: 'res-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
  };
}

function npc(id: string, opts: { withRumor?: boolean } = {}): Npc {
  return {
    id,
    displayName: id,
    status: 'seated',
    position: { x: 50, y: 50 },
    zone: 'table_a',
    arrivedGameDay: 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 2,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 100,
    carriedRumorIds: opts.withRumor ? ['rumor_d1_0'] : [],
  };
}

function build() {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const tags = new WorldTagsManager(p, bus);
  const rumors = new RumorsManager(p, bus);
  const runner = new ThreadRunner(p, bus, tags, rumors);
  const resolver = new InteractionResolver(bus, runner);
  return { p, bus, tags, rumors, runner, resolver };
}

describe('InteractionResolver', () => {
  it('emits an interaction event', () => {
    const { p, resolver } = build();
    const a = npc('a');
    const b = npc('b');
    resolver.resolve(
      { participantIds: [a.id, b.id], zone: 'table_a' },
      {
        worldSeed: 'res-seed',
        gameDay: 1,
        subTick: 1,
        npcsById: new Map([[a.id, a], [b.id, b]]),
        perDayCounter: { value: 0 },
      },
    );
    const events = p.getEventsSince(0).filter((e) => e.event.type === 'interaction');
    expect(events).toHaveLength(1);
  });

  it('a whispered_exchange between rumor-carriers eventually spawns an approaching_stranger thread', () => {
    // Run many rolls; expect at least one to spawn a thread.
    const { p, resolver } = build();
    for (let i = 0; i < 50; i += 1) {
      const a = npc(`a_${i}`, { withRumor: true });
      const b = npc(`b_${i}`, { withRumor: true });
      resolver.resolve(
        { participantIds: [a.id, b.id], zone: 'table_a' },
        {
          worldSeed: 'res-seed',
          gameDay: 1,
          subTick: i,
          npcsById: new Map([[a.id, a], [b.id, b]]),
          perDayCounter: { value: i },
        },
      );
    }

    const startedThreads = p
      .loadAllThreads()
      .filter((t) => t.type === 'approaching_stranger');
    expect(startedThreads.length).toBeGreaterThan(0);

    // Run the spawned thread forward and verify it produces a scheduled_arrival.
    const t = startedThreads[0];
    const runner = new ThreadRunner(
      p,
      new WorldEventBus(p, new FakeClock(NOW)),
      new WorldTagsManager(p, new WorldEventBus(p, new FakeClock(NOW))),
      new RumorsManager(p, new WorldEventBus(p, new FakeClock(NOW))),
    );
    runner.runDay(t.nextTickGameDay, fakeWorld(t.nextTickGameDay), 'res-seed');
    const arrivals = p.loadUpcomingScheduledArrivals(0, 30);
    expect(arrivals.length).toBeGreaterThan(0);
  });
});
