import type { NpcArchetype } from '@shared/types';
import { PLACEHOLDER_NAMES } from '../../data/placeholderNames.ts';
import { LOCATIONS } from '../../world/locations.ts';
import { register } from '../registry.ts';
import type {
  BeckonPayload,
  InterventionDefinition,
} from '../types.ts';

const CANONICAL_ARCHETYPES: ReadonlySet<NpcArchetype> = new Set<NpcArchetype>([
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
]);

export const BECKON: InterventionDefinition<BeckonPayload> = {
  kind: 'beckon',
  cost: 1,
  describe(payload) {
    const days = payload.preferredDayOffset ?? 2;
    return `You sent for a ${payload.archetype}, due in ${days} day${days === 1 ? '' : 's'}`;
  },
  validate(payload) {
    if (!payload || typeof payload.archetype !== 'string') {
      return { ok: false, reason: 'archetype is required' };
    }
    if (!CANONICAL_ARCHETYPES.has(payload.archetype as NpcArchetype)) {
      return { ok: false, reason: `unknown archetype: ${payload.archetype}` };
    }
    const off = payload.preferredDayOffset;
    if (off !== undefined && off !== 1 && off !== 2 && off !== 3) {
      return { ok: false, reason: 'preferredDayOffset must be 1, 2, or 3' };
    }
    return { ok: true };
  },
  apply({ payload, helpers, gameDay }) {
    // Deterministic origin pick + name pick based on game day and archetype
    // so the same beckon under the same seed lands identically.
    const seed = `beckon-${gameDay}-${payload.archetype}`;
    const idxA = hashString(seed) % LOCATIONS.length;
    const origin = LOCATIONS[idxA];
    const idxB = hashString(seed + '|name') % PLACEHOLDER_NAMES.length;
    const displayName = PLACEHOLDER_NAMES[idxB];

    const delay = payload.preferredDayOffset ?? 2;
    const carriedRumorIds = payload.carriedRumorId ? [payload.carriedRumorId] : undefined;
    const threadId = helpers.spawnThread({
      type: 'approaching_stranger',
      payload: {
        displayName,
        originLocationId: origin.id,
        archetype: payload.archetype,
        carriedRumorIds,
        wasBeckoned: true,
      },
      initialNextTickDelay: delay,
    });
    return { spawnedThreadId: threadId };
  },
};

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

register(BECKON);
