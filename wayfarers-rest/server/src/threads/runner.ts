import type {
  ScheduledArrival,
  Thread,
  WorldEvent,
  WorldState,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';
import { seededRng } from '../world/rng.ts';
import type { RumorsManager } from '../world/rumors.ts';
import type { WorldTagsManager } from '../world/tags.ts';
import { PLACEHOLDER_NAMES } from '../data/placeholderNames.ts';
import { getThreadDefinition } from './registry.ts';
import type {
  ScheduleArrivalInput,
  SpawnThreadHelperInput,
  ThreadHelpers,
  ThreadTickResult,
} from './types.ts';

interface PendingArrivalOp {
  kind: 'arrival';
  input: ScheduleArrivalInput;
  npcId: string;
}

interface PendingTagOp {
  kind: 'tag';
  key: string;
  value: string;
}

interface PendingRumorOp {
  kind: 'rumor';
  text?: string;
  originLocationId?: string;
  sourceThreadId: string;
  tagKey?: string;
  tagValue?: string;
  threadHistoryNote?: string;
}

interface PendingSpawnOp {
  kind: 'spawn';
  input: SpawnThreadHelperInput;
  threadId: string;
}

type HelperOp = PendingArrivalOp | PendingTagOp | PendingRumorOp | PendingSpawnOp;

export class ThreadRunner {
  /** Counters per (gameDay, type) so helper-spawned thread ids are deterministic. */
  private spawnCounters = new Map<string, number>();

  constructor(
    private readonly persistence: Persistence,
    private readonly bus: WorldEventBus,
    private readonly worldTags: WorldTagsManager,
    private readonly rumors: RumorsManager,
  ) {}

  /**
   * Add a thread to the system and emit its 'thread_started' event.
   * Returns the created Thread.
   */
  startThread(input: {
    type: string;
    payload?: Record<string, unknown>;
    initialNextTickDelay?: number;
    gameDay: number;
  }): Thread {
    const def = getThreadDefinition(input.type);
    if (!def) throw new Error(`Unknown thread type: ${input.type}`);
    const id = this.mintThreadId(input.type, input.gameDay);
    const delay = input.initialNextTickDelay ?? def.initialNextTickDelay;
    const thread: Thread = {
      id,
      type: input.type,
      status: 'active',
      state: def.initialState,
      startedGameDay: input.gameDay,
      nextTickGameDay: input.gameDay + Math.max(1, delay),
      payload: input.payload ?? {},
      history: [{ gameDay: input.gameDay, state: def.initialState, note: 'started' }],
    };
    this.persistence.saveThread(thread);
    this.bus.publish({
      type: 'thread_started',
      gameDay: input.gameDay,
      threadId: id,
      threadType: input.type,
    });
    return thread;
  }

  /**
   * Run all due active threads for the current game day. Side-effects:
   *   - thread rows updated / completed
   *   - thread_progressed / thread_completed events emitted
   *   - helpers' deferred ops applied (arrivals, tags, rumors, spawned threads)
   */
  runDay(currentGameDay: number, world: WorldState, worldSeed: string): void {
    // Reset per-day spawn counter so deterministic ids remain stable.
    this.spawnCounters.clear();

    let due = this.persistence.loadActiveThreadsDueBy(currentGameDay);
    // Newly spawned threads from helpers can also become due if a thread schedules a follow-up with delay 0;
    // we accept Phase 3's simpler "process once per day" model and they'll be picked up next day.
    const processedIds = new Set<string>();

    while (due.length > 0) {
      const thread = due.shift()!;
      if (processedIds.has(thread.id)) continue;
      processedIds.add(thread.id);
      this.processThread(thread, currentGameDay, world, worldSeed);
      // Re-check for any helper-spawned threads also due this day with no initial delay.
      const fresh = this.persistence
        .loadActiveThreadsDueBy(currentGameDay)
        .filter((t) => !processedIds.has(t.id));
      due = fresh;
    }
  }

  private processThread(
    thread: Thread,
    currentGameDay: number,
    world: WorldState,
    worldSeed: string,
  ): void {
    const def = getThreadDefinition(thread.type);
    if (!def) {
      // Unknown definition (e.g. old DB type with no current handler): abort cleanly.
      const aborted: Thread = { ...thread, status: 'aborted' };
      this.persistence.saveThread(aborted);
      return;
    }

    const ops: HelperOp[] = [];
    const helpers: ThreadHelpers = {
      scheduleArrival: (input) => {
        const npcId = this.mintArrivalId(thread.id, currentGameDay, ops);
        ops.push({ kind: 'arrival', input, npcId });
        return npcId;
      },
      setWorldTag: (key, value) => {
        ops.push({ kind: 'tag', key, value });
      },
      introduceRumor: (input) => {
        ops.push({
          kind: 'rumor',
          text: input.text,
          originLocationId: input.originLocationId,
          sourceThreadId: thread.id,
          tagKey: input.tagKey,
          tagValue: input.tagValue,
          threadHistoryNote: input.threadHistoryNote,
        });
        // The helper API is sync; the real id isn't known until applyOp runs.
        // Threads should not depend on this return value.
        return '';
      },
      spawnThread: (input) => {
        const threadId = this.mintThreadId(input.type, currentGameDay);
        ops.push({ kind: 'spawn', input, threadId });
        return threadId;
      },
    };

    const rng = seededRng(worldSeed, 'thread', thread.id, currentGameDay);
    const result: ThreadTickResult = def.tick({ thread, world, rng, helpers });

    // Apply ops (after the pure tick).
    for (const op of ops) {
      this.applyOp(op, currentGameDay);
    }

    // Update thread state.
    const isComplete =
      result.nextTickDelay === 0 || result.completes !== undefined;
    const nextThread: Thread = {
      ...thread,
      state: result.nextState,
      payload: { ...thread.payload, ...(result.payloadPatch ?? {}) },
      status: isComplete ? 'completed' : 'active',
      nextTickGameDay: isComplete
        ? thread.nextTickGameDay
        : currentGameDay + Math.max(1, result.nextTickDelay),
      history: [
        ...thread.history,
        {
          gameDay: currentGameDay,
          state: result.nextState,
          note: result.note ?? (isComplete ? (result.completes?.outcome ?? 'completed') : 'progressed'),
        },
      ],
    };
    this.persistence.saveThread(nextThread);

    // Emit additional events declared by the thread.
    if (result.emit) {
      for (const evt of result.emit) this.bus.publish(evt);
    }

    // Always emit a progressed event for the visible transition.
    this.bus.publish({
      type: 'thread_progressed',
      gameDay: currentGameDay,
      threadId: thread.id,
      fromState: thread.state,
      toState: result.nextState,
      note: result.note ?? '',
    });

    if (isComplete) {
      this.bus.publish({
        type: 'thread_completed',
        gameDay: currentGameDay,
        threadId: thread.id,
        outcome: result.completes?.outcome ?? result.nextState,
      });
    }
  }

  private applyOp(op: HelperOp, currentGameDay: number): void {
    switch (op.kind) {
      case 'arrival': {
        const displayName =
          op.input.displayName ?? this.fallbackName(op.npcId);
        const arrival: ScheduledArrival = {
          npcId: op.npcId,
          displayName,
          scheduledGameDay: op.input.onGameDay,
          // Mid-evening default for thread-spawned arrivals; they're rare enough that fine timing doesn't matter.
          scheduledSubTick: 0,
          archetype: op.input.archetype,
          originLocationId: op.input.originLocationId,
          carriedRumorIds: op.input.carriedRumorIds,
        };
        this.persistence.saveScheduledArrival(arrival);
        break;
      }
      case 'tag':
        this.worldTags.set(op.key, op.value, currentGameDay);
        break;
      case 'rumor':
        this.rumors.introduce(
          {
            text: op.text,
            sourceThreadId: op.sourceThreadId,
            originLocationId: op.originLocationId,
            placeholderHint: {
              tagKey: op.tagKey,
              tagValue: op.tagValue,
              threadHistoryNote: op.threadHistoryNote,
            },
          },
          currentGameDay,
        );
        break;
      case 'spawn': {
        const def = getThreadDefinition(op.input.type);
        if (!def) break;
        const delay = op.input.initialNextTickDelay ?? def.initialNextTickDelay;
        const thread: Thread = {
          id: op.threadId,
          type: op.input.type,
          status: 'active',
          state: def.initialState,
          startedGameDay: currentGameDay,
          nextTickGameDay: currentGameDay + Math.max(1, delay),
          payload: op.input.payload ?? {},
          history: [
            { gameDay: currentGameDay, state: def.initialState, note: 'started' },
          ],
        };
        this.persistence.saveThread(thread);
        this.bus.publish({
          type: 'thread_started',
          gameDay: currentGameDay,
          threadId: op.threadId,
          threadType: op.input.type,
        });
        break;
      }
    }
  }

  private mintThreadId(type: string, gameDay: number): string {
    const key = `${gameDay}|${type}`;
    const persisted = this.persistence.countThreadsStartedOnDay(type, gameDay);
    const inMemory = this.spawnCounters.get(key) ?? 0;
    const next = persisted + inMemory;
    this.spawnCounters.set(key, inMemory + 1);
    return `thread_d${gameDay}_${type}_${next}`;
  }

  private mintArrivalId(
    sourceThreadId: string,
    currentGameDay: number,
    ops: HelperOp[],
  ): string {
    const existing = ops.filter(
      (o) => o.kind === 'arrival' && o.input.onGameDay !== undefined,
    ).length;
    return `npc_thread_${sourceThreadId}_${currentGameDay}_${existing}`;
  }

  private fallbackName(seed: string): string {
    // Deterministic name from the id without an rng.
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) {
      h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return PLACEHOLDER_NAMES[h % PLACEHOLDER_NAMES.length];
  }
}
