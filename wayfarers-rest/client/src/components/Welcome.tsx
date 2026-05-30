import { useState } from 'react';
import type {
  ChronicleLedgerEntry,
  DailyChronicle,
  WorldEvent,
} from '@shared/types';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

/**
 * "Welcome back" view: prologue (if any) + per-day journal entries. Shown
 * when the player has unacknowledged chronicles waiting. Clicking "Enter
 * the tavern" posts an acknowledgement up to `toGameDay` and dismisses the
 * view.
 */
export function Welcome() {
  const { welcome } = useStore();
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);

  if (!welcome || !welcome.show) return null;

  const entries: Array<[number, DailyChronicle | 'pending']> = [];
  for (let d = welcome.fromGameDay; d <= welcome.toGameDay; d += 1) {
    entries.push([d, welcome.chronicles[d] ?? 'pending']);
  }

  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.postAcknowledge(welcome.toGameDay);
      dispatch({ type: 'WELCOME_DISMISSED' });
    } catch (err) {
      console.error('acknowledge failed', err);
      setBusy(false);
    }
  };

  return (
    <div className="welcome" data-testid="welcome">
      <header className="welcome-header">
        <h1>The Wayfarer's Rest</h1>
        <p className="welcome-subtitle">
          Days {welcome.fromGameDay} to {welcome.toGameDay}
        </p>
      </header>

      {welcome.prologue && (
        <section className="welcome-prologue" data-testid="welcome-prologue">
          {welcome.prologue.text}
        </section>
      )}

      <div className="welcome-entries">
        {entries.map(([day, entry]) => (
          <DayEntry key={day} day={day} entry={entry} />
        ))}
      </div>

      <footer className="welcome-footer">
        <button
          type="button"
          className="welcome-continue"
          onClick={onContinue}
          disabled={busy}
          data-testid="welcome-continue"
        >
          {busy ? 'Entering…' : 'Enter the tavern'}
        </button>
      </footer>
    </div>
  );
}

function DayEntry({
  day,
  entry,
}: {
  day: number;
  entry: DailyChronicle | 'pending';
}) {
  const [showLedger, setShowLedger] = useState(false);

  if (entry === 'pending') {
    return (
      <article
        className="welcome-entry welcome-entry-pending"
        data-testid={`welcome-entry-${day}`}
      >
        <h2 className="welcome-entry-heading">Day {day}</h2>
        <p className="welcome-entry-pending-line">
          still being written
          <span className="welcome-pending-dot">·</span>
          <span className="welcome-pending-dot">·</span>
          <span className="welcome-pending-dot">·</span>
        </p>
      </article>
    );
  }

  return (
    <article className="welcome-entry" data-testid={`welcome-entry-${day}`}>
      <h2 className="welcome-entry-heading">Day {day}</h2>
      {entry.status === 'fallback' && (
        <p className="welcome-entry-fallback-note">
          (no innkeeper's hand tonight)
        </p>
      )}
      {/* Phase 9 (QW4): today's marquee — the highest-salience event of
          the day, rendered separately from the rest. headlines[0] is the
          top-scoring entry per the chronicle generator + fallback sort,
          so styling it as a marquee is purely a CSS lift. */}
      {entry.headlines.length > 0 && (
        <p
          className="welcome-entry-marquee"
          data-testid={`welcome-entry-marquee-${day}`}
        >
          {entry.headlines[0]}
        </p>
      )}
      <ul className="welcome-entry-headlines">
        {entry.headlines.slice(1).map((h, i) => (
          <li key={i}>{h}</li>
        ))}
      </ul>
      <ul className="welcome-entry-footnotes">
        {entry.footnotes.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
      <button
        type="button"
        className="welcome-entry-ledger-toggle"
        onClick={() => setShowLedger((v) => !v)}
        data-testid={`welcome-entry-ledger-toggle-${day}`}
      >
        {showLedger ? 'hide ledger' : 'view ledger'}
      </button>
      {showLedger && <Ledger day={day} />}
    </article>
  );
}

function Ledger({ day }: { day: number }) {
  const [items, setItems] = useState<ChronicleLedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items === null && error === null) {
    api
      .getChronicle(day)
      .then((res) => setItems(res.ledger))
      .catch((err) => setError(String(err)));
  }

  return (
    <div className="welcome-entry-ledger" data-testid={`welcome-entry-ledger-${day}`}>
      {error && <span className="welcome-entry-ledger-error">{error}</span>}
      {items && (
        <ul>
          {items.map((e) => (
            <li key={e.eventId}>
              <span className="welcome-entry-ledger-id">#{e.eventId}</span>{' '}
              {ledgerLine(e.event)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Render one ledger event as a readable line; economy events get coin detail. */
function ledgerLine(event: WorldEvent): string {
  switch (event.type) {
    case 'ledger_closed': {
      const sign = event.net >= 0 ? '+' : '';
      return `ledger settled — took ${event.income}, spent ${event.expense}, net ${sign}${event.net} (purse ${event.coinAfter})`;
    }
    case 'guest_spent':
      return `a guest settled their tab — ${event.amount} coin`;
    case 'tavern_upkeep':
      return `tavern upkeep — ${event.amount} coin`;
    default:
      return event.type;
  }
}
