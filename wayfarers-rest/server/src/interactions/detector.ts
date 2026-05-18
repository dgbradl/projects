import type { Npc, ZoneName } from '@shared/types';
import { seededRng } from '../world/rng.ts';
import type { InteractionCandidate } from './types.ts';

export interface DetectorContext {
  worldSeed: string;
  gameDay: number;
  subTick: number;
  /** Per-NPC count of interactions today. Mutated by the detector when it confirms a pair. */
  countsToday: Map<string, number>;
  /** Pairs that have already interacted today (key: 'a|b' with sorted ids). */
  pairsToday: Set<string>;
}

const INTERACTION_THRESHOLD = 0.02; // 2% per pair per sub-tick
const MAX_PER_NPC_PER_DAY = 2;

export function detectInteractions(
  npcs: Npc[],
  ctx: DetectorContext,
): InteractionCandidate[] {
  // Group eligible (non-leaving/non-departed) NPCs by zone.
  const byZone = new Map<ZoneName, Npc[]>();
  for (const npc of npcs) {
    if (!npc.zone) continue;
    if (npc.status === 'leaving' || npc.status === 'departed') continue;
    if (npc.status === 'arriving') continue; // give them a beat to settle
    const list = byZone.get(npc.zone) ?? [];
    list.push(npc);
    byZone.set(npc.zone, list);
  }

  const candidates: InteractionCandidate[] = [];

  for (const [zone, occupants] of byZone) {
    if (occupants.length < 2) continue;
    for (let i = 0; i < occupants.length; i += 1) {
      for (let j = i + 1; j < occupants.length; j += 1) {
        const a = occupants[i];
        const b = occupants[j];
        const pairKey = pairKeyOf(a.id, b.id);
        if (ctx.pairsToday.has(pairKey)) continue;
        if ((ctx.countsToday.get(a.id) ?? 0) >= MAX_PER_NPC_PER_DAY) continue;
        if ((ctx.countsToday.get(b.id) ?? 0) >= MAX_PER_NPC_PER_DAY) continue;

        const rng = seededRng(
          ctx.worldSeed,
          'interact',
          a.id,
          b.id,
          ctx.gameDay,
          ctx.subTick,
        );
        if (rng() >= INTERACTION_THRESHOLD) continue;

        ctx.pairsToday.add(pairKey);
        ctx.countsToday.set(a.id, (ctx.countsToday.get(a.id) ?? 0) + 1);
        ctx.countsToday.set(b.id, (ctx.countsToday.get(b.id) ?? 0) + 1);
        candidates.push({ participantIds: [a.id, b.id], zone });
      }
    }
  }

  return candidates;
}

export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
