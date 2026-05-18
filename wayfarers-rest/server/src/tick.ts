import type { WorldState } from '@shared/types';
import type { Clock } from './lib/clock.ts';
import type { WorldStateManager } from './state.ts';

export const MAX_UNATTENDED_TICKS = 7;

export interface TickConfig {
  tickIntervalMs: number;
  schedulerCheckMs: number;
}

export class TickScheduler {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly stateManager: WorldStateManager,
    private readonly clock: Clock,
    private readonly config: TickConfig,
  ) {}

  start(): void {
    this.runCatchUp();
    this.interval = setInterval(
      () => this.runCatchUp(),
      this.config.schedulerCheckMs,
    );
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Convenience for tests: advance the clock (if it supports it) and run catch-up.
   * Returns the number of ticks fired.
   */
  advance(ms: number): number {
    const maybe = this.clock as Partial<{ advance(ms: number): void }>;
    if (typeof maybe.advance === 'function') {
      maybe.advance(ms);
    }
    return this.runCatchUp();
  }

  /**
   * Fire any ticks whose scheduled time has passed, subject to the unattended cap.
   * Returns the number of ticks fired.
   */
  runCatchUp(): number {
    let fired = 0;
    while (this.shouldTickNow()) {
      this.fireOneTick();
      fired += 1;
      if (this.stateManager.getState().status === 'paused') break;
    }
    return fired;
  }

  private shouldTickNow(): boolean {
    const state = this.stateManager.getState();
    if (state.status !== 'running') return false;
    const lastTickMs = Date.parse(state.lastTickAt);
    const nextTickAtMs = lastTickMs + this.config.tickIntervalMs;
    return this.clock.now() >= nextTickAtMs;
  }

  private fireOneTick(): void {
    const current = this.stateManager.getState();
    const newLastTickAtMs =
      Date.parse(current.lastTickAt) + this.config.tickIntervalMs;
    const newLastTickAt = new Date(newLastTickAtMs).toISOString();
    const newUnattended = current.unattendedTicks + 1;
    const newGameDay = current.gameDay + 1;
    const willPause = newUnattended >= MAX_UNATTENDED_TICKS;
    const newStatus: WorldState['status'] = willPause ? 'paused' : 'running';

    const next: WorldState = {
      ...current,
      gameDay: newGameDay,
      lastTickAt: newLastTickAt,
      unattendedTicks: newUnattended,
      status: newStatus,
    };

    // Append pause event first (if applicable), then the tick event.
    if (willPause && current.status === 'running') {
      this.stateManager.appendEvent({
        gameDay: newGameDay,
        realTimestamp: newLastTickAt,
        type: 'pause',
        payload: { reason: 'unattended_cap' },
      });
    }

    this.stateManager.appendEvent({
      gameDay: newGameDay,
      realTimestamp: newLastTickAt,
      type: 'tick',
      payload: {},
    });

    // setState emits the SSE push.
    this.stateManager.setState(next);
  }
}

/**
 * Player engagement: reset unattended-tick counter and resume if paused.
 * Triggers catch-up after a resume (still subject to the cap).
 */
export function engage(
  stateManager: WorldStateManager,
  scheduler: TickScheduler,
  clock: Clock,
): WorldState {
  const before = stateManager.getState();
  const wasPaused = before.status === 'paused';

  stateManager.setState({
    ...before,
    unattendedTicks: 0,
    status: 'running',
  });

  if (wasPaused) {
    stateManager.appendEvent({
      gameDay: stateManager.getState().gameDay,
      realTimestamp: new Date(clock.now()).toISOString(),
      type: 'resume',
      payload: {},
    });
    scheduler.runCatchUp();
  }

  return stateManager.getState();
}
