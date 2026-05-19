import { locationById } from '../../world/locations.ts';
import { registerThread } from '../registry.ts';
import type { ThreadDefinition } from '../types.ts';

interface StrangerPayload {
  displayName: string;
  originLocationId: string;
  archetype?: string;
  carriedRumorIds?: string[];
  wasBeckoned?: boolean;
}

export const APPROACHING_STRANGER: ThreadDefinition = {
  type: 'approaching_stranger',
  initialState: 'traveling',
  initialNextTickDelay: 2,
  tick({ thread, helpers }) {
    const payload = thread.payload as unknown as StrangerPayload;
    const origin = locationById(payload.originLocationId);
    const arrivalDay = thread.nextTickGameDay;
    helpers.scheduleArrival({
      onGameDay: arrivalDay,
      displayName: payload.displayName,
      originLocationId: payload.originLocationId,
      archetype: payload.archetype,
      carriedRumorIds: payload.carriedRumorIds,
      wasBeckoned: payload.wasBeckoned,
    });
    return {
      nextState: 'arrived',
      nextTickDelay: 0,
      note: `${payload.displayName} arrives from ${origin?.displayName ?? payload.originLocationId}`,
      completes: { outcome: 'arrived' },
    };
  },
};

registerThread(APPROACHING_STRANGER);
