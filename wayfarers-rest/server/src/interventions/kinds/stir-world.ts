import {
  PERMITTED_TAG_VALUES,
  isPermittedTagValue,
} from '../../world/tags.ts';
import type { Persistence } from '../../persistence.ts';
import { register } from '../registry.ts';
import type {
  InterventionDefinition,
  StirWorldPayload,
} from '../types.ts';

export interface StirWorldDeps {
  persistence: Persistence;
}

export function buildStirWorld(deps: StirWorldDeps): InterventionDefinition<StirWorldPayload> {
  return {
    kind: 'stir_world',
    cost: 2,
    describe(payload) {
      return `You stirred the world: ${payload.tagKey} turned to ${payload.newValue}`;
    },
    validate(payload) {
      if (!payload || typeof payload.tagKey !== 'string' || typeof payload.newValue !== 'string') {
        return { ok: false, reason: 'tagKey and newValue are required' };
      }
      if (!PERMITTED_TAG_VALUES[payload.tagKey]) {
        return { ok: false, reason: `unknown tag: ${payload.tagKey}` };
      }
      if (!isPermittedTagValue(payload.tagKey, payload.newValue)) {
        return {
          ok: false,
          reason: `value '${payload.newValue}' not permitted for tag '${payload.tagKey}'`,
        };
      }
      const current = deps.persistence.getWorldTag(payload.tagKey);
      if (current && current.value === payload.newValue) {
        return { ok: false, reason: 'no change: that is already the current value' };
      }
      return { ok: true };
    },
    apply({ payload, helpers }) {
      const prev = deps.persistence.getWorldTag(payload.tagKey);
      helpers.setWorldTag(payload.tagKey, payload.newValue);
      return {
        changedTag: {
          key: payload.tagKey,
          oldValue: prev?.value ?? '',
          newValue: payload.newValue,
        },
      };
    },
  };
}
