import { describe, expect, it } from 'vitest';
import type { EventLogEntry, Npc, Thread } from '@shared/types';
import { buildFallbackChronicle } from '../src/chronicle/fallback.ts';
import { DEFAULT_ALARMING_VALUES } from '../src/chronicle/types.ts';

function entry(id: number, event: EventLogEntry['event']): EventLogEntry {
  return { id, realTimestamp: 't', event };
}

const npcsById = new Map<string, Npc>([
  [
    'a',
    {
      id: 'a',
      displayName: 'Mara',
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
    },
  ],
  [
    'b',
    {
      id: 'b',
      displayName: 'Brennan',
      status: 'seated',
      position: { x: 0, y: 0 },
      zone: 'table_a',
      arrivedGameDay: 1,
      arrivedSubTick: 0,
      plannedDepartureGameDay: 2,
      plannedDepartureSubTick: 0,
      nextDecisionSubTick: 0,
      carriedRumorIds: [],
    },
  ],
]);

const ctx = {
  npcsById,
  threadsById: new Map<string, Thread>(),
  alarmingValues: DEFAULT_ALARMING_VALUES,
};

describe('buildFallbackChronicle', () => {
  it('produces a complete chronicle from a varied event mix', () => {
    const events: EventLogEntry[] = [
      entry(1, { type: 'npc_arrived', gameDay: 5, npcId: 'a', displayName: 'Mara' }),
      entry(2, {
        type: 'world_tag_changed',
        gameDay: 5,
        key: 'war_in_north',
        oldValue: 'quiet',
        newValue: 'simmering',
      }),
      entry(3, { type: 'rumor_introduced', gameDay: 5, rumorId: 'r1' }),
      entry(4, {
        type: 'thread_completed',
        gameDay: 5,
        threadId: 'thread_d2_travelers_journey_0',
        outcome: 'misfortune',
      }),
      entry(5, {
        type: 'interaction',
        gameDay: 5,
        interaction: {
          id: 'int_x',
          gameDay: 5,
          subTick: 1,
          zone: 'bar',
          participantIds: ['a', 'b'],
          kind: 'whispered_exchange',
          overheardText: 'I owed him before I met him, somehow',
        },
      }),
      entry(6, { type: 'npc_departed', gameDay: 5, npcId: 'b' }),
    ];
    const chron = buildFallbackChronicle({
      gameDay: 5,
      generatedAtRealTs: '2026-01-01T00:00:00.000Z',
      salientEvents: events,
      context: ctx,
    });
    expect(chron.status).toBe('fallback');
    expect(chron.headlines.length).toBeGreaterThanOrEqual(3);
    expect(chron.headlines.length).toBeLessThanOrEqual(5);
    expect(chron.footnotes.length).toBeGreaterThanOrEqual(3);
    expect(chron.footnotes.length).toBeLessThanOrEqual(6);
    for (const line of [...chron.headlines, ...chron.footnotes]) {
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('pads with filler footnotes when too few events', () => {
    const chron = buildFallbackChronicle({
      gameDay: 1,
      generatedAtRealTs: 't',
      salientEvents: [],
      context: ctx,
    });
    expect(chron.headlines.length).toBe(3);
    expect(chron.footnotes.length).toBe(3);
  });

  it('renders a npc_returned event as a familiar face', () => {
    const chron = buildFallbackChronicle({
      gameDay: 7,
      generatedAtRealTs: 't',
      salientEvents: [
        entry(1, {
          type: 'npc_returned',
          gameDay: 7,
          npcId: 'a',
          displayName: 'Mara',
          visitCount: 3,
        }),
      ],
      context: ctx,
    });
    const allText = [...chron.headlines, ...chron.footnotes].join(' ');
    expect(allText).toContain('Mara');
    expect(allText.toLowerCase()).toContain('familiar face');
  });

  it("renders a ledger_closed event as the day's takings", () => {
    const surplus = buildFallbackChronicle({
      gameDay: 6,
      generatedAtRealTs: 't',
      salientEvents: [
        entry(1, {
          type: 'ledger_closed',
          gameDay: 6,
          income: 80,
          expense: 30,
          net: 50,
          coinBefore: 200,
          coinAfter: 250,
          guestCount: 5,
        }),
      ],
      context: ctx,
    });
    expect([...surplus.headlines, ...surplus.footnotes].join(' ')).toContain(
      "takings came to 50 coin",
    );

    const shortfall = buildFallbackChronicle({
      gameDay: 6,
      generatedAtRealTs: 't',
      salientEvents: [
        entry(1, {
          type: 'ledger_closed',
          gameDay: 6,
          income: 10,
          expense: 40,
          net: -30,
          coinBefore: 200,
          coinAfter: 170,
          guestCount: 1,
        }),
      ],
      context: ctx,
    });
    expect([...shortfall.headlines, ...shortfall.footnotes].join(' ')).toContain(
      'ran short by 30 coin',
    );
  });

  it('never throws on any event mix', () => {
    const events: EventLogEntry[] = [
      entry(1, { type: 'tick', gameDay: 1 }),
      entry(2, { type: 'init', gameDay: 1 }),
    ];
    expect(() =>
      buildFallbackChronicle({
        gameDay: 1,
        generatedAtRealTs: 't',
        salientEvents: events,
        context: ctx,
      }),
    ).not.toThrow();
  });
});
