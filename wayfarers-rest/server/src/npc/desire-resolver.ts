/**
 * Phase 8 (A2): sim-side desire fulfilment.
 *
 * Listens to the world event bus + observes the roster each sub-tick / day
 * boundary, and marks desires fulfilled when the sim's own behaviour
 * satisfies them. Three detectors today:
 *
 *  - `quiet_seat`     — a non-staff NPC has been `seated` alone in a table
 *                       zone for QUIET_SEAT_SUBTICKS consecutive sub-ticks.
 *  - `bed_for_night`  — a non-staff NPC is still here when the day flips,
 *                       so they slept under the tavern's roof.
 *  - `company_of_kind`— a `shared_drink` interaction between two NPCs
 *                       where one carries the desire with a matching
 *                       (or 'any') archetype param.
 *
 * `warm_meal` and the rumor-shaped desires (`news_of_location`,
 * `rumor_of_tone`) are *not* satisfied by sim alone — they wait for staff
 * (A3) or keeper verbs (A4) to step in.
 *
 * On departure, any still-unfulfilled desire emits a `desire_unfulfilled`
 * event so A5 can apply the small prosperity ding and the chronicle can
 * note "Hester left with their wish unmet."
 *
 * Order-of-operations note: the resolver is *purely reactive*. It mutates
 * desires through NpcManager.markDesireFulfilled and never touches the
 * roster directly, so the existing diff/SSE pipeline carries fulfilled
 * state to the client unchanged.
 */
import type {
  DesireKind,
  Interaction,
  Npc,
  NpcDesire,
  Rumor,
  WorldEvent,
  ZoneName,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import { TABLE_ZONES } from '../world/tavern.ts';
import type { NpcManager } from './manager.ts';

/**
 * Sub-ticks of consecutive `seated`-and-alone-in-zone before quiet_seat is
 * counted satisfied. ~80 seconds at the default 10s sub-tick — long enough
 * that drifting through an empty table doesn't count, short enough that a
 * scholar who actually settles in gets paid off within their visit.
 */
export const QUIET_SEAT_SUBTICKS = 8;

const TABLE_ZONE_SET = new Set<ZoneName>(TABLE_ZONES);

export interface DesireResolverDeps {
  npcManager: NpcManager;
  bus: WorldEventBus;
  subTicksPerDay: number;
}

export class DesireResolver {
  /**
   * Per-NPC counter of consecutive sub-ticks satisfying the quiet_seat
   * predicate (seated + alone in a table zone). Reset to 0 the moment the
   * predicate fails; cleared on departure.
   */
  private quietSeatCounter = new Map<string, number>();
  private attached = false;

  constructor(private readonly deps: DesireResolverDeps) {}

  /**
   * Subscribe to the bus. Exposed separately from the constructor so tests
   * can drive the resolver with synthetic events without wiring the bus.
   */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.deps.bus.on('world_event', (entry: { event: WorldEvent }) => {
      const ev = entry.event;
      if (ev.type === 'interaction') {
        this.onInteraction(ev.interaction);
      } else if (ev.type === 'npc_departed') {
        this.onDeparted(ev);
      }
    });
  }

  /**
   * Sub-tick scan for `quiet_seat`. Counts each NPC's consecutive ticks of
   * being seated alone in a table zone; flips the desire when the threshold
   * is hit. Idempotent — already-fulfilled desires are ignored, so it's
   * safe to over-call.
   */
  onSubTick(gameDay: number, subTick: number, roster: Npc[]): void {
    const absSubTick = gameDay * this.deps.subTicksPerDay + subTick;
    const zoneCounts = countByZone(roster);
    for (const npc of roster) {
      if (npc.isStaff || !npc.desires) continue;
      const desire = npc.desires.find(
        (d) => d.kind === 'quiet_seat' && d.fulfilledAtSubTick === undefined,
      );
      if (!desire) {
        // Don't carry counter state forward for desires that no longer exist
        // (e.g. already fulfilled by some other detector — paranoid path).
        this.quietSeatCounter.delete(npc.id);
        continue;
      }
      const alone = isQuietlySeated(npc, zoneCounts);
      if (alone) {
        const next = (this.quietSeatCounter.get(npc.id) ?? 0) + 1;
        this.quietSeatCounter.set(npc.id, next);
        if (next >= QUIET_SEAT_SUBTICKS) {
          this.fulfil(npc.id, 'quiet_seat', desire.param, 'sim', gameDay, absSubTick);
          this.quietSeatCounter.delete(npc.id);
        }
      } else {
        this.quietSeatCounter.set(npc.id, 0);
      }
    }
  }

  /**
   * Day-change handler: any non-staff NPC still in the tavern from an
   * earlier game day has their `bed_for_night` desire fulfilled. Called
   * once per day boundary against the current roster.
   */
  onDayChange(newGameDay: number): void {
    const absSubTick = newGameDay * this.deps.subTicksPerDay;
    const roster = this.deps.npcManager.getRoster();
    for (const npc of roster) {
      if (npc.isStaff || !npc.desires) continue;
      if (npc.arrivedGameDay >= newGameDay) continue;
      const desire = npc.desires.find(
        (d) => d.kind === 'bed_for_night' && d.fulfilledAtSubTick === undefined,
      );
      if (!desire) continue;
      this.fulfil(npc.id, 'bed_for_night', desire.param, 'sim', newGameDay, absSubTick);
    }
  }

  // ---------- bus handlers ----------

  private onInteraction(interaction: Interaction): void {
    if (interaction.kind !== 'shared_drink') return;
    const [aId, bId] = interaction.participantIds;
    if (!aId || !bId) return;
    const roster = this.deps.npcManager.getRoster();
    const a = roster.find((n) => n.id === aId);
    const b = roster.find((n) => n.id === bId);
    if (!a || !b) return;
    const absSubTick =
      interaction.gameDay * this.deps.subTicksPerDay + interaction.subTick;
    this.maybeMatchCompany(a, b, interaction.gameDay, absSubTick);
    this.maybeMatchCompany(b, a, interaction.gameDay, absSubTick);
  }

  /**
   * If `npc` has an unfulfilled `company_of_kind` desire whose param is
   * 'any' or matches `other.archetype`, fulfil it. Called twice per
   * shared_drink (once each direction) so two soldiers sharing a pint can
   * each pay off the other's desire.
   */
  private maybeMatchCompany(
    npc: Npc,
    other: Npc,
    gameDay: number,
    absSubTick: number,
  ): void {
    if (!npc.desires) return;
    const desire = npc.desires.find(
      (d) =>
        d.kind === 'company_of_kind' &&
        d.fulfilledAtSubTick === undefined &&
        (d.param === 'any' || d.param === other.archetype),
    );
    if (!desire) return;
    this.fulfil(npc.id, 'company_of_kind', desire.param, 'sim', gameDay, absSubTick);
  }

  private onDeparted(ev: WorldEvent & { type: 'npc_departed' }): void {
    if (ev.desires && ev.desires.length > 0) {
      for (const d of ev.desires) {
        if (d.fulfilledAtSubTick !== undefined) continue;
        this.deps.bus.publish({
          type: 'desire_unfulfilled',
          gameDay: ev.gameDay,
          npcId: ev.npcId,
          desireKind: d.kind,
          param: d.param,
        });
      }
    }
    this.quietSeatCounter.delete(ev.npcId);
  }

  // ---------- core mutation ----------

  /**
   * Phase 8 (A3+A4): public fulfilment hook for non-sim sources. Used by
   * staff effects (hospitality → warm_meal, gossipNetwork → news_of_*)
   * and by interventions (plant_rumor, beckon). `by` is the
   * `fulfilledBy` string ('staff:<role>' or 'keeper:<intervention_kind>')
   * surfaced on the event and in tooltip prose. Returns true if a desire
   * actually flipped.
   */
  fulfilByExternal(
    npcId: string,
    kind: DesireKind,
    param: string | undefined,
    by: string,
    gameDay: number,
    absSubTick: number,
  ): boolean {
    const before = this.deps.npcManager
      .getRoster()
      .find((n) => n.id === npcId)?.desires;
    if (!before) return false;
    const ok = this.deps.npcManager.markDesireFulfilled(
      npcId,
      kind,
      param,
      by,
      absSubTick,
    );
    if (!ok) return false;
    this.deps.bus.publish({
      type: 'desire_fulfilled',
      gameDay,
      npcId,
      desireKind: kind,
      param,
      fulfilledBy: by,
    });
    return true;
  }

  /**
   * Phase 8 (A3): given a rumor just routed to an NPC, fulfil any
   * `news_of_location` desire whose param matches the rumor's
   * originLocationId, or any `rumor_of_tone` whose param matches the
   * rumor's tone. Returns the kind fulfilled, or undefined.
   *
   * Used by both the gossipNetwork transfer (staff fulfilment) and by
   * plant_rumor (keeper fulfilment) — the matching logic is identical, the
   * callers differ only in `by`.
   */
  fulfilFromRumor(
    npcId: string,
    rumor: Pick<Rumor, 'originLocationId' | 'tone'>,
    by: string,
    gameDay: number,
    absSubTick: number,
  ): { kind: DesireKind; param: string | undefined } | undefined {
    const npc = this.deps.npcManager
      .getRoster()
      .find((n) => n.id === npcId);
    if (!npc || !npc.desires) return undefined;
    for (const d of npc.desires) {
      if (d.fulfilledAtSubTick !== undefined) continue;
      const matches =
        (d.kind === 'news_of_location' &&
          rumor.originLocationId !== undefined &&
          d.param === rumor.originLocationId) ||
        (d.kind === 'rumor_of_tone' &&
          rumor.tone !== undefined &&
          d.param === rumor.tone);
      if (!matches) continue;
      const flipped = this.fulfilByExternal(
        npcId,
        d.kind,
        d.param,
        by,
        gameDay,
        absSubTick,
      );
      if (flipped) return { kind: d.kind, param: d.param };
    }
    return undefined;
  }

  private fulfil(
    npcId: string,
    kind: DesireKind,
    param: string | undefined,
    by: string,
    gameDay: number,
    absSubTick: number,
  ): void {
    const ok = this.deps.npcManager.markDesireFulfilled(
      npcId,
      kind,
      param,
      by,
      absSubTick,
    );
    if (!ok) return;
    this.deps.bus.publish({
      type: 'desire_fulfilled',
      gameDay,
      npcId,
      desireKind: kind,
      param,
      fulfilledBy: by,
    });
  }
}

// ---------- helpers ----------

function countByZone(roster: readonly Npc[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of roster) {
    if (n.zone) m.set(n.zone, (m.get(n.zone) ?? 0) + 1);
  }
  return m;
}

function isQuietlySeated(npc: Npc, zoneCounts: Map<string, number>): boolean {
  if (npc.status !== 'seated') return false;
  if (npc.zone === null) return false;
  if (!TABLE_ZONE_SET.has(npc.zone as ZoneName)) return false;
  return (zoneCounts.get(npc.zone) ?? 0) === 1;
}

/**
 * Convenience for tests + chronicle prose: count desires fulfilled on an
 * NPC. Not used by the resolver itself.
 */
export function fulfilledCount(desires: readonly NpcDesire[] | undefined): number {
  if (!desires) return 0;
  return desires.reduce(
    (acc, d) => acc + (d.fulfilledAtSubTick !== undefined ? 1 : 0),
    0,
  );
}
