import type { FlavorModeManager } from '../mode.ts';
import type { FlavorCache } from './manager.ts';
import type { Pool } from './pool.ts';

const BACKOFF_TICKS_ON_FAILURE = 3;

/**
 * Background refill loop. Runs at most one generation per tick (single-threaded
 * by design — we never want to hammer Ollama).
 *
 * Pauses entirely when mode !== 'llm'.
 */
export class FlavorWorker {
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly cache: FlavorCache,
    private readonly mode: FlavorModeManager,
    private readonly intervalMs: number,
    private readonly logger?: { warn: (msg: string, err?: unknown) => void },
    /**
     * When provided and returning 'stopped', the worker idles entirely
     * (skipping both generation and backoff decrements). Used by the menu's
     * Stop action so the server goes truly idle.
     */
    private readonly getWorldStatus?: () => 'running' | 'paused' | 'stopped',
  ) {}

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.tickOnce(), this.intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /**
   * Run a single worker tick. Exposed for tests and manual debugging.
   *
   * Runs in `llm` and `recorded` mode (`recorded` uses fixture responses).
   * `placeholder` mode pauses generation entirely.
   */
  async tickOnce(): Promise<void> {
    if (this.running) return; // single-threaded
    // Sleep-mode Stop fully idles the worker, including backoff decay, so a
    // resumed Stop continues from the exact backoff state it was paused in.
    if (this.getWorldStatus?.() === 'stopped') return;
    const mode = this.mode.getMode();
    if (mode !== 'llm' && mode !== 'recorded') {
      this.tickBackoffs();
      return;
    }
    this.running = true;
    let pickedPool: ReturnType<typeof this.pickPool> = null;
    try {
      pickedPool = this.pickPool();
      if (!pickedPool) {
        // finally block decrements backoff on all (non-picked) pools.
        return;
      }
      try {
        const items = await pickedPool.config.generate();
        this.cache.push(
          pickedPool.config.kind,
          pickedPool.config.subKey,
          items,
        );
      } catch (err) {
        pickedPool.recordFailure(BACKOFF_TICKS_ON_FAILURE);
        this.logger?.warn(
          `flavor worker: ${pickedPool.config.kind}/${pickedPool.config.subKey} generate failed`,
          err,
        );
      }
    } finally {
      // Decrement backoffs for pools we did NOT pick this tick. The picked
      // pool's backoff (if any was just set) remains intact for the next tick.
      for (const p of this.cache.getAllPools()) {
        if (p !== pickedPool) p.tickBackoff();
      }
      this.running = false;
    }
  }

  /** Choose the pool with the largest deficit that's below threshold and not in backoff. */
  private pickPool(): Pool<unknown> | null {
    const pools = this.cache.getAllPools();
    let best: Pool<unknown> | null = null;
    for (const p of pools) {
      if (p.backoffSkipsRemaining > 0) continue;
      if (!p.needsRefill()) continue;
      if (!best || p.deficit() > best.deficit()) best = p;
    }
    return best;
  }

  private tickBackoffs(): void {
    for (const p of this.cache.getAllPools()) p.tickBackoff();
  }
}
