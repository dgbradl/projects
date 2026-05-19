import type { Rumor, ScheduledArrival } from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { FlavorCache } from '../llm/cache/manager.ts';
import type { RumorInput, RumorOutput } from '../llm/slots/rumor.ts';
import type { Persistence } from '../persistence.ts';
import { locationById } from './locations.ts';
import type { Rng } from './rng.ts';

export interface IntroduceRumorInput {
  /**
   * If a `text` is not supplied, the rumor cache is used to produce one.
   * When supplied (legacy / fixture path), it overrides the cache.
   */
  text?: string;
  sourceThreadId?: string;
  originLocationId?: string;
  /** Inputs for the placeholder when the cache is in placeholder mode. */
  placeholderHint?: {
    tagKey?: string;
    tagValue?: string;
    threadHistoryNote?: string;
  };
}

export class RumorsManager {
  private flavorCache: FlavorCache | null = null;

  constructor(
    private readonly persistence: Persistence,
    private readonly bus: WorldEventBus,
  ) {}

  /** Wired post-construction because the FlavorCache depends on us via mode. */
  setFlavorCache(cache: FlavorCache | null): void {
    this.flavorCache = cache;
  }

  introduce(input: IntroduceRumorInput, gameDay: number): string {
    const counter = this.persistence.countRumorsIntroducedOnDay(gameDay);
    const id = `rumor_d${gameDay}_${counter}`;

    const origin = input.originLocationId
      ? locationById(input.originLocationId)
      : undefined;
    let text = input.text;
    if (!text) {
      if (this.flavorCache) {
        const placeholderInput: RumorInput = {
          locationDisplayName: origin?.displayName ?? 'somewhere distant',
          tagKey: input.placeholderHint?.tagKey ?? 'word',
          tagValue: input.placeholderHint?.tagValue ?? 'travels',
          threadHistoryNote: input.placeholderHint?.threadHistoryNote,
          seed: id,
        };
        const out = this.flavorCache.take<RumorInput, RumorOutput>('rumor', {
          placeholderInput,
          gameDay,
        });
        text = out.text;
      } else {
        text = `Word from ${origin?.displayName ?? 'far away'}.`;
      }
    }

    const rumor: Rumor = {
      id,
      text,
      introducedGameDay: gameDay,
      sourceThreadId: input.sourceThreadId,
      originLocationId: input.originLocationId,
      available: true,
    };
    this.persistence.saveRumor(rumor);
    this.bus.publish({ type: 'rumor_introduced', gameDay, rumorId: id });
    return id;
  }

  getAvailable(): Rumor[] {
    return this.persistence.loadAvailableRumors();
  }

  getAll(): Rumor[] {
    return this.persistence.loadAllRumors();
  }

  markUnavailable(id: string): void {
    const all = this.persistence.loadAllRumors();
    const rumor = all.find((r) => r.id === id);
    if (!rumor || !rumor.available) return;
    this.persistence.saveRumor({ ...rumor, available: false });
  }

  /**
   * Roll which available rumors to attach to a fresh arrival. Probability rises
   * with distance from the rumor's origin. Hard cap of 2 carried per arrival.
   *
   * Phase 6: player-seeded rumors carry 2× weight for their first 3 game days.
   */
  rollAttachmentsForArrival(
    arrival: ScheduledArrival,
    rng: Rng,
    currentGameDay: number,
  ): string[] {
    const attached: string[] = [];
    const arrivalOrigin = arrival.originLocationId
      ? locationById(arrival.originLocationId)
      : undefined;
    const arrivalDistance = arrivalOrigin?.distanceDays ?? 5;

    for (const rumor of this.getAvailable()) {
      if (attached.length >= 2) break;
      const rumorOrigin = rumor.originLocationId
        ? locationById(rumor.originLocationId)
        : undefined;
      const boost =
        rumor.playerOrigin && currentGameDay - rumor.introducedGameDay < 3
          ? 2
          : 1;
      if (rumorOrigin && rumorOrigin.id === arrival.originLocationId) {
        if (rng() < Math.min(1, 0.7 * boost)) attached.push(rumor.id);
        continue;
      }
      const rumorDistance = rumorOrigin?.distanceDays ?? 5;
      const base = Math.min(1, arrivalDistance / 10);
      const prob = Math.min(1, base * 0.5 * Math.min(1, rumorDistance / 10) * boost);
      if (rng() < prob) attached.push(rumor.id);
    }
    return attached;
  }

  /**
   * Phase 6: mark a rumor row as player-seeded and stamp its tone.
   * Used by `plant_rumor.apply` after the regular `introduce` call so that
   * the carry-weight boost and chronicle hints take effect.
   */
  markPlayerOrigin(rumorId: string, tone: import('@shared/types').RumorTone): void {
    const rumor = this.persistence.loadRumorById(rumorId);
    if (!rumor) return;
    this.persistence.saveRumor({ ...rumor, playerOrigin: true, tone });
  }
}
