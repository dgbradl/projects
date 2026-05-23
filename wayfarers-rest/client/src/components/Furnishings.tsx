import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { FurniturePiece } from '@shared/types';
import { spriteByName } from '../assets/tavernSprites.ts';
import { api, type PatchFurnitureInput } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

type Drag =
  | { mode: 'move'; id: string; rect: DOMRect; offX: number; offY: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number }
  | {
      mode: 'scale';
      id: string;
      cx: number;
      cy: number;
      startDist: number;
      startScale: number;
    };

// A piece's layer is its `layer` field — earlier (lower) = further back.
type LayerMove = 'back' | 'backward' | 'forward' | 'front';

/**
 * Pre-F3 layouts lived in localStorage; we migrate them to the server once
 * per browser. Kept exported so tests and the migration sentinel can see it.
 */
export const STORAGE_KEY = 'wayfarers.furniture.v3';
const MIGRATED_SENTINEL = 'wayfarers.furniture.migrated.v1';

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
// z-index for the piece being edited, so it and its handles stay reachable
// above the rest regardless of its resting layer.
const SELECTED_Z = 1000;

// Rendered width as a percent of the tavern, by sprite category.
const WIDTH_BY_CATEGORY: Record<string, number> = {
  tables: 12,
  chairs: 8,
  barrels: 7,
  plants: 5,
  food: 4,
  glassware: 3,
  candles: 4,
  decor: 8,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function Furnishings() {
  const dispatch = useDispatch();
  const pieces = useStore().furniture;
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const piecesRef = useRef<FurniturePiece[]>(pieces);
  const clipboardRef = useRef<Omit<FurniturePiece, 'id' | 'layer'> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep a ref to the latest pieces so the drag callbacks (which capture
  // their closure at pointerdown) can see post-dispatch values at pointerup.
  useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  // F3: one-time migration of pre-existing localStorage layouts to the
  // server. Runs once per browser, gated by a sentinel; skips if the server
  // already has furniture so we never double-import.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(MIGRATED_SENTINEL)) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MIGRATED_SENTINEL, '1');
      return;
    }
    void (async () => {
      try {
        const current = await api.listFurniture();
        if (current.length > 0) {
          localStorage.setItem(MIGRATED_SENTINEL, '1');
          return;
        }
        const legacy = JSON.parse(raw) as Array<{
          sprite: string;
          x: number;
          y: number;
          rotation?: number;
          scale?: number;
        }>;
        for (const p of legacy) {
          const created = await api.placeFurniture({
            sprite: p.sprite,
            x: p.x,
            y: p.y,
            rotation: p.rotation ?? 0,
            scale: p.scale ?? 1,
          });
          dispatch({ type: 'FURNITURE_UPSERT', payload: created });
        }
        localStorage.setItem(MIGRATED_SENTINEL, '1');
      } catch {
        // best-effort; leave sentinel unset so it retries next mount
      }
    })();
  }, [dispatch]);

  // Clipboard: Cmd/Ctrl+C copies the selected piece, Cmd/Ctrl+V pastes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'c' && selectedId) {
        const piece = piecesRef.current.find((p) => p.id === selectedId);
        if (piece) {
          e.preventDefault();
          clipboardRef.current = {
            sprite: piece.sprite,
            x: piece.x,
            y: piece.y,
            rotation: piece.rotation,
            scale: piece.scale,
          };
        }
      } else if (key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const c = clipboardRef.current;
        const x = clamp(c.x + 4, 0, 100);
        const y = clamp(c.y + 4, 0, 100);
        void api
          .placeFurniture({
            sprite: c.sprite,
            x,
            y,
            rotation: c.rotation,
            scale: c.scale,
          })
          .then((created) => {
            dispatch({ type: 'FURNITURE_UPSERT', payload: created });
            setSelectedId(created.id);
            clipboardRef.current = { ...c, x, y };
          })
          .catch(() => {});
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, selectedId]);

  function patch(id: string, next: Partial<FurniturePiece>): void {
    const current = piecesRef.current.find((p) => p.id === id);
    if (!current) return;
    dispatch({ type: 'FURNITURE_UPSERT', payload: { ...current, ...next } });
  }

  // Restack a piece within `pieces` — optimistically reorder locally, then
  // reconcile with the server's authoritative renumbering.
  function moveLayer(id: string, move: LayerMove): void {
    const ordered = piecesRef.current.slice();
    const idx = ordered.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const target =
      move === 'back'
        ? 0
        : move === 'front'
          ? ordered.length - 1
          : move === 'backward'
            ? idx - 1
            : idx + 1;
    const j = clamp(target, 0, ordered.length - 1);
    if (j === idx) return;
    const [piece] = ordered.splice(idx, 1);
    ordered.splice(j, 0, piece);
    const renumbered = ordered.map((p, i) => ({ ...p, layer: i + 1 }));
    dispatch({ type: 'FURNITURE_SET', payload: renumbered });
    void api
      .moveFurnitureLayer(id, move)
      .then((server) => dispatch({ type: 'FURNITURE_SET', payload: server }))
      .catch(() => {});
  }

  function endDrag(): void {
    const drag = dragRef.current;
    dragRef.current = null;
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    if (!drag) return;
    const piece = piecesRef.current.find((p) => p.id === drag.id);
    if (!piece) return;
    let body: PatchFurnitureInput;
    if (drag.mode === 'move') body = { x: piece.x, y: piece.y };
    else if (drag.mode === 'rotate') body = { rotation: piece.rotation };
    else body = { scale: piece.scale };
    void api.patchFurniture(drag.id, body).catch(() => {});
  }

  function onMove(e: PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'move') {
      const cx = e.clientX + drag.offX;
      const cy = e.clientY + drag.offY;
      patch(drag.id, {
        x: clamp(((cx - drag.rect.left) / drag.rect.width) * 100, 0, 100),
        y: clamp(((cy - drag.rect.top) / drag.rect.height) * 100, 0, 100),
      });
    } else if (drag.mode === 'rotate') {
      const rad = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      patch(drag.id, { rotation: Math.round((rad * 180) / Math.PI) + 90 });
    } else {
      const dist = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      patch(drag.id, {
        scale: clamp(
          (drag.startScale * dist) / Math.max(drag.startDist, 1),
          MIN_SCALE,
          MAX_SCALE,
        ),
      });
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

  function pieceCenter(piece: FurniturePiece, rect: DOMRect) {
    return {
      cx: rect.left + (piece.x / 100) * rect.width,
      cy: rect.top + (piece.y / 100) * rect.height,
    };
  }

  function startMove(piece: FurniturePiece, e: ReactPointerEvent): void {
    e.stopPropagation();
    setSelectedId(piece.id);
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const { cx, cy } = pieceCenter(piece, rect);
    beginDrag({
      mode: 'move',
      id: piece.id,
      rect,
      offX: cx - e.clientX,
      offY: cy - e.clientY,
    });
  }

  function startRotate(piece: FurniturePiece, e: ReactPointerEvent): void {
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const { cx, cy } = pieceCenter(piece, layer.getBoundingClientRect());
    beginDrag({ mode: 'rotate', id: piece.id, cx, cy });
  }

  function startScale(piece: FurniturePiece, e: ReactPointerEvent): void {
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const { cx, cy } = pieceCenter(piece, layer.getBoundingClientRect());
    beginDrag({
      mode: 'scale',
      id: piece.id,
      cx,
      cy,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy),
      startScale: piece.scale,
    });
  }

  // Drop a sprite dragged from the debug-panel gallery onto the floor.
  function handleDrop(e: ReactDragEvent): void {
    e.preventDefault();
    const sprite = e.dataTransfer.getData('text/plain');
    const layer = layerRef.current;
    if (!sprite || !spriteByName[sprite] || !layer) return;
    const rect = layer.getBoundingClientRect();
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
    void api
      .placeFurniture({ sprite, x, y, rotation: 0, scale: 1 })
      .then((created) => {
        dispatch({ type: 'FURNITURE_UPSERT', payload: created });
        setSelectedId(created.id);
      })
      .catch(() => {});
  }

  return (
    <div
      className="furnishings"
      ref={layerRef}
      data-testid="furnishings"
      onPointerDown={() => setSelectedId(null)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}
    >
      {pieces.map((piece, index) => {
        const asset = spriteByName[piece.sprite];
        if (!asset) return null;
        const selected = piece.id === selectedId;
        const width = (WIDTH_BY_CATEGORY[asset.category] ?? 6) * piece.scale;
        return (
          <div
            key={piece.id}
            className={selected ? 'furniture selected' : 'furniture'}
            data-testid={`furniture-${piece.id}`}
            style={{
              left: `${piece.x}%`,
              top: `${piece.y}%`,
              width: `${width}%`,
              transform: `translate(-50%, -50%) rotate(${piece.rotation}deg)`,
              // Furniture layering is driven by DOM/array order — every
              // piece shares z:1 (above walls/NPCs, below overlays); the
              // selected piece pops to SELECTED_Z so its handles stay
              // grabbable. An explicit per-piece z would race the pause /
              // welcome / intervention overlays as the layout grows.
              zIndex: selected ? SELECTED_Z : 1,
            }}
            onPointerDown={(e) => startMove(piece, e)}
          >
            <img src={asset.url} alt={piece.sprite} draggable={false} />
            {selected && (
              <>
                <div
                  className="furniture-rotate-handle"
                  data-testid={`furniture-rotate-${piece.id}`}
                  onPointerDown={(e) => startRotate(piece, e)}
                />
                <div
                  className="furniture-scale-handle"
                  data-testid={`furniture-scale-${piece.id}`}
                  onPointerDown={(e) => startScale(piece, e)}
                />
                <div
                  className="furniture-layer-bar"
                  data-testid={`furniture-layer-${piece.id}`}
                  style={{
                    transform: `translate(-50%, 0) rotate(${-piece.rotation}deg)`,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title="Send to back"
                    aria-label="Send to back"
                    data-testid={`furniture-layer-back-${piece.id}`}
                    disabled={index === 0}
                    onClick={() => moveLayer(piece.id, 'back')}
                  >
                    ⤓
                  </button>
                  <button
                    type="button"
                    title="Send backward"
                    aria-label="Send backward"
                    data-testid={`furniture-layer-backward-${piece.id}`}
                    disabled={index === 0}
                    onClick={() => moveLayer(piece.id, 'backward')}
                  >
                    ↓
                  </button>
                  <span className="furniture-layer-pos">
                    {index + 1}/{pieces.length}
                  </span>
                  <button
                    type="button"
                    title="Bring forward"
                    aria-label="Bring forward"
                    data-testid={`furniture-layer-forward-${piece.id}`}
                    disabled={index === pieces.length - 1}
                    onClick={() => moveLayer(piece.id, 'forward')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Bring to front"
                    aria-label="Bring to front"
                    data-testid={`furniture-layer-front-${piece.id}`}
                    disabled={index === pieces.length - 1}
                    onClick={() => moveLayer(piece.id, 'front')}
                  >
                    ⤒
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
