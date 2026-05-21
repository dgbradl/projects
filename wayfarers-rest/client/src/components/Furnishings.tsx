import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { spriteByName } from '../assets/tavernSprites.ts';

interface FurniturePiece {
  id: string;
  sprite: string;
  x: number;
  y: number;
  rotation: number;
}

type Drag =
  | { mode: 'move'; id: string; rect: DOMRect; offX: number; offY: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number };

const STORAGE_KEY = 'wayfarers.furniture.v1';

const DEFAULT_LAYOUT: FurniturePiece[] = [
  { id: 'table-a', sprite: 'table_round_01', x: 30, y: 60, rotation: 0 },
  { id: 'table-b', sprite: 'table_round_06', x: 50, y: 65, rotation: 0 },
  { id: 'table-c', sprite: 'table_round_11', x: 70, y: 60, rotation: 0 },
  { id: 'plant-l', sprite: 'plant_02', x: 9, y: 80, rotation: 0 },
  { id: 'plant-r', sprite: 'plant_05', x: 91, y: 78, rotation: 0 },
];

// Rendered width as a percent of the tavern, by sprite category.
const WIDTH_BY_CATEGORY: Record<string, number> = {
  tables: 12,
  plants: 5,
  food: 4,
  glassware: 3,
  decor: 8,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function loadLayout(): FurniturePiece[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as FurniturePiece[];
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

  function patch(id: string, next: Partial<FurniturePiece>) {
    setPieces((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
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
    } else {
      const rad = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      patch(drag.id, { rotation: Math.round((rad * 180) / Math.PI) + 90 });
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

  function startMove(piece: FurniturePiece, e: ReactPointerEvent) {
    e.stopPropagation();
    setSelectedId(piece.id);
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    beginDrag({
      mode: 'move',
      id: piece.id,
      rect,
      offX: rect.left + (piece.x / 100) * rect.width - e.clientX,
      offY: rect.top + (piece.y / 100) * rect.height - e.clientY,
    });
  }

  function startRotate(piece: FurniturePiece, e: ReactPointerEvent) {
    e.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    beginDrag({
      mode: 'rotate',
      id: piece.id,
      cx: rect.left + (piece.x / 100) * rect.width,
      cy: rect.top + (piece.y / 100) * rect.height,
    });
  }

  return (
    <div
      className="furnishings"
      ref={layerRef}
      data-testid="furnishings"
      onPointerDown={() => setSelectedId(null)}
    >
      {pieces.map((piece) => {
        const asset = spriteByName[piece.sprite];
        if (!asset) return null;
        const selected = piece.id === selectedId;
        return (
          <div
            key={piece.id}
            className={selected ? 'furniture selected' : 'furniture'}
            data-testid={`furniture-${piece.id}`}
            style={{
              left: `${piece.x}%`,
              top: `${piece.y}%`,
              width: `${WIDTH_BY_CATEGORY[asset.category] ?? 6}%`,
              transform: `translate(-50%, -50%) rotate(${piece.rotation}deg)`,
              zIndex: selected ? 2 : 1,
            }}
            onPointerDown={(e) => startMove(piece, e)}
          >
            <img src={asset.url} alt={piece.sprite} draggable={false} />
            {selected && (
              <div
                className="furniture-rotate-handle"
                data-testid={`furniture-rotate-${piece.id}`}
                onPointerDown={(e) => startRotate(piece, e)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
