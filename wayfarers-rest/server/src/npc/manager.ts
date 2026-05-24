import { EventEmitter } from 'node:events';
import type {
  ArrivalGarnish,
  Character,
  Npc,
  NpcArchetype,
  NpcDiff,
  NpcMood,
  ScheduledArrival,
} from '@shared/types';
import { tierForScore } from '@shared/types';
import { computeGuestSpend, totalSpend } from '../economy/spend.ts';
import type { WorldEventBus } from '../events/emitter.ts';
import type { FlavorCache } from '../llm/cache/manager.ts';
import type { ArrivalInput } from '../llm/slots/arrival.ts';
import type { Persistence } from '../persistence.ts';
import { locationById, randomLocation } from '../world/locations.ts';
import { rngPick, seededRng } from '../world/rng.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import { clampToWalkable, decideNextState, jitterInsideZone } from './behavior.ts';
import {
  emptyMemory,
  rememberBeckon,
  rememberRumors,
} from './character-memory.ts';
import {
  ALL_STAFF_DEFINITIONS,
  makeStaffNpc,
} from './staff-roster.ts';
import {
  absoluteSubTick,
  generateDeparture,
  generateSpawnQueue,
} from './spawn.ts';

const MOODS: NpcMood[] = [
  'cheerful',
  'anxious',
  'weary',
  'guarded',
  'desperate',
  'smug',
];

const CANONICAL_ARCHETYPES: ReadonlySet<NpcArchetype> = new Set([
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
  'mage',
  'knight',
  'bard',
  'hunter',
]);

function canonicalizeArchetype(raw?: string): NpcArchetype {
  if (raw && (CANONICAL_ARCHETYPES as Set<string>).has(raw)) {
    return raw as NpcArchetype;
  }
  // Thread-spawned archetypes get mapped to the closest fit.
  switch (raw) {
    case 'returning_traveler':
    case 'wanderer_returning':
      return 'wanderer';
    case 'investigator':
      return 'rogue';
    case 'sour_merchant':
      return 'merchant';
    default:
      return 'wanderer';
  }
}

export interface RosterSnapshot {
  npcs: Npc[];
  spawnQueue: ScheduledArrival[];
}

export interface NpcManagerConfig {
  worldSeed: string;
  subTicksPerDay: number;
}

export interface NpcManagerDeps {
  persistence: Persistence;
  bus?: WorldEventBus;
  rumors?: RumorsManager;
  threadRunner?: ThreadRunner;
  flavorCache?: FlavorCache;
  /**
   * Called after a sub-tick has applied its NPC changes. Used by index.ts to
   * run interaction detection + resolution. Tests can omit.
   */
  postSubTickHook?: (gameDay: number, subTick: number, roster: Npc[]) => void;
}

export class NpcManager extends EventEmitter {
  private roster = new Map<string, Npc>();
  private spawnQueue: ScheduledArrival[] = [];
  /** Per-NPC interaction counts for the current game day. */
  public interactionsToday = new Map<string, number>();
  public pairsToday = new Set<string>();

  constructor(
    private readonly config: NpcManagerConfig,
    private readonly deps: NpcManagerDeps = {} as NpcManagerDeps,
  ) {
    super();
  }

  hydrate(snapshot: RosterSnapshot): void {
    // Z1: any NPC loaded with a position inside the wall band drifts inward
    // immediately, so old DB rows from before WALKABLE existed don't render
    // on the wall. Idempotent for fresh data.
    this.roster = new Map(
      snapshot.npcs.map((n) => {
        const clamped = clampToWalkable(n.position);
        const npc: Npc =
          clamped.x === n.position.x && clamped.y === n.position.y
            ? n
            : { ...n, position: clamped };
        return [npc.id, npc];
      }),
    );
    this.spawnQueue = [...snapshot.spawnQueue];
  }

  snapshot(): RosterSnapshot {
    return {
      npcs: [...this.roster.values()],
      spawnQueue: [...this.spawnQueue],
    };
  }

  getRoster(): Npc[] {
    return [...this.roster.values()];
  }

  /** Apply a gossip transfer: add rumorId to recipient's carriedRumorIds. */
  applyGossip(recipientId: string, rumorId: string): void {
    const npc = this.roster.get(recipientId);
    if (!npc || npc.carriedRumorIds.includes(rumorId)) return;
    const updated: Npc = {
      ...npc,
      carriedRumorIds: [...npc.carriedRumorIds, rumorId],
    };
    this.roster.set(recipientId, updated);
    this.emit('diff', { added: [], updated: [updated], removed: [] });
  }

  /** Extend a traveler's planned departure by the given number of sub-ticks. */
  extendDeparture(npcId: string, subTicks: number): void {
    const npc = this.roster.get(npcId);
    if (!npc || npc.isStaff || subTicks <= 0) return;
    const updated: Npc = {
      ...npc,
      plannedDepartureSubTick: npc.plannedDepartureSubTick + subTicks,
    };
    this.roster.set(npcId, updated);
    this.emit('diff', { added: [], updated: [updated], removed: [] });
  }

  getSpawnQueue(): ScheduledArrival[] {
    return [...this.spawnQueue];
  }

  /**
   * Re-insert active staff into the roster if absent. Safe to call any time;
   * skips staff already present. Emits a diff if any were added.
   */
  ensureStaffOnDuty(gameDay: number, subTick: number): void {
    const activeChars = this.deps.persistence?.loadActiveStaffCharacters() ?? [];
    const diff: NpcDiff = { added: [], updated: [], removed: [] };

    for (const char of activeChars) {
      if (this.roster.has(char.id)) continue;
      const def = ALL_STAFF_DEFINITIONS.find((d) => d.id === char.id);
      if (!def) continue;
      const abs = absoluteSubTick(gameDay, subTick, this.config.subTicksPerDay);
      const npc = makeStaffNpc(char, def, abs, this.config.worldSeed);
      this.roster.set(npc.id, npc);
      diff.added.push(npc);
    }

    if (diff.added.length) this.emit('diff', diff);
  }

  /** Remove a staff member from the live roster (used by hire/fire swap). */
  removeFromRoster(id: string): void {
    if (!this.roster.has(id)) return;
    this.roster.delete(id);
    this.emit('diff', { added: [], updated: [], removed: [id] });
  }

  /**
   * Day-tick: prune departed, regenerate spawn queue (with tag modulation),
   * merge in any thread-scheduled arrivals for this day, reset interaction caps.
   */
  onMacroTick(newGameDay: number): void {
    for (const [id, npc] of this.roster) {
      if (npc.status === 'departed') this.roster.delete(id);
    }
    this.ensureStaffOnDuty(newGameDay, 0);

    const worldTags = this.deps.persistence?.getAllWorldTags() ?? [];
    // Economy (E2): the tavern's prosperity shapes how full the next day is.
    const prosperity = this.deps.persistence?.loadState()?.prosperity;
    this.spawnQueue = generateSpawnQueue({
      worldSeed: this.config.worldSeed,
      gameDay: newGameDay,
      subTicksPerDay: this.config.subTicksPerDay,
      worldTags,
      prosperityTier:
        prosperity != null ? tierForScore(prosperity) : undefined,
    });

    // Merge thread-scheduled arrivals into today's queue.
    const threadArrivals =
      this.deps.persistence?.loadScheduledArrivalsForDay(newGameDay) ?? [];
    for (const a of threadArrivals) {
      this.spawnQueue.push(a);
      this.deps.persistence?.deleteScheduledArrival(a.npcId);
    }
    this.spawnQueue.sort((a, b) => a.scheduledSubTick - b.scheduledSubTick);

    this.interactionsToday.clear();
    this.pairsToday.clear();
  }

  /**
   * Advance NPCs by one sub-tick. Returns a diff describing roster changes.
   * Side-effects:
   *  - emits npc_arrived / npc_departed via bus
   *  - spawns travelers_journey threads for departures
   *  - calls the post-sub-tick hook (interactions) at the end
   */
  onSubTick(currentGameDay: number, currentSubTick: number): NpcDiff {
    const { worldSeed, subTicksPerDay } = this.config;
    const absSubTick = absoluteSubTick(
      currentGameDay,
      currentSubTick,
      subTicksPerDay,
    );
    const diff: NpcDiff = { added: [], updated: [], removed: [] };

    // 1) Promote any scheduled arrivals whose time has come.
    const remainingQueue: ScheduledArrival[] = [];
    for (const arrival of this.spawnQueue) {
      const arrivalAbs = absoluteSubTick(
        arrival.scheduledGameDay,
        arrival.scheduledSubTick,
        subTicksPerDay,
      );
      if (arrivalAbs <= absSubTick) {
        const npc = materializeArrival(
          arrival,
          absSubTick,
          subTicksPerDay,
          worldSeed,
          this.deps.rumors,
          this.deps.flavorCache,
          currentGameDay,
          this.deps.persistence,
        );
        this.roster.set(npc.id, npc);
        diff.added.push(npc);
        // Phase 7 (A3): a returning regular gets a distinct event carrying
        // their visit count; first-timers still emit npc_arrived.
        if (npc.visitCount && npc.visitCount > 1) {
          this.deps.bus?.publish({
            type: 'npc_returned',
            gameDay: currentGameDay,
            npcId: npc.id,
            displayName: npc.displayName,
            visitCount: npc.visitCount,
          });
        } else {
          this.deps.bus?.publish({
            type: 'npc_arrived',
            gameDay: currentGameDay,
            npcId: npc.id,
            displayName: npc.displayName,
          });
        }
      } else {
        remainingQueue.push(arrival);
      }
    }
    this.spawnQueue = remainingQueue;

    // 2) Re-evaluate NPCs whose next decision is due.
    for (const [id, npc] of this.roster) {
      if (diff.added.find((a) => a.id === id)) continue;
      if (absSubTick < npc.nextDecisionSubTick) continue;
      const { npc: next, changed } = decideNextState(npc, {
        absSubTick,
        worldSeed,
        subTicksPerDay,
      });
      if (next.status === 'departed') {
        this.roster.delete(id);
        diff.removed.push(id);
        // Pick a destination and spawn a journey thread.
        let destination: string | undefined;
        if (this.deps.threadRunner) {
          const rng = seededRng(
            worldSeed,
            'depart-dest',
            id,
            currentGameDay,
            currentSubTick,
          );
          destination = randomLocation(rng).id;
          this.deps.threadRunner.startThread({
            type: 'travelers_journey',
            payload: {
              npcId: id,
              displayName: next.displayName,
              destinationLocationId: destination,
              trip: 'outbound',
            },
            gameDay: currentGameDay,
          });
        }
        this.deps.bus?.publish({
          type: 'npc_departed',
          gameDay: currentGameDay,
          npcId: id,
          displayName: next.displayName,
          destinationLocationId: destination,
        });
        // Economy (E1): settle the departing guest's tab. Staff never depart,
        // so this only ever fires for paying travellers.
        if (this.deps.bus && !npc.isStaff) {
          const character = this.deps.persistence?.loadCharacter(id);
          const affinitySum = character
            ? character.memory.encounters.reduce(
                (sum, e) => sum + e.affinity,
                0,
              )
            : 0;
          // Economy (E3): the larder and hearth lift meal and room spend.
          const tavern = this.deps.persistence?.loadState();
          const breakdown = computeGuestSpend({
            worldSeed,
            npcId: id,
            arrivedGameDay: npc.arrivedGameDay,
            archetype: canonicalizeArchetype(npc.archetype),
            mood: npc.mood,
            visitCount: npc.visitCount ?? 1,
            affinitySum,
            stayedOvernight:
              npc.plannedDepartureGameDay > npc.arrivedGameDay,
            larderStock: tavern?.larderStock,
            hearthLevel: tavern?.hearthLevel,
          });
          this.deps.bus.publish({
            type: 'guest_spent',
            gameDay: currentGameDay,
            npcId: id,
            amount: totalSpend(breakdown),
            breakdown,
          });
        }
      } else if (changed) {
        this.roster.set(id, next);
        diff.updated.push(next);
      }
    }

    if (diff.added.length || diff.updated.length || diff.removed.length) {
      this.emit('diff', diff);
    }

    // 3) Let the hook run interactions, which may update NPC dots indirectly.
    this.deps.postSubTickHook?.(currentGameDay, currentSubTick, this.getRoster());

    return diff;
  }

  reset(): void {
    this.roster.clear();
    this.spawnQueue = [];
  }
}

function materializeArrival(
  arrival: ScheduledArrival,
  absSubTick: number,
  subTicksPerDay: number,
  worldSeed: string,
  rumors: RumorsManager | undefined,
  flavorCache: FlavorCache | undefined,
  currentGameDay: number,
  persistence: Persistence,
): Npc {
  const rng = seededRng(worldSeed, 'materialize', arrival.npcId);
  const departure = generateDeparture({
    worldSeed,
    npcId: arrival.npcId,
    arrivedAbsoluteSubTick: absSubTick,
    subTicksPerDay,
  });
  const rumorIds =
    arrival.carriedRumorIds && arrival.carriedRumorIds.length > 0
      ? arrival.carriedRumorIds.slice(0, 2)
      : rumors?.rollAttachmentsForArrival(
          arrival,
          seededRng(worldSeed, 'rumor-attach', arrival.npcId),
          currentGameDay,
        ) ?? [];

  // Phase 7: load-or-create the durable Character behind this arrival. A
  // returning traveller arrives under their original id, so their record
  // already exists and carries the archetype + display name to restore.
  const existingCharacter = persistence.loadCharacter(arrival.npcId);

  // archetype may be set by the spawn queue (tag-modulated) or by a
  // thread-spawned arrival — the latter uses non-canonical strings like
  // 'returning_traveler'. A returning character keeps their established
  // archetype; a stranger's is canonicalized so the cache lookup works.
  const archetype = existingCharacter
    ? existingCharacter.archetype
    : canonicalizeArchetype(arrival.archetype);
  const mood = rngPick(
    seededRng(worldSeed, 'mood', arrival.npcId),
    MOODS,
  );

  // Flavor garnish: cache.take or fall through to placeholder (which itself
  // is deterministic given the NPC id).
  const origin = arrival.originLocationId
    ? locationById(arrival.originLocationId)
    : undefined;
  const placeholderInput: ArrivalInput = {
    archetype,
    mood,
    originLocationDisplayName: origin?.displayName ?? 'the road',
    originLocationKind: origin?.kind ?? 'road',
    seed: arrival.npcId,
  };
  const garnish: ArrivalGarnish = flavorCache
    ? flavorCache.take<ArrivalInput, ArrivalGarnish>('arrival', {
        subKey: archetype,
        placeholderInput,
        gameDay: currentGameDay,
      })
    : {
        name: arrival.displayName,
        tagline: '',
        item: '',
      };

  // A returning character keeps their established name; only a brand-new
  // stranger takes the cache-supplied (or queued placeholder) name.
  const displayName = existingCharacter
    ? existingCharacter.displayName
    : garnish.name || arrival.displayName;

  // Phase 7 (A2): fold this visit's facts into the character's memory —
  // rumors carried in, and a beckon if the keeper summoned them.
  let memory = existingCharacter ? existingCharacter.memory : emptyMemory();
  memory = rememberRumors(memory, rumorIds);
  if (arrival.wasBeckoned) memory = rememberBeckon(memory);

  const character: Character = existingCharacter
    ? {
        ...existingCharacter,
        lastSeenGameDay: currentGameDay,
        visitCount: existingCharacter.visitCount + 1,
        memory,
      }
    : {
        id: arrival.npcId,
        displayName,
        archetype,
        firstSeenGameDay: currentGameDay,
        lastSeenGameDay: currentGameDay,
        visitCount: 1,
        memory,
      };
  persistence.upsertCharacter(character);

  return {
    id: arrival.npcId,
    displayName,
    status: 'arriving',
    position: jitterInsideZone('door', rng),
    zone: 'door',
    arrivedGameDay: arrival.scheduledGameDay,
    arrivedSubTick: arrival.scheduledSubTick,
    plannedDepartureGameDay: departure.plannedDepartureGameDay,
    plannedDepartureSubTick: departure.plannedDepartureSubTick,
    nextDecisionSubTick: absSubTick + 1,
    carriedRumorIds: rumorIds,
    originLocationId: arrival.originLocationId,
    archetype,
    tagline: garnish.tagline || undefined,
    item: garnish.item || undefined,
    mood,
    wasBeckoned: arrival.wasBeckoned,
    visitCount: character.visitCount,
  };
}
