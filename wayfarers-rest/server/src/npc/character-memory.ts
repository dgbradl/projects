/**
 * Phase 7 (A2): character memory.
 *
 * A `Character` carries a `CharacterMemory` between visits. This module owns
 * the pure update functions that fold new facts into a memory, plus the
 * `CharacterMemoryRecorder` that subscribes to the world event bus and keeps
 * each character's record current as events flow.
 */
import type {
  CharacterEncounter,
  CharacterMemory,
  EventLogEntry,
  Interaction,
  InteractionKind,
  WorldEvent,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';

/** Cap on `rumorsHeard` so a long-lived character's memory stays bounded. */
const RUMORS_HEARD_CAP = 50;

const INTERACTION_KINDS: ReadonlySet<string> = new Set<InteractionKind>([
  'shared_drink',
  'overheard_argument',
  'whispered_exchange',
  'silent_recognition',
]);

/** A fresh, empty memory record. */
export function emptyMemory(): CharacterMemory {
  return { rumorsHeard: [], encounters: [], timesBeckoned: 0, timesMarked: 0 };
}

/** Parse a stored memory JSON blob, tolerating missing or malformed fields. */
export function parseCharacterMemory(json: string | null | undefined): CharacterMemory {
  if (!json) return emptyMemory();
  let raw: Partial<CharacterMemory>;
  try {
    raw = JSON.parse(json) as Partial<CharacterMemory>;
  } catch {
    return emptyMemory();
  }
  return {
    rumorsHeard: Array.isArray(raw.rumorsHeard)
      ? raw.rumorsHeard.filter((x): x is string => typeof x === 'string')
      : [],
    encounters: Array.isArray(raw.encounters)
      ? raw.encounters.filter(isEncounter)
      : [],
    timesBeckoned: typeof raw.timesBeckoned === 'number' ? raw.timesBeckoned : 0,
    timesMarked: typeof raw.timesMarked === 'number' ? raw.timesMarked : 0,
    lastDestinationLocationId:
      typeof raw.lastDestinationLocationId === 'string'
        ? raw.lastDestinationLocationId
        : undefined,
  };
}

function isEncounter(x: unknown): x is CharacterEncounter {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.characterId === 'string' &&
    typeof e.lastKind === 'string' &&
    INTERACTION_KINDS.has(e.lastKind) &&
    typeof e.count === 'number' &&
    typeof e.lastGameDay === 'number'
  );
}

// ---------- pure update functions ----------

/** Record rumor ids carried into the tavern; deduped, newest-kept, capped. */
export function rememberRumors(
  memory: CharacterMemory,
  rumorIds: readonly string[],
): CharacterMemory {
  if (rumorIds.length === 0) return memory;
  const merged = [...memory.rumorsHeard];
  for (const id of rumorIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return { ...memory, rumorsHeard: merged.slice(-RUMORS_HEARD_CAP) };
}

/** Record an interaction with another character, aggregating per character. */
export function rememberEncounter(
  memory: CharacterMemory,
  otherCharacterId: string,
  kind: InteractionKind,
  gameDay: number,
): CharacterMemory {
  const encounters = memory.encounters.map((e) => ({ ...e }));
  const existing = encounters.find((e) => e.characterId === otherCharacterId);
  if (existing) {
    existing.count += 1;
    existing.lastKind = kind;
    existing.lastGameDay = gameDay;
  } else {
    encounters.push({
      characterId: otherCharacterId,
      lastKind: kind,
      count: 1,
      lastGameDay: gameDay,
    });
  }
  return { ...memory, encounters };
}

/** Record that the keeper summoned this character with a beckon. */
export function rememberBeckon(memory: CharacterMemory): CharacterMemory {
  return { ...memory, timesBeckoned: memory.timesBeckoned + 1 };
}

/** Record that the keeper marked this character for attention. */
export function rememberMark(memory: CharacterMemory): CharacterMemory {
  return { ...memory, timesMarked: memory.timesMarked + 1 };
}

/** Record the location this character last set out toward. */
export function rememberDeparture(
  memory: CharacterMemory,
  locationId: string,
): CharacterMemory {
  return { ...memory, lastDestinationLocationId: locationId };
}

// ---------- bus recorder ----------

/**
 * Subscribes to the world event bus and folds the relevant events into each
 * character's memory: interactions, departures, and keeper marks. Rumors heard
 * and beckons are recorded at materialize time (see `materializeArrival`),
 * since those facts aren't carried by a discrete event.
 */
export class CharacterMemoryRecorder {
  constructor(private readonly persistence: Persistence) {}

  attach(bus: WorldEventBus): void {
    bus.on('world_event', (entry: EventLogEntry) => this.handle(entry.event));
  }

  /** Apply one world event to character memory. Exposed for tests. */
  handle(event: WorldEvent): void {
    switch (event.type) {
      case 'interaction':
        this.onInteraction(event.interaction);
        break;
      case 'npc_departed':
        if (event.destinationLocationId) {
          const dest = event.destinationLocationId;
          this.update(event.npcId, (m) => rememberDeparture(m, dest));
        }
        break;
      case 'npc_marked':
        this.update(event.npcId, rememberMark);
        break;
      default:
        break;
    }
  }

  private onInteraction(interaction: Interaction): void {
    const [aId, bId] = interaction.participantIds;
    if (!aId || !bId) return;
    this.update(aId, (m) =>
      rememberEncounter(m, bId, interaction.kind, interaction.gameDay),
    );
    this.update(bId, (m) =>
      rememberEncounter(m, aId, interaction.kind, interaction.gameDay),
    );
  }

  private update(
    characterId: string,
    fn: (memory: CharacterMemory) => CharacterMemory,
  ): void {
    const character = this.persistence.loadCharacter(characterId);
    if (!character) return;
    this.persistence.upsertCharacter({
      ...character,
      memory: fn(character.memory),
    });
  }
}
