import { afterEach, describe, expect, it } from 'vitest';
import { Persistence } from '../src/persistence.ts';
import { ZoneManager } from '../src/world/zone-manager.ts';
import {
  TAVERN_ZONES,
  resetActiveZonesToDefaults,
  zoneByName,
} from '../src/world/tavern.ts';

const persistences: Persistence[] = [];
function build() {
  const persistence = new Persistence(':memory:');
  persistences.push(persistence);
  return new ZoneManager(persistence);
}

afterEach(() => {
  while (persistences.length) persistences.pop()?.close();
  // The manager mutates the module-level active-zone registry; restore
  // defaults so subsequent tests that don't construct a manager aren't
  // surprised.
  resetActiveZonesToDefaults();
});

describe('ZoneManager', () => {
  it('seeds the table with TAVERN_ZONES on first construction', () => {
    const m = build();
    const list = m.list();
    expect(list.length).toBe(TAVERN_ZONES.length);
    for (const z of TAVERN_ZONES) {
      expect(list.find((l) => l.name === z.name)).toEqual({
        name: z.name,
        x: z.x,
        y: z.y,
        radius: z.radius,
      });
    }
  });

  it('refreshes the active-zone registry so zoneByName sees live values', () => {
    const m = build();
    expect(zoneByName('bar')?.x).toBe(50);
    m.patch('bar', { x: 42 });
    expect(zoneByName('bar')?.x).toBe(42);
  });

  it('place adds a custom zone and rejects collisions', () => {
    const m = build();
    const z = m.place({ name: 'snug', x: 70, y: 80, radius: 4 });
    expect(z.name).toBe('snug');
    expect(m.list().length).toBe(TAVERN_ZONES.length + 1);
    expect(() => m.place({ name: 'snug', x: 1, y: 1, radius: 1 })).toThrow();
  });

  it('place rejects bogus names and non-finite coords', () => {
    const m = build();
    expect(() => m.place({ name: '', x: 1, y: 1, radius: 1 })).toThrow();
    expect(() => m.place({ name: 'has space', x: 1, y: 1, radius: 1 })).toThrow();
    expect(() =>
      m.place({ name: 'ok', x: NaN as number, y: 1, radius: 1 }),
    ).toThrow();
  });

  it('place clamps coordinates into the walkable rectangle and radius into [1,40]', () => {
    const m = build();
    const z = m.place({ name: 'corner', x: -5, y: 200, radius: 99 });
    expect(z.x).toBe(8); // WALKABLE.minX
    expect(z.y).toBe(92); // WALKABLE.maxY
    expect(z.radius).toBe(40);
  });

  it('patch updates supplied fields and keeps the rest', () => {
    const m = build();
    const u = m.patch('bar', { x: 40, radius: 9 });
    expect(u?.x).toBe(40);
    expect(u?.y).toBe(20); // unchanged
    expect(u?.radius).toBe(9);
    expect(m.patch('nope', { x: 1 })).toBeNull();
  });

  it('remove drops a zone (defaults included) and reset reseeds', () => {
    const m = build();
    expect(m.remove('table_a')).toBe(true);
    expect(zoneByName('table_a')).toBeUndefined();
    expect(m.list().length).toBe(TAVERN_ZONES.length - 1);
    m.reset();
    expect(m.list().length).toBe(TAVERN_ZONES.length);
    expect(zoneByName('table_a')?.x).toBe(30);
  });

  it('emits change on every mutation', () => {
    const m = build();
    let n = 0;
    m.on('change', () => n++);
    m.place({ name: 'custom', x: 50, y: 50, radius: 3 }); // +1
    m.patch('custom', { radius: 5 }); // +1
    m.remove('custom'); // +1
    m.reset(); // +1
    expect(n).toBe(4);
  });

  it('round-trips a custom zone via persistence', () => {
    const persistence = new Persistence(':memory:');
    persistences.push(persistence);
    const m1 = new ZoneManager(persistence);
    const placed = m1.place({ name: 'snug', x: 70, y: 80, radius: 4 });
    const m2 = new ZoneManager(persistence);
    expect(m2.list().find((z) => z.name === 'snug')).toEqual(placed);
  });
});
