import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  EventLogEntry,
  InterventionRecord,
  Npc,
  Thread,
  WorldEvent,
  WorldTag,
} from '@shared/types';
import { locationById } from '../world/locations.ts';
import type { Persistence } from '../persistence.ts';

const DAILY_TEMPLATE = readFileSync(
  fileURLToPath(new URL('./prompts/daily.prompt.md', import.meta.url)),
  'utf8',
);

const PROLOGUE_TEMPLATE = readFileSync(
  fileURLToPath(new URL('./prompts/prologue.prompt.md', import.meta.url)),
  'utf8',
);

export interface InterventionDescription {
  /** Pre-rendered "by your hand" description. */
  text: string;
}

export interface BuildDailyPromptInput {
  gameDay: number;
  salientEvents: EventLogEntry[];
  tagsAtDawn: WorldTag[];
  tagsAtDusk: WorldTag[];
  yesterdayHeadlines: string[];
  activeThreads: Thread[];
  npcsById: Map<string, Npc>;
  /** Phase 6: descriptions of player interventions performed on this day. */
  interventionDescriptions?: InterventionDescription[];
}

export function buildDailyPrompt(input: BuildDailyPromptInput): string {
  return DAILY_TEMPLATE
    .replace('{gameDay}', String(input.gameDay))
    .replace('{tagsAtDawn}', formatTags(input.tagsAtDawn))
    .replace('{tagsAtDusk}', formatTags(input.tagsAtDusk))
    .replace('{yesterdayHeadlines}', formatHeadlines(input.yesterdayHeadlines))
    .replace(
      '{activeThreadHeadlines}',
      formatActiveThreads(input.activeThreads),
    )
    .replace(
      '{interventionDescriptions}',
      formatInterventions(input.interventionDescriptions ?? []),
    )
    .replace(
      '{eventList}',
      formatEventList(input.salientEvents, input.npcsById),
    );
}

function formatInterventions(items: InterventionDescription[]): string {
  if (items.length === 0) return '(you did not intervene)';
  return items.map((i) => `- ${i.text}`).join('\n');
}

export interface BuildProloguePromptInput {
  fromGameDay: number;
  toGameDay: number;
  /** Headlines from each chronicle in the range, in order. */
  allHeadlines: string[];
  /** Phase 6: number of interventions performed during the span. */
  interventionCount?: number;
}

export function buildProloguePrompt(input: BuildProloguePromptInput): string {
  const dayCount = input.toGameDay - input.fromGameDay + 1;
  const lines = input.allHeadlines.length
    ? input.allHeadlines.map((h) => `- ${h}`).join('\n')
    : '(no notable headlines)';
  const hint =
    input.interventionCount && input.interventionCount > 0
      ? `Across these days you exercised ${input.interventionCount} of your favors.`
      : '';
  return PROLOGUE_TEMPLATE
    .replace('{dayCount}', String(dayCount))
    .replace('{allHeadlinesConcatenated}', lines)
    .replace('{playerActionHint}', hint);
}

function formatTags(tags: WorldTag[]): string {
  if (tags.length === 0) return '(no tags set)';
  return tags
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((t) => `- ${t.key}: ${t.value}`)
    .join('\n');
}

function formatHeadlines(headlines: string[]): string {
  if (headlines.length === 0) return '(this is the first day)';
  return headlines
    .slice(0, 5)
    .map((h) => `- ${h}`)
    .join('\n');
}

function formatActiveThreads(threads: Thread[]): string {
  if (threads.length === 0) return '(nothing of note)';
  return threads
    .slice(0, 5)
    .map((t) => `- ${threadHeadline(t)}`)
    .join('\n');
}

export function threadHeadline(thread: Thread): string {
  const payload = thread.payload as Record<string, unknown>;
  switch (thread.type) {
    case 'travelers_journey': {
      const name = (payload.displayName as string | undefined) ?? 'a traveler';
      const destId = payload.destinationLocationId as string | undefined;
      const dest = destId ? locationById(destId)?.displayName ?? destId : 'parts unknown';
      const state = thread.state;
      if (state === 'returning' || state === 'returned_to_tavern') {
        return `${name} is on the road back from ${dest}`;
      }
      if (state === 'met_misfortune') {
        return `${name}'s journey to ${dest} ended badly`;
      }
      return `${name} is on the road to ${dest}`;
    }
    case 'approaching_stranger': {
      const name = (payload.displayName as string | undefined) ?? 'a stranger';
      const originId = payload.originLocationId as string | undefined;
      const origin = originId
        ? locationById(originId)?.displayName ?? originId
        : 'somewhere distant';
      return `${name} is on their way from ${origin}`;
    }
    case 'worldly_event': {
      const key = (payload.tagKey as string | undefined) ?? 'something';
      const sequence = (payload.sequence as string[] | undefined) ?? [];
      const cursor = (payload.cursor as number | undefined) ?? 0;
      const next = sequence[cursor] ?? '?';
      return `${key} drifts toward ${next}`;
    }
    default:
      return `${thread.type} is in progress`;
  }
}

function formatEventList(
  entries: EventLogEntry[],
  npcsById: Map<string, Npc>,
): string {
  if (entries.length === 0) return '(no notable events)';
  return entries
    .map((entry) => formatEventLine(entry, npcsById))
    .join('\n');
}

function formatEventLine(entry: EventLogEntry, npcsById: Map<string, Npc>): string {
  const ev = entry.event;
  const stamp = `[d${(ev as { gameDay: number }).gameDay}]`;
  switch (ev.type) {
    case 'npc_arrived': {
      const npc = npcsById.get(ev.npcId);
      const archetype = npc?.archetype ?? 'traveler';
      const mood = npc?.mood ?? '';
      const origin = npc?.originLocationId
        ? locationById(npc.originLocationId)?.displayName ?? npc.originLocationId
        : 'parts unknown';
      const tagline = npc?.tagline ? ` — ${npc.tagline}` : '';
      const moodStr = mood ? `${mood} ` : '';
      return `${stamp} arrived: ${ev.displayName} (${moodStr}${archetype} from ${origin})${tagline}`;
    }
    case 'npc_departed': {
      const npc = npcsById.get(ev.npcId);
      const name = npc?.displayName ?? ev.npcId;
      const destId = ev.destinationLocationId;
      const dest = destId
        ? locationById(destId)?.displayName ?? destId
        : 'parts unknown';
      return `${stamp} departed: ${name} (toward ${dest})`;
    }
    case 'world_tag_changed':
      return `${stamp} world tag: ${ev.key} ${ev.oldValue ?? '∅'} → ${ev.newValue}`;
    case 'thread_started':
      return `${stamp} thread started: ${ev.threadType} (${ev.threadId})`;
    case 'thread_progressed':
      return `${stamp} thread: ${ev.threadId} ${ev.fromState} → ${ev.toState}${ev.note ? ` (${ev.note})` : ''}`;
    case 'thread_completed':
      return `${stamp} thread completed: ${ev.threadId} → ${ev.outcome}`;
    case 'rumor_introduced':
      return `${stamp} rumor introduced: ${ev.rumorId}`;
    case 'interaction': {
      const ids = ev.interaction.participantIds
        .map((id) => npcsById.get(id)?.displayName ?? id)
        .join(' and ');
      const overheard = ev.interaction.overheardText
        ? ` — overheard: "${ev.interaction.overheardText}"`
        : '';
      return `${stamp} ${ev.interaction.kind} between ${ids} at the ${ev.interaction.zone}${overheard}`;
    }
    default:
      return `${stamp} ${(ev as { type: string }).type}`;
  }
}

/**
 * Reconstruct the world tag state at the start or end of a given game day
 * by replaying world_tag_changed events from the persistent event log.
 */
export function reconstructWorldTagsAt(
  persistence: Persistence,
  gameDay: number,
  boundary: 'dawn' | 'dusk',
): WorldTag[] {
  const all = persistence.getEventsSince(0);
  const tags = new Map<string, { value: string; setOnGameDay: number }>();
  for (const entry of all) {
    const ev = entry.event;
    if (ev.type !== 'world_tag_changed') continue;
    if (boundary === 'dawn' && ev.gameDay >= gameDay) break;
    if (boundary === 'dusk' && ev.gameDay > gameDay) break;
    tags.set(ev.key, { value: ev.newValue, setOnGameDay: ev.gameDay });
  }
  const out: WorldTag[] = [];
  for (const [key, { value, setOnGameDay }] of tags) {
    out.push({ key, value, setOnGameDay });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}
