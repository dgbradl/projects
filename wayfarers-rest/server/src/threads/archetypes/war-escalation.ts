import { registerThread } from '../registry.ts';
import type { ThreadDefinition, ThreadTickResult } from '../types.ts';

/**
 * Phase 7 (D4): a war-escalation thread.
 *
 * A chained worldly arc — a distant war creeps closer step by step,
 * escalating the `war_in_north` tag (which pushes refugees onto the spawn
 * queue) and then souring `road_safety_south`, before resolving as a victory
 * or a grinding stalemate. A richer successor to the plain `worldly_event`
 * that used to walk `war_in_north` through a fixed sequence.
 */
export const WAR_ESCALATION: ThreadDefinition = {
  type: 'war_escalation',
  initialState: 'distant',
  initialNextTickDelay: 4,
  tick({ thread, rng, helpers, world }) {
    switch (thread.state) {
      case 'distant':
        helpers.setWorldTag('war_in_north', 'simmering');
        helpers.introduceRumor({
          text: 'Word has reached the Rest of war stirring in the north.',
        });
        return {
          nextState: 'escalating',
          nextTickDelay: 4,
          note: 'war stirs in the north',
        };

      case 'escalating':
        helpers.setWorldTag('war_in_north', 'escalating');
        helpers.introduceRumor({
          text: 'The war in the north has escalated; refugees have taken to the roads.',
        });
        return {
          nextState: 'crisis',
          nextTickDelay: 4,
          note: 'the war in the north escalates',
        };

      case 'crisis':
        helpers.setWorldTag('road_safety_south', 'poor');
        helpers.introduceRumor({
          text: 'The war has spilled south; the roads have grown perilous.',
        });
        return {
          nextState: 'resolving',
          nextTickDelay: 4,
          note: 'the war reaches the southern roads',
        };

      case 'resolving': {
        // The roads recover whichever way the war turns.
        // Phase 9 (G3): a `trade_crossroads` tavern attracts patrols on
        // the road south — recovery jumps straight to `good` instead of
        // settling at `fair`. Stub from D3 lands here.
        const tradeCrossroads = world.tavernTraits.includes('trade_crossroads');
        helpers.setWorldTag(
          'road_safety_south',
          tradeCrossroads ? 'good' : 'fair',
        );
        if (rng() < 0.5) {
          helpers.setWorldTag('war_in_north', 'resolved');
          helpers.introduceRumor({
            text: 'The war in the north has ended at last.',
          });
          return {
            nextState: 'ended',
            nextTickDelay: 0,
            note: 'the war in the north ended',
            completes: { outcome: 'ended' },
          };
        }
        helpers.setWorldTag('war_in_north', 'simmering');
        helpers.introduceRumor({
          text: 'The war in the north has ground down into an uneasy stalemate.',
        });
        return {
          nextState: 'stalemate',
          nextTickDelay: 0,
          note: 'the war in the north reached a stalemate',
          completes: { outcome: 'stalemate' },
        };
      }

      default:
        return {
          nextState: thread.state,
          nextTickDelay: 0,
          completes: { outcome: 'ended' },
        } satisfies ThreadTickResult;
    }
  },
};

registerThread(WAR_ESCALATION);
