import { EventEmitter } from 'node:events';
import type {
  ArrivalGarnish,
  Character,
  DesireKind,
  Npc,
  NpcArchetype,
  NpcDesire,
  NpcDiff,
  NpcMood,
  ScheduledArrival,
} from '@shared/types';
import { tierForScore } from '@shared/types';
import { computeGuestSpend, totalSpend } from '../economy/spend.ts';
import type { WorldEventBus } from '../events/emitter.ts';
import type { FurnitureManager } from '../furniture/manager.ts';
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
import { generateDesires } from './desires.ts';
import { buildEarnedName, EARNED_NAME_THRESHOLD } from './earned-names.ts';
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

/**
 * Phase 9 (H1): a returning character carries their last-visit unmet
 * desire forward only if the gap between visits is within this many game
 * days. Past it, the wish has gone stale and the fresh roll wins.
 */
export const RECENT_CARRYOVER_DAYS = 10;

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
  /** Z3: when present, NPCs snap to chair sprites and cluster around
   *  furniture during their decision tick. Tests can omit. */
  furnitureManager?: FurnitureManager;
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
  /**
   * Phase 9 (G2): per-merchant transactions tally for the day. Read by
   * `computeGuestSpend` at departure for the coin bump and by
   * `processMerchantTransaction` to enforce the daily cap. Cleared in
   * `onMacroTick`.
   */
  public transactionsToday = new Map<string, number>();

  constructor(
    private readonly config: NpcManagerConfig,
    private readonly deps: NpcManagerDeps = {} as NpcManagerDeps,
  ) {
    super();
  }

  hydrate(snapshot: RosterSnapshot): void {
    // Z1: clamp loaded positions into WALKABLE (old DB rows from before
    // WALKABLE existed snap inward). Z2: defensively reseat any non-staff
    // NPC stuck in the bar_back zone (impossible going forward, but covers
    // pre-Z2 rows). Both passes are idempotent for fresh data.
    this.roster = new Map(
      snapshot.npcs.map((n) => {
        let next: Npc = n;
        const clamped = clampToWalkable(n.position);
        if (clamped.x !== n.position.x || clamped.y !== n.position.y) {
          next = { ...next, position: clamped };
        }
        if (next.zone === 'bar_back' && !next.isStaff) {
          next = { ...next, zone: 'bar' };
        }
        return [next.id, next];
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

  /**
   * Phase 8 (A2): mark a single desire on a roster member as fulfilled.
   * Returns true if the desire was found unfulfilled and was updated;
   * false otherwise (no matching desire, already fulfilled, or NPC absent).
   * Emits a roster diff so the client tooltip can light the chip gold.
   */
  markDesireFulfilled(
    npcId: string,
    kind: DesireKind,
    param: string | undefined,
    by: string,
    absSubTick: number,
  ): boolean {
    const npc = this.roster.get(npcId);
    if (!npc || !npc.desires) return false;
    let mutated = false;
    const next = npc.desires.map((d) => {
      if (mutated) return d;
      if (
        d.kind === kind &&
        d.param === param &&
        d.fulfilledAtSubTick === undefined
      ) {
        mutated = true;
        return { ...d, fulfilledAtSubTick: absSubTick, fulfilledBy: by };
      }
      return d;
    });
    if (!mutated) return false;
    const updated: Npc = { ...npc, desires: next };
    this.roster.set(npcId, updated);
    this.emit('diff', { added: [], updated: [updated], removed: [] });
    return true;
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
    const tavernState = this.deps.persistence?.loadState();
    // Economy (E2): the tavern's prosperity shapes how full the next day is.
    const prosperity = tavernState?.prosperity;
    this.spawnQueue = generateSpawnQueue({
      worldSeed: this.config.worldSeed,
      gameDay: newGameDay,
      subTicksPerDay: this.config.subTicksPerDay,
      worldTags,
      prosperityTier:
        prosperity != null ? tierForScore(prosperity) : undefined,
      // Phase 8 (D3): the keeper's chosen identity tilts the archetype mix.
      tavernTraits: tavernState?.tavernTraits,
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
    // Phase 9 (G2): reset merchant transaction tally too.
    this.transactionsToday.clear();
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
    // Z3: snapshot furniture + roster once per sub-tick so every NPC's
    // decision sees the same picture (no order-dependence inside the loop).
    const furniture = this.deps.furnitureManager?.list();
    const rosterSnapshot = [...this.roster.values()];
    for (const [id, npc] of this.roster) {
      if (diff.added.find((a) => a.id === id)) continue;
      if (absSubTick < npc.nextDecisionSubTick) continue;
      const { npc: next, changed } = decideNextState(npc, {
        absSubTick,
        worldSeed,
        subTicksPerDay,
        furniture,
        roster: rosterSnapshot,
        selfId: id,
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
          // Phase 8 (A2): snapshot of desires at departure so the
          // DesireResolver can emit desire_unfulfilled for any unmet ones
          // after the NPC has been pruned from the roster. Staff have no
          // desires; the field is `undefined` for them, which is correct.
          desires: npc.desires,
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
          const fulfilledDesireCount = npc.desires
            ? npc.desires.reduce(
                (acc, d) =>
                  acc + (d.fulfilledAtSubTick !== undefined ? 1 : 0),
                0,
              )
            : 0;
          // Phase 9 (G2): merchants get a coin bump per transaction they
          // closed today. Non-merchants always have 0 here.
          const merchantTransactionCount = this.transactionsToday.get(id) ?? 0;
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
            // Phase 8 (A5): a satisfied guest tips more. Each fulfilled
            // desire draws an extra rngInt(2,5) on top of the base tip.
            fulfilledDesireCount,
            // Phase 9 (G2): a closing-deal bump for the merchant's tab.
            merchantTransactionCount,
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

  // Phase 9 (H2): once a regular has reached the threshold, dress up their
  // placeholder name with an archetype-flavoured epithet. Sticky once
  // generated — earned names persist for the life of the Character.
  if (
    !character.earnedName &&
    character.visitCount >= EARNED_NAME_THRESHOLD &&
    !character.isStaff
  ) {
    const earned = buildEarnedName({
      baseDisplayName: character.displayName,
      archetype: character.archetype,
      characterId: character.id,
      worldSeed,
    });
    if (earned) {
      character.earnedName = earned.displayName;
      character.earnedTagline = earned.tagline;
    }
  }

  persistence.upsertCharacter(character);

  // Phase 9 (H2): prefer the earned name on the live Npc so the sprite
  // label + tooltip show "Old Marrick" instead of "Marrick" the moment
  // the threshold is crossed. The base displayName stays on Character
  // for replay / debug, but isn't surfaced past this point.
  const liveDisplayName = character.earnedName ?? displayName;

  // Phase 8 (A1): each non-staff arrival picks up 1–2 desires deterministically
  // from their archetype's pool. The roster shows them in the hover tooltip;
  // later slices wire fulfilment by sim/staff/keeper and the economy outcome.
  let desires = generateDesires({
    archetype,
    npcId: arrival.npcId,
    worldSeed,
  });

  // Phase 9 (H1): if this is a returning character whose last visit ended
  // with an unmet wish AND the gap since then is short enough that the wish
  // still feels live, overlay one of those carryover desires onto this visit.
  // The first generated slot is replaced (count stays the same) and the
  // overlaid desire is marked `carryover: true` so the salience scorer can
  // call out the repeat if it goes unmet again.
  if (
    existingCharacter &&
    existingCharacter.visitCount >= 1 &&
    existingCharacter.memory.lastUnfulfilledDesires &&
    existingCharacter.memory.lastUnfulfilledDesires.length > 0 &&
    existingCharacter.memory.lastUnfulfilledAtGameDay !== undefined &&
    currentGameDay - existingCharacter.memory.lastUnfulfilledAtGameDay <=
      RECENT_CARRYOVER_DAYS
  ) {
    const carry: NpcDesire = {
      ...existingCharacter.memory.lastUnfulfilledDesires[0],
      carryover: true,
    };
    if (desires.length === 0) {
      desires = [carry];
    } else {
      // Skip the overlay if the freshly-generated desires already include
      // the same wish — no need to mark it carryover (the visit naturally
      // wants the same thing) and the chip would dupe.
      const dupIdx = desires.findIndex(
        (d) => d.kind === carry.kind && d.param === carry.param,
      );
      if (dupIdx >= 0) {
        desires = desires.map((d, i) =>
          i === dupIdx ? { ...d, carryover: true } : d,
        );
      } else {
        desires = [carry, ...desires.slice(1)];
      }
    }
  }

  return {
    id: arrival.npcId,
    // Phase 9 (H2): a regular past EARNED_NAME_THRESHOLD shows their
    // honorific name on the sprite label + tooltip from arrival on.
    displayName: liveDisplayName,
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
    // Phase 9 (H2): earned tagline wins over the arrival garnish tagline
    // once a character has earned one — it's the stickier "who they are".
    tagline: character.earnedTagline ?? garnish.tagline ?? undefined,
    item: garnish.item || undefined,
    mood,
    wasBeckoned: arrival.wasBeckoned,
    visitCount: character.visitCount,
    desires: desires.length > 0 ? desires : undefined,
  };
}
