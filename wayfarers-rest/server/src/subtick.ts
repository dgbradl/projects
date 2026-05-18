import type { Clock } from './lib/clock.ts';
import type { NpcManager } from './npc/manager.ts';
import type { WorldStateManager } from './state.ts';

export interface SubTickConfig {
  subTickIntervalMs: number;
  subTicksPerDay: number;
}

/**
 * Drives NPC behavior. Sub-ticks only fire while status === 'running'.
 *
 * Macro-tick coordination: subscribes to WorldStateManager 'state' events.
 * When gameDay changes, the manager is notified BEFORE the sub-tick counter
 * resumes for the new day. The sub-tick scheduler does not replay missed
 * sub-ticks during catch-up — on resume from pause, gameDay catch-up resets
 * subTick to 0 at each macro step and sub-ticks continue normally from there.
 */
export class SubTickScheduler {
  private interval: NodeJS.Timeout | null = null;
  private lastGameDay: number;
  private nextDueAtMs: number;

  constructor(
    private readonly stateManager: WorldStateManager,
    private readonly npcManager: NpcManager,
    private readonly clock: Clock,
    private readonly config: SubTickConfig,
  ) {
    this.lastGameDay = stateManager.getState().gameDay;
    this.nextDueAtMs = clock.now() + config.subTickIntervalMs;

    stateManager.on('state', (state) => {
      if (state.gameDay !== this.lastGameDay) {
        this.npcManager.onMacroTick(state.gameDay);
        this.lastGameDay = state.gameDay;
        // A new day always starts at subTick 0; persist the reset.
        if (state.subTick !== 0) {
          this.stateManager.setState({ ...state, subTick: 0 });
        }
        // Reset the wall-clock cursor so we don't immediately fire a sub-tick.
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
   * Test helper: advance the (Fake)Clock and run any due sub-ticks.
   * Returns the number of sub-ticks fired.
   */
  advance(ms: number): number {
    const maybe = this.clock as Partial<{ advance(ms: number): void }>;
    if (typeof maybe.advance === 'function') {
      maybe.advance(ms);
    }
    return this.runIfDue();
  }

  /**
   * Fire a sub-tick if the wall-clock has crossed the next due time.
   * Will fire multiple sub-ticks back-to-back if the clock has advanced far
   * (e.g. from a test calling `advance(intervalMs * 5)`).
   */
  runIfDue(): number {
    let fired = 0;
    while (this.clock.now() >= this.nextDueAtMs) {
      // Skip while paused — do not catch up sub-ticks across a pause.
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
    // The macro tick is responsible for advancing gameDay; we never roll over.
    if (state.subTick + 1 >= this.config.subTicksPerDay) {
      // Cap at the last sub-tick of the day; the macro tick will reset us to 0.
      return;
    }
    const nextSubTick = state.subTick + 1;
    this.npcManager.onSubTick(state.gameDay, nextSubTick);
    this.stateManager.setState({ ...state, subTick: nextSubTick });
  }
}
