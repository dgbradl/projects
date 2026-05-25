import { useState } from 'react';
import type { Thread } from '@shared/types';
import { useStore } from '../../state/store.tsx';

/** Inspector tab: active narrative threads. Each row expands to show its
 *  history so we can verify state machines without hitting the DB. */
export function ThreadsSection() {
  const { threads } = useStore();
  return (
    <details open data-testid="debug-threads">
      <summary>active threads ({threads.length})</summary>
      <ul className="debug-list">
        {threads.map((t) => (
          <ThreadRow key={t.id} thread={t} />
        ))}
      </ul>
    </details>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="debug-thread-toggle"
        onClick={() => setOpen((v) => !v)}
        data-testid={`debug-thread-${thread.id}`}
      >
        <span className="debug-key">{thread.type}</span> · {thread.state}{' '}
        <span className="debug-dim">→ day {thread.nextTickGameDay}</span>
      </button>
      {open && (
        <ul
          className="debug-thread-history"
          data-testid={`debug-thread-history-${thread.id}`}
        >
          {thread.history.map((h, i) => (
            <li key={i}>
              <span className="debug-dim">day {h.gameDay}</span> {h.state}
              {h.note ? <span className="debug-dim"> — {h.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
