import { registerThread } from '../registry.ts';
import type { ThreadDefinition, ThreadTickResult } from '../types.ts';

/**
 * Phase 7 (D3): a festival thread — a recurring celebration.
 *
 * It runs announced → imminent → underway → concluded, driving a `festival`
 * world tag. While the tag reads 'underway' the spawn queue swells with extra
 * arrivals (see `generateSpawnQueue`). On concluding it schedules the next
 * festival, so the cycle sustains itself from a single seed at world init.
 */
const NEXT_FESTIVAL_DELAY = 20;

export const FESTIVAL: ThreadDefinition = {
  type: 'festival',
  initialState: 'announced',
  initialNextTickDelay: 3,
  tick({ thread, helpers }) {
    switch (thread.state) {
      case 'announced':
        helpers.introduceRumor({
          text: 'Word has spread of a festival coming to the Rest.',
        });
        return {
          nextState: 'imminent',
          nextTickDelay: 3,
          note: 'a festival has been announced',
        };

      case 'imminent':
        helpers.setWorldTag('festival', 'imminent');
        helpers.introduceRumor({
          text: 'The festival draws near; the Rest readies itself.',
        });
        return {
          nextState: 'underway',
          nextTickDelay: 2,
          note: 'the festival is imminent',
        };

      case 'underway':
        helpers.setWorldTag('festival', 'underway');
        helpers.introduceRumor({
          text: 'The festival is in full swing — every bench at the Rest is taken.',
        });
        return {
          nextState: 'concluded',
          nextTickDelay: 3,
          note: 'the festival is underway',
        };

      case 'concluded':
        helpers.setWorldTag('festival', 'past');
        helpers.introduceRumor({
          text: 'The festival has wound down; the Rest settles back to its rhythm.',
        });
        // Keep the cycle going — the next festival is already on the calendar.
        helpers.spawnThread({
          type: 'festival',
          initialNextTickDelay: NEXT_FESTIVAL_DELAY,
        });
        return {
          nextState: 'closed',
          nextTickDelay: 0,
          note: 'the festival has concluded',
          completes: { outcome: 'concluded' },
        };

      default:
        return {
          nextState: thread.state,
          nextTickDelay: 0,
          completes: { outcome: 'concluded' },
        } satisfies ThreadTickResult;
    }
  },
};

registerThread(FESTIVAL);
