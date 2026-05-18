import { useStore } from '../state/store.tsx';
import { Npc } from './Npc.tsx';
import { Zone } from './Zone.tsx';

export function Tavern() {
  const { tavern, npcs } = useStore();
  if (!tavern) return <div className="tavern tavern-loading">Loading the tavern…</div>;

  const subTickMs = tavern.subTickIntervalMs;
  const style = { ['--subtick-ms' as string]: `${subTickMs}ms` } as React.CSSProperties;

  return (
    <div className="tavern" style={style} data-testid="tavern">
      {tavern.zones.map((z) => (
        <Zone key={z.name} zone={z} />
      ))}
      {Object.values(npcs).map((n) => (
        <Npc key={n.id} npc={n} />
      ))}
    </div>
  );
}
