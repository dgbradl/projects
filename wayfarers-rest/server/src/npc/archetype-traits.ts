/**
 * Phase 8 (C1): archetype behavioural traits.
 *
 * Each of the 11 NPC archetypes gets a small behavioural signature so the
 * sim's variety is at the behavioural level (where the player sees it) and
 * not just at the spawn-distribution level (where it's invisible).
 *
 * Three pure-data knobs and one signature flag:
 *
 *  - `preferredZones`  — bias pool for the next-zone pick. Repeats weight
 *                        entries (so ['bar', 'bar', 'hearth'] picks bar 2/3
 *                        of the time). Used by behavior.ts in C2.
 *  - `dwellMultiplier` — scales the rngInt dwell ranges in the behaviour
 *                        state machine (scholars linger, refugees flit).
 *  - `clusterAffinity` — probability of seeking the same-archetype centroid
 *                        when in their preferred zone (soldiers and refugees
 *                        cluster; rogues and mages prefer their own corner).
 *                        Replaces the global CLUSTER_BIAS_PROB for non-staff.
 *  - `signature`       — optional named mechanic activated in C3
 *                        ('performs', 'transacts', 'studies', 'broods').
 *
 * Values are intentionally hand-tuned and small; C4 retunes any test
 * snapshots that prove brittle after C2/C3 integrate this table.
 *
 * Staff archetypes are intentionally absent from this map — staff have their
 * own behaviour path in behavior.ts. Callers must default sensibly for
 * unknown archetypes (see `traitsFor` below).
 */
import type { NpcArchetype, ZoneName } from '@shared/types';

export type ArchetypeSignature = 'performs' | 'transacts' | 'studies' | 'broods';

export interface ArchetypeTraits {
  /** Weighted bias pool for next-zone selection. Repeats raise the weight. */
  preferredZones: readonly ZoneName[];
  /** Multiplier on the dwell rngInt ranges in behavior.ts. */
  dwellMultiplier: number;
  /** [0..1] probability of seeking same-archetype centroid when settling. */
  clusterAffinity: number;
  /** Optional signature mechanic activated in C3. */
  signature?: ArchetypeSignature;
}

/**
 * The trait table. Tuneable; tests pin the *relative shape* (bards bias
 * toward the hearth, scholars dwell longer than refugees), not exact values.
 */
export const ARCHETYPE_TRAITS: Record<NpcArchetype, ArchetypeTraits> = {
  // bards perform around the hearth; their signature buffs shared_drink for
  // nearby pairs while a performance is live (C3).
  bard: {
    preferredZones: ['hearth', 'hearth', 'bar'],
    dwellMultiplier: 1.3,
    clusterAffinity: 0,
    signature: 'performs',
  },
  // scholars take corners and stay; their signature occasionally surfaces
  // a tag-flavoured rumor (C3).
  scholar: {
    preferredZones: ['table_a', 'table_c', 'bar', 'table_b'],
    dwellMultiplier: 1.5,
    clusterAffinity: 0.3,
    signature: 'studies',
  },
  // soldiers cluster at the bar; their signature lifts argument weight
  // among same-archetype pairs (C3) — bartender conflictMitigation tempers.
  soldier: {
    preferredZones: ['bar', 'bar', 'bar', 'hearth'],
    dwellMultiplier: 1.1,
    clusterAffinity: 0.7,
    signature: 'broods',
  },
  // merchants roam, looking for buyers; their signature is `transaction` —
  // a new low-affinity, coin-positive interaction kind seeded in C3.
  merchant: {
    preferredZones: ['bar', 'table_a', 'table_b', 'table_c'],
    dwellMultiplier: 1.0,
    clusterAffinity: 0,
    signature: 'transacts',
  },
  // refugees flit between hearth (warmth) and bar (food); cluster with kin.
  refugee: {
    preferredZones: ['hearth', 'hearth', 'bar', 'table_a'],
    dwellMultiplier: 0.7,
    clusterAffinity: 0.6,
  },
  knight: {
    preferredZones: ['bar', 'bar', 'table_b', 'hearth'],
    dwellMultiplier: 1.2,
    clusterAffinity: 0.4,
  },
  pilgrim: {
    preferredZones: ['hearth', 'table_a', 'bar', 'table_c'],
    dwellMultiplier: 0.9,
    clusterAffinity: 0.2,
  },
  rogue: {
    // table corners — table_a + table_c are the visual corners in the layout.
    preferredZones: ['table_a', 'table_c', 'table_a', 'bar'],
    dwellMultiplier: 0.8,
    clusterAffinity: 0,
  },
  mage: {
    // solo presence at hearth or tables.
    preferredZones: ['hearth', 'table_b', 'table_c'],
    dwellMultiplier: 1.2,
    clusterAffinity: 0,
  },
  hunter: {
    preferredZones: ['bar', 'bar', 'table_c'],
    dwellMultiplier: 0.9,
    clusterAffinity: 0,
  },
  // baseline — wanderers roam without strong preference.
  wanderer: {
    preferredZones: ['bar', 'hearth', 'table_a', 'table_b', 'table_c'],
    dwellMultiplier: 1.0,
    clusterAffinity: 0,
  },
};

const DEFAULT_TRAITS: ArchetypeTraits = ARCHETYPE_TRAITS.wanderer;

/**
 * Safe lookup. Returns the wanderer baseline if an NPC's archetype string is
 * missing or unrecognised (thread-spawned archetypes use non-canonical
 * strings like 'returning_traveler'; npc/manager.ts canonicalizes those, but
 * defence in depth here keeps behavior.ts from throwing on a malformed row).
 */
export function traitsFor(archetype: string | undefined): ArchetypeTraits {
  if (!archetype) return DEFAULT_TRAITS;
  return ARCHETYPE_TRAITS[archetype as NpcArchetype] ?? DEFAULT_TRAITS;
}
