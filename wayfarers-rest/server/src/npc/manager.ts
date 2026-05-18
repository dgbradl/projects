import { EventEmitter } from 'node:events';
import type {
  Npc,
  NpcDiff,
  ScheduledArrival,
} from '@shared/types';
import { decideNextState, jitterInsideZone } from './behavior.ts';
import {
  absoluteSubTick,
  generateDeparture,
  generateSpawnQueue,
} from './spawn.ts';
import { seededRng } from '../world/rng.ts';

export interface RosterSnapshot {
  npcs: Npc[];
  spawnQueue: ScheduledArrival[];
}

export interface NpcManagerConfig {
  worldSeed: string;
  subTicksPerDay: number;
}

export class NpcManager extends EventEmitter {
  private roster = new Map<string, Npc>();
  private spawnQueue: ScheduledArrival[] = [];

  constructor(private readonly config: NpcManagerConfig) {
    super();
  }

  /**
   * Load a previously-persisted roster (server boot).
   */
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
   * Called when the macro day-tick advances. Drops any lingering 'departed'
   * NPCs and generates the new day's spawn queue.
   *
   * Note: NPCs whose plannedDeparture lands on a later game day persist across
   * the day boundary.
   */
  onMacroTick(newGameDay: number): void {
    for (const [id, npc] of this.roster) {
      if (npc.status === 'departed') this.roster.delete(id);
    }
    this.spawnQueue = generateSpawnQueue({
      worldSeed: this.config.worldSeed,
      gameDay: newGameDay,
      subTicksPerDay: this.config.subTicksPerDay,
    });
  }

  /**
   * Advance NPCs by one sub-tick. Returns a diff describing any roster
   * changes, ready for SSE broadcast. Manager state is mutated in place.
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
        const npc = materializeArrival(arrival, absSubTick, subTicksPerDay, worldSeed);
        this.roster.set(npc.id, npc);
        diff.added.push(npc);
      } else {
        remainingQueue.push(arrival);
      }
    }
    this.spawnQueue = remainingQueue;

    // 2) Re-evaluate any NPCs whose next decision is due.
    for (const [id, npc] of this.roster) {
      if (diff.added.find((a) => a.id === id)) continue; // just materialized
      if (absSubTick < npc.nextDecisionSubTick) continue;
      const { npc: next, changed } = decideNextState(npc, {
        absSubTick,
        worldSeed,
        subTicksPerDay,
      });
      if (next.status === 'departed') {
        this.roster.delete(id);
        diff.removed.push(id);
      } else if (changed) {
        this.roster.set(id, next);
        diff.updated.push(next);
      }
    }

    if (diff.added.length || diff.updated.length || diff.removed.length) {
      this.emit('diff', diff);
    }
    return diff;
  }

  /**
   * Replace the in-memory roster with a snapshot (used by macro-tick handling
   * when we need to throw away mid-day state — typically not invoked directly
   * from the scheduler in Phase 2).
   */
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
): Npc {
  const rng = seededRng(worldSeed, 'materialize', arrival.npcId);
  const departure = generateDeparture({
    worldSeed,
    npcId: arrival.npcId,
    arrivedAbsoluteSubTick: absSubTick,
    subTicksPerDay,
  });
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
    // Decide next state on the next sub-tick.
    nextDecisionSubTick: absSubTick + 1,
  };
}
