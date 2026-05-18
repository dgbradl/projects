import type { Npc as NpcT } from '@shared/types';

interface Props {
  npc: NpcT;
}

export function Npc({ npc }: Props) {
  const style: React.CSSProperties = {
    left: `${npc.position.x}%`,
    top: `${npc.position.y}%`,
  };
  return (
    <div
      className={`npc npc-${npc.status}`}
      style={style}
      data-npc-id={npc.id}
      data-status={npc.status}
      title={`${npc.displayName} — ${npc.status}`}
    >
      <span className="npc-dot" aria-hidden />
      <span className="npc-label">{npc.displayName}</span>
    </div>
  );
}
