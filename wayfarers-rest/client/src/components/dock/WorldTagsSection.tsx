import { useStore } from '../../state/store.tsx';

/** Inspector tab: world tags as set by the simulation (key:value with a
 *  set-on-day note). Read-only — server owns the writes. */
export function WorldTagsSection() {
  const { worldTags } = useStore();
  return (
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
  );
}
