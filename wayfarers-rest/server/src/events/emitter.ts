import { EventEmitter } from 'node:events';
import type { EventLogEntry, WorldEvent } from '@shared/types';
import type { Clock } from '../lib/clock.ts';
import type { Persistence } from '../persistence.ts';

/**
 * Single point of egress for all WorldEvents.
 *
 * - Persists each event to the `events` table.
 * - Emits a Node EventEmitter signal so the SSE layer can broadcast.
 * - Also signals 'world_change' for any subscriber wanting to re-broadcast
 *   the full WorldSnapshot (used by the SSE layer to push a snapshot frame
 *   after each event).
 */
export class WorldEventBus extends EventEmitter {
  constructor(
    private readonly persistence: Persistence,
    private readonly clock: Clock,
  ) {
    super();
  }

  publish(event: WorldEvent): EventLogEntry {
    const entry = this.persistence.appendWorldEvent(
      event,
      new Date(this.clock.now()).toISOString(),
    );
    this.emit('world_event', entry);
    this.emit('world_change', entry);
    return entry;
  }
}
