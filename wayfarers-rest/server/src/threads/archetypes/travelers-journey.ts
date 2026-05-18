import { locationById } from '../../world/locations.ts';
import { registerThread } from '../registry.ts';
import type { ThreadDefinition, ThreadTickResult } from '../types.ts';

interface JourneyPayload {
  npcId?: string;
  displayName: string;
  destinationLocationId: string;
  trip?: 'outbound' | 'inbound';
}

export const TRAVELERS_JOURNEY: ThreadDefinition = {
  type: 'travelers_journey',
  initialState: 'traveling',
  initialNextTickDelay: 3, // overridden when started via helper using destination distance
  tick({ thread, rng, helpers }) {
    const payload = thread.payload as unknown as JourneyPayload;
    const destination = locationById(payload.destinationLocationId);
    const distance = destination?.distanceDays ?? 3;

    switch (thread.state) {
      case 'traveling': {
        // Misfortune base 5%; modulated by road_safety hint inside payload if present.
        const roadSafetyTag = (thread.payload as Record<string, unknown>).__roadSafety as
          | string
          | undefined;
        const misfortuneChance =
          roadSafetyTag === 'poor' ? 0.18 : roadSafetyTag === 'good' ? 0.02 : 0.05;
        if (rng() < misfortuneChance) {
          return {
            nextState: 'met_misfortune',
            nextTickDelay: 1,
            note: `met misfortune en route to ${destination?.displayName ?? 'parts unknown'}`,
          };
        }
        return {
          nextState: 'arrived_safely',
          nextTickDelay: 1 + Math.floor(rng() * 3),
          note: `arrived at ${destination?.displayName ?? payload.destinationLocationId}`,
        };
      }

      case 'arrived_safely': {
        if (rng() < 0.6 && destination) {
          helpers.introduceRumor({
            originLocationId: destination.id,
            tagKey: 'travel',
            tagValue: 'safe',
            threadHistoryNote: `${payload.displayName} reached ${destination.displayName}`,
          });
        }
        return {
          nextState: 'returning',
          nextTickDelay: Math.max(1, distance),
          note: `${payload.displayName} sets out for the tavern`,
          payloadPatch: { trip: 'inbound' },
        };
      }

      case 'returning': {
        helpers.scheduleArrival({
          onGameDay: thread.nextTickGameDay, // already incremented by runner; this is a hint
          displayName: payload.displayName,
          originLocationId: payload.destinationLocationId,
          carriedRumorIds: undefined,
          archetype: 'returning_traveler',
        });
        return {
          nextState: 'returned_to_tavern',
          nextTickDelay: 0,
          note: `${payload.displayName} returns to the tavern`,
          completes: { outcome: 'returned' },
        };
      }

      case 'met_misfortune': {
        if (destination) {
          helpers.introduceRumor({
            originLocationId: destination.id,
            tagKey: 'travel',
            tagValue: 'ill',
            threadHistoryNote: `${payload.displayName} never made it past ${destination.displayName}`,
          });
        }
        return {
          nextState: 'closed',
          nextTickDelay: 0,
          note: 'misfortune resolved',
          completes: { outcome: 'misfortune' },
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

registerThread(TRAVELERS_JOURNEY);
