/**
 * Phase 8 (B2): live event ticker.
 *
 * A scrollable parchment column in the right margin. Salient events (server-
 * filtered, server-rendered prose) scroll past as the day unfolds: arrivals,
 * thread beats, world-tag shifts, desire fulfilments, the player's verbs.
 *
 * Drives:
 *  - initial fetch on mount (hot-start buffer from `/events/recent`)
 *  - incremental polling whenever `recentEvents.length` changes — that's our
 *    SSE pulse; the actual fetch is a single round-trip with sinceEventId so
 *    it pays nothing for "nothing happened" beats
 *
 * B3 adds click-to-focus and thread drill-down.
 */
import { useEffect } from 'react';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

export function EventTicker() {
  const { tickerEntries, tickerLastEventId, recentEvents, tavern, world } =
    useStore();
  const dispatch = useDispatch();

  // Initial fetch on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .getRecentEvents(0)
      .then((res) => {
        if (cancelled) return;
        dispatch({ type: 'TICKER_LOADED', payload: res });
      })
      .catch(() => {
        // Ignore — the SSE event pulse below will retry incrementally.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Incremental fetch driven by the SSE world_event pulse. Cheap because
  // sinceEventId means the server only returns the new salient entries.
  useEffect(() => {
    if (recentEvents.length === 0) return;
    let cancelled = false;
    api
      .getRecentEvents(tickerLastEventId)
      .then((res) => {
        if (cancelled) return;
        if (res.entries.length > 0 || res.lastEventId > tickerLastEventId) {
          dispatch({ type: 'TICKER_LOADED', payload: res });
        }
      })
      .catch(() => {
        // Ignore individual misses; next SSE pulse triggers another try.
      });
    return () => {
      cancelled = true;
    };
    // We depend on the length of recentEvents — that's our SSE pulse — and
    // the current cursor. tickerLastEventId is read inside the effect so we
    // see the latest after a previous load completed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentEvents.length]);

  if (tickerEntries.length === 0) {
    return (
      <aside className="event-ticker" aria-label="Recent happenings">
        <div className="event-ticker-empty">The hour is yet quiet.</div>
      </aside>
    );
  }

  const subTicksPerDay = tavern?.subTicksPerDay ?? 360;

  return (
    <aside className="event-ticker" aria-label="Recent happenings">
      <ol className="event-ticker-list">
        {tickerEntries.map((entry) => {
          const stamp = formatStamp(entry, world?.gameDay, subTicksPerDay);
          return (
            <li key={entry.eventId} className="event-ticker-entry">
              <span className="event-ticker-stamp" aria-hidden>
                {stamp}
              </span>
              <span className="event-ticker-text">{entry.text}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/**
 * "today" entries show a sub-tick prefix; older entries show "d{n}" to keep
 * the line short. `event.gameDay` is the canonical reference; sub-tick is
 * lifted off the underlying event for interactions only — other event types
 * don't carry one, in which case we fall back to gameDay.
 */
function formatStamp(
  entry: { event: { gameDay?: number; subTick?: number; interaction?: { subTick?: number } } },
  currentGameDay: number | undefined,
  _subTicksPerDay: number,
): string {
  const gd = entry.event.gameDay ?? 0;
  if (currentGameDay !== undefined && gd === currentGameDay) {
    const st =
      entry.event.subTick ??
      entry.event.interaction?.subTick;
    return typeof st === 'number' ? `t${st}` : '·';
  }
  return `d${gd}`;
}
