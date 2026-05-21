import { useEffect, useRef, useState } from 'react';
import type { Npc } from '@shared/types';
import { useStore } from '../state/store.tsx';
import {
  cellPosition,
  resolvePose,
  spriteSheetForNpc,
  SHEET_COLS,
  SHEET_ROWS,
  type Facing,
} from './npcSheet.ts';

interface Props {
  npc: Npc;
}

/** Cycles a frame index for an animation; static (<=1 frame) poses don't tick. */
function useAnimationFrame(frameCount: number, frameMs: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (frameCount <= 1 || frameMs <= 0) return;
    const id = setInterval(
      () => setFrame((f) => (f + 1) % frameCount),
      frameMs,
    );
    return () => clearInterval(id);
  }, [frameCount, frameMs]);
  return frame < frameCount ? frame : 0;
}

/**
 * Renders an NPC as an animated paper-doll sprite from its archetype sheet.
 * Facing is derived from sub-tick position changes; until a sheet exists for
 * the archetype this falls back to the status-coloured dot.
 */
export function NpcSprite({ npc }: Props) {
  const { tavern } = useStore();
  const subTickMs = tavern?.subTickIntervalMs ?? 1000;

  const [moving, setMoving] = useState(false);
  const [facing, setFacing] = useState<Facing>('down');
  const prevPos = useRef(npc.position);

  const { x, y } = npc.position;
  useEffect(() => {
    const prev = prevPos.current;
    const dx = x - prev.x;
    const dy = y - prev.y;
    if (dx === 0 && dy === 0) return;
    prevPos.current = { x, y };
    setFacing(
      Math.abs(dx) >= Math.abs(dy)
        ? dx < 0
          ? 'left'
          : 'right'
        : dy < 0
          ? 'up'
          : 'down',
    );
    setMoving(true);
    // Position lands once per sub-tick while walking; a little slack past one
    // sub-tick keeps a continuous walk from flickering back to idle between
    // updates. When the NPC truly stops, this fires and settles to idle.
    const id = setTimeout(() => setMoving(false), subTickMs * 1.4);
    return () => clearTimeout(id);
  }, [x, y, subTickMs]);

  const { animation, flipX } = resolvePose(npc.status, moving, facing);
  const frame = useAnimationFrame(animation.frames.length, animation.frameMs);

  // No sheet for this NPC yet — fall back to the status-coloured dot.
  const sheet = spriteSheetForNpc(npc);
  if (!sheet) return <span className="npc-dot" aria-hidden />;

  const cell = animation.frames[frame] ?? animation.frames[0];
  return (
    <span
      className="npc-sprite"
      aria-hidden
      data-flip={flipX || undefined}
      style={{
        backgroundImage: `url(${sheet})`,
        backgroundSize: `${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%`,
        backgroundPosition: cellPosition(cell),
      }}
    />
  );
}
