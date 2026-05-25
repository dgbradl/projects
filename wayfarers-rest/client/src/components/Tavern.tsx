import { useStore } from '../state/store.tsx';
import { Furnishings } from './Furnishings.tsx';
import { Npc } from './Npc.tsx';
import { Walls } from './Walls.tsx';
import { ZoneOverlay } from './ZoneOverlay.tsx';

export function Tavern() {
  const {
    tavern,
    npcs,
    world,
    interactingNpcs,
    furniture,
    focusedNpcId,
    focusedNpcExpiresAt,
  } = useStore();
  if (!tavern) return <div className="tavern tavern-loading">Loading the tavern…</div>;

  const subTickMs = tavern.subTickIntervalMs;
  const style = {
    ['--subtick-ms' as string]: `${subTickMs}ms`,
  } as React.CSSProperties;

  return (
    <div className="tavern" style={style} data-testid="tavern">
      <Walls />
      <Furnishings />
      <ZoneOverlay />
      {Object.values(npcs).map((n) => (
        <Npc
          key={n.id}
          npc={n}
          flash={interactingNpcs[n.id]}
          focused={focusedNpcId === n.id && focusedNpcExpiresAt > Date.now()}
          furniture={furniture}
          currentGameDay={world?.gameDay}
          currentSubTick={world?.subTick}
          subTicksPerDay={tavern.subTicksPerDay}
        />
      ))}
    </div>
  );
}
