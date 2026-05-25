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
  'mage',
  'knight',
  'bard',
  'hunter',
]);

export const BECKON: InterventionDefinition<BeckonPayload> = {
  kind: 'beckon',
  cost: 1,
  describe(payload, _options, effect) {
    const days = payload.preferredDayOffset ?? 2;
    const base = `You sent for a ${payload.archetype}, due in ${days} day${days === 1 ? '' : 's'}`;
    // Phase 8 (A4): the keeper's act of summoning may have answered a present
    // NPC's wish for company.
    if (effect?.fulfilledDesireOnNpcId) {
      return `${base}, easing ${effect.fulfilledDesireOnNpcId}'s wish for kin`;
    }
    return base;
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
    // Phase 8 (A4): the keeper's act of summoning may answer a present NPC's
    // unmet `company_of_kind` desire — they've heard kin is on the way. The
    // beckoned NPC themselves arrives 1-3 days later, but the wish counts
    // satisfied now: the wisdom of the keeper is its own balm.
    const fulfilledNpcId = helpers.fulfilCompanyDesireForArchetype?.(
      payload.archetype,
      'keeper:beckon',
    );
    return { spawnedThreadId: threadId, fulfilledDesireOnNpcId: fulfilledNpcId };
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
