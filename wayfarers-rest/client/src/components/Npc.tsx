import type { Npc as NpcT, StaffRole } from '@shared/types';
import { displaceFromFurniture } from '../furniture/bbox.ts';
import { useStore } from '../state/store.tsx';
import { NpcSprite } from '../sprites/NpcSprite.tsx';
import { InteractionBubble } from './InteractionBubble.tsx';

const STAFF_ROLE_ABBREV: Record<StaffRole, string> = {
  bartender: '(bar)',
  waitstaff: '(wait)',
  cleaner: '(clean)',
};

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
  const { interactingNpcs, furniture } = useStore();
  const flash = interactingNpcs[npc.id];
  const interacting = !!flash && flash.expiresAt > Date.now();
  const isRegular = (npc.visitCount ?? 0) > 1;
  const isStaff = npc.isStaff ?? false;
  const staffRoleLabel = isStaff ? STAFF_ROLE_ABBREV[npc.staffRole ?? 'waitstaff'] : null;

  // F4: visually push the NPC out of any furniture bbox it would render
  // inside. The CSS transition on top/left smooths the offset over a
  // sub-tick so it doesn't snap.
  const pos = displaceFromFurniture(
    { x: npc.position.x, y: npc.position.y },
    furniture,
  );
  const style: React.CSSProperties = {
    left: `${pos.x}%`,
    top: `${pos.y}%`,
  };
  // Flip the tooltip below the NPC when it's near the top of the tavern,
  // so it doesn't clip into the bar / room edge. Threshold is tuned so the
  // full tooltip (~5–7 rows) clears the chrome at default zoom.
  const tooltipBelow = pos.y < 18;

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
      className={`npc npc-${npc.status}${isStaff ? ' npc-staff' : ''}`}
      style={style}
      data-npc-id={npc.id}
      data-status={npc.status}
      data-staff-role={npc.staffRole ?? undefined}
      data-interacting={interacting ? 'true' : undefined}
    >
      <InteractionBubble npc={npc} />
      <NpcSprite npc={npc} />
      <span className="npc-label">
        {npc.displayName}
        {isStaff && staffRoleLabel && (
          <span className="npc-staff-badge" title={npc.staffRole}>
            {staffRoleLabel}
          </span>
        )}
        {isRegular && !isStaff && (
          <span className="npc-regular-badge" aria-label="a regular" title="a regular">
            ★
          </span>
        )}
      </span>
      <div
        className="npc-tooltip"
        role="tooltip"
        data-position={tooltipBelow ? 'below' : 'above'}
      >
        <div className="npc-tooltip-name">{npc.displayName}</div>
        {npc.tagline && (
          <div className="npc-tooltip-tagline">{npc.tagline}</div>
        )}
        {isStaff && npc.staffRole && (
          <div className="npc-tooltip-row">
            role: <span>{npc.staffRole}</span>
          </div>
        )}
        {!isStaff && (
          <div className="npc-tooltip-row">
            status: <span>{npc.status}</span>
          </div>
        )}
        {isRegular && !isStaff && (
          <div className="npc-tooltip-row">
            visits: <span>{npc.visitCount}</span>
          </div>
        )}
        {!isStaff && subTicksSinceArrival !== null && (
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
