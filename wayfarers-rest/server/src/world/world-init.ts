import type { ThreadRunner } from '../threads/runner.ts';
import { randomLocation } from './locations.ts';
import { seededRng } from './rng.ts';
import type { WorldTagsManager } from './tags.ts';
import { PLACEHOLDER_NAMES } from '../data/placeholderNames.ts';

/**
 * Seeds Phase 3 initial world tags and a small set of starter threads so the
 * world is not empty on first boot. Idempotent in the sense that it should
 * only be invoked when no tags exist yet (caller decides).
 */
export function seedPhase3World(opts: {
  worldSeed: string;
  gameDay: number;
  worldTags: WorldTagsManager;
  threadRunner: ThreadRunner;
}): void {
  const { worldSeed, gameDay, worldTags, threadRunner } = opts;

  // Initial flat tags.
  worldTags.set('season', 'spring', gameDay);
  worldTags.set('harvest', 'unknown', gameDay);
  worldTags.set('war_in_north', 'quiet', gameDay);
  worldTags.set('road_safety_south', 'fair', gameDay);

  // Slow-burn worldly events.
  threadRunner.startThread({
    type: 'worldly_event',
    payload: {
      tagKey: 'war_in_north',
      sequence: ['simmering', 'escalating', 'resolved'],
      dwellDays: 5,
    },
    initialNextTickDelay: 4,
    gameDay,
  });
  threadRunner.startThread({
    type: 'worldly_event',
    payload: {
      tagKey: 'harvest',
      sequence: ['promising', 'plentiful'],
      dwellDays: 6,
    },
    initialNextTickDelay: 3,
    gameDay,
  });

  // Phase 7 (D3): kick off the recurring festival cycle.
  threadRunner.startThread({
    type: 'festival',
    initialNextTickDelay: 10,
    gameDay,
  });

  // One initial approaching stranger so the first week has a special arrival.
  const rng = seededRng(worldSeed, 'seed', 'stranger', gameDay);
  const origin = randomLocation(rng);
  const nameIdx = Math.floor(rng() * PLACEHOLDER_NAMES.length);
  threadRunner.startThread({
    type: 'approaching_stranger',
    payload: {
      displayName: PLACEHOLDER_NAMES[nameIdx],
      originLocationId: origin.id,
      archetype: 'wanderer',
    },
    initialNextTickDelay: 2 + Math.floor(rng() * 3),
    gameDay,
  });
}
