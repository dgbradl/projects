import { EventEmitter } from 'node:events';
import type { FlavorMode } from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { OllamaClient } from './ollama.ts';

export interface FlavorModeManagerOpts {
  initialMode: FlavorMode;
  client: OllamaClient | null;
  bus: WorldEventBus;
  healthCheckIntervalMs: number;
  getGameDay: () => number;
}

/**
 * Owns the current flavor mode. Reasons it might change:
 *  - On boot in `llm` mode, an initial health check fails → switches to
 *    `placeholder` until a periodic re-check succeeds.
 *  - Operator switches via {@link forceMode}.
 *
 * `recorded` mode is a test fixture mode and does NOT health-check.
 */
export class FlavorModeManager extends EventEmitter {
  private current: FlavorMode;
  /** The mode the operator requested at boot. */
  private readonly desired: FlavorMode;
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly opts: FlavorModeManagerOpts) {
    super();
    this.current = opts.initialMode;
    this.desired = opts.initialMode;
  }

  getMode(): FlavorMode {
    return this.current;
  }

  /**
   * Run the boot health check. If we want LLM mode but Ollama is unreachable,
   * fall back to placeholder mode and emit a flavor_mode_changed event.
   */
  async runBootHealthCheck(): Promise<void> {
    if (this.desired !== 'llm') return;
    const ok = await this.opts.client?.healthCheck() ?? false;
    if (!ok) {
      this.switchTo('placeholder', 'ollama unreachable at boot');
    }
  }

  /**
   * Start periodic health-check loop. When in fallback `placeholder` mode
   * (and we wanted `llm`), recheck periodically and switch back when Ollama
   * comes online.
   */
  startPeriodicHealthCheck(): void {
    if (this.interval) return;
    this.interval = setInterval(async () => {
      if (this.desired !== 'llm') return;
      if (this.current === 'llm') {
        // Detect outage: a single failed check while running flips to placeholder.
        const ok = await this.opts.client?.healthCheck() ?? false;
        if (!ok) this.switchTo('placeholder', 'ollama health check failed');
      } else {
        // Try to recover.
        const ok = await this.opts.client?.healthCheck() ?? false;
        if (ok) this.switchTo('llm', 'ollama back online');
      }
    }, this.opts.healthCheckIntervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Operator override (also used by tests). */
  forceMode(next: FlavorMode, reason: string): void {
    if (this.current !== next) this.switchTo(next, reason);
  }

  private switchTo(next: FlavorMode, reason: string): void {
    const old = this.current;
    this.current = next;
    this.opts.bus.publish({
      type: 'flavor_mode_changed',
      gameDay: this.opts.getGameDay(),
      oldMode: old,
      newMode: next,
      reason,
    });
    this.emit('mode_changed', { oldMode: old, newMode: next, reason });
  }
}
