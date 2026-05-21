import { describe, expect, it } from 'vitest';
import type { Character, ScheduledArrival } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { emptyMemory } from '../src/npc/character-memory.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SUB_TICKS_PER_DAY = 60;

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: 'char-seed', subTicksPerDay: SUB_TICKS_PER_DAY },
    { persistence, bus },
  );
  return { persistence, bus, npcManager };
}

/** Drive a whole game day of sub-ticks so every queued arrival materializes. */
function runDay(npcManager: NpcManager, gameDay: number) {
  for (let st = 0; st < SUB_TICKS_PER_DAY; st += 1) {
    npcManager.onSubTick(gameDay, st);
  }
}

describe('Persistence — characters', () => {
  it('upserts, loads, and lists characters', () => {
    const { persistence } = build();
    expect(persistence.loadCharacter('c1')).toBeNull();

    const c: Character = {
      id: 'c1',
      displayName: 'Borin Stonepath',
      archetype: 'merchant',
      firstSeenGameDay: 3,
      lastSeenGameDay: 3,
      visitCount: 1,
      memory: emptyMemory(),
    };
    persistence.upsertCharacter(c);
    expect(persistence.loadCharacter('c1')).toEqual(c);

    persistence.upsertCharacter({ ...c, lastSeenGameDay: 9, visitCount: 4 });
    expect(persistence.loadCharacter('c1')?.visitCount).toBe(4);
    expect(persistence.loadCharacter('c1')?.firstSeenGameDay).toBe(3);
    expect(persistence.loadAllCharacters()).toHaveLength(1);
  });
});

describe('NpcManager — character identity', () => {
  it('creates a Character with visitCount 1 for each new arrival', () => {
    const { persistence, npcManager } = build();
    npcManager.onMacroTick(1);
    const queued = npcManager.getSpawnQueue().length;
    expect(queued).toBeGreaterThan(0);

    runDay(npcManager, 1);

    const characters = persistence.loadAllCharacters();
    expect(characters.length).toBe(queued);
    for (const c of characters) {
      expect(c.visitCount).toBe(1);
      expect(c.firstSeenGameDay).toBe(1);
      expect(c.lastSeenGameDay).toBe(1);
    }
  });

  it('a returning character keeps id + archetype and bumps visitCount', () => {
    const { persistence, npcManager } = build();
    // A character who has already visited once, before this run.
    persistence.upsertCharacter({
      id: 'regular-1',
      displayName: 'Iliana Brookfoot',
      archetype: 'scholar',
      firstSeenGameDay: 1,
      lastSeenGameDay: 1,
      visitCount: 1,
      memory: emptyMemory(),
    });
    // Schedule them to return on day 2. The archetype here is the
    // non-canonical 'returning_traveler' string the journey thread uses —
    // materialize must ignore it in favour of the stored archetype.
    const arrival: ScheduledArrival = {
      npcId: 'regular-1',
      displayName: 'Iliana Brookfoot',
      scheduledGameDay: 2,
      scheduledSubTick: 0,
      archetype: 'returning_traveler',
    };
    persistence.saveScheduledArrival(arrival);

    npcManager.onMacroTick(2); // merges the scheduled arrival into the queue
    npcManager.onSubTick(2, 0); // sub-tick 0 materializes it

    const returned = npcManager.getRoster().find((n) => n.id === 'regular-1');
    expect(returned).toBeDefined();
    expect(returned!.displayName).toBe('Iliana Brookfoot');
    // Not downgraded to 'wanderer' via canonicalizeArchetype.
    expect(returned!.archetype).toBe('scholar');

    const character = persistence.loadCharacter('regular-1')!;
    expect(character.visitCount).toBe(2);
    expect(character.archetype).toBe('scholar');
    expect(character.firstSeenGameDay).toBe(1);
    expect(character.lastSeenGameDay).toBe(2);
  });

  it('records carried rumors and a beckon into the arriving character', () => {
    const { persistence, npcManager } = build();
    persistence.saveScheduledArrival({
      npcId: 'beckoned-1',
      displayName: 'Garrick Vale',
      scheduledGameDay: 1,
      scheduledSubTick: 0,
      carriedRumorIds: ['rumor-a', 'rumor-b'],
      wasBeckoned: true,
    });

    npcManager.onMacroTick(1); // merges the scheduled arrival
    npcManager.onSubTick(1, 0); // materializes it

    const memory = persistence.loadCharacter('beckoned-1')!.memory;
    expect(memory.rumorsHeard).toEqual(['rumor-a', 'rumor-b']);
    expect(memory.timesBeckoned).toBe(1);
  });

  it('emits npc_returned for a regular and npc_arrived for newcomers', () => {
    const { persistence, npcManager } = build();
    persistence.upsertCharacter({
      id: 'regular-2',
      displayName: 'Old Sten',
      archetype: 'soldier',
      firstSeenGameDay: 1,
      lastSeenGameDay: 1,
      visitCount: 1,
      memory: emptyMemory(),
    });
    persistence.saveScheduledArrival({
      npcId: 'regular-2',
      displayName: 'Old Sten',
      scheduledGameDay: 2,
      scheduledSubTick: 0,
    });

    npcManager.onMacroTick(2);
    runDay(npcManager, 2);

    const events = persistence.getEventsSince(0).map((e) => e.event);
    const returned = events.find(
      (e) => e.type === 'npc_returned' && e.npcId === 'regular-2',
    );
    expect(returned).toMatchObject({ visitCount: 2, displayName: 'Old Sten' });
    // The day-2 strangers from the spawn queue still arrive as newcomers.
    expect(events.some((e) => e.type === 'npc_arrived')).toBe(true);
  });
});
