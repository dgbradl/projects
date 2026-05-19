import type {
  InterventionKindStatus,
  InterventionOptionsResponse,
  InterventionTargets,
  NpcArchetype,
} from '@shared/types';
import { LOCATIONS } from '../world/locations.ts';
import { PERMITTED_TAG_VALUES } from '../world/tags.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { threadHeadline } from '../chronicle/prompt.ts';
import { listDefinitions } from './registry.ts';
import { FAVORS_MAX_DEFAULT } from './favor.ts';

const ARCHETYPES: NpcArchetype[] = [
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
];

export interface BuildOptionsDeps {
  stateManager: WorldStateManager;
  persistence: Persistence;
  npcManager: NpcManager;
  favorsMax?: number;
}

export function buildInterventionOptions(
  deps: BuildOptionsDeps,
): InterventionOptionsResponse {
  const state = deps.stateManager.getState();
  const favorsMax = deps.favorsMax ?? FAVORS_MAX_DEFAULT;

  const locations = LOCATIONS.map((l) => ({
    id: l.id,
    displayName: l.displayName,
    kind: l.kind,
  }));

  const activeThreads = deps.persistence.loadActiveThreads().map((t) => ({
    id: t.id,
    type: t.type,
    state: t.state,
    describable: threadHeadline(t),
    canSway: (t.payload as Record<string, unknown>).swayBias === undefined,
  }));

  const worldTags = deps.persistence.getAllWorldTags().map((tag) => ({
    key: tag.key,
    currentValue: tag.value,
    permittedValues: PERMITTED_TAG_VALUES[tag.key] ?? [],
  }));

  const markedSet = new Set(state.markedNpcIds);
  const npcsInTavern = deps.npcManager
    .getRoster()
    .filter((n) => n.status !== 'departed')
    .map((n) => ({
      id: n.id,
      displayName: n.displayName,
      archetype: n.archetype ?? 'wanderer',
      status: n.status,
      isMarked: markedSet.has(n.id),
    }));

  const targets: InterventionTargets = {
    locations,
    archetypes: ARCHETYPES,
    activeThreads,
    worldTags,
    npcsInTavern,
  };

  const rumorsForBeckoning = deps.persistence
    .loadAvailableRumors()
    .slice(-5)
    .map((r) => ({ id: r.id, text: r.text }));

  // Compute per-kind availability.
  const kinds: InterventionKindStatus[] = listDefinitions().map((def) => {
    if (state.favors < def.cost) {
      return {
        kind: def.kind,
        cost: def.cost,
        available: false,
        unavailableReason: `costs ${def.cost} (you have ${state.favors})`,
      };
    }
    const reason = checkHasTargets(def.kind, targets, npcsInTavern);
    if (reason) {
      return {
        kind: def.kind,
        cost: def.cost,
        available: false,
        unavailableReason: reason,
      };
    }
    return { kind: def.kind, cost: def.cost, available: true };
  });

  return {
    favors: state.favors,
    favorsMax,
    kinds,
    targets,
    rumorsForBeckoning,
  };
}

function checkHasTargets(
  kind: string,
  targets: InterventionTargets,
  npcsInTavern: InterventionTargets['npcsInTavern'],
): string | undefined {
  switch (kind) {
    case 'sway_thread':
      if (targets.activeThreads.filter((t) => t.canSway).length === 0) {
        return 'no swayable threads';
      }
      return undefined;
    case 'stir_world':
      if (targets.worldTags.length === 0) return 'no world tags set';
      return undefined;
    case 'mark_npc': {
      const unmarked = npcsInTavern.filter((n) => !n.isMarked);
      if (unmarked.length === 0) return 'no unmarked NPCs in the tavern';
      return undefined;
    }
    default:
      return undefined;
  }
}
