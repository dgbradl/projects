// The chronicle: the world's remembered history. Everything notable that
// happens is written here, forming the emergent story of the world.

import { yearOf, dayOfYear } from './world.js';

// importance: 0 = minor (daily life), 1 = notable, 2 = major, 3 = world-shaking
export function chronicle(sim, importance, text, opts = {}) {
  const entry = {
    day: sim.day,
    year: yearOf(sim.day),
    dayOfYear: dayOfYear(sim.day),
    importance,
    text,
    x: opts.x, y: opts.y,           // optional location for map pings
    kind: opts.kind || 'event',
  };
  sim.chronicleLog.push(entry);
  if (sim.chronicleLog.length > 4000) sim.chronicleLog.splice(0, 500);
  if (sim.onChronicle) sim.onChronicle(entry);
  return entry;
}

export function remember(person, sim, text, moodDelta = 0) {
  person.memories.push({ day: sim.day, text });
  if (person.memories.length > 12) person.memories.shift();
  if (moodDelta) person.mood = Math.max(-1, Math.min(1, person.mood + moodDelta));
}
