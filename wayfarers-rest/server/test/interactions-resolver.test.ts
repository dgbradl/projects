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
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 200,
    prosperity: 0,
    tavernName: "The Wayfarer\'s Rest",
    tavernTraits: [],
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

  it('affinity steers interaction kinds — friends drink, rivals argue', () => {
    const { p, bus, runner } = build();
    const resolver = new InteractionResolver(bus, runner, undefined, p);

    // Give `id` a memory of `otherId` at the given affinity.
    function remember(id: string, otherId: string, affinity: number): void {
      p.upsertCharacter({
        id,
        displayName: id,
        archetype: 'wanderer',
        firstSeenGameDay: 1,
        lastSeenGameDay: 1,
        visitCount: 2,
        memory: {
          rumorsHeard: [],
          encounters: [
            {
              characterId: otherId,
              lastKind: 'shared_drink',
              count: 1,
              lastGameDay: 1,
              affinity,
            },
          ],
          timesBeckoned: 0,
          timesMarked: 0,
        },
      });
    }
    remember('friend-a', 'friend-b', 25); // close friends
    remember('rival-a', 'rival-b', -25); // bitter rivals
    remember('known-a', 'known-b', 0); // mere acquaintances

    function tally(aId: string, bId: string): Record<string, number> {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 400; i += 1) {
        const a = npc(aId);
        const b = npc(bId);
        const { kind } = resolver.resolve(
          { participantIds: [aId, bId], zone: 'table_a' },
          {
            worldSeed: 'res-seed',
            gameDay: 1,
            subTick: i,
            npcsById: new Map([[aId, a], [bId, b]]),
            perDayCounter: { value: i },
          },
        );
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
      return counts;
    }

    const friends = tally('friend-a', 'friend-b');
    const rivals = tally('rival-a', 'rival-b');
    const acquaintances = tally('known-a', 'known-b');
    const strangers = tally('stranger-a', 'stranger-b');

    // Friends drink together far more than strangers do.
    expect(friends.shared_drink ?? 0).toBeGreaterThan(strangers.shared_drink ?? 0);
    // Rivals fall into arguments far more than strangers do.
    expect(rivals.overheard_argument ?? 0).toBeGreaterThan(
      strangers.overheard_argument ?? 0,
    );
    // Any prior meeting raises plain recognition.
    expect(acquaintances.silent_recognition ?? 0).toBeGreaterThan(
      strangers.silent_recognition ?? 0,
    );
  });
});
