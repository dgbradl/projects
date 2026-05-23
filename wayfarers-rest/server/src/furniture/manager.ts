import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FurniturePiece } from '@shared/types';
import type { Persistence } from '../persistence.ts';

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const MAX_SPRITE_LEN = 80;

export type LayerMove = 'back' | 'backward' | 'forward' | 'front';

export interface PlaceInput {
  sprite: string;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
}

export interface PatchInput {
  x?: number;
  y?: number;
  rotation?: number;
  scale?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateSprite(sprite: unknown): string {
  if (typeof sprite !== 'string' || sprite.length === 0 || sprite.length > MAX_SPRITE_LEN) {
    throw new Error('invalid sprite');
  }
  if (!/^[\w-]+$/.test(sprite)) {
    throw new Error('invalid sprite');
  }
  return sprite;
}

/**
 * Owns the tavern's furniture layout. Pieces are persisted in sqlite; their
 * `layer` is an explicit integer so re-stacking touches only the moved row
 * (with an occasional renormalisation to keep layers contiguous in 1..N).
 *
 * Emits `'change'` on every mutation so the SSE stream / world snapshot
 * stays in sync.
 */
export class FurnitureManager extends EventEmitter {
  constructor(private readonly persistence: Persistence) {
    super();
  }

  list(): FurniturePiece[] {
    return this.persistence.loadAllFurniture();
  }

  place(input: PlaceInput): FurniturePiece {
    const sprite = validateSprite(input.sprite);
    if (!isNum(input.x) || !isNum(input.y)) throw new Error('invalid coordinates');
    const x = clamp(input.x, 0, 100);
    const y = clamp(input.y, 0, 100);
    const rotation = isNum(input.rotation) ? input.rotation : 0;
    const scale = clamp(isNum(input.scale) ? input.scale : 1, MIN_SCALE, MAX_SCALE);
    const existing = this.list();
    const nextLayer = existing.reduce((m, p) => Math.max(m, p.layer), 0) + 1;
    const piece: FurniturePiece = {
      id: randomUUID(),
      sprite,
      x,
      y,
      rotation,
      scale,
      layer: nextLayer,
    };
    this.persistence.saveFurniturePiece(piece);
    this.emit('change');
    return piece;
  }

  patch(id: string, input: PatchInput): FurniturePiece | null {
    const piece = this.list().find((p) => p.id === id);
    if (!piece) return null;
    const next: FurniturePiece = {
      ...piece,
      x: isNum(input.x) ? clamp(input.x, 0, 100) : piece.x,
      y: isNum(input.y) ? clamp(input.y, 0, 100) : piece.y,
      rotation: isNum(input.rotation) ? input.rotation : piece.rotation,
      scale: isNum(input.scale) ? clamp(input.scale, MIN_SCALE, MAX_SCALE) : piece.scale,
    };
    this.persistence.saveFurniturePiece(next);
    this.emit('change');
    return next;
  }

  /** Restack one piece; returns the full list in its new paint order. */
  setLayer(id: string, move: LayerMove): FurniturePiece[] {
    const ordered = this.list();
    const idx = ordered.findIndex((p) => p.id === id);
    if (idx < 0) return ordered;
    const target =
      move === 'back'
        ? 0
        : move === 'front'
          ? ordered.length - 1
          : move === 'backward'
            ? idx - 1
            : idx + 1;
    const j = clamp(target, 0, ordered.length - 1);
    if (j === idx) return ordered;
    const [piece] = ordered.splice(idx, 1);
    ordered.splice(j, 0, piece);
    // Renormalise so layers stay contiguous 1..N (cheap; N is small).
    ordered.forEach((p, i) => {
      const layer = i + 1;
      if (p.layer !== layer) this.persistence.saveFurniturePiece({ ...p, layer });
      p.layer = layer;
    });
    this.emit('change');
    return ordered;
  }

  remove(id: string): boolean {
    const ok = this.persistence.deleteFurniturePiece(id);
    if (ok) {
      // Renormalise the survivors.
      const survivors = this.list();
      survivors.forEach((p, i) => {
        const layer = i + 1;
        if (p.layer !== layer) this.persistence.saveFurniturePiece({ ...p, layer });
      });
      this.emit('change');
    }
    return ok;
  }
}
