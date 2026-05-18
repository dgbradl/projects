import type { Clock } from './lib/clock.ts';
import type { NpcManager } from './npc/manager.ts';
import type { WorldStateManager } from './state.ts';
import type { ThreadRunner } from './threads/runner.ts';

export interface SubTickConfig {
  subTickIntervalMs: number;
  subTicksPerDay: number;
}

export class SubTickScheduler {
  private interval: NodeJS.Timeout | null = null;
  private lastGameDay: number;
  private nextDueAtMs: number;

  constructor(
    private readonly stateManager: WorldStateManager,
    private readonly npcManager: NpcManager,
    private readonly clock: Clock,
    private readonly config: SubTickConfig,
    private readonly threadRunner?: ThreadRunner,
  ) {
    this.lastGameDay = stateManager.getState().gameDay;
    this.nextDueAtMs = clock.now() + config.subTickIntervalMs;

    stateManager.on('state', (state) => {
      if (state.gameDay !== this.lastGameDay) {
        this.npcManager.onMacroTick(state.gameDay);
        this.threadRunner?.runDay(state.gameDay, state, state.seed);
        this.lastGameDay = state.gameDay;
        if (state.subTick !== 0) {
          this.stateManager.setState({ ...state, subTick: 0 });
        }
        this.nextDueAtMs = this.clock.now() + this.config.subTickIntervalMs;
      }
    });
  }

  start(): void {
    this.interval = setInterval(
      () => this.runIfDue(),
      Math.max(50, Math.floor(this.config.subTickIntervalMs / 4)),
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
    return this.runIfDue();
  }

  runIfDue(): number {
    let fired = 0;
    while (this.clock.now() >= this.nextDueAtMs) {
      const state = this.stateManager.getState();
      if (state.status !== 'running') {
        this.nextDueAtMs = this.clock.now() + this.config.subTickIntervalMs;
        return fired;
      }
      this.fireOneSubTick();
      fired += 1;
      this.nextDueAtMs += this.config.subTickIntervalMs;
    }
    return fired;
  }

  private fireOneSubTick(): void {
    const state = this.stateManager.getState();
    if (state.subTick + 1 >= this.config.subTicksPerDay) return;
    const nextSubTick = state.subTick + 1;
    this.npcManager.onSubTick(state.gameDay, nextSubTick);
    this.stateManager.setState({ ...state, subTick: nextSubTick });
  }
}
