import { useMemo } from 'react';
import { useStore } from '../../state/store.tsx';

/** Inspector tab: NPCs scheduled to arrive in future ticks, grouped by day. */
export function PendingArrivalsSection() {
  const { pendingArrivals } = useStore();

  const arrivalsByDay = useMemo(() => {
    const groups = new Map<number, typeof pendingArrivals>();
    for (const a of pendingArrivals) {
      const list = groups.get(a.scheduledGameDay) ?? [];
      list.push(a);
      groups.set(a.scheduledGameDay, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [pendingArrivals]);

  return (
    <details data-testid="debug-arrivals">
      <summary>pending arrivals ({pendingArrivals.length})</summary>
      {arrivalsByDay.length === 0 ? (
        <div className="debug-dim">(none in window)</div>
      ) : (
        arrivalsByDay.map(([day, list]) => (
          <div key={day}>
            <div className="debug-key">day {day}</div>
            <ul className="debug-list">
              {list.map((a) => (
                <li key={a.npcId}>
                  {a.displayName}{' '}
                  <span className="debug-dim">
                    ({a.archetype ?? 'traveler'}
                    {a.originLocationId ? ` from ${a.originLocationId}` : ''})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </details>
  );
}
