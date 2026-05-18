import type { Npc } from '@shared/types';
import { useStore } from '../state/store.tsx';

interface Props {
  npc: Npc;
}

/**
 * A small text bubble that appears above an NPC for the duration of an
 * interaction. CSS handles the fade in/out via the `data-fading` attribute.
 */
export function InteractionBubble({ npc }: Props) {
  const { interactingNpcs } = useStore();
  const flash = interactingNpcs[npc.id];
  if (!flash || !flash.overheardText) return null;
  if (flash.expiresAt <= Date.now()) return null;
  // Only render the bubble above the alphabetically-first participant so we
  // don't double-attach to both NPCs in the pair.
  const isAnchor = flash.npcIds[0] === npc.id;
  if (!isAnchor) return null;

  return (
    <div
      className="interaction-bubble"
      data-testid={`interaction-bubble-${npc.id}`}
      role="note"
    >
      {flash.overheardText}
    </div>
  );
}
