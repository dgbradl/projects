import type { Clock } from './lib/clock.ts';
import type { NpcManager } from './npc/manager.ts';
import type { WorldStateManager } from './state.ts';
import type { ThreadRunner } from './threads/runner.ts';

export interface SubTickConfig {
  subTickIntervalMs: number;
  subTicksPerDay: number;
}

export type OnDayChange = (newGameDay: number) => void;

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
    /** Phase 6: invoked before npcManager.onMacroTick on each day change. */
    private readonly onDayChange?: OnDayChange,
  ) {
    this.lastGameDay = stateManager.getState().gameDay;
    this.nextDueAtMs = clock.now() + config.subTickIntervalMs;

    stateManager.on('state', (state) => {
      if (state.gameDay !== this.lastGameDay) {
        // gameDay moving backwards only happens via POST /control/reset.
        // Snap to the fresh day without firing the day-change pipeline —
        // resetGame() will re-seed the world itself.
        if (state.gameDay < this.lastGameDay) {
          this.lastGameDay = state.gameDay;
          this.nextDueAtMs = this.clock.now() + this.config.subTickIntervalMs;
          return;
        }
        this.onDayChange?.(state.gameDay);
        this.npcManager.onMacroTick(state.gameDay);
        this.threadRunner?.runDay(state.gameDay, state, state.seed);
        this.lastGameDay = state.gameDay;
        // Snap subTick to 0 for the new day. Re-read fresh state: onDayChange
        // may have mutated other fields (favor regen, the daily ledger's
        // coin), and the captured `state` arg is stale — writing it back
        // would clobber those updates.
        const afterDayChange = this.stateManager.getState();
        if (afterDayChange.subTick !== 0) {
          this.stateManager.setState({ ...afterDayChange, subTick: 0 });
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

  /**
   * Snap the cached `lastGameDay` / due-tick clock back to whatever the
   * current world state says. Used by POST /control/reset so day-change
   * handling doesn't get stranded on the pre-reset gameDay.
   */
  resetDayTracking(): void {
    this.lastGameDay = this.stateManager.getState().gameDay;
    this.nextDueAtMs = this.clock.now() + this.config.subTickIntervalMs;
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
