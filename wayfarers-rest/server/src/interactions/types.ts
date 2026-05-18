import type { ZoneName } from '@shared/types';

export interface InteractionCandidate {
  participantIds: [string, string];
  zone: ZoneName;
}
