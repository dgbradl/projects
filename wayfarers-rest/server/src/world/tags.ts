import type { WorldTag } from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';

/**
 * Phase 6: enumerated permitted values for each known tag. Used by the
 * `stir_world` intervention to validate the player's proposed new value.
 */
export const PERMITTED_TAG_VALUES: Record<string, string[]> = {
  season: ['spring', 'summer', 'autumn', 'winter'],
  harvest: ['unknown', 'poor', 'fair', 'promising', 'plentiful'],
  war_in_north: ['quiet', 'simmering', 'escalating', 'resolved'],
  road_safety_south: ['poor', 'fair', 'good'],
};

export function isPermittedTagValue(key: string, value: string): boolean {
  const allowed = PERMITTED_TAG_VALUES[key];
  return Array.isArray(allowed) && allowed.includes(value);
}

export class WorldTagsManager {
  constructor(
    private readonly persistence: Persistence,
    private readonly bus: WorldEventBus,
  ) {}

  get(key: string): WorldTag | null {
    return this.persistence.getWorldTag(key);
  }

  getAll(): WorldTag[] {
    return this.persistence.getAllWorldTags();
  }

  /**
   * Sets a tag. Emits `world_tag_changed` only if the value actually changes
   * (setting the same value twice is a no-op silently).
   */
  set(key: string, value: string, gameDay: number): void {
    const prev = this.persistence.getWorldTag(key);
    if (prev && prev.value === value) return;
    this.persistence.saveWorldTag({ key, value, setOnGameDay: gameDay });
    this.bus.publish({
      type: 'world_tag_changed',
      gameDay,
      key,
      oldValue: prev?.value ?? null,
      newValue: value,
    });
  }
}
