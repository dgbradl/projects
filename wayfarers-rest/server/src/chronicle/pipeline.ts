import { EventEmitter } from 'node:events';
import type { DailyChronicle, WorldState } from '@shared/types';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import type { ChronicleGenerator } from './generator.ts';

export interface ChroniclePipelineConfig {
  workerIntervalMs: number;
}

/**
 * Owns the chronicle worker loop and the day-tick hook.
 *
 * Day-tick hook: subscribes to WorldStateManager 'state' events. When
 * `gameDay` advances from N to N+1, day N has just ended; we mark a
 * pending row for day N immediately so the worker picks it up.
 *
 * Worker loop: polls every {@link ChroniclePipelineConfig.workerIntervalMs};
 * picks the oldest row whose status is `pending` or `in_progress`; calls
 * the generator; emits `ready` when finished.
 */
export class ChroniclePipeline extends EventEmitter {
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private lastSeenGameDay: number;

  constructor(
    private readonly persistence: Persistence,
    private readonly stateManager: WorldStateManager,
    private readonly generator: ChronicleGenerator,
    private readonly config: ChroniclePipelineConfig,
  ) {
    super();
    this.lastSeenGameDay = stateManager.getState().gameDay;
    stateManager.on('state', (state: WorldState) => {
      if (state.gameDay <= this.lastSeenGameDay) return;
      // Days [lastSeenGameDay, state.gameDay - 1] have ended; enqueue rows.
      for (let d = this.lastSeenGameDay; d < state.gameDay; d += 1) {
        if (d < 1) continue;
        this.enqueueIfMissing(d);
      }
      this.lastSeenGameDay = state.gameDay;
    });
  }

  /** Insert pending rows for any past days that don't already have a chronicle. */
  runCatchUp(): void {
    const current = this.stateManager.getState().gameDay;
    const existing = new Set(this.persistence.loadAllChronicleGameDays());
    for (let d = 1; d < current; d += 1) {
      if (!existing.has(d)) this.enqueueIfMissing(d);
    }
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.tickOnce(), this.config.workerIntervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Pop one pending chronicle and generate it. Exposed for tests. */
  async tickOnce(): Promise<DailyChronicle | null> {
    if (this.running) return null;
    const pending = this.persistence.loadPendingChronicleGameDays();
    if (pending.length === 0) return null;
    this.running = true;
    try {
      const day = pending[0];
      const result = await this.generator.generate(day);
      this.emit('ready', result);
      return result;
    } finally {
      this.running = false;
    }
  }

  private enqueueIfMissing(gameDay: number): void {
    if (this.persistence.loadChronicle(gameDay)) return;
    this.persistence.upsertChronicle({
      gameDay,
      generatedAtRealTs: null,
      status: 'pending',
      headlines: [],
      footnotes: [],
      modelUsed: null,
      promptCharCount: null,
      completionCharCount: null,
      generationDurationMs: null,
      failureReason: null,
    });
  }
}
