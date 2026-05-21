import { registerThread } from '../registry.ts';
import type { ThreadDefinition, ThreadTickResult } from '../types.ts';

/**
 * Phase 7 (D1): a feud thread — a quarrel spilling outward into the tavern.
 *
 * Spawned when a personal rivalry hardens (see the `relationship` archetype),
 * it escalates over a few days: patrons take sides, a world tag sours, rumours
 * spread, and the quarrel finally either cools or entrenches.
 */
interface FeudPayload {
  /** Display name of one party (a person or a place). */
  sideA: string;
  /** Display name of the other party. */
  sideB: string;
  /** World tag the feud drives, so its stage is visible in world state. */
  tagKey: string;
}

export const FEUD: ThreadDefinition = {
  type: 'feud',
  initialState: 'spreading',
  initialNextTickDelay: 2,
  tick({ thread, rng, helpers }) {
    const { sideA, sideB, tagKey } = thread.payload as unknown as FeudPayload;

    switch (thread.state) {
      case 'spreading':
        helpers.setWorldTag(tagKey, 'simmering');
        helpers.introduceRumor({
          text: `The quarrel between ${sideA} and ${sideB} has set tongues wagging.`,
        });
        return {
          nextState: 'factions',
          nextTickDelay: 3,
          note: `the feud between ${sideA} and ${sideB} is spreading`,
        };

      case 'factions':
        helpers.setWorldTag(tagKey, 'open');
        helpers.introduceRumor({
          text: `Patrons have begun taking sides between ${sideA} and ${sideB}.`,
        });
        return {
          nextState: 'head',
          nextTickDelay: 3,
          note: `the feud between ${sideA} and ${sideB} is coming to a head`,
        };

      case 'head': {
        // A slim majority of feuds burn out rather than harden.
        if (rng() < 0.55) {
          helpers.setWorldTag(tagKey, 'eased');
          helpers.introduceRumor({
            text: `Cooler heads have eased the feud between ${sideA} and ${sideB}.`,
          });
          return {
            nextState: 'reconciled',
            nextTickDelay: 0,
            note: `the feud between ${sideA} and ${sideB} cooled`,
            completes: { outcome: 'reconciled' },
          };
        }
        helpers.setWorldTag(tagKey, 'bitter');
        helpers.introduceRumor({
          text: `The feud between ${sideA} and ${sideB} has split the room for good.`,
        });
        return {
          nextState: 'entrenched',
          nextTickDelay: 0,
          note: `the feud between ${sideA} and ${sideB} hardened`,
          completes: { outcome: 'entrenched' },
        };
      }

      default:
        return {
          nextState: thread.state,
          nextTickDelay: 0,
          completes: { outcome: 'unknown' },
        } satisfies ThreadTickResult;
    }
  },
};

registerThread(FEUD);
