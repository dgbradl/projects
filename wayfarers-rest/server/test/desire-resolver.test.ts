/**
 * Phase 8 (A2): tests for sim-side desire fulfilment.
 *
 * The resolver is reactive — it never calls into behaviour, just observes
 * the roster and the bus. These tests exercise it directly without spinning
 * up the full sub-tick scheduler.
 */
import { describe, expect, it } from 'vitest';
import type {
  EventLogEntry,
  Interaction,
  Npc,
  NpcDesire,
  WorldEvent,
  ZoneName,
} from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import {
  DesireResolver,
  QUIET_SEAT_SUBTICKS,
  fulfilledCount,
} from '../src/npc/desire-resolver.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';

const SUBTICKS_PER_DAY = 360;

function setup() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00Z'));
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: 'test-seed', subTicksPerDay: SUBTICKS_PER_DAY },
    { persistence, bus },
  );
  const resolver = new DesireResolver({
    npcManager,
    bus,
    subTicksPerDay: SUBTICKS_PER_DAY,
  });
  resolver.attach();

  // Capture published events for assertions.
  const events: WorldEvent[] = [];
  bus.on('world_event', (entry: EventLogEntry) => events.push(entry.event));

  return { persistence, bus, npcManager, resolver, events };
}

function makeNpc(input: {
  id: string;
  archetype?: string;
  desires?: NpcDesire[];
  status?: Npc['status'];
  zone?: ZoneName | null;
  arrivedGameDay?: number;
  isStaff?: boolean;
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: input.status ?? 'seated',
    position: { x: 50, y: 50 },
    zone: input.zone === undefined ? 'table_a' : input.zone,
    arrivedGameDay: input.arrivedGameDay ?? 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 1,
    plannedDepartureSubTick: SUBTICKS_PER_DAY - 1,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype ?? 'scholar',
    visitCount: 1,
    isStaff: input.isStaff,
    desires: input.desires,
  };
}

// Pre-seed the roster by hydrating — bypasses the spawn-queue pipeline so
// each test controls exactly which NPCs the resolver sees.
function seedRoster(npcManager: NpcManager, npcs: Npc[]): void {
  npcManager.hydrate({ npcs, spawnQueue: [] });
}

describe('DesireResolver — quiet_seat', () => {
  it('fulfils after QUIET_SEAT_SUBTICKS consecutive ticks alone in a table', () => {
    const { npcManager, resolver, events } = setup();
    const npc = makeNpc({
      id: 'scholar1',
      archetype: 'scholar',
      desires: [{ kind: 'quiet_seat' }],
    });
    seedRoster(npcManager, [npc]);

    // Drive enough sub-ticks to cross the threshold.
    for (let i = 0; i < QUIET_SEAT_SUBTICKS - 1; i += 1) {
      resolver.onSubTick(1, i, npcManager.getRoster());
      expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);
    }
    resolver.onSubTick(1, QUIET_SEAT_SUBTICKS - 1, npcManager.getRoster());

    const after = npcManager.getRoster()[0];
    expect(fulfilledCount(after.desires)).toBe(1);
    expect(after.desires![0].fulfilledBy).toBe('sim');
    expect(after.desires![0].fulfilledAtSubTick).toBe(
      1 * SUBTICKS_PER_DAY + (QUIET_SEAT_SUBTICKS - 1),
    );

    const fulfilledEvents = events.filter((e) => e.type === 'desire_fulfilled');
    expect(fulfilledEvents).toHaveLength(1);
    const ev = fulfilledEvents[0] as WorldEvent & { type: 'desire_fulfilled' };
    expect(ev.npcId).toBe('scholar1');
    expect(ev.desireKind).toBe('quiet_seat');
    expect(ev.fulfilledBy).toBe('sim');
  });

  it('resets the counter when company arrives in the zone', () => {
    const { npcManager, resolver } = setup();
    const scholar = makeNpc({
      id: 'scholar1',
      desires: [{ kind: 'quiet_seat' }],
      zone: 'table_a',
    });
    seedRoster(npcManager, [scholar]);

    // Build up the counter most of the way…
    for (let i = 0; i < QUIET_SEAT_SUBTICKS - 1; i += 1) {
      resolver.onSubTick(1, i, npcManager.getRoster());
    }
    // …then a soldier joins the same table.
    const soldier = makeNpc({
      id: 'soldier1',
      archetype: 'soldier',
      zone: 'table_a',
      desires: [],
    });
    npcManager.hydrate({
      npcs: [npcManager.getRoster()[0], soldier],
      spawnQueue: [],
    });
    resolver.onSubTick(1, QUIET_SEAT_SUBTICKS - 1, npcManager.getRoster());
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);

    // Now they walk off, scholar is alone again. Has to count from zero.
    npcManager.hydrate({
      npcs: [npcManager.getRoster()[0]],
      spawnQueue: [],
    });
    for (let i = 0; i < QUIET_SEAT_SUBTICKS - 1; i += 1) {
      resolver.onSubTick(1, QUIET_SEAT_SUBTICKS + i, npcManager.getRoster());
      expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);
    }
    resolver.onSubTick(1, QUIET_SEAT_SUBTICKS * 2 - 1, npcManager.getRoster());
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(1);
  });

  it('does not fulfil quiet_seat at the bar', () => {
    const { npcManager, resolver } = setup();
    const npc = makeNpc({
      id: 'scholar1',
      desires: [{ kind: 'quiet_seat' }],
      zone: 'bar',
      status: 'at_bar',
    });
    seedRoster(npcManager, [npc]);
    for (let i = 0; i < QUIET_SEAT_SUBTICKS * 2; i += 1) {
      resolver.onSubTick(1, i, npcManager.getRoster());
    }
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);
  });
});

describe('DesireResolver — bed_for_night', () => {
  it('fulfils on day-change for NPCs still here from earlier days', () => {
    const { npcManager, resolver, events } = setup();
    const npc = makeNpc({
      id: 'pilgrim1',
      archetype: 'pilgrim',
      arrivedGameDay: 1,
      desires: [{ kind: 'bed_for_night' }],
    });
    seedRoster(npcManager, [npc]);

    resolver.onDayChange(2);
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(1);
    const fulfilled = events.filter((e) => e.type === 'desire_fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect((fulfilled[0] as WorldEvent & { type: 'desire_fulfilled' }).desireKind).toBe(
      'bed_for_night',
    );
  });

  it('does not fulfil for guests who arrived the same day', () => {
    const { npcManager, resolver } = setup();
    const npc = makeNpc({
      id: 'pilgrim1',
      arrivedGameDay: 2,
      desires: [{ kind: 'bed_for_night' }],
    });
    seedRoster(npcManager, [npc]);
    resolver.onDayChange(2);
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);
  });

  it('skips staff', () => {
    const { npcManager, resolver } = setup();
    const npc = makeNpc({
      id: 'staff1',
      isStaff: true,
      arrivedGameDay: 1,
      desires: [{ kind: 'bed_for_night' }],
    });
    seedRoster(npcManager, [npc]);
    resolver.onDayChange(2);
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);
  });
});

describe('DesireResolver — company_of_kind via shared_drink', () => {
  it('fulfils when the other party matches the desired archetype', () => {
    const { npcManager, bus, events } = setup();
    const wantsSoldier = makeNpc({
      id: 'A',
      archetype: 'soldier',
      desires: [{ kind: 'company_of_kind', param: 'soldier' }],
    });
    const otherSoldier = makeNpc({
      id: 'B',
      archetype: 'soldier',
      desires: [],
    });
    seedRoster(npcManager, [wantsSoldier, otherSoldier]);

    const interaction: Interaction = {
      id: 'int1',
      gameDay: 1,
      subTick: 50,
      zone: 'bar',
      participantIds: ['A', 'B'],
      kind: 'shared_drink',
    };
    bus.publish({ type: 'interaction', gameDay: 1, interaction });

    const a = npcManager
      .getRoster()
      .find((n) => n.id === 'A')!;
    expect(fulfilledCount(a.desires)).toBe(1);
    expect(a.desires![0].fulfilledBy).toBe('sim');

    const fulfilled = events.filter((e) => e.type === 'desire_fulfilled');
    expect(fulfilled).toHaveLength(1);
  });

  it("matches when the desire's param is 'any'", () => {
    const { npcManager, bus } = setup();
    const bard = makeNpc({
      id: 'A',
      archetype: 'bard',
      desires: [{ kind: 'company_of_kind', param: 'any' }],
    });
    const stranger = makeNpc({
      id: 'B',
      archetype: 'wanderer',
      desires: [],
    });
    seedRoster(npcManager, [bard, stranger]);
    bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: {
        id: 'int1',
        gameDay: 1,
        subTick: 50,
        zone: 'bar',
        participantIds: ['A', 'B'],
        kind: 'shared_drink',
      },
    });
    expect(fulfilledCount(npcManager.getRoster().find((n) => n.id === 'A')!.desires)).toBe(1);
  });

  it('does not fulfil for whispered_exchange (only shared_drink counts)', () => {
    const { npcManager, bus } = setup();
    seedRoster(npcManager, [
      makeNpc({
        id: 'A',
        archetype: 'soldier',
        desires: [{ kind: 'company_of_kind', param: 'soldier' }],
      }),
      makeNpc({ id: 'B', archetype: 'soldier', desires: [] }),
    ]);
    bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: {
        id: 'int1',
        gameDay: 1,
        subTick: 50,
        zone: 'bar',
        participantIds: ['A', 'B'],
        kind: 'whispered_exchange',
      },
    });
    expect(fulfilledCount(npcManager.getRoster()[0].desires)).toBe(0);
  });

  it('fulfils both parties when each wants the other archetype', () => {
    const { npcManager, bus } = setup();
    seedRoster(npcManager, [
      makeNpc({
        id: 'A',
        archetype: 'soldier',
        desires: [{ kind: 'company_of_kind', param: 'bard' }],
      }),
      makeNpc({
        id: 'B',
        archetype: 'bard',
        desires: [{ kind: 'company_of_kind', param: 'soldier' }],
      }),
    ]);
    bus.publish({
      type: 'interaction',
      gameDay: 1,
      interaction: {
        id: 'int1',
        gameDay: 1,
        subTick: 50,
        zone: 'bar',
        participantIds: ['A', 'B'],
        kind: 'shared_drink',
      },
    });
    expect(fulfilledCount(npcManager.getRoster().find((n) => n.id === 'A')!.desires)).toBe(1);
    expect(fulfilledCount(npcManager.getRoster().find((n) => n.id === 'B')!.desires)).toBe(1);
  });
});

describe('DesireResolver — desire_unfulfilled on departure', () => {
  it('emits desire_unfulfilled for each unmet desire in the npc_departed payload', () => {
    const { bus, events } = setup();
    bus.publish({
      type: 'npc_departed',
      gameDay: 3,
      npcId: 'X',
      desires: [
        { kind: 'warm_meal' },
        { kind: 'news_of_location', param: 'oldspire' },
        {
          kind: 'bed_for_night',
          fulfilledAtSubTick: 500,
          fulfilledBy: 'sim',
        },
      ],
    });

    const unfulfilled = events.filter((e) => e.type === 'desire_unfulfilled');
    expect(unfulfilled).toHaveLength(2);
    const kinds = unfulfilled.map((e) =>
      (e as WorldEvent & { type: 'desire_unfulfilled' }).desireKind,
    );
    expect(kinds).toEqual(['warm_meal', 'news_of_location']);
  });

  it('emits nothing if the departed NPC has no desires field (staff)', () => {
    const { bus, events } = setup();
    bus.publish({
      type: 'npc_departed',
      gameDay: 3,
      npcId: 'mirela',
      // no desires field — staff
    });
    expect(events.some((e) => e.type === 'desire_unfulfilled')).toBe(false);
  });
});
