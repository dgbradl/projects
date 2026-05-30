/**
 * Phase 9 (F1): the stage runner.
 *
 * Drives in-tavern dramatic moments — scenes that take over a zone, pull
 * NPCs in as participants, and progress through a state machine
 * (building → underway → climax → aftermath → resolved).
 *
 * F1 ships brawl only. F3 adds wedding / court_day / storyteller_circle
 * scenarios behind the same shape. F4 adds keeper verbs to escalate or
 * defuse a live scene.
 *
 * Architecture:
 *   - The runner subscribes to the bus for `interaction` events; the
 *     brawl trigger watches for `overheard_argument`.
 *   - `onSubTick(gameDay, subTick, roster)` is called from the
 *     post-sub-tick hook to advance any live scene through its state
 *     machine and emit the right WorldEvents.
 *   - Scenes are persisted to `stage_events` so the SSE snapshot can
 *     replay them on reconnect and so a server restart picks them up
 *     mid-scene.
 *
 * The runner doesn't itself impose mechanical effects (prosperity dings,
 * coin penalties, NPC behaviour overrides) — F5's balance pass adds
 * those. F1's deliverable is the *structure* + the chronicle headlines
 * so the player can see the scene happen, even if it doesn't yet bite.
 */
import type {
  Interaction,
  Npc,
  StageEvent,
  StageEventState,
  StageEventType,
  WorldEvent,
  ZoneName,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';
import { seededRng } from '../world/rng.ts';
import { absoluteSubTick } from '../npc/spawn.ts';

/** Maximum number of brawls per game day. Defensive against a runaway
 *  trigger; one or two brawls in a day is a story, ten is noise. */
const MAX_BRAWLS_PER_DAY = 2;

/** Brawl state-machine timing. Total ~1 in-game day at default cadence. */
const BRAWL_TIMING: Record<StageEventState, number> = {
  building: 3,
  underway: 5,
  climax: 2,
  aftermath: 3,
  resolved: 0,
};

const BRAWL_STATE_ORDER: StageEventState[] = [
  'building',
  'underway',
  'climax',
  'aftermath',
  'resolved',
];

/**
 * Probability that an `overheard_argument` between two participants escalates
 * into a brawl. Modulated downward by:
 *   - bartender presence (their conflictMitigation skill is already shaved
 *     off the argument weight upstream, but a present bartender further
 *     suppresses brawl onset)
 *   - existing live brawls (one's enough)
 * Modulated upward by:
 *   - more non-staff bodies in the zone (peer-pressure escalation)
 */
const BRAWL_BASE_PROBABILITY = 0.35;

export interface StageRunnerDeps {
  persistence: Persistence;
  bus: WorldEventBus;
  worldSeed: string;
  subTicksPerDay: number;
  /** Optional override for tests. */
  scenarioRng?: (gameDay: number, subTick: number, key: string) => number;
}

export class StageRunner {
  private attached = false;
  /** Live scenes, keyed by id. Mirrors the stage_events table; loaded on
   *  attach and updated in step with persistence. */
  private liveScenes = new Map<string, StageEvent>();

  constructor(private readonly deps: StageRunnerDeps) {}

  /** Load existing scenes from persistence + subscribe to the bus. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    for (const scene of this.deps.persistence.loadActiveStageEvents()) {
      this.liveScenes.set(scene.id, scene);
    }
    this.deps.bus.on('world_event', (entry: { event: WorldEvent }) => {
      const ev = entry.event;
      if (ev.type === 'interaction') {
        this.onInteraction(ev.interaction, ev.gameDay);
      }
    });
  }

  /** Read-only snapshot of live scenes — used by the API world snapshot. */
  getLiveScenes(): StageEvent[] {
    return [...this.liveScenes.values()];
  }

  /**
   * Sub-tick advance. Call from postSubTickHook. Walks each live scene
   * forward through its state machine when its `nextTransitionAbsSubTick`
   * arrives; emits stage_event_progressed / stage_event_resolved.
   *
   * `roster` is passed so future scenes can pull in additional
   * participants from the zone; F1's brawl doesn't actively re-recruit
   * after onset.
   */
  onSubTick(gameDay: number, subTick: number, _roster: Npc[]): void {
    const absSubTick = absoluteSubTick(gameDay, subTick, this.deps.subTicksPerDay);
    for (const scene of this.liveScenes.values()) {
      if (absSubTick < scene.nextTransitionAbsSubTick) continue;
      this.advance(scene, gameDay, absSubTick);
    }
  }

  // ---------- triggers ----------

  private onInteraction(interaction: Interaction, gameDay: number): void {
    if (interaction.kind !== 'overheard_argument') return;
    // Already a brawl live? Skip — one's enough for now.
    for (const scene of this.liveScenes.values()) {
      if (scene.type === 'brawl' && scene.state !== 'resolved') return;
    }
    // Daily cap on brawls. We can't count via the stage_events table —
    // resolved scenes are deleted from it — so count `stage_event_started`
    // events from the persisted event log instead. The log keeps history
    // even after the live row is gone.
    let startedToday = 0;
    for (const entry of this.deps.persistence.getEventsSince(0)) {
      const ev = entry.event;
      if (
        ev.type === 'stage_event_started' &&
        ev.stageEventType === 'brawl' &&
        ev.gameDay === gameDay
      ) {
        startedToday += 1;
      }
    }
    if (startedToday >= MAX_BRAWLS_PER_DAY) return;

    const rng = this.rngFor(gameDay, interaction.subTick, `brawl-${interaction.id}`);
    if (rng() >= BRAWL_BASE_PROBABILITY) return;

    this.startScene({
      type: 'brawl',
      zone: interaction.zone,
      participantNpcIds: [...interaction.participantIds],
      payload: { triggerInteractionId: interaction.id },
      gameDay,
      subTick: interaction.subTick,
    });
  }

  // ---------- lifecycle ----------

  /**
   * Start a new scene. Persists, indexes, and emits stage_event_started.
   * Exposed so tests (and future verbs / scenarios) can spawn directly.
   */
  startScene(input: {
    type: StageEventType;
    zone: ZoneName;
    participantNpcIds: string[];
    payload?: Record<string, unknown>;
    gameDay: number;
    subTick: number;
  }): StageEvent {
    const absSubTick = absoluteSubTick(
      input.gameDay,
      input.subTick,
      this.deps.subTicksPerDay,
    );
    const buildingDuration = BRAWL_TIMING.building;
    const id = `scene_d${input.gameDay}_st${input.subTick}_${input.type}`;
    const scene: StageEvent = {
      id,
      type: input.type,
      state: 'building',
      zone: input.zone,
      startedGameDay: input.gameDay,
      startedSubTick: input.subTick,
      nextTransitionAbsSubTick: absSubTick + buildingDuration,
      participantNpcIds: input.participantNpcIds,
      payload: input.payload ?? {},
    };
    this.deps.persistence.upsertStageEvent(scene);
    this.liveScenes.set(scene.id, scene);
    this.deps.bus.publish({
      type: 'stage_event_started',
      gameDay: input.gameDay,
      stageEventId: scene.id,
      stageEventType: scene.type,
      zone: scene.zone,
      participantNpcIds: scene.participantNpcIds,
    });
    return scene;
  }

  /**
   * Advance one scene to its next state. Emits stage_event_progressed
   * on every move and stage_event_resolved on the final transition out
   * of aftermath.
   */
  private advance(scene: StageEvent, gameDay: number, absSubTick: number): void {
    const idx = BRAWL_STATE_ORDER.indexOf(scene.state);
    if (idx < 0 || idx >= BRAWL_STATE_ORDER.length - 1) {
      // Already resolved or in an unknown state — clean up.
      this.cleanup(scene.id);
      return;
    }
    const fromState = scene.state;
    const toState = BRAWL_STATE_ORDER[idx + 1];
    scene.state = toState;
    if (toState === 'resolved') {
      this.cleanup(scene.id);
      this.deps.bus.publish({
        type: 'stage_event_resolved',
        gameDay,
        stageEventId: scene.id,
        stageEventType: scene.type,
        outcome: 'burned_out',
        participantNpcIds: scene.participantNpcIds,
      });
      return;
    }
    scene.nextTransitionAbsSubTick = absSubTick + BRAWL_TIMING[toState];
    this.deps.persistence.upsertStageEvent(scene);
    this.deps.bus.publish({
      type: 'stage_event_progressed',
      gameDay,
      stageEventId: scene.id,
      stageEventType: scene.type,
      fromState,
      toState,
    });
  }

  private cleanup(id: string): void {
    this.liveScenes.delete(id);
    this.deps.persistence.deleteStageEvent(id);
  }

  private rngFor(gameDay: number, subTick: number, key: string) {
    if (this.deps.scenarioRng) {
      const v = this.deps.scenarioRng(gameDay, subTick, key);
      return () => v;
    }
    return seededRng(this.deps.worldSeed, 'stage', key, gameDay, subTick);
  }
}
