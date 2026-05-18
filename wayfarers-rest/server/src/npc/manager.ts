import { EventEmitter } from 'node:events';
import type {
  Npc,
  NpcDiff,
  ScheduledArrival,
  WorldTag,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';
import { randomLocation } from '../world/locations.ts';
import { seededRng } from '../world/rng.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import { decideNextState, jitterInsideZone } from './behavior.ts';
import {
  absoluteSubTick,
  generateDeparture,
  generateSpawnQueue,
} from './spawn.ts';

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
    this.roster = new Map(snapshot.npcs.map((n) => [n.id, n]));
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

  getSpawnQueue(): ScheduledArrival[] {
    return [...this.spawnQueue];
  }

  /**
   * Day-tick: prune departed, regenerate spawn queue (with tag modulation),
   * merge in any thread-scheduled arrivals for this day, reset interaction caps.
   */
  onMacroTick(newGameDay: number): void {
    for (const [id, npc] of this.roster) {
      if (npc.status === 'departed') this.roster.delete(id);
    }

    const worldTags = this.deps.persistence?.getAllWorldTags() ?? [];
    this.spawnQueue = generateSpawnQueue({
      worldSeed: this.config.worldSeed,
      gameDay: newGameDay,
      subTicksPerDay: this.config.subTicksPerDay,
      worldTags,
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
        );
        this.roster.set(npc.id, npc);
        diff.added.push(npc);
        this.deps.bus?.publish({
          type: 'npc_arrived',
          gameDay: currentGameDay,
          npcId: npc.id,
          displayName: npc.displayName,
        });
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
          destinationLocationId: destination,
        });
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
        ) ?? [];
  return {
    id: arrival.npcId,
    displayName: arrival.displayName,
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
    archetype: arrival.archetype,
  };
}
