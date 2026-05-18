import { registerThread } from '../registry.ts';
import type { ThreadDefinition } from '../types.ts';

interface WorldlyEventPayload {
  tagKey: string;
  sequence: string[];
  dwellDays: number;
  cursor?: number; // index into sequence
}

export const WORLDLY_EVENT: ThreadDefinition = {
  type: 'worldly_event',
  initialState: 'cued',
  initialNextTickDelay: 2,
  tick({ thread, helpers }) {
    const payload = thread.payload as unknown as WorldlyEventPayload;
    const cursor = payload.cursor ?? 0;
    const value = payload.sequence[cursor];
    helpers.setWorldTag(payload.tagKey, value);

    const nextCursor = cursor + 1;
    const isLast = nextCursor >= payload.sequence.length;

    return {
      nextState: isLast ? 'resolved' : `step_${nextCursor}`,
      nextTickDelay: isLast ? 0 : payload.dwellDays,
      payloadPatch: { cursor: nextCursor },
      note: `${payload.tagKey} → ${value}`,
      completes: isLast ? { outcome: value } : undefined,
    };
  },
};

registerThread(WORLDLY_EVENT);
