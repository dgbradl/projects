import { useStore } from '../../state/store.tsx';

/** Inspector tab: last 12 rumors currently in circulation. */
export function RumorsSection() {
  const { rumors } = useStore();
  return (
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
  );
}
