import { registerThread } from '../registry.ts';
import type { ThreadDefinition, ThreadTickResult } from '../types.ts';

/**
 * Phase 7 (B3): a relationship thread. Spawned by the character-memory
 * recorder when two characters' affinity reaches an extreme — a friendship
 * or a feud — it plays a short two-beat arc whose notes name both parties,
 * so the bond surfaces in the daily chronicle.
 */
interface RelationshipPayload {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  kind: 'friendship' | 'feud';
}

export const RELATIONSHIP: ThreadDefinition = {
  type: 'relationship',
  initialState: 'forming',
  initialNextTickDelay: 2,
  tick({ thread, helpers }) {
    const payload = thread.payload as unknown as RelationshipPayload;
    const { aName, bName, kind } = payload;
    const friendly = kind === 'friendship';

    switch (thread.state) {
      case 'forming':
        return {
          nextState: 'established',
          nextTickDelay: 3,
          note: friendly
            ? `a friendship has taken root between ${aName} and ${bName}`
            : `bad blood has settled between ${aName} and ${bName}`,
        };

      case 'established': {
        if (!friendly) {
          // Phase 7 (D1): a hardened personal feud spills outward — the
          // quarrel becomes a tavern-wide matter of its own.
          helpers.spawnThread({
            type: 'feud',
            payload: {
              sideA: aName,
              sideB: bName,
              tagKey: `feud_${payload.aId}_${payload.bId}`,
            },
          });
        }
        return {
          nextState: 'settled',
          nextTickDelay: 0,
          note: friendly
            ? `${aName} and ${bName} are now fast friends`
            : `the feud between ${aName} and ${bName} has hardened into lasting enmity`,
          completes: { outcome: kind },
        };
      }

      default:
        return {
          nextState: thread.state,
          nextTickDelay: 0,
          completes: { outcome: kind },
        } satisfies ThreadTickResult;
    }
  },
};

registerThread(RELATIONSHIP);
