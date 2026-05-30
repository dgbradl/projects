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
  TavernTrait,
  WorldEvent,
  ZoneName,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { seededRng } from '../world/rng.ts';
import { absoluteSubTick } from '../npc/spawn.ts';

/** Per-type cap on scenes spawned in a single game day. Tuned so the
 *  player sees roughly one notable scene per in-tavern day at most. */
const MAX_PER_DAY: Record<StageEventType, number> = {
  brawl: 2,
  wedding: 1,
  court_day: 1,
  storyteller_circle: 1,
};

/** Per-type state-machine timing. Each value is the dwell at that state in
 *  sub-ticks. `resolved` is the terminal — no dwell — and is omitted from
 *  the iteration order below. */
const SCENE_TIMING: Record<
  StageEventType,
  Record<Exclude<StageEventState, 'resolved'>, number>
> = {
  brawl: { building: 3, underway: 5, climax: 2, aftermath: 3 },
  wedding: { building: 5, underway: 8, climax: 3, aftermath: 4 },
  court_day: { building: 4, underway: 6, climax: 2, aftermath: 3 },
  storyteller_circle: { building: 3, underway: 5, climax: 2, aftermath: 3 },
};

const STATE_ORDER: StageEventState[] = [
  'building',
  'underway',
  'climax',
  'aftermath',
  'resolved',
];

/** Probability that an `overheard_argument` between two participants
 *  escalates into a brawl. F5 will tune this against bartender presence. */
const BRAWL_BASE_PROBABILITY = 0.35;

/** Probability a pilgrim arrival sparks a wedding when conditions are met. */
const WEDDING_BASE_PROBABILITY = 0.55;

/** Probability a knight arrival sparks a court day. */
const COURT_BASE_PROBABILITY = 0.5;

/** Per-sub-tick probability that a bard at the hearth with 3+ NPCs nearby
 *  draws a storyteller circle. Multiplied by the daily-cap gate so it
 *  fires at most once a day naturally. */
const STORYTELLER_BASE_PROBABILITY = 0.04;

/** Minimum non-staff NPCs (other than the focal NPC) for a wedding to happen.
 *  A bare-bones tavern doesn't celebrate. */
const WEDDING_MIN_OTHERS = 4;

/** Minimum NPCs gathered at the hearth (excluding the bard) for a
 *  storyteller circle to start. */
const STORYTELLER_MIN_AUDIENCE = 3;

const WEDDING_TRAITS: TavernTrait[] = ['pilgrims_pause', 'hearthside_refuge'];

export interface StageRunnerDeps {
  persistence: Persistence;
  bus: WorldEventBus;
  worldSeed: string;
  subTicksPerDay: number;
  /** Phase 9 (F3): wedding/court scenarios look up tavernTraits via the
   *  state manager. Optional so the F1 tests that don't pass one stay valid;
   *  weddings just won't trigger without it. */
  stateManager?: WorldStateManager;
  /** Phase 9 (F3): roster lookup for spawn-time triggers (npc_arrived
   *  brings the new NPC into the bus, but counting bodies on the floor
   *  needs the full roster). Optional for the same reason. */
  getRoster?: () => Npc[];
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
      } else if (ev.type === 'npc_arrived' || ev.type === 'npc_returned') {
        this.onNpcArrived(ev.npcId, ev.gameDay);
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
  onSubTick(gameDay: number, subTick: number, roster: Npc[]): void {
    const absSubTick = absoluteSubTick(gameDay, subTick, this.deps.subTicksPerDay);
    for (const scene of this.liveScenes.values()) {
      if (absSubTick < scene.nextTransitionAbsSubTick) continue;
      this.advance(scene, gameDay, absSubTick);
    }
    // Phase 9 (F3): state-based triggers run after the advance pass so a
    // scene that just resolved this tick doesn't immediately respawn.
    this.tryStorytellerCircle(gameDay, subTick, roster);
  }

  // ---------- triggers ----------

  private onInteraction(interaction: Interaction, gameDay: number): void {
    if (interaction.kind !== 'overheard_argument') return;
    if (!this.canSpawn('brawl', gameDay)) return;
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

  /**
   * Phase 9 (F3): wedding + court_day are spawn-time triggers — they fire
   * when the right archetype walks through the door under the right
   * conditions. The arriving NPC seeds the participant list; the
   * underway state pulls others in via a per-sub-tick spread pass (added
   * to onSubTick below).
   */
  private onNpcArrived(npcId: string, gameDay: number): void {
    const roster = this.deps.getRoster?.() ?? [];
    const newcomer = roster.find((n) => n.id === npcId);
    if (!newcomer || newcomer.isStaff) return;
    const archetype = newcomer.archetype;
    const subTick = newcomer.arrivedSubTick;

    if (archetype === 'pilgrim') this.tryWedding(newcomer, roster, gameDay, subTick);
    else if (archetype === 'knight') this.tryCourtDay(newcomer, gameDay, subTick);
  }

  private tryWedding(
    pilgrim: Npc,
    roster: Npc[],
    gameDay: number,
    subTick: number,
  ): void {
    if (!this.canSpawn('wedding', gameDay)) return;
    // Must own one of the wedding-friendly traits.
    const traits = this.deps.stateManager?.getState().tavernTraits ?? [];
    const matchingTrait = WEDDING_TRAITS.some((t) => traits.includes(t));
    if (!matchingTrait) return;
    // Need enough bodies for a celebration.
    const others = roster.filter(
      (n) => !n.isStaff && n.id !== pilgrim.id && n.status !== 'departed',
    );
    if (others.length < WEDDING_MIN_OTHERS) return;
    const rng = this.rngFor(gameDay, subTick, `wedding-${pilgrim.id}`);
    if (rng() >= WEDDING_BASE_PROBABILITY) return;
    this.startScene({
      type: 'wedding',
      zone: 'hearth',
      participantNpcIds: [pilgrim.id],
      payload: { focalNpcId: pilgrim.id, matchingTraits: traits.filter((t) => WEDDING_TRAITS.includes(t)) },
      gameDay,
      subTick,
    });
  }

  private tryCourtDay(knight: Npc, gameDay: number, subTick: number): void {
    if (!this.canSpawn('court_day', gameDay)) return;
    const rng = this.rngFor(gameDay, subTick, `court-${knight.id}`);
    if (rng() >= COURT_BASE_PROBABILITY) return;
    this.startScene({
      type: 'court_day',
      zone: 'table_b',
      participantNpcIds: [knight.id],
      payload: { focalNpcId: knight.id },
      gameDay,
      subTick,
    });
  }

  /**
   * Phase 9 (F3): storyteller circle is a *state-based* trigger — it fires
   * when a bard is at the hearth with 3+ NPCs nearby, not on any single
   * event. Checked once per sub-tick from onSubTick.
   */
  private tryStorytellerCircle(
    gameDay: number,
    subTick: number,
    roster: Npc[],
  ): void {
    if (!this.canSpawn('storyteller_circle', gameDay)) return;
    const bard = roster.find(
      (n) =>
        !n.isStaff &&
        n.archetype === 'bard' &&
        n.zone === 'hearth' &&
        n.status !== 'departed',
    );
    if (!bard) return;
    const audience = roster.filter(
      (n) =>
        !n.isStaff &&
        n.id !== bard.id &&
        n.zone === 'hearth' &&
        n.status !== 'departed',
    );
    if (audience.length < STORYTELLER_MIN_AUDIENCE) return;
    const rng = this.rngFor(
      gameDay,
      subTick,
      `storyteller-${bard.id}-${gameDay}`,
    );
    if (rng() >= STORYTELLER_BASE_PROBABILITY) return;
    this.startScene({
      type: 'storyteller_circle',
      zone: 'hearth',
      participantNpcIds: [bard.id, ...audience.slice(0, 4).map((n) => n.id)],
      payload: { focalNpcId: bard.id },
      gameDay,
      subTick,
    });
  }

  /** Phase 9 (F3): per-type per-day gate. Combines the in-flight check
   *  (one live scene of this type at a time) with the daily cap from the
   *  events log (caps per-day spawns even after one resolves). */
  private canSpawn(type: StageEventType, gameDay: number): boolean {
    for (const scene of this.liveScenes.values()) {
      if (scene.type === type && scene.state !== 'resolved') return false;
    }
    let startedToday = 0;
    for (const entry of this.deps.persistence.getEventsSince(0)) {
      const ev = entry.event;
      if (
        ev.type === 'stage_event_started' &&
        ev.stageEventType === type &&
        ev.gameDay === gameDay
      ) {
        startedToday += 1;
      }
    }
    return startedToday < MAX_PER_DAY[type];
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
    const buildingDuration = SCENE_TIMING[input.type].building;
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
    const idx = STATE_ORDER.indexOf(scene.state);
    if (idx < 0 || idx >= STATE_ORDER.length - 1) {
      // Already resolved or in an unknown state — clean up.
      this.cleanup(scene.id);
      return;
    }
    const fromState = scene.state;
    const toState = STATE_ORDER[idx + 1];
    scene.state = toState;
    if (toState === 'resolved') {
      this.cleanup(scene.id);
      // Phase 9 (F4): if the keeper defused this scene, the outcome wins
      // out over the natural one — the player should see the chronicle
      // credit them.
      // F3 default: non-conflict scenes end as 'completed', brawls as
      // 'burned_out'.
      const defused = scene.payload.defusedByKeeper === true;
      const outcome: 'burned_out' | 'completed' | 'defused_by_keeper' = defused
        ? 'defused_by_keeper'
        : scene.type === 'brawl'
          ? 'burned_out'
          : 'completed';
      this.deps.bus.publish({
        type: 'stage_event_resolved',
        gameDay,
        stageEventId: scene.id,
        stageEventType: scene.type,
        outcome,
        participantNpcIds: scene.participantNpcIds,
      });
      return;
    }
    const timing = SCENE_TIMING[scene.type];
    scene.nextTransitionAbsSubTick =
      absSubTick + timing[toState as Exclude<StageEventState, 'resolved'>];
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

  /**
   * Phase 9 (F4): keeper-initiated state transition. Two actions today:
   *   - 'escalate' jumps the scene from building/underway to climax.
   *   - 'defuse' jumps the scene to aftermath AND tags payload so the
   *     final resolution emits outcome='defused_by_keeper'.
   * Returns the new state on success, or undefined if the requested
   * action wasn't valid for the scene's current state.
   */
  applyKeeperAction(
    sceneId: string,
    action: 'escalate' | 'defuse',
    gameDay: number,
    subTick: number,
  ): { fromState: StageEventState; toState: StageEventState } | undefined {
    const scene = this.liveScenes.get(sceneId);
    if (!scene) return undefined;
    if (scene.state === 'resolved') return undefined;
    const absSubTick = absoluteSubTick(gameDay, subTick, this.deps.subTicksPerDay);

    let toState: StageEventState | undefined;
    if (action === 'escalate') {
      // Escalation only makes sense before the climax. After climax the
      // scene is already on its way down.
      if (scene.state !== 'building' && scene.state !== 'underway') return undefined;
      toState = 'climax';
    } else {
      // Defuse can land any time before resolution. Jumps to aftermath; the
      // next runner tick will progress aftermath → resolved, and the
      // defused-by-keeper flag set below will route the outcome.
      if (scene.state === 'aftermath') return undefined;
      toState = 'aftermath';
      scene.payload = { ...scene.payload, defusedByKeeper: true };
    }
    const fromState = scene.state;
    scene.state = toState;
    const timing = SCENE_TIMING[scene.type];
    scene.nextTransitionAbsSubTick =
      absSubTick + timing[toState as Exclude<StageEventState, 'resolved'>];
    this.deps.persistence.upsertStageEvent(scene);
    this.deps.bus.publish({
      type: 'stage_event_progressed',
      gameDay,
      stageEventId: scene.id,
      stageEventType: scene.type,
      fromState,
      toState,
    });
    return { fromState, toState };
  }

  private rngFor(gameDay: number, subTick: number, key: string) {
    if (this.deps.scenarioRng) {
      const v = this.deps.scenarioRng(gameDay, subTick, key);
      return () => v;
    }
    return seededRng(this.deps.worldSeed, 'stage', key, gameDay, subTick);
  }
}
