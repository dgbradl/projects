import { api } from '../../api.ts';
import { useDispatch, useStore } from '../../state/store.tsx';

/** Build tab: zone CRUD. Toggling "edit on tavern" lights up the in-play
 *  drag/resize handles in ZoneOverlay; add/reset persist via the server. */
export function ZonesSection() {
  const { zones, debugZonesEnabled } = useStore();
  const dispatch = useDispatch();
  return (
    <details open data-testid="debug-zones">
      <summary>zones ({zones.length})</summary>
      <div className="debug-zones">
        <label className="debug-zones-toggle">
          <input
            type="checkbox"
            checked={debugZonesEnabled}
            onChange={() => dispatch({ type: 'DEBUG_ZONES_TOGGLED' })}
            data-testid="debug-zones-toggle"
          />
          edit on tavern
        </label>
        <div className="debug-zones-actions">
          <button
            type="button"
            data-testid="debug-zone-add"
            onClick={async () => {
              const name = window.prompt(
                'Name for new zone (letters, digits, _ or -):',
              );
              if (!name) return;
              try {
                const z = await api.placeZone({
                  name,
                  x: 50,
                  y: 50,
                  radius: 6,
                });
                dispatch({ type: 'ZONES_UPSERT', payload: z });
              } catch (err) {
                window.alert((err as Error).message);
              }
            }}
          >
            + add
          </button>
          <button
            type="button"
            data-testid="debug-zone-reset"
            onClick={async () => {
              if (!window.confirm('Reset all zones to defaults?')) return;
              const next = await api.resetZones();
              dispatch({ type: 'ZONES_SET', payload: next });
            }}
          >
            reset
          </button>
        </div>
        <ul className="debug-list debug-zones-list">
          {zones.map((z) => (
            <li key={z.name}>
              <span className="debug-key">{z.name}</span>{' '}
              <span className="debug-dim">
                ({Math.round(z.x)}, {Math.round(z.y)}) r {Math.round(z.radius)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
