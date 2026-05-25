import type { WorldEvent } from '@shared/types';
import { useStore } from '../../state/store.tsx';

/** Inspector tab: raw server event stream. Last 30, newest first. The
 *  per-type summary is intentionally terse — this is the developer view, not
 *  the player-facing chronicle (which lives in the Events tab). */
export function RecentEventsSection() {
  const { recentEvents } = useStore();
  return (
    <details data-testid="debug-events">
      <summary>recent events ({recentEvents.length})</summary>
      <ul className="debug-list debug-events">
        {recentEvents.slice(0, 30).map((e) => (
          <li key={e.id}>
            <span className="debug-dim">#{e.id}</span> {e.event.type}{' '}
            <span className="debug-dim">{summarize(e.event)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function summarize(event: WorldEvent): string {
  switch (event.type) {
    case 'npc_arrived':
      return event.displayName;
    case 'npc_returned':
      return `${event.displayName} ×${event.visitCount}`;
    case 'npc_departed':
      return event.destinationLocationId ?? '';
    case 'world_tag_changed':
      return `${event.key} ${event.oldValue ?? '∅'}→${event.newValue}`;
    case 'thread_started':
      return event.threadType;
    case 'thread_progressed':
      return `${event.fromState}→${event.toState}`;
    case 'thread_completed':
      return event.outcome;
    case 'interaction':
      return `${event.interaction.kind} @ ${event.interaction.zone}`;
    case 'rumor_introduced':
      return event.rumorId;
    default:
      return '';
  }
}
