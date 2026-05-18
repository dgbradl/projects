import type { WorldTag } from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';

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
