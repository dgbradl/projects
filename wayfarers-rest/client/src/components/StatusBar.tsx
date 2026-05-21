import { useStore } from '../state/store.tsx';

export function StatusBar() {
  const { world, tavern, npcs } = useStore();
  if (!world || !tavern) return <div className="status-bar status-bar-loading" />;

  return (
    <div className="status-bar" data-testid="status-bar">
      <span className="status-item">
        Day <strong data-testid="status-day">{world.gameDay}</strong>
      </span>
      <span className="status-item">
        Sub-tick{' '}
        <strong data-testid="status-subtick">
          {world.subTick}/{tavern.subTicksPerDay}
        </strong>
      </span>
      <span className={`status-item status-${world.status}`}>{world.status}</span>
      <span className="status-item status-population">
        {Object.keys(npcs).length} in tavern
      </span>
      <span className="status-item status-coin">
        <strong data-testid="status-coin">{world.coin}</strong> coin
      </span>
    </div>
  );
}
