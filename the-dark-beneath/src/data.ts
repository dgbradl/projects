import type { Item, MonsterDef, SpellDef, WorldNode, Quest } from './types';

// ============================================================ ITEMS

export const ITEMS: Record<string, Item> = {};
function item(i: Item) { ITEMS[i.id] = i; }

// weapons
item({ id: 'dagger', name: 'Dagger', kind: 'weapon', slots: 1, cost: 1, dmg: '1d4', finesse: true });
item({ id: 'club', name: 'Club', kind: 'weapon', slots: 1, cost: 1, dmg: '1d4' });
item({ id: 'staff', name: 'Quarterstaff', kind: 'weapon', slots: 1, cost: 1, dmg: '1d4', twoHanded: true });
item({ id: 'shortsword', name: 'Shortsword', kind: 'weapon', slots: 1, cost: 7, dmg: '1d6', finesse: true });
item({ id: 'mace', name: 'Mace', kind: 'weapon', slots: 1, cost: 5, dmg: '1d6' });
item({ id: 'spear', name: 'Spear', kind: 'weapon', slots: 1, cost: 3, dmg: '1d6' });
item({ id: 'longsword', name: 'Longsword', kind: 'weapon', slots: 1, cost: 9, dmg: '1d8' });
item({ id: 'greataxe', name: 'Greataxe', kind: 'weapon', slots: 2, cost: 12, dmg: '1d10', twoHanded: true });
item({ id: 'shortbow', name: 'Shortbow', kind: 'weapon', slots: 1, cost: 8, dmg: '1d6', ranged: true, twoHanded: true });
item({ id: 'crossbow', name: 'Crossbow', kind: 'weapon', slots: 1, cost: 8, dmg: '1d6', ranged: true, twoHanded: true });
// armor
item({ id: 'leather', name: 'Leather Armor', kind: 'armor', slots: 1, cost: 10, ac: 11 });
item({ id: 'chainmail', name: 'Chainmail', kind: 'armor', slots: 2, cost: 60, ac: 13 });
item({ id: 'plate', name: 'Plate Mail', kind: 'armor', slots: 3, cost: 130, ac: 15, noDex: true });
item({ id: 'shield', name: 'Shield', kind: 'shield', slots: 1, cost: 10, ac: 2 });
// consumables & gear
item({ id: 'torch', name: 'Torch', kind: 'torch', slots: 1, cost: 1, desc: 'Burns for a while. The dark is always waiting.' });
item({ id: 'ration', name: 'Rations', kind: 'gear', slots: 1, cost: 1, desc: 'A day of hard bread and salt meat.' });
item({ id: 'potion_heal', name: 'Potion of Healing', kind: 'potion', slots: 1, cost: 25, heals: '2d4', desc: 'Tastes of copper and summer.' });
item({ id: 'potion_heal_greater', name: 'Greater Healing Potion', kind: 'potion', slots: 1, cost: 60, heals: '3d6', desc: 'Thick as honey, warm as a hearth.' });
item({ id: 'scroll_mm', name: 'Scroll: Magic Missile', kind: 'scroll', slots: 1, cost: 20, spell: 'magic_missile' });
item({ id: 'scroll_cure', name: 'Scroll: Cure Wounds', kind: 'scroll', slots: 1, cost: 20, spell: 'cure_wounds' });
item({ id: 'crowbar', name: 'Crowbar', kind: 'gear', slots: 1, cost: 3, desc: 'Advantage forcing locks and lids.' });
// treasure
item({ id: 't_gem', name: 'Rough Gemstone', kind: 'treasure', slots: 0, cost: 0, value: 25 });
item({ id: 't_chalice', name: 'Silver Chalice', kind: 'treasure', slots: 1, cost: 0, value: 40 });
item({ id: 't_idol', name: 'Jade Idol', kind: 'treasure', slots: 1, cost: 0, value: 120 });
item({ id: 't_crown', name: 'Ancient Crown', kind: 'treasure', slots: 1, cost: 0, value: 300 });

export const SHOP_STOCK = [
  'torch', 'ration', 'dagger', 'shortsword', 'mace', 'spear', 'longsword', 'greataxe',
  'shortbow', 'crossbow', 'leather', 'chainmail', 'plate', 'shield',
  'potion_heal', 'scroll_mm', 'scroll_cure', 'crowbar',
];

// ============================================================ SPELLS

export const SPELLS: Record<string, SpellDef> = {};
function spell(s: SpellDef) { SPELLS[s.id] = s; }

spell({ id: 'magic_missile', name: 'Magic Missile', tier: 1, cls: 'Wizard', target: 'enemy', range: 8, desc: 'A dart of force that never misses. 1d6+1 damage.' });
spell({ id: 'burning_hands', name: 'Burning Hands', tier: 1, cls: 'Wizard', target: 'area', range: 2, desc: 'Fire fans from your fingers. 1d6 to enemies within 2 tiles.' });
spell({ id: 'sleep', name: 'Sleep', tier: 1, cls: 'Wizard', target: 'enemy', range: 6, desc: 'A weak-willed foe (2 HD or less) drops senseless and out of the fight.' });
spell({ id: 'web', name: 'Web', tier: 2, cls: 'Wizard', target: 'enemy', range: 6, desc: 'Sticky strands root a foe in place for 3 rounds.' });
spell({ id: 'fireball', name: 'Fireball', tier: 3, cls: 'Wizard', target: 'all-enemies', range: 10, desc: 'A bead of flame detonates. 3d6 to every enemy.' });
spell({ id: 'cure_wounds', name: 'Cure Wounds', tier: 1, cls: 'Priest', target: 'ally', range: 1, desc: 'Knit flesh and staunch blood. Heals 1d6 + caster level.' });
spell({ id: 'bless', name: 'Bless', tier: 1, cls: 'Priest', target: 'ally', range: 4, desc: 'A whispered benediction. +1 to attacks and saves this fight.' });
spell({ id: 'turn_undead', name: 'Turn Undead', tier: 1, cls: 'Priest', target: 'all-enemies', range: 6, desc: 'Brandish your symbol; the restless dead may flee.' });
spell({ id: 'holy_smite', name: 'Holy Smite', tier: 2, cls: 'Priest', target: 'enemy', range: 6, desc: 'A column of white fire. 2d6 damage, 3d6 to undead.' });
spell({ id: 'heal', name: 'Heal', tier: 3, cls: 'Priest', target: 'ally', range: 1, desc: 'Restore an ally to full hit points.' });

export const CLASS_SPELLS: Record<string, string[]> = {
  Wizard: ['magic_missile', 'burning_hands', 'sleep', 'web', 'fireball'],
  Priest: ['cure_wounds', 'bless', 'turn_undead', 'holy_smite', 'heal'],
};

// ============================================================ MONSTERS

export const MONSTERS: Record<string, MonsterDef> = {};
function mon(m: MonsterDef) { MONSTERS[m.id] = m; }

mon({ id: 'giant_rat', name: 'Giant Rat', hd: 1, ac: 11, atk: 1, dmg: '1d4', speed: 6, xp: 2, morale: 6, color: '#8a7560', glyph: 'r', desc: 'A dog-sized rat, all teeth and hunger.' });
mon({ id: 'goblin', name: 'Goblin', hd: 1, ac: 11, atk: 1, dmg: '1d6', speed: 5, xp: 3, morale: 7, color: '#5e7a3a', glyph: 'g', desc: 'A wiry, yellow-eyed raider with a rusted blade.' });
mon({ id: 'goblin_archer', name: 'Goblin Archer', hd: 1, ac: 11, atk: 1, dmg: '1d4', speed: 5, xp: 3, ranged: true, morale: 6, color: '#6d8a42', glyph: 'a', desc: 'It looses crooked arrows from the shadows.' });
mon({ id: 'warg', name: 'Warg', hd: 2, ac: 12, atk: 3, dmg: '1d6+1', speed: 7, xp: 6, morale: 8, color: '#4a4038', glyph: 'w', desc: 'A goblin wolf, big as a pony, breath like a grave.' });
mon({ id: 'bandit', name: 'Bandit', hd: 1, ac: 12, atk: 2, dmg: '1d6', speed: 5, xp: 4, morale: 7, color: '#7a5c3a', glyph: 'b', desc: 'A desperate soul with a blade and bad intentions.' });
mon({ id: 'wolf', name: 'Wolf', hd: 2, ac: 12, atk: 2, dmg: '1d6', speed: 7, xp: 5, morale: 8, color: '#666e78', glyph: 'w', desc: 'Grey and patient, hunting in the treeline.' });
mon({ id: 'skeleton', name: 'Skeleton', hd: 2, ac: 13, atk: 2, dmg: '1d6', speed: 5, xp: 6, undead: true, morale: 12, color: '#cfc8b8', glyph: 's', desc: 'Bones held together by old malice.' });
mon({ id: 'zombie', name: 'Zombie', hd: 2, ac: 9, atk: 2, dmg: '1d8', speed: 3, xp: 6, undead: true, morale: 12, color: '#6f7a5a', glyph: 'z', desc: 'It shuffles forward, patient as rot.' });
mon({ id: 'crypt_wight', name: 'The Pale Abbot', hd: 4, ac: 14, atk: 4, dmg: '1d8+1', speed: 5, xp: 30, undead: true, morale: 12, color: '#b8c8d8', glyph: 'W', desc: 'Once the crypt\'s keeper. Now it keeps other things.' });
mon({ id: 'giant_spider', name: 'Giant Spider', hd: 3, ac: 13, atk: 3, dmg: '1d6+1', speed: 6, xp: 9, morale: 8, color: '#3a2f3f', glyph: 'S', desc: 'Eight eyes catch your torchlight and hold it.' });
mon({ id: 'cultist', name: 'Cultist', hd: 1, ac: 12, atk: 2, dmg: '1d6', speed: 5, xp: 4, morale: 8, color: '#5c3a4a', glyph: 'c', desc: 'Robed in grey, murmuring to something below.' });
mon({ id: 'cult_fanatic', name: 'Cult Fanatic', hd: 3, ac: 12, atk: 3, dmg: '1d8', speed: 5, xp: 10, ranged: true, morale: 9, color: '#7a2f45', glyph: 'C', desc: 'Its eyes are wrong. It hurls whispers that cut.' });
mon({ id: 'ogre', name: 'Ogre', hd: 4, ac: 12, atk: 4, dmg: '2d6', speed: 5, xp: 20, morale: 9, color: '#8a6a4a', glyph: 'O', desc: 'A mountain of appetite with a tree for a club.' });
mon({ id: 'redtooth', name: 'Redtooth, Goblin King', hd: 4, ac: 14, atk: 4, dmg: '1d8+2', speed: 6, xp: 30, morale: 10, color: '#8a3a2a', glyph: 'R', desc: 'His crown is scrap iron. His namesake is not rust.' });
mon({ id: 'deep_crawler', name: 'The Weeping Thing', hd: 6, ac: 14, atk: 5, dmg: '2d6', speed: 5, xp: 60, morale: 12, color: '#3a4a5c', glyph: 'D', desc: 'The miners heard it crying. They dug toward the sound.' });
mon({ id: 'animated_armor', name: 'Animated Armor', hd: 3, ac: 15, atk: 3, dmg: '1d8', speed: 4, xp: 12, morale: 12, color: '#8a8f9a', glyph: 'A', desc: 'Empty plate that remembers how to kill.' });
mon({ id: 'imp', name: 'Imp', hd: 2, ac: 13, atk: 3, dmg: '1d4+1', speed: 7, xp: 8, ranged: true, morale: 8, color: '#a04a3a', glyph: 'i', desc: 'A snickering knot of spite with bat wings.' });
mon({ id: 'gargoyle', name: 'Gargoyle', hd: 4, ac: 15, atk: 4, dmg: '1d6+2', speed: 6, xp: 20, morale: 11, color: '#6a6a72', glyph: 'G', desc: 'You were sure it was a statue. You were sure.' });
mon({ id: 'vel_zaruk', name: 'Vel Zaruk the Undying', hd: 8, ac: 16, atk: 6, dmg: '2d6+2', speed: 5, xp: 120, ranged: true, undead: true, morale: 12, color: '#7a4a9a', glyph: 'V', desc: 'The sorcerer who built the Spire, and refused to leave it. Even in death.' });

// ============================================================ ENCOUNTER TABLES (overworld travel, by tier)

export interface EncounterEntry { defId: string; count: string; }
export const ENCOUNTERS: Record<number, EncounterEntry[]> = {
  1: [
    { defId: 'giant_rat', count: '2d4' },
    { defId: 'goblin', count: '1d4+1' },
    { defId: 'bandit', count: '1d4' },
    { defId: 'wolf', count: '1d4' },
  ],
  2: [
    { defId: 'goblin', count: '2d4' },
    { defId: 'wolf', count: '1d6' },
    { defId: 'giant_spider', count: '1d3' },
    { defId: 'cultist', count: '1d4+1' },
    { defId: 'ogre', count: '1' },
  ],
  3: [
    { defId: 'cult_fanatic', count: '1d2' },
    { defId: 'gargoyle', count: '1d2' },
    { defId: 'ogre', count: '1d2' },
    { defId: 'skeleton', count: '2d4' },
  ],
};

// Loot tables by tier: gold dice + possible bonus items (id, chance 0..1)
export const LOOT: Record<number, { gold: string; items: [string, number][] }> = {
  1: { gold: '2d6', items: [['torch', 0.3], ['potion_heal', 0.15], ['t_gem', 0.15], ['scroll_cure', 0.07]] },
  2: { gold: '4d6', items: [['potion_heal', 0.25], ['t_gem', 0.2], ['t_chalice', 0.15], ['scroll_mm', 0.1]] },
  3: { gold: '2d6+20', items: [['potion_heal_greater', 0.25], ['t_chalice', 0.2], ['t_idol', 0.15], ['t_crown', 0.05]] },
};

// ============================================================ WORLD MAP

export const WORLD: Record<string, WorldNode> = {};
function node(n: WorldNode) { WORLD[n.id] = n; }

node({ id: 'emberwick', name: 'Emberwick', kind: 'town', x: 0.30, y: 0.62, tier: 1, links: ['crossroads', 'whispering_hollow'], desc: 'A palisade town of peat smoke and lantern light — the last warm place before the dark country.' });
node({ id: 'crossroads', name: 'Gallows Crossroads', kind: 'landmark', x: 0.46, y: 0.52, tier: 1, links: ['emberwick', 'sunken_crypt', 'redtooth_warrens', 'old_bridge'], desc: 'A leaning signpost and an empty gibbet. Roads go everywhere people shouldn\'t.' });
node({ id: 'sunken_crypt', name: 'The Sunken Crypt', kind: 'dungeon', x: 0.62, y: 0.72, tier: 1, links: ['crossroads'], dungeonId: 'crypt', desc: 'The old chapel drowned in the fen a century ago. Its dead did not.' });
node({ id: 'redtooth_warrens', name: 'Redtooth Warrens', kind: 'dungeon', x: 0.68, y: 0.36, tier: 1, links: ['crossroads', 'weeping_mine'], dungeonId: 'warrens', desc: 'Goblin tunnels under a hill of scrub and bone-totems.' });
node({ id: 'whispering_hollow', name: 'Whispering Hollow', kind: 'cave', x: 0.14, y: 0.42, tier: 1, links: ['emberwick'], procgen: true, desc: 'A cave mouth in the birchwood. It never looks the same way twice.' });
node({ id: 'old_bridge', name: 'The Old Bridge', kind: 'landmark', x: 0.42, y: 0.28, tier: 2, links: ['crossroads', 'weeping_mine', 'black_delve', 'spire'], desc: 'Dwarf-cut stone over black water. The toll-keeper\'s hut is long empty.' });
node({ id: 'weeping_mine', name: 'The Weeping Mine', kind: 'dungeon', x: 0.60, y: 0.16, tier: 2, links: ['old_bridge', 'redtooth_warrens'], dungeonId: 'mine', desc: 'Abandoned mid-shift. Tools still lean where the miners left them, running.' });
node({ id: 'black_delve', name: 'The Black Delve', kind: 'cave', x: 0.22, y: 0.18, tier: 2, links: ['old_bridge'], procgen: true, desc: 'A crack in the moor that breathes cold air. It goes down, and down differently each time.' });
node({ id: 'spire', name: 'The Spire of Vel Zaruk', kind: 'dungeon', x: 0.86, y: 0.12, tier: 3, links: ['old_bridge'], dungeonId: 'spire', desc: 'A black needle against the sky. No bird will land on it.' });

export const QUESTS: Quest[] = [
  { id: 'q_crypt', title: 'The Chapel\'s Dead', desc: 'Father Ambrose pays 100gp to lay the Pale Abbot of the Sunken Crypt to rest. "He rings the bell at night. There is no bell."', target: 'boss_crypt', reward: 100, done: false, paid: false },
  { id: 'q_warrens', title: 'Redtooth\'s Raids', desc: 'The town council offers 150gp for the head of Redtooth, the goblin king raiding the east farms.', target: 'boss_warrens', reward: 150, done: false, paid: false },
  { id: 'q_mine', title: 'The Weeping in the Deep', desc: 'The Miners\' Guild offers 300gp to whoever silences whatever weeps at the bottom of the mine. They will not go back down.', target: 'boss_mine', reward: 300, done: false, paid: false },
  { id: 'q_spire', title: 'The Spire\'s Shadow', desc: 'The shadow of the Spire grows an inch each week, and things move inside it. 600gp — everything Emberwick has — to end Vel Zaruk forever.', target: 'boss_spire', reward: 600, done: false, paid: false },
];

// ============================================================ HANDCRAFTED DUNGEONS
// Legend: # wall · . floor · + door · L locked door · S secret door · < entrance
// C chest · T hidden trap · B brazier · A altar · ~ water · % rubble · space void
// digits 1-9 = monster group markers (see groups list)

export interface DungeonDef {
  name: string;
  theme: 'crypt' | 'warren' | 'mine' | 'spire' | 'cave';
  tier: number;
  map: string[];
  groups: Record<string, { defId: string; count: string; boss?: boolean }>;
  notes?: Record<string, string>;   // "x,y" -> GM narration on arrival
  intro: string;
}

export const DUNGEONS: Record<string, DungeonDef> = {
  crypt: {
    name: 'The Sunken Crypt',
    theme: 'crypt',
    tier: 1,
    intro: 'Stone steps descend into water-smell and old incense. Somewhere below, faintly, a bell that is not there is ringing.',
    map: [
      '##########################',
      '#B...+....#....C#...2..A.#',
      '#....#....#.~~~.#........#',
      '#..1.#....+.~~~.S....3...#',
      '#.........#.....#........#',
      '#####+#####.....##########',
      '#........####+###.....#B.#',
      '#..C........4...+..T...C.#',
      '#.....###.......#......#.#',
      '####+####..###..####S#####',
      '#..T....#...B#..#........#',
      '#.5.....+..###..+...6.C..#',
      '#........#..7...#........#',
      '#############<############',
    ],
    groups: {
      '1': { defId: 'giant_rat', count: '2d3' },
      '2': { defId: 'skeleton', count: '3' },
      '3': { defId: 'crypt_wight', count: '1', boss: true },
      '4': { defId: 'zombie', count: '2' },
      '5': { defId: 'skeleton', count: '2' },
      '6': { defId: 'zombie', count: '3' },
      '7': { defId: 'giant_rat', count: '1d4' },
    },
    notes: {
      '22,11': 'Coffin niches line the walls here, all of them broken open — from the inside.',
      '12,2': 'Black fenwater has flooded the chapel floor. Something pale moves beneath it, or perhaps it is only your torch.',
      '23,1': 'An altar of Saint Maren, defiled with grave-soil. A prayer might yet clean it.',
    },
  },

  warrens: {
    name: 'Redtooth Warrens',
    theme: 'warren',
    tier: 1,
    intro: 'The tunnel reeks of wet dog and woodsmoke. Crude totems of bone and red feathers rattle as you pass.',
    map: [
      '##########################',
      '#...2....#####....3......#',
      '#..%.....+...+...%%..C...#',
      '#........#...#...........#',
      '####+#####...####+########',
      '#..1..#......#....5....#T#',
      '#.....+..%...+.........+.#',
      '#..C..#......#..%%..4..#.#',
      '########......#........#.#',
      '#..7..#..6...##S##########',
      '#.....+......#....C....#.#',
      '#..%..#......#..8......+.#',
      '#.....#......#.........#.#',
      '#########<################',
    ],
    groups: {
      '1': { defId: 'goblin', count: '3' },
      '2': { defId: 'goblin_archer', count: '2' },
      '3': { defId: 'warg', count: '2' },
      '4': { defId: 'redtooth', count: '1', boss: true },
      '5': { defId: 'goblin', count: '4' },
      '6': { defId: 'goblin', count: '2' },
      '7': { defId: 'giant_rat', count: '2d3' },
      '8': { defId: 'goblin_archer', count: '2' },
    },
    notes: {
      '17,5': 'A throne of stolen chairs nailed together. Farm goods from the east raids are piled as tribute.',
      '3,9': 'A goblin larder. You decide, firmly, not to identify the meat.',
    },
  },

  mine: {
    name: 'The Weeping Mine',
    theme: 'mine',
    tier: 2,
    intro: 'Pit-props groan overhead. Down the main shaft, past the abandoned carts, you can hear it: a slow, patient sobbing.',
    map: [
      '############################',
      '#T....#....2....#.....C....#',
      '#.....+....##...S...%......#',
      '#..1..#....##...#......3...#',
      '#.....#....##...############',
      '###+###....##......+.......#',
      '#......%...##......#..4....#',
      '#..C...%...####+####.......#',
      '#......%......~~...#...C...#',
      '####+#########~~...####+####',
      '#.5......#....~~...#.......#',
      '#........+....~~...+...6...#',
      '#..T..C..#.7..~~...#.....B.#',
      '#........#....~~...#.......#',
      '#############<##############',
    ],
    groups: {
      '1': { defId: 'giant_spider', count: '2' },
      '2': { defId: 'cultist', count: '3' },
      '3': { defId: 'cult_fanatic', count: '1' },
      '4': { defId: 'deep_crawler', count: '1', boss: true },
      '5': { defId: 'giant_spider', count: '1d3' },
      '6': { defId: 'cultist', count: '2' },
      '7': { defId: 'zombie', count: '2' },
    },
    notes: {
      '14,8': 'The shaft floods here with black, still water. The sobbing is louder. It comes from everywhere.',
      '22,6': 'The walls of this gallery are scratched with the same words, hundreds of times: IT ONLY WANTS COMPANY.',
      '11,12': 'Miners\' remains, arranged with terrible care into a circle, all facing inward.',
    },
  },

  spire: {
    name: 'The Spire of Vel Zaruk',
    theme: 'spire',
    tier: 3,
    intro: 'The doors open before you touch them. Inside, the air is dry as parchment and the silence has weight. Far above, something laughs like turning pages.',
    map: [
      '##########################',
      '#....C..#..2....#..C.....#',
      '#..1....+.......L....3...#',
      '#....#..#....B..#........#',
      '#....#..######+###S#######',
      '#.B..#..#........#....B..#',
      '####+####...4....#..5....#',
      '#.......L........+.......#',
      '#...6...#....~...#..C....#',
      '#.......##########T#######',
      '####+#######..######...#B#',
      '#..T....#..#..#....+.7...#',
      '#.C.....+..+..+..8.#.....#',
      '#..........#..#....#..C..#',
      '#############<############',
    ],
    groups: {
      '1': { defId: 'animated_armor', count: '2' },
      '2': { defId: 'imp', count: '3' },
      '3': { defId: 'vel_zaruk', count: '1', boss: true },
      '4': { defId: 'gargoyle', count: '2' },
      '5': { defId: 'skeleton', count: '4' },
      '6': { defId: 'animated_armor', count: '1' },
      '7': { defId: 'imp', count: '2' },
      '8': { defId: 'gargoyle', count: '1' },
    },
    notes: {
      '13,8': 'A scrying pool. In its surface you see, briefly, your own party — seen from above, right now.',
      '9,1': 'A library where every book has the same title: what you fear most. You do not open one.',
      '21,2': 'The inner sanctum. The dry-parchment laughter stops, which is worse.',
    },
  },
};

// ============================================================ NAMES & FLAVOR

export const NAMES: Record<string, string[]> = {
  Human: ['Aldric', 'Berta', 'Cedric', 'Doria', 'Edwin', 'Greta', 'Hamond', 'Isolde', 'Jorik', 'Maren', 'Odo', 'Petra', 'Rowan', 'Sabel', 'Tomas', 'Wenna'],
  Elf: ['Aelwen', 'Caeril', 'Elandril', 'Faelar', 'Ilyana', 'Loriel', 'Myrren', 'Sylvas', 'Thalia', 'Vaeril'],
  Dwarf: ['Bardin', 'Dagna', 'Grim', 'Helga', 'Kettil', 'Morgrim', 'Orsik', 'Runa', 'Thrain', 'Vera'],
  Halfling: ['Bram', 'Cora', 'Dell', 'Fenn', 'Hattie', 'Milo', 'Nim', 'Posy', 'Tuck', 'Wilba'],
  Goblin: ['Grix', 'Nark', 'Pib', 'Reeza', 'Skint', 'Toad', 'Vex', 'Yip', 'Zeb'],
};

export const ANCESTRIES: { name: 'Human' | 'Elf' | 'Dwarf' | 'Halfling' | 'Goblin'; perk: string }[] = [
  { name: 'Human', perk: 'Ambitious: +1 to one stat, learns fast (+10% XP).' },
  { name: 'Elf', perk: 'Farsight: advantage on search checks.' },
  { name: 'Dwarf', perk: 'Stout: +2 starting HP, advantage vs. poison.' },
  { name: 'Halfling', perk: 'Lucky: reroll one fumble per combat.' },
  { name: 'Goblin', perk: 'Keen dark-sense: sees 1 tile even without light.' },
];

export const TRAVEL_FLAVOR = [
  'Crows follow you for a mile, then lose interest.',
  'The road is mud and old cart-ruts. It rains, briefly, without conviction.',
  'You pass a shrine of stacked stones. Someone has left a child\'s shoe as an offering.',
  'A merchant\'s wagon passes the other way, driver whipping the horses harder than he needs to.',
  'Smoke on the horizon. By the time you crest the hill, it\'s gone.',
  'The wind carries a sound like singing. None of you mentions it.',
];

export const TOWN_FLAVOR = [
  'Emberwick\'s lanterns are already lit against the afternoon grey.',
  'A town crier announces, without enthusiasm, that all is well.',
  'Children play at monster-slaying in the mud. One of them plays the monster too well.',
  'The gate-guard nods you through. "Back in one piece. That\'s the trick, isn\'t it."',
];
