import type {
  InterventionKindStatus,
  InterventionOptionsResponse,
  InterventionTargets,
  NpcArchetype,
  WorldState,
} from '@shared/types';
import { LOCATIONS } from '../world/locations.ts';
import { PERMITTED_TAG_VALUES } from '../world/tags.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { threadHeadline } from '../chronicle/prompt.ts';
import { listDefinitions } from './registry.ts';
import { FAVORS_MAX_DEFAULT } from './favor.ts';
import { LARDER_MAX } from './kinds/restock-larder.ts';
import { HEARTH_MAX } from './kinds/upgrade-hearth.ts';

const ARCHETYPES: NpcArchetype[] = [
  'wanderer',
  'merchant',
  'refugee',
  'pilgrim',
  'soldier',
  'scholar',
  'rogue',
  'mage',
  'knight',
  'bard',
  'hunter',
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
    const currency = def.costCurrency ?? 'favor';
    const balance = currency === 'coin' ? state.coin : state.favors;
    const base = { kind: def.kind, cost: def.cost, costCurrency: currency };
    if (balance < def.cost) {
      return {
        ...base,
        available: false,
        unavailableReason: `costs ${def.cost} ${currency} (you have ${balance})`,
      };
    }
    const reason = checkHasTargets(def.kind, targets, npcsInTavern, state);
    if (reason) {
      return { ...base, available: false, unavailableReason: reason };
    }
    return { ...base, available: true };
  });

  return {
    favors: state.favors,
    favorsMax,
    coin: state.coin,
    kinds,
    targets,
    rumorsForBeckoning,
  };
}

function checkHasTargets(
  kind: string,
  targets: InterventionTargets,
  npcsInTavern: InterventionTargets['npcsInTavern'],
  state: WorldState,
): string | undefined {
  switch (kind) {
    case 'restock_larder':
      if ((state.larderStock ?? 0) >= LARDER_MAX) {
        return 'the larder is already well stocked';
      }
      return undefined;
    case 'upgrade_hearth':
      if ((state.hearthLevel ?? 0) >= HEARTH_MAX) {
        return 'the hearth is as fine as it can be';
      }
      return undefined;
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
