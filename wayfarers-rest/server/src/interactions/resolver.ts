import type {
  CharacterEncounter,
  Interaction,
  InteractionKind,
  Npc,
  ZoneName,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { FlavorCache } from '../llm/cache/manager.ts';
import {
  bothSoldiers,
  type ArchetypeModifiers,
} from '../npc/archetype-signatures.ts';
import { AFFINITY_MAX, AFFINITY_MIN } from '../npc/character-memory.ts';
import type { Persistence } from '../persistence.ts';
import type { ThreadRunner } from '../threads/runner.ts';
import { randomLocation } from '../world/locations.ts';
import { seededRng, type Rng } from '../world/rng.ts';
import type { InteractionCandidate } from './types.ts';

type Weights = Record<InteractionKind, number>;

const BASE_WEIGHTS: Record<string, Weights> = {
  at_bar: {
    shared_drink: 0.6,
    overheard_argument: 0.2,
    whispered_exchange: 0.15,
    silent_recognition: 0.05,
    // Phase 9 (G2): `transaction` is force-emitted via the G2 path; the
    // natural-pick weight is 0 so it never competes here.
    transaction: 0,
  },
  default: {
    shared_drink: 0.3,
    overheard_argument: 0.1,
    whispered_exchange: 0.4,
    silent_recognition: 0.2,
    transaction: 0,
  },
};

export interface StaffModifiers {
  /** Reduce `overheard_argument` weight by this amount (0–1). */
  conflictMitigation: number;
}

export interface ResolverContext {
  worldSeed: string;
  gameDay: number;
  subTick: number;
  npcsById: Map<string, Npc>;
  perDayCounter: { value: number };
  staffModifiers?: StaffModifiers;
  /** Phase 8 (C3): archetype-signature modifiers (bard performance, soldier brood). */
  archetypeModifiers?: ArchetypeModifiers;
  /**
   * Phase 9 (G2): bypass `pickKind` and emit the given kind directly. Used
   * by the merchant `transaction` path so a force-detected pair becomes a
   * `transaction` interaction without competing in the natural weight table.
   */
  forcedKind?: InteractionKind;
}

export class InteractionResolver {
  constructor(
    private readonly bus: WorldEventBus,
    private readonly threadRunner: ThreadRunner,
    private readonly flavorCache?: FlavorCache,
    private readonly persistence?: Persistence,
  ) {}

  resolve(
    candidate: InteractionCandidate,
    ctx: ResolverContext,
  ): Interaction {
    const [aId, bId] = candidate.participantIds;
    const a = ctx.npcsById.get(aId);
    const b = ctx.npcsById.get(bId);

    const rng = seededRng(
      ctx.worldSeed,
      'resolve',
      aId,
      bId,
      ctx.gameDay,
      ctx.subTick,
    );
    const kind =
      ctx.forcedKind ??
      this.pickKind(
        candidate.zone,
        a,
        b,
        rng,
        ctx.staffModifiers,
        ctx.archetypeModifiers,
      );
    const id = `int_d${ctx.gameDay}_st${ctx.subTick}_${ctx.perDayCounter.value}`;
    ctx.perDayCounter.value += 1;

    let spawnedThreadId: string | undefined;
    if (kind === 'whispered_exchange' && rng() < 0.3) {
      // The gossiped-about person comes to investigate.
      const origin = randomLocation(rng);
      const namePick = a?.displayName ?? 'a wanderer';
      const thread = this.threadRunner.startThread({
        type: 'approaching_stranger',
        payload: {
          displayName: `Friend of ${namePick}`,
          originLocationId: origin.id,
          archetype: 'investigator',
        },
        gameDay: ctx.gameDay,
      });
      spawnedThreadId = thread.id;
    } else if (kind === 'overheard_argument' && rng() < 0.2 && b) {
      // One of the arguers leaves early — schedule a journey for them.
      const dest = randomLocation(rng);
      const thread = this.threadRunner.startThread({
        type: 'travelers_journey',
        payload: {
          npcId: b.id,
          displayName: b.displayName,
          destinationLocationId: dest.id,
          trip: 'outbound',
        },
        gameDay: ctx.gameDay,
      });
      spawnedThreadId = thread.id;
    }

    const overheardText = this.flavorCache
      ? this.flavorCache.take<{ seed?: string }, string>('fragment', {
          placeholderInput: { seed: id },
          gameDay: ctx.gameDay,
        })
      : undefined;

    const interaction: Interaction = {
      id,
      gameDay: ctx.gameDay,
      subTick: ctx.subTick,
      zone: candidate.zone,
      participantIds: [aId, bId],
      kind,
      spawnedThreadId,
      overheardText,
    };
    this.bus.publish({ type: 'interaction', gameDay: ctx.gameDay, interaction });
    return interaction;
  }

  private pickKind(
    zone: ZoneName,
    a: Npc | undefined,
    b: Npc | undefined,
    rng: Rng,
    staffModifiers?: StaffModifiers,
    archetypeModifiers?: ArchetypeModifiers,
  ): InteractionKind {
    const base = BASE_WEIGHTS[zone] ?? BASE_WEIGHTS.default;
    const weights: Weights = { ...base };
    if (
      (a?.carriedRumorIds?.length ?? 0) > 0 ||
      (b?.carriedRumorIds?.length ?? 0) > 0
    ) {
      weights.whispered_exchange += 0.25;
    }
    if (staffModifiers?.conflictMitigation) {
      weights.overheard_argument = Math.max(
        0,
        weights.overheard_argument - staffModifiers.conflictMitigation,
      );
    }
    // Phase 8 (C3): bard performs — buff shared_drink within the
    // bard's zone (the hearth, today). Multiplicative; default 1.
    if (
      archetypeModifiers?.bardPerformZone === zone &&
      archetypeModifiers.bardPerformBuff > 1
    ) {
      weights.shared_drink *= archetypeModifiers.bardPerformBuff;
    }
    // Phase 8 (C3): soldier broods — two soldiers raise the argument
    // probability between themselves. Bartender conflictMitigation has
    // already been subtracted above, so the net effect honours both.
    if (archetypeModifiers && bothSoldiers(a, b)) {
      weights.overheard_argument *= archetypeModifiers.soldierBroodBuff;
    }
    // Phase 7 (B2): two characters who have met recognise each other, and
    // their standing colours the encounter — friends drink, rivals argue.
    // The pull scales with how strong the bond (or grudge) has grown.
    const prior = this.priorEncounter(a, b);
    if (prior) {
      weights.silent_recognition += 0.2;
      if (prior.affinity > 0) {
        weights.shared_drink += (prior.affinity / AFFINITY_MAX) * 0.6;
      } else if (prior.affinity < 0) {
        weights.overheard_argument += (prior.affinity / AFFINITY_MIN) * 0.6;
      }
    }
    return weightedPick(weights, rng);
  }

  /** The standing record between a and b from a's memory, if they have met. */
  private priorEncounter(
    a: Npc | undefined,
    b: Npc | undefined,
  ): CharacterEncounter | undefined {
    if (!this.persistence || !a || !b) return undefined;
    const character = this.persistence.loadCharacter(a.id);
    return character?.memory.encounters.find((e) => e.characterId === b.id);
  }
}

function weightedPick<T extends string>(weights: Record<T, number>, rng: Rng): T {
  const entries = Object.entries(weights) as Array<[T, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}
