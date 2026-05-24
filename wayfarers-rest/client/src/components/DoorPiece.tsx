import { useEffect, useRef, useState } from 'react';
import { spriteByName } from '../assets/tavernSprites.ts';
import { useStore } from '../state/store.tsx';

// The 4 cut frames live in client/src/assets/tavern/doors/. Order matters:
// frame 1 is closed, frame 4 is wide open. The cycle plays 1→2→3→4→3→2→1
// over ~700ms whenever an NPC enters or leaves the tavern.
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
 * Renders a door piece's <img>, advancing through the 4-frame open/close
 * sequence whenever an NPC newly transitions into `arriving` or `leaving`
 * status. Concurrent triggers while a cycle is already running are ignored
 * (the existing cycle finishes first), keeping the visual deterministic
 * even when a wave of patrons arrives at once.
 */
export function DoorPiece({ sprite }: { sprite: string }) {
  const { npcs } = useStore();
  const [frameIdx, setFrameIdx] = useState(0);
  const playingRef = useRef(false);
  const prevStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    // Detect newly arriving/leaving NPCs by diffing against last tick's
    // status map. Initial mount populates the map without triggering, so
    // we don't fire on first paint for NPCs already in transit.
    const prev = prevStatusRef.current;
    let triggered = false;
    for (const id in npcs) {
      const status = npcs[id].status;
      const was = prev[id];
      if (was !== status && (status === 'arriving' || status === 'leaving')) {
        if (was !== undefined) triggered = true;
      }
    }
    const next: Record<string, string> = {};
    for (const id in npcs) next[id] = npcs[id].status;
    prevStatusRef.current = next;

    if (!triggered || playingRef.current) return;
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
  }, [npcs]);

  // Fall back to the placed sprite if the cycle frame is missing (e.g. the
  // doors/ folder hasn't been built yet) — keeps the piece visible either way.
  const frameSprite = FRAMES[frameIdx] ?? sprite;
  const asset = spriteByName[frameSprite] ?? spriteByName[sprite];
  if (!asset) return null;
  return <img src={asset.url} alt={sprite} draggable={false} />;
}
