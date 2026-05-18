import { describe, expect, it } from 'vitest';
import type {
  EventLogEntry,
  Npc,
  Thread,
  WorldTag,
} from '@shared/types';
import {
  buildDailyPrompt,
  buildProloguePrompt,
  threadHeadline,
} from '../src/chronicle/prompt.ts';

function entry(id: number, event: EventLogEntry['event']): EventLogEntry {
  return { id, realTimestamp: 't', event };
}

const npcsById = new Map<string, Npc>([
  [
    'npc_d1_0',
    {
      id: 'npc_d1_0',
      displayName: 'Mara Thistlewick',
      status: 'seated',
      position: { x: 0, y: 0 },
      zone: 'bar',
      arrivedGameDay: 1,
      arrivedSubTick: 0,
      plannedDepartureGameDay: 2,
      plannedDepartureSubTick: 0,
      nextDecisionSubTick: 0,
      carriedRumorIds: [],
      originLocationId: 'cradle_hollow',
      archetype: 'merchant',
      mood: 'guarded',
      tagline: 'always pricing the room',
    },
  ],
]);

describe('buildDailyPrompt', () => {
  it('produces a byte-stable string for identical inputs', () => {
    const tagsAtDawn: WorldTag[] = [
      { key: 'season', value: 'spring', setOnGameDay: 1 },
      { key: 'war_in_north', value: 'quiet', setOnGameDay: 1 },
    ];
    const tagsAtDusk: WorldTag[] = [
      { key: 'season', value: 'spring', setOnGameDay: 1 },
      { key: 'war_in_north', value: 'simmering', setOnGameDay: 3 },
    ];
    const salient: EventLogEntry[] = [
      entry(10, {
        type: 'npc_arrived',
        gameDay: 3,
        npcId: 'npc_d1_0',
        displayName: 'Mara Thistlewick',
      }),
      entry(11, {
        type: 'world_tag_changed',
        gameDay: 3,
        key: 'war_in_north',
        oldValue: 'quiet',
        newValue: 'simmering',
      }),
    ];
    const activeThreads: Thread[] = [
      {
        id: 'thread_d1_worldly_event_0',
        type: 'worldly_event',
        status: 'active',
        state: 'cued',
        startedGameDay: 1,
        nextTickGameDay: 5,
        payload: { tagKey: 'war_in_north', sequence: ['simmering', 'escalating'], dwellDays: 4, cursor: 0 },
        history: [],
      },
    ];
    const a = buildDailyPrompt({
      gameDay: 3,
      salientEvents: salient,
      tagsAtDawn,
      tagsAtDusk,
      yesterdayHeadlines: ['Old Tomas argued with the doorframe.'],
      activeThreads,
      npcsById,
    });
    const b = buildDailyPrompt({
      gameDay: 3,
      salientEvents: salient,
      tagsAtDawn,
      tagsAtDusk,
      yesterdayHeadlines: ['Old Tomas argued with the doorframe.'],
      activeThreads,
      npcsById,
    });
    expect(a).toBe(b);
    // Sanity: it embeds the expected substitutions.
    expect(a).toContain('Day 3.');
    expect(a).toContain('war_in_north: simmering');
    expect(a).toContain('arrived: Mara Thistlewick');
    expect(a).toContain('always pricing the room');
    expect(a).toContain('war_in_north drifts toward simmering');
    expect(a).toContain('Old Tomas argued with the doorframe.');
  });

  it('falls back to friendly placeholders when slots are empty', () => {
    const prompt = buildDailyPrompt({
      gameDay: 1,
      salientEvents: [],
      tagsAtDawn: [],
      tagsAtDusk: [],
      yesterdayHeadlines: [],
      activeThreads: [],
      npcsById: new Map(),
    });
    expect(prompt).toContain('(no tags set)');
    expect(prompt).toContain('(this is the first day)');
    expect(prompt).toContain('(nothing of note)');
    expect(prompt).toContain('(no notable events)');
  });
});

describe('threadHeadline', () => {
  it('renders travelers_journey state-aware', () => {
    const thread: Thread = {
      id: 't1',
      type: 'travelers_journey',
      status: 'active',
      state: 'traveling',
      startedGameDay: 1,
      nextTickGameDay: 4,
      payload: {
        displayName: 'Wren',
        destinationLocationId: 'oldspire',
        trip: 'outbound',
      },
      history: [],
    };
    expect(threadHeadline(thread)).toContain('Wren is on the road to Oldspire');
    expect(threadHeadline({ ...thread, state: 'returning' })).toContain(
      'on the road back from',
    );
    expect(threadHeadline({ ...thread, state: 'met_misfortune' })).toContain(
      'ended badly',
    );
  });
});

describe('buildProloguePrompt', () => {
  it('substitutes day count and headlines list', () => {
    const out = buildProloguePrompt({
      fromGameDay: 5,
      toGameDay: 9,
      allHeadlines: ['Old Tomas argued with the doorframe.', 'The bells rang twice.'],
    });
    expect(out).toContain('been away from your village for 5 days');
    expect(out).toContain('- Old Tomas argued with the doorframe.');
    expect(out).toContain('- The bells rang twice.');
  });

  it('handles empty headlines list gracefully', () => {
    const out = buildProloguePrompt({
      fromGameDay: 1,
      toGameDay: 3,
      allHeadlines: [],
    });
    expect(out).toContain('(no notable headlines)');
  });
});
