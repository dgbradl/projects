/**
 * Phase 9 (H3): the Tavern Memory page.
 *
 * A scrolling timeline of the tavern's high-salience moments — one
 * capital-M event per game day. Accessed from the hamburger menu.
 *
 * Each entry is a single sentence rendered by the server's chronicle
 * prose pipeline (same path the LLM-off chronicle uses), so the live
 * ticker, the day-end chronicle, and the Memory page all speak in one
 * voice across three registers.
 */
import { useEffect, useState } from 'react';
import type { TavernMemoryEntry } from '@shared/types';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

export function TavernMemoryModal() {
  const { tavernMemoryOpen, world } = useStore();
  const dispatch = useDispatch();
  const [entries, setEntries] = useState<TavernMemoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tavernMemoryOpen) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    api
      .getTavernMemory()
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [tavernMemoryOpen]);

  // Escape closes the modal — matches the rest of the app's modal idiom.
  useEffect(() => {
    if (!tavernMemoryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'TAVERN_MEMORY_CLOSED' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tavernMemoryOpen, dispatch]);

  if (!tavernMemoryOpen) return null;

  const dayCount = world?.gameDay ?? 0;
  const tavernName = world?.tavernName ?? '';

  return (
    <div
      className="tavern-memory"
      role="dialog"
      aria-label="Tavern Memory"
      onClick={(e) => {
        // Click on the scrim (outside the card) closes the modal.
        if (e.target === e.currentTarget) {
          dispatch({ type: 'TAVERN_MEMORY_CLOSED' });
        }
      }}
    >
      <div className="tavern-memory-card">
        <header className="tavern-memory-header">
          <h2 className="tavern-memory-title">
            The Memory of {tavernName || 'the Tavern'}
          </h2>
          <p className="tavern-memory-subtitle">
            {dayCount > 0
              ? `${dayCount} day${dayCount === 1 ? '' : 's'} of history`
              : 'A new tavern, yet without history.'}
          </p>
          <button
            type="button"
            className="tavern-memory-close"
            onClick={() => dispatch({ type: 'TAVERN_MEMORY_CLOSED' })}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="tavern-memory-body">
          {error && <div className="tavern-memory-error">{error}</div>}
          {!error && entries === null && (
            <div className="tavern-memory-loading">…</div>
          )}
          {!error && entries && entries.length === 0 && (
            <div className="tavern-memory-empty">
              The tavern has no high moments to remember yet. Come back after a
              few days of play.
            </div>
          )}
          {!error && entries && entries.length > 0 && (
            <ol className="tavern-memory-list">
              {entries.map((e) => (
                <li key={e.eventId} className="tavern-memory-entry">
                  <span className="tavern-memory-day">Day {e.gameDay}</span>
                  <span className="tavern-memory-text">{e.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
