import { describe, expect, it } from 'vitest';
import type {
  CharacterMemory,
  Interaction,
  InteractionKind,
} from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  CharacterMemoryRecorder,
  emptyMemory,
  parseCharacterMemory,
  rememberBeckon,
  rememberDeparture,
  rememberEncounter,
  rememberMark,
  rememberRumors,
} from '../src/npc/character-memory.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts'; // registers the relationship archetype
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('character memory — pure updates', () => {
  it('rememberRumors dedupes and keeps the newest within the cap', () => {
    let m = emptyMemory();
    m = rememberRumors(m, ['r1', 'r2']);
    m = rememberRumors(m, ['r2', 'r3']); // r2 already present
    expect(m.rumorsHeard).toEqual(['r1', 'r2', 'r3']);

    // Past the cap of 50, the oldest fall off.
    const many = Array.from({ length: 60 }, (_, i) => `bulk${i}`);
    m = rememberRumors(emptyMemory(), many);
    expect(m.rumorsHeard).toHaveLength(50);
    expect(m.rumorsHeard[0]).toBe('bulk10');
    expect(m.rumorsHeard[49]).toBe('bulk59');
  });

  it('rememberRumors with no ids returns the same memory', () => {
    const m = emptyMemory();
    expect(rememberRumors(m, [])).toBe(m);
  });

  it('rememberEncounter aggregates per other character', () => {
    let m = emptyMemory();
    m = rememberEncounter(m, 'other', 'shared_drink', 3);
    m = rememberEncounter(m, 'other', 'overheard_argument', 5);
    m = rememberEncounter(m, 'someone-else', 'whispered_exchange', 6);
    expect(m.encounters).toHaveLength(2);
    const withOther = m.encounters.find((e) => e.characterId === 'other')!;
    expect(withOther.count).toBe(2);
    expect(withOther.lastKind).toBe('overheard_argument');
    expect(withOther.lastGameDay).toBe(5);
    expect(withOther.affinity).toBe(-1); // +3 drink, then -4 argument
  });

  it('rememberBeckon / rememberMark increment counters', () => {
    let m = emptyMemory();
    m = rememberBeckon(rememberBeckon(m));
    m = rememberMark(m);
    expect(m.timesBeckoned).toBe(2);
    expect(m.timesMarked).toBe(1);
  });

  it('rememberDeparture stores the latest destination', () => {
    let m = rememberDeparture(emptyMemory(), 'hollow_wood');
    m = rememberDeparture(m, 'iron_ford');
    expect(m.lastDestinationLocationId).toBe('iron_ford');
  });
});

describe('character memory — parse', () => {
  it('round-trips a populated memory', () => {
    const original: CharacterMemory = {
      rumorsHeard: ['r1'],
      encounters: [
        {
          characterId: 'x',
          lastKind: 'shared_drink',
          count: 2,
          lastGameDay: 4,
          affinity: 6,
        },
      ],
      timesBeckoned: 1,
      timesMarked: 3,
      lastDestinationLocationId: 'hollow_wood',
    };
    expect(parseCharacterMemory(JSON.stringify(original))).toEqual(original);
  });

  it('falls back to empty memory on malformed or missing input', () => {
    expect(parseCharacterMemory(null)).toEqual(emptyMemory());
    expect(parseCharacterMemory('not json')).toEqual(emptyMemory());
    expect(parseCharacterMemory('{}')).toEqual(emptyMemory());
  });

  it('drops malformed entries but keeps the valid fields', () => {
    const parsed = parseCharacterMemory(
      JSON.stringify({
        rumorsHeard: ['ok', 7],
        encounters: [
          { characterId: 'good', lastKind: 'shared_drink', count: 1, lastGameDay: 2 },
          { characterId: 'bad', lastKind: 'not_a_kind', count: 1, lastGameDay: 2 },
        ],
        timesBeckoned: 4,
      }),
    );
    expect(parsed.rumorsHeard).toEqual(['ok']);
    expect(parsed.encounters).toHaveLength(1);
    expect(parsed.encounters[0].characterId).toBe('good');
    expect(parsed.encounters[0].affinity).toBe(0); // missing affinity → 0
    expect(parsed.timesBeckoned).toBe(4);
    expect(parsed.timesMarked).toBe(0);
  });
});

describe('affinity (B1)', () => {
  it('applies a delta per interaction kind', () => {
    const affinityFor = (kind: InteractionKind) =>
      rememberEncounter(emptyMemory(), 'x', kind, 1).encounters[0].affinity;
    expect(affinityFor('shared_drink')).toBe(3);
    expect(affinityFor('silent_recognition')).toBe(1);
    expect(affinityFor('whispered_exchange')).toBe(1);
    expect(affinityFor('overheard_argument')).toBe(-4);
  });

  it('accumulates across interactions and clamps to the range', () => {
    let warm = emptyMemory();
    for (let i = 0; i < 20; i += 1) {
      warm = rememberEncounter(warm, 'friend', 'shared_drink', i);
    }
    expect(warm.encounters[0].affinity).toBe(AFFINITY_MAX);

    let cold = emptyMemory();
    for (let i = 0; i < 20; i += 1) {
      cold = rememberEncounter(cold, 'rival', 'overheard_argument', i);
    }
    expect(cold.encounters[0].affinity).toBe(AFFINITY_MIN);
  });

  it('parse fills a missing affinity and clamps an out-of-range one', () => {
    const parsed = parseCharacterMemory(
      JSON.stringify({
        encounters: [
          { characterId: 'old', lastKind: 'shared_drink', count: 1, lastGameDay: 1 },
          {
            characterId: 'hot',
            lastKind: 'shared_drink',
            count: 9,
            lastGameDay: 1,
            affinity: 999,
          },
        ],
      }),
    );
    expect(parsed.encounters[0].affinity).toBe(0);
    expect(parsed.encounters[1].affinity).toBe(AFFINITY_MAX);
  });
});

describe('CharacterMemoryRecorder', () => {
  function setup() {
    const persistence = new Persistence(':memory:');
    const recorder = new CharacterMemoryRecorder(persistence);
    const seed = (id: string) =>
      persistence.upsertCharacter({
        id,
        displayName: id,
        archetype: 'wanderer',
        firstSeenGameDay: 1,
        lastSeenGameDay: 1,
        visitCount: 1,
        memory: emptyMemory(),
      });
    return { persistence, recorder, seed };
  }

  it('records an interaction on both participants', () => {
    const { persistence, recorder, seed } = setup();
    seed('a');
    seed('b');
    const interaction: Interaction = {
      id: 'int1',
      gameDay: 4,
      subTick: 10,
      zone: 'bar',
      participantIds: ['a', 'b'],
      kind: 'shared_drink',
    };
    recorder.handle({ type: 'interaction', gameDay: 4, interaction });

    const a = persistence.loadCharacter('a')!;
    const b = persistence.loadCharacter('b')!;
    expect(a.memory.encounters).toEqual([
      {
        characterId: 'b',
        lastKind: 'shared_drink',
        count: 1,
        lastGameDay: 4,
        affinity: 3,
      },
    ]);
    expect(b.memory.encounters[0].characterId).toBe('a');
  });

  it('records a departure destination and a keeper mark', () => {
    const { persistence, recorder, seed } = setup();
    seed('traveller');
    recorder.handle({
      type: 'npc_departed',
      gameDay: 6,
      npcId: 'traveller',
      destinationLocationId: 'iron_ford',
    });
    recorder.handle({ type: 'npc_marked', gameDay: 6, npcId: 'traveller' });

    const c = persistence.loadCharacter('traveller')!;
    expect(c.memory.lastDestinationLocationId).toBe('iron_ford');
    expect(c.memory.timesMarked).toBe(1);
  });

  it('ignores events for characters with no record', () => {
    const { recorder } = setup();
    expect(() =>
      recorder.handle({ type: 'npc_marked', gameDay: 1, npcId: 'ghost' }),
    ).not.toThrow();
  });

  it('attaches to the bus and records published events', () => {
    const { persistence, recorder, seed } = setup();
    const bus = new WorldEventBus(persistence, new FakeClock(NOW));
    recorder.attach(bus);
    seed('marked-one');
    bus.publish({ type: 'npc_marked', gameDay: 2, npcId: 'marked-one' });
    expect(persistence.loadCharacter('marked-one')!.memory.timesMarked).toBe(1);
  });
});

describe('CharacterMemoryRecorder — relationship threads (B3)', () => {
  function setup() {
    const persistence = new Persistence(':memory:');
    const bus = new WorldEventBus(persistence, new FakeClock(NOW));
    const runner = new ThreadRunner(
      persistence,
      bus,
      new WorldTagsManager(persistence, bus),
      new RumorsManager(persistence, bus),
    );
    const recorder = new CharacterMemoryRecorder(persistence, runner);
    const seed = (id: string) =>
      persistence.upsertCharacter({
        id,
        displayName: id,
        archetype: 'wanderer',
        firstSeenGameDay: 1,
        lastSeenGameDay: 1,
        visitCount: 1,
        memory: emptyMemory(),
      });
    return { persistence, recorder, seed };
  }

  function interact(
    recorder: CharacterMemoryRecorder,
    aId: string,
    bId: string,
    kind: InteractionKind,
    gameDay: number,
  ): void {
    recorder.handle({
      type: 'interaction',
      gameDay,
      interaction: {
        id: `int-${gameDay}`,
        gameDay,
        subTick: 0,
        zone: 'bar',
        participantIds: [aId, bId],
        kind,
      },
    });
  }

  function relationshipThreads(persistence: Persistence) {
    return persistence.loadAllThreads().filter((t) => t.type === 'relationship');
  }

  it('spawns a friendship thread once affinity crosses the threshold', () => {
    const { persistence, recorder, seed } = setup();
    seed('borin');
    seed('sera');
    // Six shared drinks (+3 each) lift affinity to the +18 threshold.
    for (let i = 1; i <= 6; i += 1) {
      interact(recorder, 'borin', 'sera', 'shared_drink', i);
    }
    const threads = relationshipThreads(persistence);
    expect(threads).toHaveLength(1);
    expect(threads[0].payload.kind).toBe('friendship');
    expect(threads[0].payload).toMatchObject({ aName: 'borin', bName: 'sera' });
  });

  it('spawns a feud thread once arguments drive affinity to the floor', () => {
    const { persistence, recorder, seed } = setup();
    seed('a');
    seed('b');
    // Five arguments (-4 each) drop affinity to -20, past the -18 threshold.
    for (let i = 1; i <= 5; i += 1) {
      interact(recorder, 'a', 'b', 'overheard_argument', i);
    }
    const threads = relationshipThreads(persistence);
    expect(threads).toHaveLength(1);
    expect(threads[0].payload.kind).toBe('feud');
  });

  it('spawns only one relationship thread per pair, even on a re-crossing', () => {
    const { persistence, recorder, seed } = setup();
    seed('a');
    seed('b');
    for (let i = 1; i <= 6; i += 1) {
      interact(recorder, 'a', 'b', 'shared_drink', i); // → 18, spawns
    }
    interact(recorder, 'a', 'b', 'overheard_argument', 7); // 18 → 14, dips below
    interact(recorder, 'a', 'b', 'shared_drink', 8); // 14 → 17
    interact(recorder, 'a', 'b', 'shared_drink', 9); // 17 → 20, re-crosses
    expect(relationshipThreads(persistence)).toHaveLength(1);
  });

  it('does not spawn a thread without a threadRunner', () => {
    const persistence = new Persistence(':memory:');
    const recorder = new CharacterMemoryRecorder(persistence); // no runner
    for (const id of ['a', 'b']) {
      persistence.upsertCharacter({
        id,
        displayName: id,
        archetype: 'wanderer',
        firstSeenGameDay: 1,
        lastSeenGameDay: 1,
        visitCount: 1,
        memory: emptyMemory(),
      });
    }
    for (let i = 1; i <= 6; i += 1) {
      interact(recorder, 'a', 'b', 'shared_drink', i);
    }
    expect(persistence.loadAllThreads()).toHaveLength(0);
  });
});
