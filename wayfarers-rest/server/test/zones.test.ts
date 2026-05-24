import { describe, expect, it } from 'vitest';
import type { Npc } from '@shared/types';
import {
  ZONE_RULES,
  filterAllowed,
  isAudienceAllowed,
  isZoneAllowed,
} from '../src/npc/zones.ts';

function npc(overrides: Partial<Npc> = {}): Npc {
  return {
    id: overrides.id ?? 'n1',
    displayName: overrides.displayName ?? 'Test',
    archetype: overrides.archetype ?? 'wanderer',
    status: overrides.status ?? 'arriving',
    zone: overrides.zone ?? 'door',
    position: overrides.position ?? { x: 50, y: 50 },
    nextDecisionSubTick: overrides.nextDecisionSubTick ?? 0,
    arrivedGameDay: overrides.arrivedGameDay ?? 1,
    arrivedSubTick: overrides.arrivedSubTick ?? 0,
    carriedRumorIds: overrides.carriedRumorIds ?? [],
    visitCount: overrides.visitCount ?? 1,
    isStaff: overrides.isStaff ?? false,
    staffRole: overrides.staffRole,
    item: overrides.item,
    tagline: overrides.tagline,
    originLocationId: overrides.originLocationId,
  } as Npc;
}

describe('ZONE_RULES', () => {
  it('bar_back is the only staff-only zone in the default ruleset', () => {
    const staffOnly = Object.entries(ZONE_RULES)
      .filter(([, rule]) => rule.staffOnly)
      .map(([name]) => name);
    expect(staffOnly).toEqual(['bar_back']);
  });
});

describe('isZoneAllowed', () => {
  it('lets a customer into every non-staff-only zone', () => {
    const customer = npc({ isStaff: false });
    expect(isZoneAllowed('bar', customer)).toBe(true);
    expect(isZoneAllowed('hearth', customer)).toBe(true);
    expect(isZoneAllowed('table_a', customer)).toBe(true);
    expect(isZoneAllowed('door', customer)).toBe(true);
  });

  it('forbids a customer from bar_back', () => {
    expect(isZoneAllowed('bar_back', npc({ isStaff: false }))).toBe(false);
  });

  it('lets any staff member into bar_back', () => {
    for (const role of ['bartender', 'waitstaff', 'cleaner'] as const) {
      const staff = npc({ isStaff: true, staffRole: role });
      expect(isZoneAllowed('bar_back', staff)).toBe(true);
    }
  });
});

describe('filterAllowed', () => {
  it('strips staff-only zones from a customer pool', () => {
    const all = ['bar', 'bar_back', 'hearth', 'table_a'] as const;
    expect(filterAllowed(all, npc({ isStaff: false }))).toEqual([
      'bar',
      'hearth',
      'table_a',
    ]);
  });

  it('passes a staff pool through unchanged', () => {
    const all = ['bar', 'bar_back', 'hearth'] as const;
    expect(filterAllowed(all, npc({ isStaff: true, staffRole: 'bartender' }))).toEqual(
      ['bar', 'bar_back', 'hearth'],
    );
  });
});

// Z4: archetype-level rules (mechanism only — no defaults shipped).
describe('isAudienceAllowed with archetype rules', () => {
  it('forbiddenArchetypes blocks the listed archetype but lets others in', () => {
    const rule = { forbiddenArchetypes: ['merchant'] as const };
    expect(isAudienceAllowed(rule, npc({ archetype: 'merchant' }))).toBe(false);
    expect(isAudienceAllowed(rule, npc({ archetype: 'pilgrim' }))).toBe(true);
  });

  it('allowedArchetypes only admits NPCs whose archetype is listed', () => {
    const rule = { allowedArchetypes: ['knight', 'mage'] as const };
    expect(isAudienceAllowed(rule, npc({ archetype: 'knight' }))).toBe(true);
    expect(isAudienceAllowed(rule, npc({ archetype: 'mage' }))).toBe(true);
    expect(isAudienceAllowed(rule, npc({ archetype: 'wanderer' }))).toBe(false);
  });

  it('forbiddenArchetypes wins when both lists name the same archetype', () => {
    const rule = {
      allowedArchetypes: ['merchant'] as const,
      forbiddenArchetypes: ['merchant'] as const,
    };
    expect(isAudienceAllowed(rule, npc({ archetype: 'merchant' }))).toBe(false);
  });

  it('staff are exempt from archetype gating', () => {
    const rule = { forbiddenArchetypes: ['merchant'] as const };
    expect(
      isAudienceAllowed(rule, npc({ isStaff: true, staffRole: 'waitstaff', archetype: 'merchant' })),
    ).toBe(true);
  });

  it('an NPC without an archetype is rejected by an allow-list', () => {
    const rule = { allowedArchetypes: ['knight'] as const };
    expect(isAudienceAllowed(rule, npc({ archetype: undefined as never }))).toBe(false);
  });
});
