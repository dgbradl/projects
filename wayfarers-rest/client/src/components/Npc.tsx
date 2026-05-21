import type { Npc as NpcT } from '@shared/types';
import { useStore } from '../state/store.tsx';
import { InteractionBubble } from './InteractionBubble.tsx';

interface Props {
  npc: NpcT;
  /** Optional clock for the tooltip's "sub-ticks since arrival" stat. */
  currentGameDay?: number;
  currentSubTick?: number;
  subTicksPerDay?: number;
}

export function Npc({
  npc,
  currentGameDay,
  currentSubTick,
  subTicksPerDay,
}: Props) {
  const { interactingNpcs } = useStore();
  const flash = interactingNpcs[npc.id];
  const interacting = !!flash && flash.expiresAt > Date.now();
  // Phase 7 (A3): a returning regular wears a small badge.
  const isRegular = (npc.visitCount ?? 0) > 1;

  const style: React.CSSProperties = {
    left: `${npc.position.x}%`,
    top: `${npc.position.y}%`,
  };

  let subTicksSinceArrival: number | null = null;
  if (
    currentGameDay !== undefined &&
    currentSubTick !== undefined &&
    subTicksPerDay !== undefined
  ) {
    subTicksSinceArrival =
      currentGameDay * subTicksPerDay +
      currentSubTick -
      (npc.arrivedGameDay * subTicksPerDay + npc.arrivedSubTick);
  }

  return (
    <div
      className={`npc npc-${npc.status}`}
      style={style}
      data-npc-id={npc.id}
      data-status={npc.status}
      data-interacting={interacting ? 'true' : undefined}
    >
      <InteractionBubble npc={npc} />
      <span className="npc-dot" aria-hidden />
      <span className="npc-label">
        {npc.displayName}
        {isRegular && (
          <span
            className="npc-regular-badge"
            aria-label="a regular"
            title="a regular"
          >
            ★
          </span>
        )}
      </span>
      <div className="npc-tooltip" role="tooltip">
        <div className="npc-tooltip-name">{npc.displayName}</div>
        {npc.tagline && (
          <div className="npc-tooltip-tagline">{npc.tagline}</div>
        )}
        <div className="npc-tooltip-row">
          status: <span>{npc.status}</span>
        </div>
        {isRegular && (
          <div className="npc-tooltip-row">
            visits: <span>{npc.visitCount}</span>
          </div>
        )}
        {subTicksSinceArrival !== null && (
          <div className="npc-tooltip-row">
            here: <span>{subTicksSinceArrival} sub-ticks</span>
          </div>
        )}
        {npc.originLocationId && (
          <div className="npc-tooltip-row">
            from: <span>{npc.originLocationId}</span>
          </div>
        )}
        {npc.item && (
          <div className="npc-tooltip-row">
            carries: <span>{npc.item}</span>
          </div>
        )}
        {npc.carriedRumorIds.length > 0 && (
          <div className="npc-tooltip-row">
            rumors: <span>{npc.carriedRumorIds.join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
