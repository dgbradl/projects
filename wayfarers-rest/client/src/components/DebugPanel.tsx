import { useMemo, useState } from 'react';
import { tavernSprites, tavernSpritesByCategory } from '../assets/tavernSprites.ts';
import { useStore } from '../state/store.tsx';

export function DebugPanel() {
  const {
    worldTags,
    threads,
    pendingArrivals,
    recentEvents,
    rumors,
    flavorMode,
    flavorPools,
  } = useStore();
  const [collapsed, setCollapsed] = useState(false);

  const arrivalsByDay = useMemo(() => {
    const groups = new Map<number, typeof pendingArrivals>();
    for (const a of pendingArrivals) {
      const list = groups.get(a.scheduledGameDay) ?? [];
      list.push(a);
      groups.set(a.scheduledGameDay, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [pendingArrivals]);

  if (collapsed) {
    return (
      <button
        type="button"
        className="debug-toggle"
        onClick={() => setCollapsed(false)}
        data-testid="debug-toggle"
      >
        debug ▸
      </button>
    );
  }

  return (
    <aside className="debug-panel" data-testid="debug-panel">
      <header className="debug-panel-header">
        <span>debug</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="debug-panel-close"
          data-testid="debug-collapse"
        >
          ×
        </button>
      </header>

      <details open data-testid="debug-tags">
        <summary>world tags ({worldTags.length})</summary>
        <ul className="debug-list">
          {worldTags.map((t) => (
            <li key={t.key}>
              <span className="debug-key">{t.key}</span>: {t.value}{' '}
              <span className="debug-dim">(day {t.setOnGameDay})</span>
            </li>
          ))}
        </ul>
      </details>

      <details open data-testid="debug-threads">
        <summary>active threads ({threads.length})</summary>
        <ul className="debug-list">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} />
          ))}
        </ul>
      </details>

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

      <details open data-testid="debug-flavor">
        <summary>flavor cache · mode: {flavorMode}</summary>
        <ul className="debug-list flavor-pools">
          {flavorPools.map((p) => {
            const className =
              p.size === 0
                ? 'flavor-pool flavor-pool-empty'
                : p.size < p.refillThreshold
                  ? 'flavor-pool flavor-pool-low'
                  : 'flavor-pool flavor-pool-ok';
            const labelKey = p.subKey ? `${p.kind}/${p.subKey}` : p.kind;
            return (
              <li
                key={`${p.kind}|${p.subKey}`}
                className={className}
                data-testid={`flavor-pool-${p.kind}-${p.subKey}`}
              >
                <span className="debug-key">{labelKey}</span>:{' '}
                <strong>{p.size}</strong>/{p.target}
                {p.recentFailures > 0 && (
                  <span className="debug-dim"> (fails: {p.recentFailures})</span>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      <details data-testid="debug-rumors">
        <summary>rumors ({rumors.length})</summary>
        <ul className="debug-list">
          {rumors.slice(0, 12).map((r) => (
            <li key={r.id}>
              <span className="debug-dim">{r.id}</span> {r.text}
            </li>
          ))}
        </ul>
      </details>

      <details data-testid="debug-events">
        <summary>recent events ({recentEvents.length})</summary>
        <ul className="debug-list debug-events">
          {recentEvents.slice(0, 30).map((e) => (
            <li key={e.id}>
              <span className="debug-dim">#{e.id}</span> {e.event.type}
              {' '}
              <span className="debug-dim">
                {summarize(e.event)}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details data-testid="debug-sprites">
        <summary>sprite gallery ({tavernSprites.length})</summary>
        {tavernSpritesByCategory.map(([category, sprites]) => (
          <div key={category} className="sprite-group">
            <div className="sprite-group-label">
              <span className="debug-key">{category}</span>{' '}
              <span className="debug-dim">({sprites.length})</span>
            </div>
            <div className="sprite-grid">
              {sprites.map((sprite) => (
                <div
                  key={sprite.name}
                  className="sprite-cell"
                  title={sprite.name}
                >
                  <img src={sprite.url} alt={sprite.name} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </details>
    </aside>
  );
}

function ThreadRow({ thread }: { thread: import('@shared/types').Thread }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="debug-thread-toggle"
        onClick={() => setOpen((v) => !v)}
        data-testid={`debug-thread-${thread.id}`}
      >
        <span className="debug-key">{thread.type}</span> · {thread.state}
        {' '}
        <span className="debug-dim">→ day {thread.nextTickGameDay}</span>
      </button>
      {open && (
        <ul className="debug-thread-history" data-testid={`debug-thread-history-${thread.id}`}>
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

function summarize(event: import('@shared/types').WorldEvent): string {
  switch (event.type) {
    case 'npc_arrived':
      return event.displayName;
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
