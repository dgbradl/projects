/**
 * Phase 9 (H1): multi-visit desires tests.
 *
 *  - rememberDesireOutcomes captures unfulfilled into lastUnfulfilledDesires
 *    and clears the slate when everything was fulfilled
 *  - parseCharacterMemory round-trips the new fields and filters malformed
 *  - The carryover flag propagates through desire_unfulfilled events
 *  - Salience bumps +3 for a carryover unmet
 *  - Fallback prose adds the "— still." beat
 */
import { describe, expect, it } from 'vitest';
import type {
  CharacterMemory,
  EventLogEntry,
  NpcDesire,
  WorldEvent,
} from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { buildFallbackChronicle } from '../src/chronicle/fallback.ts';
import { score as scoreSalience } from '../src/chronicle/salience.ts';
import { DEFAULT_ALARMING_VALUES } from '../src/chronicle/types.ts';
import {
  emptyMemory,
  parseCharacterMemory,
  rememberDesireOutcomes,
} from '../src/npc/character-memory.ts';
import { DesireResolver } from '../src/npc/desire-resolver.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SUBTICKS_PER_DAY = 360;

describe('rememberDesireOutcomes — H1 unfulfilled snapshot', () => {
  it('captures unmet desires into lastUnfulfilledDesires + records the day', () => {
    const desires: NpcDesire[] = [
      { kind: 'warm_meal', fulfilledAtSubTick: 12, fulfilledBy: 'sim' },
      { kind: 'news_of_location', param: 'oldspire' }, // unfulfilled
      { kind: 'quiet_seat' }, // unfulfilled
    ];
    const m = rememberDesireOutcomes(emptyMemory(), desires, 5);
    expect(m.lastUnfulfilledDesires).toEqual([
      { kind: 'news_of_location', param: 'oldspire' },
      { kind: 'quiet_seat' },
    ]);
    expect(m.lastUnfulfilledAtGameDay).toBe(5);
  });

  it('clears lastUnfulfilledDesires when everything was met', () => {
    const prior: CharacterMemory = {
      ...emptyMemory(),
      lastUnfulfilledDesires: [{ kind: 'warm_meal' }],
      lastUnfulfilledAtGameDay: 2,
    };
    const m = rememberDesireOutcomes(
      prior,
      [{ kind: 'warm_meal', fulfilledAtSubTick: 50, fulfilledBy: 'sim' }],
      4,
    );
    expect(m.lastUnfulfilledDesires).toBeUndefined();
    expect(m.lastUnfulfilledAtGameDay).toBeUndefined();
  });

  it('strips carryover flag from the stored snapshot (clean slate)', () => {
    const desires: NpcDesire[] = [
      { kind: 'warm_meal', carryover: true }, // was a carryover, left unmet
    ];
    const m = rememberDesireOutcomes(emptyMemory(), desires, 7);
    expect(m.lastUnfulfilledDesires).toEqual([{ kind: 'warm_meal' }]);
  });
});

describe('parseCharacterMemory — H1 round-trip', () => {
  it('round-trips lastUnfulfilledDesires + day', () => {
    const original: CharacterMemory = {
      ...emptyMemory(),
      lastUnfulfilledDesires: [
        { kind: 'news_of_location', param: 'iron_quay' },
      ],
      lastUnfulfilledAtGameDay: 9,
    };
    expect(parseCharacterMemory(JSON.stringify(original))).toEqual(original);
  });

  it('drops malformed unfulfilled entries', () => {
    const parsed = parseCharacterMemory(
      JSON.stringify({
        ...emptyMemory(),
        lastUnfulfilledDesires: [
          { kind: 'warm_meal' },
          { kind: 'not_a_kind' },
          'garbage',
          { },
        ],
        lastUnfulfilledAtGameDay: 3,
      }),
    );
    expect(parsed.lastUnfulfilledDesires).toEqual([{ kind: 'warm_meal' }]);
  });
});

describe('DesireResolver — H1 carryover flag propagation', () => {
  function setup() {
    const persistence = new Persistence(':memory:');
    const clock = new FakeClock(NOW);
    const bus = new WorldEventBus(persistence, clock);
    const npcManager = new NpcManager(
      { worldSeed: 'h1-seed', subTicksPerDay: SUBTICKS_PER_DAY },
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
    return { persistence, bus, events };
  }

  it('emits desire_unfulfilled with carryover: true when departing NPC had a carryover desire unmet', () => {
    const h = setup();
    h.bus.publish({
      type: 'npc_departed',
      gameDay: 3,
      npcId: 'regular-1',
      desires: [
        { kind: 'news_of_location', param: 'oldspire', carryover: true },
      ],
    });
    const u = h.events.filter((e) => e.type === 'desire_unfulfilled');
    expect(u).toHaveLength(1);
    const ev = u[0] as WorldEvent & { type: 'desire_unfulfilled' };
    expect(ev.carryover).toBe(true);
  });

  it('omits carryover (or false) for a fresh unmet desire', () => {
    const h = setup();
    h.bus.publish({
      type: 'npc_departed',
      gameDay: 3,
      npcId: 'firsttimer',
      desires: [{ kind: 'warm_meal' }],
    });
    const u = h.events.filter((e) => e.type === 'desire_unfulfilled');
    const ev = u[0] as WorldEvent & { type: 'desire_unfulfilled' };
    expect(ev.carryover).toBeUndefined();
  });
});

describe('salience — H1 carryover bump', () => {
  const ctx = {
    npcsById: new Map(),
    threadsById: new Map(),
    alarmingValues: DEFAULT_ALARMING_VALUES,
  };

  it('bumps desire_unfulfilled by +3 when carryover is true', () => {
    const fresh = scoreSalience(
      {
        type: 'desire_unfulfilled',
        gameDay: 1,
        npcId: 'x',
        desireKind: 'warm_meal',
      },
      ctx,
    );
    const carry = scoreSalience(
      {
        type: 'desire_unfulfilled',
        gameDay: 1,
        npcId: 'x',
        desireKind: 'warm_meal',
        carryover: true,
      },
      ctx,
    );
    expect(carry).toBe(fresh + 3);
  });
});

describe('fallback prose — H1 carryover phrasing', () => {
  it('adds " — still." to the unmet sentence when carryover', () => {
    const npcsById = new Map();
    const ev: EventLogEntry = {
      id: 1,
      realTimestamp: '2026-01-01T00:00:00.000Z',
      event: {
        type: 'desire_unfulfilled',
        gameDay: 1,
        npcId: 'lana',
        desireKind: 'news_of_location',
        param: 'oldspire',
        carryover: true,
      },
    };
    const result = buildFallbackChronicle({
      gameDay: 1,
      generatedAtRealTs: '2026-01-01T00:00:00.000Z',
      salientEvents: [ev],
      context: {
        npcsById,
        threadsById: new Map(),
        alarmingValues: DEFAULT_ALARMING_VALUES,
      },
    });
    const combined = [...result.headlines, ...result.footnotes].join(' | ');
    expect(combined).toContain('still');
  });
});
