/**
 * Phase 9 (G1): scholar 'studies' signature tests.
 *
 * The signature lifts a one-line rumor about a non-positive world tag
 * when a scholar is at the bar. Once per visit per scholar, deterministic
 * per (worldSeed, gameDay, subTick, scholar id), and silent when no
 * alarming tags are in play.
 */
import { describe, expect, it } from 'vitest';
import type { Npc, WorldTag } from '@shared/types';
import { ScholarStudyTracker } from '../src/npc/archetype-signatures.ts';

function makeNpc(input: {
  id: string;
  archetype: string;
  zone: Npc['zone'];
  isStaff?: boolean;
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: input.zone === 'bar' ? 'at_bar' : 'seated',
    position: { x: 50, y: 50 },
    zone: input.zone,
    arrivedGameDay: 0,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 999,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype,
    visitCount: 1,
    isStaff: input.isStaff,
  };
}

const ALARMING_TAGS: WorldTag[] = [
  { key: 'war_in_north', value: 'escalating', setOnGameDay: 1 },
  { key: 'road_safety_south', value: 'poor', setOnGameDay: 1 },
];

const PEACEFUL_TAGS: WorldTag[] = [
  { key: 'war_in_north', value: 'quiet', setOnGameDay: 1 },
  { key: 'season', value: 'spring', setOnGameDay: 1 },
];

describe('ScholarStudyTracker — eligibility gates', () => {
  it('returns undefined when no scholar is present', () => {
    const t = new ScholarStudyTracker();
    const r = t.maybeFire({
      roster: [makeNpc({ id: 'w1', archetype: 'wanderer', zone: 'bar' })],
      worldTags: ALARMING_TAGS,
      worldSeed: 's',
      gameDay: 1,
      subTick: 5,
    });
    expect(r).toBeUndefined();
  });

  it('returns undefined for a staff scholar (staff path is separate)', () => {
    const t = new ScholarStudyTracker();
    for (let s = 0; s < 50; s += 1) {
      const r = t.maybeFire({
        roster: [
          makeNpc({ id: 'staff-s', archetype: 'scholar', zone: 'bar', isStaff: true }),
        ],
        worldTags: ALARMING_TAGS,
        worldSeed: 'seed',
        gameDay: 1,
        subTick: s,
      });
      expect(r).toBeUndefined();
    }
  });

  it('returns undefined when no world tag is alarming', () => {
    const t = new ScholarStudyTracker();
    for (let s = 0; s < 50; s += 1) {
      const r = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: PEACEFUL_TAGS,
        worldSeed: 'seed',
        gameDay: 1,
        subTick: s,
      });
      expect(r).toBeUndefined();
    }
  });

  it('returns undefined when scholar is not at the bar', () => {
    const t = new ScholarStudyTracker();
    for (let s = 0; s < 50; s += 1) {
      const r = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'table_a' })],
        worldTags: ALARMING_TAGS,
        worldSeed: 'seed',
        gameDay: 1,
        subTick: s,
      });
      expect(r).toBeUndefined();
    }
  });
});

describe('ScholarStudyTracker — fire path', () => {
  it('eventually fires for a scholar at the bar with alarming tags', () => {
    const t = new ScholarStudyTracker();
    let result;
    for (let s = 0; s < 200 && !result; s += 1) {
      result = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: ALARMING_TAGS,
        worldSeed: 'seed-fire',
        gameDay: 1,
        subTick: s,
      });
    }
    expect(result).toBeDefined();
    expect(result!.scholarId).toBe('sch');
    expect(['war_in_north', 'road_safety_south']).toContain(result!.tagKey);
    expect(result!.rumorText.length).toBeGreaterThan(0);
  });

  it('uses curated templates when (tag, value) matches', () => {
    // Drive a roster with only one alarming tag so the template choice is forced.
    const t = new ScholarStudyTracker();
    let result;
    for (let s = 0; s < 200 && !result; s += 1) {
      result = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: [
          { key: 'road_safety_south', value: 'poor', setOnGameDay: 1 },
        ],
        worldSeed: 'curated',
        gameDay: 1,
        subTick: s,
      });
    }
    expect(result?.rumorText).toContain('road south');
  });

  it('falls back to generic prose for unknown (tag, value) pairs', () => {
    const t = new ScholarStudyTracker();
    let result;
    for (let s = 0; s < 200 && !result; s += 1) {
      result = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: [
          // Made-up tag → no template → generic fallback path.
          { key: 'sky_omen', value: 'escalating', setOnGameDay: 1 },
        ],
        worldSeed: 'unknown',
        gameDay: 1,
        subTick: s,
      });
    }
    expect(result?.rumorText).toMatch(/sky omen/);
    expect(result?.rumorText).toMatch(/escalating/);
  });
});

describe('ScholarStudyTracker — once-per-visit gate', () => {
  it('does not fire twice for the same scholar id without onDeparture', () => {
    const t = new ScholarStudyTracker();
    // First fire.
    let firstAt = -1;
    for (let s = 0; s < 200; s += 1) {
      const r = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: ALARMING_TAGS,
        worldSeed: 'gate',
        gameDay: 1,
        subTick: s,
      });
      if (r) {
        firstAt = s;
        break;
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(0);
    // Continue past the first fire; no second fire should happen.
    for (let s = firstAt + 1; s < firstAt + 200; s += 1) {
      const r = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: ALARMING_TAGS,
        worldSeed: 'gate',
        gameDay: 1,
        subTick: s,
      });
      expect(r).toBeUndefined();
    }
  });

  it('fires again for the same id after onDeparture (slot reuse)', () => {
    const t = new ScholarStudyTracker();
    let firstAt = -1;
    for (let s = 0; s < 200; s += 1) {
      const r = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: ALARMING_TAGS,
        worldSeed: 'reuse',
        gameDay: 1,
        subTick: s,
      });
      if (r) {
        firstAt = s;
        break;
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(0);
    t.onDeparture('sch');
    let secondAt = -1;
    for (let s = firstAt + 1; s < firstAt + 200; s += 1) {
      const r = t.maybeFire({
        roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
        worldTags: ALARMING_TAGS,
        worldSeed: 'reuse',
        gameDay: 1,
        subTick: s,
      });
      if (r) {
        secondAt = s;
        break;
      }
    }
    expect(secondAt).toBeGreaterThan(firstAt);
  });
});

describe('ScholarStudyTracker — determinism', () => {
  it('two trackers with the same inputs produce the same first-fire sub-tick', () => {
    function runUntilFire(tracker: ScholarStudyTracker): number {
      for (let s = 0; s < 200; s += 1) {
        const r = tracker.maybeFire({
          roster: [makeNpc({ id: 'sch', archetype: 'scholar', zone: 'bar' })],
          worldTags: ALARMING_TAGS,
          worldSeed: 'det-seed',
          gameDay: 1,
          subTick: s,
        });
        if (r) return s;
      }
      return -1;
    }
    expect(runUntilFire(new ScholarStudyTracker())).toBe(
      runUntilFire(new ScholarStudyTracker()),
    );
  });
});
