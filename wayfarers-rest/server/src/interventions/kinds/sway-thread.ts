import type { Persistence } from '../../persistence.ts';
import { register } from '../registry.ts';
import type {
  InterventionDefinition,
  SwayThreadPayload,
} from '../types.ts';

const BLESS_BIAS = 0.3;
const CURSE_BIAS = -0.3;

export interface SwayThreadDeps {
  persistence: Persistence;
}

/**
 * The sway intervention needs direct persistence access to update the thread
 * row. We expose a builder so we can inject `persistence` at registration time.
 */
export function buildSwayThread(deps: SwayThreadDeps): InterventionDefinition<SwayThreadPayload> {
  return {
    kind: 'sway_thread',
    cost: 1,
    describe(payload) {
      return `You ${payload.direction === 'bless' ? 'blessed' : 'cursed'} a thread (${payload.threadId})`;
    },
    validate(payload) {
      if (!payload || typeof payload.threadId !== 'string') {
        return { ok: false, reason: 'threadId is required' };
      }
      if (payload.direction !== 'bless' && payload.direction !== 'curse') {
        return { ok: false, reason: "direction must be 'bless' or 'curse'" };
      }
      const thread = deps.persistence
        .loadAllThreads()
        .find((t) => t.id === payload.threadId);
      if (!thread) {
        return { ok: false, reason: `thread not found: ${payload.threadId}` };
      }
      if (thread.status !== 'active') {
        return { ok: false, reason: `thread is ${thread.status}, must be active` };
      }
      if ((thread.payload as Record<string, unknown>).swayBias !== undefined) {
        return { ok: false, reason: 'thread already swayed' };
      }
      return { ok: true };
    },
    apply({ payload }) {
      const thread = deps.persistence
        .loadAllThreads()
        .find((t) => t.id === payload.threadId);
      if (!thread) {
        // Should be unreachable; validate ran first.
        return {};
      }
      const swayBias = payload.direction === 'bless' ? BLESS_BIAS : CURSE_BIAS;
      const updated = {
        ...thread,
        payload: { ...thread.payload, swayBias },
      };
      deps.persistence.saveThread(updated);
      return { swayedThreadId: payload.threadId };
    },
  };
}
