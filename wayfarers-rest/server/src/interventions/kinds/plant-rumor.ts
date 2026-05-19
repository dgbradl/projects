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
  describe(payload, options) {
    const loc = options.targets.locations.find((l) => l.id === payload.locationId);
    const where = loc?.displayName ?? payload.locationId;
    const tone = payload.tone ?? DEFAULT_TONE;
    return `You whispered a ${tone} rumor toward ${where}`;
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
    return { introducedRumorId: rumorId };
  },
};

register(PLANT_RUMOR);
