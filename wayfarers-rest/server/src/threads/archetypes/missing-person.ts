import { registerThread } from '../registry.ts';
import type { ThreadDefinition, ThreadTickResult } from '../types.ts';

/**
 * Phase 7 (D2): a missing-person thread.
 *
 * Spawned when a traveller is lost to misfortune on the road (see the
 * `travelers_journey` archetype). Word spreads that they never arrived, a
 * searcher takes up the trail and comes to the Rest, and the trail ends one
 * of three ways — found safe, found the worse for it, or never found.
 */
interface MissingPersonPayload {
  missingName: string;
  lastSeenLocationId?: string;
}

export const MISSING_PERSON: ThreadDefinition = {
  type: 'missing_person',
  initialState: 'unaccounted',
  initialNextTickDelay: 2,
  tick({ thread, world, rng, helpers }) {
    const { missingName, lastSeenLocationId } =
      thread.payload as unknown as MissingPersonPayload;

    switch (thread.state) {
      case 'unaccounted':
        helpers.introduceRumor({
          text: `${missingName} set out for the Rest and has not been seen since.`,
          originLocationId: lastSeenLocationId,
        });
        return {
          nextState: 'searching',
          nextTickDelay: 2,
          note: `${missingName} is unaccounted for`,
        };

      case 'searching':
        // A searcher takes up the trail and makes for the tavern.
        helpers.scheduleArrival({
          onGameDay: world.gameDay + 2,
          archetype: 'wanderer',
          originLocationId: lastSeenLocationId,
        });
        helpers.introduceRumor({
          text: `Someone has come to the Rest asking after ${missingName}.`,
        });
        return {
          nextState: 'resolving',
          nextTickDelay: 3,
          note: `a searcher has taken up the trail of ${missingName}`,
        };

      case 'resolving': {
        const roll = rng();
        if (roll < 0.4) {
          helpers.introduceRumor({
            text: `${missingName} was found alive — only delayed by a hard road.`,
          });
          return {
            nextState: 'found_safe',
            nextTickDelay: 0,
            note: `${missingName} was found safe`,
            completes: { outcome: 'found_safe' },
          };
        }
        if (roll < 0.75) {
          helpers.introduceRumor({
            text: `${missingName} was found at last, but the road had not been kind.`,
          });
          return {
            nextState: 'found_ill',
            nextTickDelay: 0,
            note: `${missingName} was found, worse for the journey`,
            completes: { outcome: 'found_ill' },
          };
        }
        helpers.introduceRumor({
          text: `No trace of ${missingName} was ever found.`,
        });
        return {
          nextState: 'lost',
          nextTickDelay: 0,
          note: `${missingName} was never found`,
          completes: { outcome: 'lost' },
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

registerThread(MISSING_PERSON);
