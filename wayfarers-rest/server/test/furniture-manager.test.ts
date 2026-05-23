import { afterEach, describe, expect, it } from 'vitest';
import { FurnitureManager } from '../src/furniture/manager.ts';
import { Persistence } from '../src/persistence.ts';

const persistences: Persistence[] = [];

function build() {
  const persistence = new Persistence(':memory:');
  persistences.push(persistence);
  return new FurnitureManager(persistence);
}

afterEach(() => {
  while (persistences.length) persistences.pop()?.close();
});

describe('FurnitureManager', () => {
  it('places a piece with an id, default rotation/scale, and incrementing layer', () => {
    const m = build();
    const a = m.place({ sprite: 'table_round_01', x: 30, y: 40 });
    const b = m.place({ sprite: 'plant_02', x: 60, y: 50 });
    expect(a.id).toBeTruthy();
    expect(a.layer).toBe(1);
    expect(a.rotation).toBe(0);
    expect(a.scale).toBe(1);
    expect(b.layer).toBe(2);
    expect(m.list()).toHaveLength(2);
  });

  it('clamps x/y to [0,100] and scale to [0.2,3]', () => {
    const m = build();
    const p = m.place({ sprite: 'plant_02', x: -10, y: 200, scale: 99 });
    expect(p.x).toBe(0);
    expect(p.y).toBe(100);
    expect(p.scale).toBe(3);
  });

  it('rejects bogus sprites and non-finite coordinates', () => {
    const m = build();
    expect(() => m.place({ sprite: '', x: 5, y: 5 })).toThrow();
    expect(() => m.place({ sprite: 'has spaces', x: 5, y: 5 })).toThrow();
    expect(() => m.place({ sprite: 'ok', x: NaN, y: 5 })).toThrow();
  });

  it('patches x/y/rotation/scale and keeps the layer', () => {
    const m = build();
    const a = m.place({ sprite: 'table_round_01', x: 30, y: 40 });
    const u = m.patch(a.id, { x: 50, scale: 0.5 });
    expect(u?.x).toBe(50);
    expect(u?.y).toBe(40);
    expect(u?.scale).toBe(0.5);
    expect(u?.layer).toBe(a.layer);
  });

  it('returns null when patching a missing id', () => {
    const m = build();
    expect(m.patch('nope', { x: 1 })).toBeNull();
  });

  it('restacks via setLayer: back / front / forward / backward', () => {
    const m = build();
    const a = m.place({ sprite: 's', x: 1, y: 1 }); // layer 1
    const b = m.place({ sprite: 's', x: 2, y: 2 }); // layer 2
    const c = m.place({ sprite: 's', x: 3, y: 3 }); // layer 3

    // c -> back: order becomes c, a, b
    let list = m.setLayer(c.id, 'back');
    expect(list.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect(list.map((p) => p.layer)).toEqual([1, 2, 3]);

    // a -> forward (past b): order becomes c, b, a
    list = m.setLayer(a.id, 'forward');
    expect(list.map((p) => p.id)).toEqual([c.id, b.id, a.id]);

    // c -> front: order becomes b, a, c
    list = m.setLayer(c.id, 'front');
    expect(list.map((p) => p.id)).toEqual([b.id, a.id, c.id]);

    // c -> backward: order becomes b, c, a
    list = m.setLayer(c.id, 'backward');
    expect(list.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
  });

  it('removing a piece renormalises the surviving layers', () => {
    const m = build();
    const a = m.place({ sprite: 's', x: 1, y: 1 });
    const b = m.place({ sprite: 's', x: 2, y: 2 });
    const c = m.place({ sprite: 's', x: 3, y: 3 });
    expect(m.remove(b.id)).toBe(true);
    const list = m.list();
    expect(list.map((p) => p.id)).toEqual([a.id, c.id]);
    expect(list.map((p) => p.layer)).toEqual([1, 2]);
    expect(m.remove('nope')).toBe(false);
  });

  it('emits change on mutations (and not on no-op setLayer)', () => {
    const m = build();
    let n = 0;
    m.on('change', () => n++);
    const a = m.place({ sprite: 's', x: 1, y: 1 });     // +1
    const b = m.place({ sprite: 's', x: 2, y: 2 });     // +1
    m.patch(a.id, { x: 3 });                            // +1
    m.setLayer(a.id, 'back');                            // no-op (already back) — no emit
    m.setLayer(a.id, 'forward');                         // +1 (a swaps with b)
    m.remove(b.id);                                      // +1
    expect(n).toBe(5);
  });

  it('round-trips a piece via persistence', () => {
    const persistence = new Persistence(':memory:');
    persistences.push(persistence);
    const m1 = new FurnitureManager(persistence);
    const p = m1.place({ sprite: 'table_round_01', x: 25, y: 25, scale: 1.5 });
    const m2 = new FurnitureManager(persistence);
    expect(m2.list()).toEqual([p]);
  });
});
