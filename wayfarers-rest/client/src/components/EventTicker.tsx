/**
 * Phase 8 (B2/B3): live event ticker.
 *
 * A scrollable parchment column in the right margin. Salient events (server-
 * filtered, server-rendered prose) scroll past as the day unfolds. B3 added
 * click-to-focus (an NPC reference glows the matching sprite) and inline
 * thread expansion (a thread reference unfolds the recent history beneath
 * the entry).
 */
import { useEffect } from 'react';
import type { TickerEntry, WorldEvent } from '@shared/types';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

/** How long the click-to-focus glow lingers on an NPC sprite. */
const FOCUS_GLOW_MS = 3_000;

export function EventTicker() {
  const {
    tickerEntries,
    tickerLastEventId,
    recentEvents,
    tavern,
    world,
    threads,
    expandedThreadId,
  } = useStore();
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
        // Swallow — the SSE pulse below will retry incrementally.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Incremental fetch driven by the SSE world_event pulse.
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
        // Ignore — next pulse retries.
      });
    return () => {
      cancelled = true;
    };
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
  const threadsById = new Map(threads.map((t) => [t.id, t]));

  const onClickEntry = (entry: TickerEntry) => {
    const npcId = npcIdFromEvent(entry.event);
    if (npcId) {
      dispatch({
        type: 'FOCUS_NPC',
        payload: { npcId, expiresAt: Date.now() + FOCUS_GLOW_MS },
      });
      return;
    }
    const threadId = threadIdFromEvent(entry.event);
    if (threadId) {
      dispatch({
        type: 'TOGGLE_TICKER_THREAD',
        payload: { threadId },
      });
    }
  };

  return (
    <aside className="event-ticker" aria-label="Recent happenings">
      <ol className="event-ticker-list">
        {tickerEntries.map((entry) => {
          const stamp = formatStamp(entry, world?.gameDay, subTicksPerDay);
          const npcId = npcIdFromEvent(entry.event);
          const threadId = threadIdFromEvent(entry.event);
          const clickable = npcId !== undefined || threadId !== undefined;
          const expanded = threadId !== undefined && expandedThreadId === threadId;
          const thread = expanded ? threadsById.get(threadId!) : undefined;
          return (
            <li
              key={entry.eventId}
              className={`event-ticker-entry${clickable ? ' event-ticker-entry--clickable' : ''}`}
            >
              <button
                type="button"
                className="event-ticker-row"
                onClick={() => clickable && onClickEntry(entry)}
                disabled={!clickable}
                aria-expanded={threadId ? expanded : undefined}
              >
                <span className="event-ticker-stamp" aria-hidden>
                  {stamp}
                </span>
                <span className="event-ticker-text">{entry.text}</span>
              </button>
              {expanded && thread && (
                <div className="event-ticker-thread-detail">
                  <div className="event-ticker-thread-state">
                    <span className="event-ticker-thread-type">{thread.type}</span>
                    <span className="event-ticker-thread-status">
                      {thread.state}
                    </span>
                  </div>
                  {thread.history.length > 0 && (
                    <ol className="event-ticker-thread-history">
                      {thread.history.slice(-4).map((h, i) => (
                        <li key={i}>
                          <span className="event-ticker-thread-day">
                            d{h.gameDay}
                          </span>
                          <span>{h.note}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/**
 * Extract the (single) NPC id a ticker entry is "about", if any. Used so a
 * click on an arrival or desire fulfilment glows the right sprite.
 */
function npcIdFromEvent(ev: WorldEvent): string | undefined {
  switch (ev.type) {
    case 'npc_arrived':
    case 'npc_returned':
    case 'npc_departed':
    case 'npc_marked':
    case 'npc_unmarked':
    case 'desire_fulfilled':
    case 'desire_unfulfilled':
      return ev.npcId;
    case 'interaction':
      return ev.interaction.participantIds[0];
    default:
      return undefined;
  }
}

function threadIdFromEvent(ev: WorldEvent): string | undefined {
  switch (ev.type) {
    case 'thread_started':
    case 'thread_progressed':
    case 'thread_completed':
      return ev.threadId;
    default:
      return undefined;
  }
}

function formatStamp(
  entry: TickerEntry,
  currentGameDay: number | undefined,
  _subTicksPerDay: number,
): string {
  const gd = entry.gameDay;
  if (currentGameDay !== undefined && gd === currentGameDay) {
    // Interaction events carry an explicit subTick; others don't, so we
    // fall back to a generic marker for today.
    const ev = entry.event as { interaction?: { subTick?: number } };
    const st = ev.interaction?.subTick;
    return typeof st === 'number' ? `t${st}` : '·';
  }
  return `d${gd}`;
}
