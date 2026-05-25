/**
 * Phase 8 (A3): tests for staff-driven desire fulfilment.
 *
 * Two paths covered here:
 *   - Waitstaff hospitality → warm_meal (processHospitalityFulfilment +
 *     DesireResolver.fulfilByExternal)
 *   - Bartender gossipNetwork transfers a rumor whose origin/tone matches a
 *     recipient's news_of_location / rumor_of_tone desire
 *     (DesireResolver.fulfilFromRumor)
 *
 * Each end-to-end flow is exercised — the staff function returns the
 * candidate, the resolver flips the desire, the bus emits desire_fulfilled
 * with the right `fulfilledBy` provenance.
 */
import { describe, expect, it } from 'vitest';
import type {
  EventLogEntry,
  Npc,
  NpcDesire,
  Rumor,
  StaffSkills,
  WorldEvent,
  ZoneName,
} from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { DesireResolver } from '../src/npc/desire-resolver.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { processHospitalityFulfilment } from '../src/npc/staff-effects.ts';
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
  const events: WorldEvent[] = [];
  bus.on('world_event', (entry: EventLogEntry) => events.push(entry.event));
  return { persistence, bus, npcManager, resolver, events };
}

function makeStaff(input: {
  id: string;
  role: 'bartender' | 'waitstaff' | 'cleaner';
  skills?: StaffSkills;
  zone?: ZoneName;
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: 'at_bar',
    position: { x: 50, y: 50 },
    zone: input.zone ?? (input.role === 'bartender' ? 'bar' : 'table_a'),
    arrivedGameDay: 0,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 9999,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    isStaff: true,
    staffRole: input.role,
    skills: input.skills,
  };
}

function makeGuest(input: {
  id: string;
  archetype?: string;
  desires?: NpcDesire[];
  status?: Npc['status'];
  zone?: ZoneName;
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: input.status ?? 'seated',
    position: { x: 50, y: 50 },
    zone: input.zone ?? 'table_a',
    arrivedGameDay: 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 1,
    plannedDepartureSubTick: SUBTICKS_PER_DAY - 1,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype ?? 'wanderer',
    visitCount: 1,
    desires: input.desires,
  };
}

describe('processHospitalityFulfilment — warm_meal', () => {
  it('returns a candidate when waitstaff is present, skill > 0, and a seated guest wants a warm meal', () => {
    const guest = makeGuest({
      id: 'g1',
      desires: [{ kind: 'warm_meal' }],
    });
    const waiter = makeStaff({
      id: 'petra',
      role: 'waitstaff',
      skills: { hospitality: 10 },
    });
    // Walk through sub-ticks; at hospitality 10, p=0.4, so within a handful
    // of ticks the deterministic RNG produces at least one hit.
    let result;
    for (let st = 0; st < 30; st += 1) {
      result = processHospitalityFulfilment([waiter, guest], 'seed-a', 1, st);
      if (result) break;
    }
    expect(result).toBeDefined();
    expect(result!.waitstaffId).toBe('petra');
    expect(result!.recipientId).toBe('g1');
  });

  it('returns undefined with no waitstaff', () => {
    const guest = makeGuest({ id: 'g1', desires: [{ kind: 'warm_meal' }] });
    for (let st = 0; st < 30; st += 1) {
      expect(
        processHospitalityFulfilment([guest], 'seed-a', 1, st),
      ).toBeUndefined();
    }
  });

  it('returns undefined when no guest wants a warm meal', () => {
    const guest = makeGuest({ id: 'g1', desires: [{ kind: 'quiet_seat' }] });
    const waiter = makeStaff({
      id: 'petra',
      role: 'waitstaff',
      skills: { hospitality: 10 },
    });
    for (let st = 0; st < 30; st += 1) {
      expect(
        processHospitalityFulfilment([waiter, guest], 'seed-a', 1, st),
      ).toBeUndefined();
    }
  });

  it('skips non-seated guests', () => {
    const guest = makeGuest({
      id: 'g1',
      desires: [{ kind: 'warm_meal' }],
      status: 'at_bar',
    });
    const waiter = makeStaff({
      id: 'petra',
      role: 'waitstaff',
      skills: { hospitality: 10 },
    });
    for (let st = 0; st < 30; st += 1) {
      expect(
        processHospitalityFulfilment([waiter, guest], 'seed-a', 1, st),
      ).toBeUndefined();
    }
  });

  it('uses the highest-hospitality waiter when multiple are on the floor', () => {
    const guest = makeGuest({ id: 'g1', desires: [{ kind: 'warm_meal' }] });
    const meh = makeStaff({
      id: 'mediocre',
      role: 'waitstaff',
      skills: { hospitality: 1 },
    });
    const star = makeStaff({
      id: 'star',
      role: 'waitstaff',
      skills: { hospitality: 10 },
    });
    let result;
    for (let st = 0; st < 30; st += 1) {
      result = processHospitalityFulfilment([meh, star, guest], 'seed-a', 1, st);
      if (result) break;
    }
    expect(result?.waitstaffId).toBe('star');
  });
});

describe('DesireResolver.fulfilByExternal — staff:waitstaff', () => {
  it('flips warm_meal and emits desire_fulfilled with staff provenance', () => {
    const { npcManager, resolver, events } = setup();
    const guest = makeGuest({
      id: 'g1',
      desires: [{ kind: 'warm_meal' }],
    });
    npcManager.hydrate({ npcs: [guest], spawnQueue: [] });

    const ok = resolver.fulfilByExternal(
      'g1',
      'warm_meal',
      undefined,
      'staff:waitstaff',
      1,
      72, // arbitrary absSubTick
    );
    expect(ok).toBe(true);
    const after = npcManager.getRoster()[0];
    expect(after.desires![0].fulfilledBy).toBe('staff:waitstaff');
    expect(after.desires![0].fulfilledAtSubTick).toBe(72);

    const fulfilled = events.filter((e) => e.type === 'desire_fulfilled');
    expect(fulfilled).toHaveLength(1);
    const ev = fulfilled[0] as WorldEvent & { type: 'desire_fulfilled' };
    expect(ev.fulfilledBy).toBe('staff:waitstaff');
    expect(ev.desireKind).toBe('warm_meal');
  });

  it('returns false (no event) when the desire is already fulfilled', () => {
    const { npcManager, resolver, events } = setup();
    npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'g1',
          desires: [
            { kind: 'warm_meal', fulfilledAtSubTick: 1, fulfilledBy: 'sim' },
          ],
        }),
      ],
      spawnQueue: [],
    });
    const ok = resolver.fulfilByExternal(
      'g1',
      'warm_meal',
      undefined,
      'staff:waitstaff',
      1,
      99,
    );
    expect(ok).toBe(false);
    expect(events.some((e) => e.type === 'desire_fulfilled')).toBe(false);
  });
});

describe('DesireResolver.fulfilFromRumor — news_of_location + rumor_of_tone', () => {
  function rumor(opts: Partial<Rumor>): Pick<Rumor, 'originLocationId' | 'tone'> {
    return {
      originLocationId: opts.originLocationId,
      tone: opts.tone,
    };
  }

  it('fulfils news_of_location when the rumor originates from the right place', () => {
    const { npcManager, resolver, events } = setup();
    npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'g1',
          desires: [{ kind: 'news_of_location', param: 'oldspire' }],
        }),
      ],
      spawnQueue: [],
    });
    const result = resolver.fulfilFromRumor(
      'g1',
      rumor({ originLocationId: 'oldspire', tone: 'curious' }),
      'staff:bartender',
      2,
      720,
    );
    expect(result).toEqual({ kind: 'news_of_location', param: 'oldspire' });
    expect(events.some((e) => e.type === 'desire_fulfilled')).toBe(true);
  });

  it('fulfils rumor_of_tone when the rumor tone matches', () => {
    const { npcManager, resolver } = setup();
    npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'g1',
          desires: [{ kind: 'rumor_of_tone', param: 'foreboding' }],
        }),
      ],
      spawnQueue: [],
    });
    const result = resolver.fulfilFromRumor(
      'g1',
      rumor({ originLocationId: 'whitepike', tone: 'foreboding' }),
      'staff:bartender',
      2,
      720,
    );
    expect(result).toEqual({ kind: 'rumor_of_tone', param: 'foreboding' });
  });

  it('returns undefined when the rumor matches no desire', () => {
    const { npcManager, resolver, events } = setup();
    npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'g1',
          desires: [{ kind: 'news_of_location', param: 'oldspire' }],
        }),
      ],
      spawnQueue: [],
    });
    const result = resolver.fulfilFromRumor(
      'g1',
      rumor({ originLocationId: 'iron_quay', tone: 'curious' }),
      'staff:bartender',
      2,
      720,
    );
    expect(result).toBeUndefined();
    expect(events.some((e) => e.type === 'desire_fulfilled')).toBe(false);
  });

  it('ignores already-fulfilled desires of the same kind', () => {
    const { npcManager, resolver } = setup();
    npcManager.hydrate({
      npcs: [
        makeGuest({
          id: 'g1',
          desires: [
            {
              kind: 'news_of_location',
              param: 'oldspire',
              fulfilledAtSubTick: 10,
              fulfilledBy: 'keeper:plant_rumor',
            },
          ],
        }),
      ],
      spawnQueue: [],
    });
    const result = resolver.fulfilFromRumor(
      'g1',
      rumor({ originLocationId: 'oldspire' }),
      'staff:bartender',
      2,
      720,
    );
    expect(result).toBeUndefined();
  });
});
