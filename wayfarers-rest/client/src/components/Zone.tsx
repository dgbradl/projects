import type { Zone as ZoneT } from '@shared/types';

interface Props {
  zone: ZoneT;
}

const ZONE_LABELS: Record<ZoneT['name'], string> = {
  door: 'Door',
  bar: 'Bar',
  hearth: 'Hearth',
  table_a: 'Table A',
  table_b: 'Table B',
  table_c: 'Table C',
};

export function Zone({ zone }: Props) {
  const style: React.CSSProperties = {
    left: `${zone.x}%`,
    top: `${zone.y}%`,
    width: `${zone.radius * 2}%`,
    height: `${zone.radius * 2}%`,
  };
  return (
    <div className={`zone zone-${zone.name}`} style={style} data-zone={zone.name}>
      <span className="zone-label">{ZONE_LABELS[zone.name]}</span>
    </div>
  );
}
