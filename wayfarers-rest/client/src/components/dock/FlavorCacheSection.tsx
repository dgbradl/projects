import { useStore } from '../../state/store.tsx';

/** Inspector tab: status of the flavor-generation pools (rumors, names…).
 *  Colour-codes empty / low / ok so a stuck pool stands out at a glance. */
export function FlavorCacheSection() {
  const { flavorMode, flavorPools } = useStore();
  return (
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
  );
}
