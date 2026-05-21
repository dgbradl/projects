import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { spriteByName } from '../assets/tavernSprites.ts';

interface FurniturePiece {
  id: string;
  sprite: string;
  x: number;
  y: number;
  rotation: number;
  scale?: number;
}

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

// A piece's layer is its index in `pieces` — earlier in the array = further back.
type LayerMove = 'back' | 'backward' | 'forward' | 'front';

export const STORAGE_KEY = 'wayfarers.furniture.v3';
const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
// z-index for the piece being edited, so it and its handles stay reachable
// above the rest regardless of its resting layer.
const SELECTED_Z = 1000;

// The floor starts empty; pieces are added by dropping sprites from the
// debug-panel gallery onto the tavern.
const DEFAULT_LAYOUT: FurniturePiece[] = [];

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

function loadLayout(): FurniturePiece[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return (parsed as FurniturePiece[]).map((p) => ({
        ...p,
        scale: typeof p.scale === 'number' && p.scale > 0 ? p.scale : 1,
      }));
    }
  } catch {
    // corrupt or unavailable storage — fall through to the default layout
  }
  return DEFAULT_LAYOUT;
}

export function Furnishings() {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const clipboardRef = useRef<Omit<FurniturePiece, 'id'> | null>(null);
  const [pieces, setPieces] = useState<FurniturePiece[]>(loadLayout);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pieces));
    } catch {
      // ignore storage failures
    }
  }, [pieces]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

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
        const piece = pieces.find((p) => p.id === selectedId);
        if (piece) {
          e.preventDefault();
          clipboardRef.current = {
            sprite: piece.sprite,
            x: piece.x,
            y: piece.y,
            rotation: piece.rotation,
            scale: piece.scale ?? 1,
          };
        }
      } else if (key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const c = clipboardRef.current;
        const x = clamp(c.x + 4, 0, 100);
        const y = clamp(c.y + 4, 0, 100);
        const id = `${c.sprite}-${Date.now().toString(36)}-${seqRef.current++}`;
        setPieces((prev) => [...prev, { ...c, id, x, y }]);
        setSelectedId(id);
        clipboardRef.current = { ...c, x, y };
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pieces, selectedId]);

  function patch(id: string, next: Partial<FurniturePiece>) {
    setPieces((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }

  // Restack a piece within `pieces` — array order is paint order, back to front.
  function moveLayer(id: string, move: LayerMove) {
    setPieces((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      if (i < 0) return prev;
      const target =
        move === 'back'
          ? 0
          : move === 'front'
            ? prev.length - 1
            : move === 'backward'
              ? i - 1
              : i + 1;
      const j = clamp(target, 0, prev.length - 1);
      if (j === i) return prev;
      const next = prev.slice();
      const [piece] = next.splice(i, 1);
      next.splice(j, 0, piece);
      return next;
    });
  }

  function endDrag() {
    dragRef.current = null;
    ctrlRef.current?.abort();
    ctrlRef.current = null;
  }

  function onMove(e: PointerEvent) {
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

  function beginDrag(drag: Drag) {
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

  function startMove(piece: FurniturePiece, e: ReactPointerEvent) {
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

  function startRotate(piece: FurniturePiece, e: ReactPointerEvent) {
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const { cx, cy } = pieceCenter(piece, layer.getBoundingClientRect());
    beginDrag({ mode: 'rotate', id: piece.id, cx, cy });
  }

  function startScale(piece: FurniturePiece, e: ReactPointerEvent) {
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
      startScale: piece.scale ?? 1,
    });
  }

  // Drop a sprite dragged from the debug-panel gallery onto the floor.
  function handleDrop(e: ReactDragEvent) {
    e.preventDefault();
    const sprite = e.dataTransfer.getData('text/plain');
    const layer = layerRef.current;
    if (!sprite || !spriteByName[sprite] || !layer) return;
    const rect = layer.getBoundingClientRect();
    const id = `${sprite}-${Date.now().toString(36)}-${seqRef.current++}`;
    const piece: FurniturePiece = {
      id,
      sprite,
      x: clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100),
      rotation: 0,
      scale: 1,
    };
    setPieces((prev) => [...prev, piece]);
    setSelectedId(id);
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
        const width =
          (WIDTH_BY_CATEGORY[asset.category] ?? 6) * (piece.scale ?? 1);
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
              zIndex: selected ? SELECTED_Z : index + 1,
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
