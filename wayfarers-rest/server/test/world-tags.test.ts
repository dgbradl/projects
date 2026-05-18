import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const tags = new WorldTagsManager(p, bus);
  return { p, bus, tags };
}

describe('WorldTagsManager', () => {
  it('set emits world_tag_changed with the previous value', () => {
    const { p, tags } = build();
    tags.set('season', 'spring', 1);
    const events = p.getEventsSince(0);
    const last = events[events.length - 1];
    expect(last.event.type).toBe('world_tag_changed');
    if (last.event.type === 'world_tag_changed') {
      expect(last.event.key).toBe('season');
      expect(last.event.oldValue).toBeNull();
      expect(last.event.newValue).toBe('spring');
    }
  });

  it('setting the same value twice does NOT re-emit', () => {
    const { p, tags } = build();
    tags.set('season', 'spring', 1);
    const after1 = p.getEventsSince(0).length;
    tags.set('season', 'spring', 1);
    const after2 = p.getEventsSince(0).length;
    expect(after2).toBe(after1);
  });

  it('changing to a new value emits with the prior value', () => {
    const { p, tags } = build();
    tags.set('season', 'spring', 1);
    tags.set('season', 'summer', 5);
    const all = p.getEventsSince(0);
    const last = all[all.length - 1];
    expect(last.event.type).toBe('world_tag_changed');
    if (last.event.type === 'world_tag_changed') {
      expect(last.event.oldValue).toBe('spring');
      expect(last.event.newValue).toBe('summer');
    }
  });

  it('getAll returns persisted tags in stable key order', () => {
    const { tags } = build();
    tags.set('zebra', 'x', 1);
    tags.set('apple', 'y', 1);
    const all = tags.getAll();
    expect(all.map((t) => t.key)).toEqual(['apple', 'zebra']);
  });
});
