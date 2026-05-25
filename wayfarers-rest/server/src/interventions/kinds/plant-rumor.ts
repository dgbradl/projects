import { locationById } from '../../world/locations.ts';
import { register } from '../registry.ts';
import type {
  InterventionDefinition,
  PlantRumorPayload,
} from '../types.ts';

const TONES = ['foreboding', 'curious', 'mundane', 'urgent'] as const;
const DEFAULT_TONE = 'curious';

export const PLANT_RUMOR: InterventionDefinition<PlantRumorPayload> = {
  kind: 'plant_rumor',
  cost: 1,
  describe(payload, options, effect) {
    const loc = options.targets.locations.find((l) => l.id === payload.locationId);
    const where = loc?.displayName ?? payload.locationId;
    const tone = payload.tone ?? DEFAULT_TONE;
    const base = `You whispered a ${tone} rumor toward ${where}`;
    // Phase 8 (A4): if a present NPC's matching desire was fulfilled, name them.
    if (effect?.fulfilledDesireOnNpcId) {
      return `${base}, and ${effect.fulfilledDesireOnNpcId} caught the news they were waiting for`;
    }
    return base;
  },
  validate(payload) {
    if (!payload || typeof payload.locationId !== 'string') {
      return { ok: false, reason: 'locationId is required' };
    }
    if (!locationById(payload.locationId)) {
      return { ok: false, reason: `unknown locationId: ${payload.locationId}` };
    }
    if (
      payload.tone !== undefined &&
      !TONES.includes(payload.tone as (typeof TONES)[number])
    ) {
      return { ok: false, reason: `unknown tone: ${payload.tone}` };
    }
    return { ok: true };
  },
  apply({ payload, helpers, gameDay }) {
    const tone = payload.tone ?? DEFAULT_TONE;
    const loc = locationById(payload.locationId)!;
    const rumorId = helpers.introduceRumor({
      originLocationId: loc.id,
      tagKey: 'word',
      tagValue: tone,
      threadHistoryNote: `seeded by the keeper of The Wayfarer's Rest`,
    });
    // Phase 8 (A4): the just-introduced rumor may match a present NPC's
    // news_of_location or rumor_of_tone desire — fulfil the first hit.
    const fulfilledNpcId = helpers.fulfilDesireFromRumor?.(
      { originLocationId: loc.id, tone },
      'keeper:plant_rumor',
    );
    return {
      introducedRumorId: rumorId,
      fulfilledDesireOnNpcId: fulfilledNpcId,
    };
  },
};

register(PLANT_RUMOR);
