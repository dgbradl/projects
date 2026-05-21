import type { EventLogEntry, WorldEvent } from '@shared/types';
import { DEFAULT_ALARMING_VALUES, type SalienceContext } from './types.ts';

/**
 * Deterministic salience scorer. Identical inputs → identical scores.
 * Returns 0 for event types we don't want in the chronicle at all.
 */
export function score(event: WorldEvent, ctx: SalienceContext): number {
  switch (event.type) {
    case 'world_tag_changed': {
      let s = 8;
      const alarming = ctx.alarmingValues ?? DEFAULT_ALARMING_VALUES;
      if (alarming.has(event.newValue) || (event.oldValue && alarming.has(event.oldValue))) {
        s += 2;
      }
      return s;
    }
    case 'thread_completed': {
      let s = 7;
      if (event.outcome === 'misfortune' || event.outcome === 'met_misfortune') s += 2;
      return s;
    }
    case 'thread_started':
      return 4;
    case 'thread_progressed': {
      let s = 3;
      // "major beat" heuristic: state names that aren't no-op continuations.
      if (
        event.toState !== event.fromState &&
        event.toState !== 'idle' &&
        event.toState !== 'continued'
      ) {
        s += 1;
      }
      return s;
    }
    case 'rumor_introduced':
      return 5;
    case 'npc_arrived': {
      let s = 2;
      const npc = ctx.npcsById.get(event.npcId);
      if (npc?.carriedRumorIds.length) s += 3;
      if (npc?.archetype && NOTABLE_ARCHETYPES.has(npc.archetype)) s += 3;
      if (ctx.markedNpcIds?.has(event.npcId)) s += 5;
      return s;
    }
    case 'npc_returned': {
      // A familiar face is more notable than yet another stranger.
      let s = 4;
      const npc = ctx.npcsById.get(event.npcId);
      if (npc?.carriedRumorIds.length) s += 3;
      if (npc?.archetype && NOTABLE_ARCHETYPES.has(npc.archetype)) s += 3;
      if (ctx.markedNpcIds?.has(event.npcId)) s += 5;
      // A well-worn regular outranks a second-time face.
      s += Math.min(event.visitCount - 1, 3);
      return s;
    }
    case 'npc_departed': {
      let s = 2;
      const npc = ctx.npcsById.get(event.npcId);
      if (npc) {
        const days = event.gameDay - npc.arrivedGameDay;
        if (days >= 2) s += 3;
      }
      if (ctx.markedNpcIds?.has(event.npcId)) s += 5;
      return s;
    }
    case 'interaction': {
      let s = 1;
      const k = event.interaction.kind;
      if (k === 'whispered_exchange' || k === 'overheard_argument') s += 3;
      if (event.interaction.spawnedThreadId) s += 5;
      if (
        ctx.markedNpcIds &&
        event.interaction.participantIds.some((id) =>
          ctx.markedNpcIds!.has(id),
        )
      ) {
        s += 5;
      }
      return s;
    }
    case 'intervention_used':
      return 9;
    case 'ledger_closed': {
      // The day's takings — modestly notable, a little more so in the red.
      let s = 4;
      if (event.net < 0) s += 2;
      return s;
    }
    default:
      // Excluded: init/tick/pause/resume, all flavor_*, all chronicle_*,
      // favor_regenerated, npc_marked, npc_unmarked, guest_spent,
      // tavern_upkeep (the latter two are too noisy per-event).
      return 0;
  }
}

const NOTABLE_ARCHETYPES = new Set([
  'refugee',
  'soldier',
  'rogue',
  'scholar',
]);

export interface SelectOpts {
  maxEvents?: number;
}

/**
 * Pick the top-N highest-scoring events for the chronicle, returned in
 * chronological order (by event id). Tie-breaks deterministically.
 */
export function select(
  entries: EventLogEntry[],
  ctx: SalienceContext,
  opts: SelectOpts = {},
): EventLogEntry[] {
  const max = opts.maxEvents ?? 25;
  const scored = entries
    .map((e) => ({ entry: e, score: score(e.event, ctx) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.id - b.entry.id;
  });
  const top = scored.slice(0, max);
  top.sort((a, b) => a.entry.id - b.entry.id);
  return top.map((x) => x.entry);
}

export function scoreEntries(
  entries: EventLogEntry[],
  ctx: SalienceContext,
): Array<{ entry: EventLogEntry; score: number }> {
  return entries.map((e) => ({ entry: e, score: score(e.event, ctx) }));
}
