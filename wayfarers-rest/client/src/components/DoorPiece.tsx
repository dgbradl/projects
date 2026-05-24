import { useEffect, useRef, useState } from 'react';
import { spriteByName } from '../assets/tavernSprites.ts';

// The 4 cut frames live in client/src/assets/tavern/doors/. Order matters:
// frame 1 is closed, frame 4 is wide open. The cycle plays 1→2→3→4→3→2→1
// over ~700ms whenever the parent ticks `playToken`.
const FRAMES = [
  'door_01_closed',
  'door_02_ajar',
  'door_03_open',
  'door_04_wide',
  'door_03_open',
  'door_02_ajar',
  'door_01_closed',
];
const FRAME_MS = 100;

/** Any furniture whose sprite is one of the 4 door cuts is treated as a door. */
export function isDoorSprite(sprite: string): boolean {
  return sprite.startsWith('door_0');
}

/**
 * Renders a door piece's <img>. The cycle is driven by `playToken`: a
 * change in its value (incremented by the parent) starts one play of
 * the 7-frame sequence. While a cycle is running, further token changes
 * are ignored so the visual stays deterministic if a wave of patrons
 * arrives in the same tick.
 */
export function DoorPiece({
  sprite,
  playToken,
}: {
  sprite: string;
  playToken: number;
}) {
  const [frameIdx, setFrameIdx] = useState(0);
  const playingRef = useRef(false);
  const lastTokenRef = useRef(playToken);

  useEffect(() => {
    if (playToken === lastTokenRef.current) return;
    lastTokenRef.current = playToken;
    if (playingRef.current) return;
    playingRef.current = true;
    let i = 0;
    setFrameIdx(0);
    const tick = window.setInterval(() => {
      i += 1;
      if (i >= FRAMES.length) {
        window.clearInterval(tick);
        playingRef.current = false;
        setFrameIdx(0);
        return;
      }
      setFrameIdx(i);
    }, FRAME_MS);
    return () => window.clearInterval(tick);
  }, [playToken]);

  // Fall back to the placed sprite if the cycle frame is missing (e.g. the
  // doors/ folder hasn't been built yet) — keeps the piece visible either way.
  const frameSprite = FRAMES[frameIdx] ?? sprite;
  const asset = spriteByName[frameSprite] ?? spriteByName[sprite];
  if (!asset) return null;
  return <img src={asset.url} alt={sprite} draggable={false} />;
}
