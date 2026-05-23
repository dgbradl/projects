import type { WorldState } from '@shared/types';
import type { WorldEventBus } from './events/emitter.ts';
import type { Clock } from './lib/clock.ts';
import type { NpcManager } from './npc/manager.ts';
import { seedStaffIfMissing } from './npc/staff-roster.ts';
import type { Persistence } from './persistence.ts';
import type { ChroniclePipeline } from './chronicle/pipeline.ts';
import type { SubTickScheduler } from './subtick.ts';
import type { WorldStateManager } from './state.ts';
import type { ThreadRunner } from './threads/runner.ts';
import type { WorldTagsManager } from './world/tags.ts';
import { seedPhase3World } from './world/world-init.ts';

/**
 * Bundle of every long-lived runtime piece that the menu's pause/stop/resume/
 * reset actions need to touch. Mirrors what main() wires up so the control
 * routes can drive the same surface without re-creating instances.
 */
export interface ControlDeps {
  persistence: Persistence;
  clock: Clock;
  bus: WorldEventBus;
  stateManager: WorldStateManager;
  npcManager: NpcManager;
  threadRunner: ThreadRunner;
  worldTags: WorldTagsManager;
  chroniclePipeline?: ChroniclePipeline;
  subTickScheduler?: SubTickScheduler;
}

/** Manual Pause — same status the auto-pause uses, but reset attendance. */
export function pauseGame(deps: ControlDeps): WorldState {
  const { stateManager, bus } = deps;
  const current = stateManager.getState();
  if (current.status === 'paused') return stateManager.getState();
  stateManager.setState({
    ...current,
    status: 'paused',
    // Manual pause shouldn't carry the auto-pause clock — when the keeper
    // resumes, they should get a fresh 7-day window of grace.
    unattendedTicks: 0,
  });
  bus.publish({ type: 'pause', gameDay: current.gameDay });
  return stateManager.getState();
}

/**
 * Sleep-mode Stop. Same effect on the tick/sub-tick schedulers as Pause, but
 * gates the chronicle and flavor workers too (those check world status
 * directly). Resuming follows the same engage() path as a pause.
 */
export function stopGame(deps: ControlDeps): WorldState {
  const { stateManager, bus } = deps;
  const current = stateManager.getState();
  if (current.status === 'stopped') return stateManager.getState();
  stateManager.setState({
    ...current,
    status: 'stopped',
    unattendedTicks: 0,
  });
  bus.publish({ type: 'pause', gameDay: current.gameDay });
  return stateManager.getState();
}

/**
 * Wipe every game-state table (keeping the LLM flavor cache so a freshly-
 * reset tavern still benefits from generated pool content), then rebuild the
 * initial world. Schedulers should be stopped before this runs and started
 * again afterwards.
 */
export function resetGame(deps: ControlDeps): WorldState {
  const {
    persistence,
    stateManager,
    npcManager,
    threadRunner,
    worldTags,
    chroniclePipeline,
    subTickScheduler,
    bus,
  } = deps;

  // 1) Drop every per-game row. Flavor cache and schema meta survive.
  persistence.wipeGameTables();

  // 2) Re-create the in-memory state and persist a fresh world_state row.
  const fresh = stateManager.reset();

  // 3) Reset every manager that caches game-life state.
  npcManager.reset();
  threadRunner.reset();
  subTickScheduler?.resetDayTracking();
  chroniclePipeline?.resetDayTracking();

  // 4) Re-run the first-boot world seed (staff characters, world tags,
  //    starter threads, opening NPC roster).
  seedStaffIfMissing(persistence, fresh.gameDay);
  npcManager.ensureStaffOnDuty(fresh.gameDay, fresh.subTick);
  seedPhase3World({
    worldSeed: fresh.seed,
    gameDay: fresh.gameDay,
    worldTags,
    threadRunner,
  });
  npcManager.onMacroTick(fresh.gameDay);
  persistence.saveRoster(npcManager.snapshot());

  // 5) Signal the reset so SSE subscribers refetch snapshots.
  bus.publish({ type: 'init', gameDay: fresh.gameDay });

  return stateManager.getState();
}
