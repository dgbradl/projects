import type { NpcDesire, Npc as NpcT, StaffRole } from '@shared/types';
import { displaceFromFurniture } from '../furniture/bbox.ts';
import { useStore } from '../state/store.tsx';
import { NpcSprite } from '../sprites/NpcSprite.tsx';
import { InteractionBubble } from './InteractionBubble.tsx';

const STAFF_ROLE_ABBREV: Record<StaffRole, string> = {
  bartender: '(bar)',
  waitstaff: '(wait)',
  cleaner: '(clean)',
};

// Phase 8 (A1): icon + short text for a desire chip. Mirrors the server-side
// describeDesire / iconForDesire so the chip the player sees matches the
// chronicle voice; kept local here to keep the client a leaf consumer of
// `@shared/types` and avoid pulling a server module into the bundle.
const DESIRE_ICON: Record<NpcDesire['kind'], string> = {
  warm_meal: '🍲',
  bed_for_night: '🛏',
  quiet_seat: '🪑',
  company_of_kind: '🤝',
  news_of_location: '📜',
  rumor_of_tone: '🜁',
};

function describeDesire(d: NpcDesire): string {
  switch (d.kind) {
    case 'warm_meal':
      return 'a warm meal';
    case 'bed_for_night':
      return 'a bed for the night';
    case 'quiet_seat':
      return 'a quiet seat';
    case 'company_of_kind':
      return d.param && d.param !== 'any'
        ? `company of a ${d.param}`
        : 'company';
    case 'news_of_location':
      return d.param ? `news of ${d.param.replace(/_/g, ' ')}` : 'news of afar';
    case 'rumor_of_tone':
      return d.param ? `a ${d.param} rumor` : 'a rumor';
  }
}

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
  const { interactingNpcs, furniture, focusedNpcId, focusedNpcExpiresAt } =
    useStore();
  const flash = interactingNpcs[npc.id];
  const interacting = !!flash && flash.expiresAt > Date.now();
  // Phase 8 (B3): a ticker click highlights the matching sprite for ~3s.
  const focused =
    focusedNpcId === npc.id && focusedNpcExpiresAt > Date.now();
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

  // Phase 8 (QW2): a returning regular gets a 2s gold sheen on the
  // sub-tick they arrive. We key on subTicksSinceArrival === 0 so the
  // CSS animation (forwards, 2s) plays once then stays settled.
  const regularSheen = isRegular && !isStaff && subTicksSinceArrival === 0;

  return (
    <div
      className={`npc npc-${npc.status}${isStaff ? ' npc-staff' : ''}${focused ? ' npc--focused' : ''}${regularSheen ? ' npc--regular-sheen' : ''}`}
      style={style}
      data-npc-id={npc.id}
      data-status={npc.status}
      data-staff-role={npc.staffRole ?? undefined}
      data-interacting={interacting ? 'true' : undefined}
      data-focused={focused ? 'true' : undefined}
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
        {!isStaff && npc.desires && npc.desires.length > 0 && (
          <div className="npc-tooltip-desires">
            {npc.desires.map((d, i) => {
              const fulfilled = d.fulfilledAtSubTick !== undefined;
              return (
                <span
                  key={`${d.kind}-${d.param ?? ''}-${i}`}
                  className={`npc-desire-chip${fulfilled ? ' npc-desire-chip--fulfilled' : ''}`}
                  title={`wants ${describeDesire(d)}${fulfilled ? ' — fulfilled' : ''}`}
                >
                  <span className="npc-desire-chip-icon" aria-hidden>
                    {DESIRE_ICON[d.kind]}
                  </span>
                  <span className="npc-desire-chip-text">{describeDesire(d)}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
