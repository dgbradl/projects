import type { Character, Npc, StaffRole, StaffSkills, ZoneName } from '@shared/types';
import type { Persistence } from '../persistence.ts';
import { seededRng } from '../world/rng.ts';
import { jitterInsideZone } from './behavior.ts';
import { emptyMemory } from './character-memory.ts';

export interface StaffDefinition {
  id: string;
  displayName: string;
  role: StaffRole;
  personality: string;
  skills: StaffSkills;
  homeZone: ZoneName;
}

export const ACTIVE_STAFF: StaffDefinition[] = [
  {
    id: 'staff_bartender_mirela',
    displayName: 'Mirela',
    role: 'bartender',
    personality:
      "Gruff and close-mouthed, but remembers every regular's order and knows which secrets to keep.",
    skills: { pourQuality: 8, gossipNetwork: 9, conflictMitigation: 6 },
    homeZone: 'bar',
  },
  {
    id: 'staff_waitstaff_tomas',
    displayName: 'Tomás',
    role: 'waitstaff',
    personality:
      'Eager nephew of the last barkeep. Drops something every few nights, but guests adore him for it.',
    skills: { hospitality: 9, attentiveness: 4 },
    homeZone: 'table_a',
  },
  {
    id: 'staff_waitstaff_petra',
    displayName: 'Petra',
    role: 'waitstaff',
    personality:
      'Sharp-eyed widow, works every shift without complaint. Can carry six flagons without spilling.',
    skills: { hospitality: 6, attentiveness: 9 },
    homeZone: 'table_b',
  },
  {
    id: 'staff_cleaner_oskar',
    displayName: 'Oskar',
    role: 'cleaner',
    personality: 'Never speaks. Has swept the same corner for years. Seems to hear everything.',
    skills: { thoroughness: 7, observant: 10 },
    homeZone: 'hearth',
  },
];

export const REPLACEMENT_POOL: StaffDefinition[] = [
  {
    id: 'staff_bartender_corvin',
    displayName: 'Corvin',
    role: 'bartender',
    personality:
      'Retired sailor who took the job reluctantly. Gruff in a resigned way, not a cruel one.',
    skills: { pourQuality: 6, gossipNetwork: 5, conflictMitigation: 8 },
    homeZone: 'bar',
  },
  {
    id: 'staff_waitstaff_emmett',
    displayName: 'Emmett',
    role: 'waitstaff',
    personality: 'Tall, clumsy, and relentlessly cheerful. Breaks one thing per shift, always apologizes.',
    skills: { hospitality: 7, attentiveness: 3 },
    homeZone: 'table_c',
  },
  {
    id: 'staff_cleaner_lenna',
    displayName: 'Lenna',
    role: 'cleaner',
    personality: 'Always humming, always moving. The floors have been cleaner since she started.',
    skills: { thoroughness: 9, observant: 6 },
    homeZone: 'hearth',
  },
];

export const ALL_STAFF_DEFINITIONS: StaffDefinition[] = [
  ...ACTIVE_STAFF,
  ...REPLACEMENT_POOL,
];

export function definitionById(id: string): StaffDefinition | undefined {
  return ALL_STAFF_DEFINITIONS.find((d) => d.id === id);
}

/** Create Character DB records for every known staff member if absent. */
export function seedStaffIfMissing(persistence: Persistence, currentGameDay: number): void {
  for (const def of ALL_STAFF_DEFINITIONS) {
    if (persistence.loadCharacter(def.id)) continue;
    persistence.upsertCharacter({
      id: def.id,
      displayName: def.displayName,
      archetype: 'wanderer',
      firstSeenGameDay: currentGameDay,
      lastSeenGameDay: currentGameDay,
      visitCount: 0,
      memory: emptyMemory(),
      isStaff: true,
      staffRole: def.role,
      skills: def.skills,
      personality: def.personality,
    });
  }
}

/** Build a live Npc entry for a staff member from their Character record. */
export function makeStaffNpc(
  character: Character,
  def: StaffDefinition,
  absSubTick: number,
  worldSeed: string,
): Npc {
  const rng = seededRng(worldSeed, 'staff-spawn', character.id);
  return {
    id: character.id,
    displayName: character.displayName,
    status: 'wandering',
    position: jitterInsideZone(def.homeZone, rng),
    zone: def.homeZone,
    arrivedGameDay: 0,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 999999,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: absSubTick + 3,
    carriedRumorIds: [],
    tagline: character.personality,
    isStaff: true,
    staffRole: def.role,
    skills: def.skills,
  };
}
