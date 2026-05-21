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
import type { ThreadRunner } from '../threads/runner.ts';

/** Cap on `rumorsHeard` so a long-lived character's memory stays bounded. */
const RUMORS_HEARD_CAP = 50;

/** Phase 7 (B1): affinity is clamped to this signed range. */
export const AFFINITY_MIN = -25;
export const AFFINITY_MAX = 25;

/** How much each interaction kind nudges a pair's affinity. */
const AFFINITY_DELTAS: Record<InteractionKind, number> = {
  shared_drink: 3,
  silent_recognition: 1,
  whispered_exchange: 1,
  overheard_argument: -4,
};

/** Clamp an affinity value into [AFFINITY_MIN, AFFINITY_MAX]. */
export function clampAffinity(value: number): number {
  return Math.max(AFFINITY_MIN, Math.min(AFFINITY_MAX, value));
}

/**
 * Phase 7 (B3): affinity magnitude at which a relationship thread spawns —
 * a friendship at +threshold, a feud at -threshold.
 */
export const RELATIONSHIP_THRESHOLD = 18;

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
      ? raw.encounters
          .map(readEncounter)
          .filter((e): e is CharacterEncounter => e !== null)
      : [],
    timesBeckoned: typeof raw.timesBeckoned === 'number' ? raw.timesBeckoned : 0,
    timesMarked: typeof raw.timesMarked === 'number' ? raw.timesMarked : 0,
    lastDestinationLocationId:
      typeof raw.lastDestinationLocationId === 'string'
        ? raw.lastDestinationLocationId
        : undefined,
  };
}

/**
 * Validate and normalize one stored encounter. Returns null for malformed
 * entries; fills a missing `affinity` (encounters written before B1) with 0.
 */
function readEncounter(x: unknown): CharacterEncounter | null {
  if (typeof x !== 'object' || x === null) return null;
  const e = x as Record<string, unknown>;
  if (
    typeof e.characterId !== 'string' ||
    typeof e.lastKind !== 'string' ||
    !INTERACTION_KINDS.has(e.lastKind) ||
    typeof e.count !== 'number' ||
    typeof e.lastGameDay !== 'number'
  ) {
    return null;
  }
  return {
    characterId: e.characterId,
    lastKind: e.lastKind as InteractionKind,
    count: e.count,
    lastGameDay: e.lastGameDay,
    affinity: typeof e.affinity === 'number' ? clampAffinity(e.affinity) : 0,
  };
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
  const delta = AFFINITY_DELTAS[kind];
  const encounters = memory.encounters.map((e) => ({ ...e }));
  const existing = encounters.find((e) => e.characterId === otherCharacterId);
  if (existing) {
    existing.count += 1;
    existing.lastKind = kind;
    existing.lastGameDay = gameDay;
    existing.affinity = clampAffinity(existing.affinity + delta);
  } else {
    encounters.push({
      characterId: otherCharacterId,
      lastKind: kind,
      count: 1,
      lastGameDay: gameDay,
      affinity: clampAffinity(delta),
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
 *
 * Phase 7 (B3): when an interaction pushes a pair's affinity past
 * `RELATIONSHIP_THRESHOLD`, the recorder also spawns a relationship thread
 * (requires a `threadRunner`).
 */
export class CharacterMemoryRecorder {
  constructor(
    private readonly persistence: Persistence,
    private readonly threadRunner?: ThreadRunner,
  ) {}

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
    const affinityBefore = this.affinityBetween(aId, bId);
    this.update(aId, (m) =>
      rememberEncounter(m, bId, interaction.kind, interaction.gameDay),
    );
    this.update(bId, (m) =>
      rememberEncounter(m, aId, interaction.kind, interaction.gameDay),
    );
    this.maybeSpawnRelationship(aId, bId, affinityBefore, interaction.gameDay);
  }

  /**
   * Spawn a relationship thread when this interaction pushed the pair's
   * affinity across an extreme for the first time.
   */
  private maybeSpawnRelationship(
    aId: string,
    bId: string,
    affinityBefore: number,
    gameDay: number,
  ): void {
    if (!this.threadRunner) return;
    const after = this.affinityBetween(aId, bId);
    let kind: 'friendship' | 'feud' | undefined;
    if (
      affinityBefore < RELATIONSHIP_THRESHOLD &&
      after >= RELATIONSHIP_THRESHOLD
    ) {
      kind = 'friendship';
    } else if (
      affinityBefore > -RELATIONSHIP_THRESHOLD &&
      after <= -RELATIONSHIP_THRESHOLD
    ) {
      kind = 'feud';
    }
    if (!kind) return;
    if (this.hasRelationshipThread(aId, bId)) return;
    const a = this.persistence.loadCharacter(aId);
    const b = this.persistence.loadCharacter(bId);
    this.threadRunner.startThread({
      type: 'relationship',
      payload: {
        aId,
        bId,
        aName: a?.displayName ?? aId,
        bName: b?.displayName ?? bId,
        kind,
      },
      gameDay,
    });
  }

  /** a's current affinity toward b (0 if they have no encounter on record). */
  private affinityBetween(aId: string, bId: string): number {
    const character = this.persistence.loadCharacter(aId);
    const encounter = character?.memory.encounters.find(
      (e) => e.characterId === bId,
    );
    return encounter?.affinity ?? 0;
  }

  /** True if a relationship thread already exists for this unordered pair. */
  private hasRelationshipThread(aId: string, bId: string): boolean {
    return this.persistence.loadAllThreads().some((t) => {
      if (t.type !== 'relationship') return false;
      const p = t.payload as { aId?: unknown; bId?: unknown };
      return (
        (p.aId === aId && p.bId === bId) || (p.aId === bId && p.bId === aId)
      );
    });
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
