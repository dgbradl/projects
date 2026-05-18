import type { WorldState } from '@shared/types';
import type { WorldEventBus } from './events/emitter.ts';
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
    private readonly bus: WorldEventBus,
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

  advance(ms: number): number {
    const maybe = this.clock as Partial<{ advance(ms: number): void }>;
    if (typeof maybe.advance === 'function') {
      maybe.advance(ms);
    }
    return this.runCatchUp();
  }

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

    if (willPause && current.status === 'running') {
      this.bus.publish({ type: 'pause', gameDay: newGameDay });
    }

    this.bus.publish({ type: 'tick', gameDay: newGameDay });
    this.stateManager.setState(next);
  }
}

export function engage(
  stateManager: WorldStateManager,
  scheduler: TickScheduler,
  bus: WorldEventBus,
): WorldState {
  const before = stateManager.getState();
  const wasPaused = before.status === 'paused';

  stateManager.setState({
    ...before,
    unattendedTicks: 0,
    status: 'running',
  });

  if (wasPaused) {
    bus.publish({ type: 'resume', gameDay: stateManager.getState().gameDay });
    scheduler.runCatchUp();
  }

  return stateManager.getState();
}
