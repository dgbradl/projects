import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Zone } from '@shared/types';
import { api, type PatchZoneInput } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

// D2: dashed-circle debug overlay for the server-owned zone layout.
// Visible only when `debugZonesEnabled` is on (DebugPanel toggle).
// Drag a center handle to move the zone; drag the right-edge handle to
// resize the radius; click ✕ to delete. All edits optimistically update
// the store and fire the matching REST call.

type Drag =
  | { mode: 'move'; name: string; rect: DOMRect; offX: number; offY: number }
  | { mode: 'resize'; name: string; cx: number; cy: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const MIN_RADIUS = 1;
const MAX_RADIUS = 40;

export function ZoneOverlay() {
  const dispatch = useDispatch();
  const { zones, debugZonesEnabled } = useStore();
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const zonesRef = useRef<Zone[]>(zones);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  function patchOptimistic(name: string, patch: PatchZoneInput): void {
    const current = zonesRef.current.find((z) => z.name === name);
    if (!current) return;
    dispatch({ type: 'ZONES_UPSERT', payload: { ...current, ...patch } });
  }

  function endDrag(): void {
    const drag = dragRef.current;
    dragRef.current = null;
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    if (!drag) return;
    const zone = zonesRef.current.find((z) => z.name === drag.name);
    if (!zone) return;
    const body: PatchZoneInput =
      drag.mode === 'move' ? { x: zone.x, y: zone.y } : { radius: zone.radius };
    void api.patchZone(drag.name, body).catch(() => {});
  }

  function onMove(e: PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'move') {
      const cx = e.clientX + drag.offX;
      const cy = e.clientY + drag.offY;
      patchOptimistic(drag.name, {
        x: clamp(((cx - drag.rect.left) / drag.rect.width) * 100, 0, 100),
        y: clamp(((cy - drag.rect.top) / drag.rect.height) * 100, 0, 100),
      });
    } else {
      // Edge handle: new radius = horizontal distance from center, in
      // tavern-percent of width (matches how zone radii are interpreted).
      const layer = layerRef.current;
      if (!layer) return;
      const rect = layer.getBoundingClientRect();
      const radius = clamp(
        (Math.abs(e.clientX - drag.cx) / rect.width) * 100,
        MIN_RADIUS,
        MAX_RADIUS,
      );
      patchOptimistic(drag.name, { radius });
    }
  }

  function beginDrag(drag: Drag): void {
    endDrag();
    dragRef.current = drag;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    window.addEventListener('pointermove', onMove, { signal: ctrl.signal });
    window.addEventListener('pointerup', endDrag, { signal: ctrl.signal });
    window.addEventListener('pointercancel', endDrag, { signal: ctrl.signal });
  }

  function startMove(zone: Zone, e: ReactPointerEvent): void {
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const cx = rect.left + (zone.x / 100) * rect.width;
    const cy = rect.top + (zone.y / 100) * rect.height;
    beginDrag({
      mode: 'move',
      name: zone.name,
      rect,
      offX: cx - e.clientX,
      offY: cy - e.clientY,
    });
  }

  function startResize(zone: Zone, e: ReactPointerEvent): void {
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    beginDrag({
      mode: 'resize',
      name: zone.name,
      cx: rect.left + (zone.x / 100) * rect.width,
      cy: rect.top + (zone.y / 100) * rect.height,
    });
  }

  function deleteZone(name: string): void {
    dispatch({ type: 'ZONES_REMOVE', payload: { name } });
    void api.removeZone(name).catch(() => {});
  }

  if (!debugZonesEnabled) return null;

  return (
    <div className="zone-overlay" ref={layerRef} data-testid="zone-overlay">
      {zones.map((zone) => (
        <div
          key={zone.name}
          className="zone-debug"
          data-testid={`zone-${zone.name}`}
          style={{
            left: `${zone.x}%`,
            top: `${zone.y}%`,
            width: `${zone.radius * 2}%`,
            height: `${zone.radius * 2}%`,
          }}
        >
          <button
            type="button"
            className="zone-debug-handle zone-debug-move"
            title={`drag to move ${zone.name}`}
            aria-label={`move ${zone.name}`}
            data-testid={`zone-move-${zone.name}`}
            onPointerDown={(e) => startMove(zone, e)}
          />
          <button
            type="button"
            className="zone-debug-handle zone-debug-resize"
            title={`drag to resize ${zone.name}`}
            aria-label={`resize ${zone.name}`}
            data-testid={`zone-resize-${zone.name}`}
            onPointerDown={(e) => startResize(zone, e)}
          />
          <div className="zone-debug-label">
            <span>{zone.name}</span>
            <button
              type="button"
              className="zone-debug-delete"
              title={`delete ${zone.name}`}
              aria-label={`delete ${zone.name}`}
              data-testid={`zone-delete-${zone.name}`}
              onClick={() => deleteZone(zone.name)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
