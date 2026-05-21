import type {
  DailyChronicle,
  EventLogEntry,
  Npc,
} from '@shared/types';
import { locationById } from '../world/locations.ts';
import { score } from './salience.ts';
import { DEFAULT_ALARMING_VALUES, type SalienceContext } from './types.ts';

export interface FallbackInput {
  gameDay: number;
  generatedAtRealTs: string;
  salientEvents: EventLogEntry[];
  context: SalienceContext;
  failureReason?: string;
}

const FILLER_FOOTNOTES = [
  'The hearth burned low; the night was quiet.',
  'The cellar door creaked twice for no one.',
  'A cup was chipped; a cup was always being chipped.',
  'The dog slept by the bar and dreamed loudly.',
  'The candle in the back room ran down without complaint.',
  'A merchant counted his coins twice and still did not believe them.',
];

/**
 * Build a chronicle without an LLM. Renders the highest-scoring events into
 * one-sentence headlines, the rest into footnotes, padding with quiet
 * filler if needed. Never throws.
 */
export function buildFallbackChronicle(input: FallbackInput): DailyChronicle {
  // Re-sort by score so highest-impact events become headlines.
  const ctx = {
    ...input.context,
    alarmingValues: input.context.alarmingValues ?? DEFAULT_ALARMING_VALUES,
  };
  const scored = input.salientEvents
    .map((e) => ({ entry: e, score: score(e.event, ctx) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.id - b.entry.id;
    });

  const sentences = scored.map((s) =>
    renderSentence(s.entry, input.context.npcsById),
  );

  const headlines = sentences
    .slice(0, Math.min(5, Math.max(3, Math.ceil(sentences.length / 2))))
    .filter((s) => s.length > 0);
  while (headlines.length < 3) {
    headlines.push('The day passed without much remark.');
  }

  const remainder = sentences.slice(headlines.length);
  const footnotes: string[] = [];
  for (const r of remainder) {
    if (footnotes.length >= 6) break;
    if (r) footnotes.push(r);
  }
  let fillerIdx = 0;
  while (footnotes.length < 3) {
    footnotes.push(FILLER_FOOTNOTES[fillerIdx % FILLER_FOOTNOTES.length]);
    fillerIdx += 1;
  }

  return {
    gameDay: input.gameDay,
    generatedAtRealTs: input.generatedAtRealTs,
    status: 'fallback',
    headlines: headlines.slice(0, 5),
    footnotes: footnotes.slice(0, 6),
    modelUsed: null,
    promptCharCount: null,
    completionCharCount: null,
    generationDurationMs: null,
    failureReason: input.failureReason ?? null,
  };
}

function renderSentence(entry: EventLogEntry, npcsById: Map<string, Npc>): string {
  const ev = entry.event;
  switch (ev.type) {
    case 'npc_arrived': {
      const npc = npcsById.get(ev.npcId);
      const origin = npc?.originLocationId
        ? locationById(npc.originLocationId)?.displayName ?? npc.originLocationId
        : 'parts unknown';
      return `${ev.displayName} arrived from ${origin}.`;
    }
    case 'npc_returned': {
      const npc = npcsById.get(ev.npcId);
      const origin = npc?.originLocationId
        ? locationById(npc.originLocationId)?.displayName ?? npc.originLocationId
        : 'parts unknown';
      return `${ev.displayName}, a familiar face, returned from ${origin}.`;
    }
    case 'npc_departed': {
      const npc = npcsById.get(ev.npcId);
      const name = npc?.displayName ?? ev.npcId;
      const destId = ev.destinationLocationId;
      const dest = destId
        ? locationById(destId)?.displayName ?? destId
        : 'parts unknown';
      return `${name} left, bound for ${dest}.`;
    }
    case 'world_tag_changed':
      return `Word spread that ${ev.key} had turned to ${ev.newValue}.`;
    case 'thread_started':
      return `A new matter began in the world: ${ev.threadType}.`;
    case 'thread_progressed':
      return `The matter of ${ev.threadId} moved from ${ev.fromState} to ${ev.toState}.`;
    case 'thread_completed':
      return `The matter of ${ev.threadId} concluded: ${ev.outcome}.`;
    case 'rumor_introduced':
      return `A new rumor began to circulate (${ev.rumorId}).`;
    case 'interaction': {
      const names = ev.interaction.participantIds
        .map((id) => npcsById.get(id)?.displayName ?? id)
        .join(' and ');
      if (ev.interaction.overheardText) {
        return `${names} exchanged words at the ${ev.interaction.zone}; one of them was overheard saying: ${ev.interaction.overheardText}.`;
      }
      return `${names} shared a ${ev.interaction.kind.replace(/_/g, ' ')} at the ${ev.interaction.zone}.`;
    }
    default:
      return '';
  }
}
