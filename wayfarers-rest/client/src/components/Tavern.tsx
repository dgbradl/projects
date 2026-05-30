import { useStore } from '../state/store.tsx';
import { Furnishings } from './Furnishings.tsx';
import { Npc } from './Npc.tsx';
import {
  sceneParticipantSet,
  StageEventOverlay,
} from './StageEventOverlay.tsx';
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
    stageEvents,
  } = useStore();
  if (!tavern) return <div className="tavern tavern-loading">Loading the tavern…</div>;

  const subTickMs = tavern.subTickIntervalMs;
  const style = {
    ['--subtick-ms' as string]: `${subTickMs}ms`,
  } as React.CSSProperties;

  // Phase 9 (F2): set of NPC ids caught up in a live scene. Computed once
  // here so the React.memo'd Npc receives a simple boolean prop and skips
  // re-renders when nothing about its scene state has changed.
  const sceneParticipants = sceneParticipantSet(stageEvents);

  return (
    <div className="tavern" style={style} data-testid="tavern">
      <Walls />
      <Furnishings />
      <ZoneOverlay />
      <StageEventOverlay />
      {Object.values(npcs).map((n) => (
        <Npc
          key={n.id}
          npc={n}
          flash={interactingNpcs[n.id]}
          focused={focusedNpcId === n.id && focusedNpcExpiresAt > Date.now()}
          sceneParticipant={sceneParticipants.has(n.id)}
          furniture={furniture}
          currentGameDay={world?.gameDay}
          currentSubTick={world?.subTick}
          subTicksPerDay={tavern.subTicksPerDay}
        />
      ))}
    </div>
  );
}
