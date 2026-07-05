// Core type definitions for The Dark Beneath.
// No imports here — every other module depends on this one.

export type Stat = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export const STATS: Stat[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export type ClassName = 'Fighter' | 'Thief' | 'Priest' | 'Wizard';
export type Ancestry = 'Human' | 'Elf' | 'Dwarf' | 'Halfling' | 'Goblin';

export type ItemKind =
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'torch'
  | 'potion'
  | 'scroll'
  | 'gear'
  | 'treasure';

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  slots: number;          // gear slots occupied
  cost: number;           // gp
  dmg?: string;           // e.g. "1d8"
  twoHanded?: boolean;
  ranged?: boolean;
  finesse?: boolean;      // may use DEX to attack
  ac?: number;            // armor: base AC; shield: bonus
  noDex?: boolean;        // heavy armor ignores DEX
  heals?: string;         // potion healing dice
  spell?: string;         // scroll spell id
  value?: number;         // treasure sale value
  desc?: string;
}

export interface SpellDef {
  id: string;
  name: string;
  tier: number;
  cls: 'Priest' | 'Wizard';
  target: 'enemy' | 'ally' | 'self' | 'area' | 'all-enemies';
  range: number;          // tiles; 0 = self/touch
  desc: string;
}

export interface Character {
  id: string;
  name: string;
  ancestry: Ancestry;
  cls: ClassName;
  level: number;
  xp: number;
  stats: Record<Stat, number>;
  hp: number;
  maxHp: number;
  // Spells known -> true if still available today (Shadowdark-style: lost on a bad casting check until rest)
  spells: Record<string, boolean>;
  gear: Item[];
  weapon?: Item;
  armor?: Item;
  shield?: Item;
  alive: boolean;
  // combat-transient
  dyingRounds?: number;   // rounds until death when downed; undefined = not dying
  blessed?: boolean;
  epitaph?: string;       // how they died
}

export interface MonsterDef {
  id: string;
  name: string;
  hd: number;             // hit dice (d8)
  ac: number;
  atk: number;            // attack bonus
  dmg: string;
  speed: number;
  xp: number;
  ranged?: boolean;
  undead?: boolean;
  morale: number;         // 2d6 roll-under target; 12 = fearless
  color: string;          // token color
  glyph: string;          // token letter
  desc: string;
}

export interface MonsterInst {
  uid: number;
  def: MonsterDef;
  hp: number;
  x: number;
  y: number;
  fled?: boolean;
  rooted?: number;        // rounds webbed in place
  asleep?: boolean;
}

// ---------- World ----------

export type Mode = 'title' | 'chargen' | 'town' | 'overworld' | 'dungeon' | 'combat' | 'gameover';

export interface WorldNode {
  id: string;
  name: string;
  kind: 'town' | 'dungeon' | 'cave' | 'landmark';
  x: number;              // position on overworld canvas (0..1 relative)
  y: number;
  tier: number;           // danger tier of surrounding region
  desc: string;
  links: string[];        // connected node ids
  dungeonId?: string;     // handcrafted dungeon key
  procgen?: boolean;      // regenerating cave site
}

export type TileType =
  | 'wall' | 'floor' | 'door' | 'locked' | 'secret'
  | 'exit' | 'stairs' | 'chest' | 'trap' | 'brazier' | 'altar' | 'water' | 'rubble';

export interface Tile {
  t: TileType;
  seen: boolean;          // ever revealed
  open?: boolean;         // doors
  found?: boolean;        // secret door / trap discovered
  looted?: boolean;       // chest opened / altar used / trap sprung
  loot?: string;          // loot table key or item id
}

export interface DungeonMonsterGroup {
  uid: number;
  defId: string;
  count: number;
  x: number;
  y: number;
  alerted?: boolean;
  boss?: boolean;
  dead?: boolean;
}

export interface DungeonState {
  id: string;             // world node id
  name: string;
  w: number;
  h: number;
  tiles: Tile[];          // w*h
  px: number;             // party position
  py: number;
  groups: DungeonMonsterGroup[];
  level: number;          // current depth (for multi-floor later)
  tier: number;
  theme: 'crypt' | 'warren' | 'mine' | 'spire' | 'cave';
  notes: Record<string, string>; // positional notes "x,y" -> text shown on arrival
}

// ---------- Combat ----------

export interface Combatant {
  kind: 'pc' | 'monster';
  pc?: Character;
  mon?: MonsterInst;
  init: number;
  x: number;
  y: number;
  moves: number;          // movement points left this turn
  acted?: boolean;
}

export interface CombatState {
  w: number;
  h: number;
  walls: boolean[];       // obstacle tiles
  order: Combatant[];
  turn: number;           // index into order
  round: number;
  over: boolean;
  fleeing?: boolean;
  theme: string;
  surprise?: 'party' | 'monsters';
  groupUid?: number;      // dungeon group this fight came from
  travel?: boolean;       // overworld random encounter
}

// ---------- Quests ----------

export interface Quest {
  id: string;
  title: string;
  desc: string;
  target: string;         // flag that completes it
  reward: number;         // gp
  done: boolean;
  paid: boolean;
}

// ---------- Root state ----------

export interface GameState {
  mode: Mode;
  seed: number;
  party: Character[];
  graveyard: Character[];
  gold: number;
  torches: number;        // spare torches (party pool)
  torchLit: boolean;
  torchLeft: number;      // turns remaining on the lit torch
  rations: number;
  location: string;       // current world node id
  day: number;
  dungeon: DungeonState | null;
  dungeonSaves: Record<string, DungeonState>;  // cleared-state persistence for authored dungeons
  combat: CombatState | null;
  quests: Quest[];
  flags: Record<string, boolean>;
  recruits: Character[];  // available at the tavern (refreshes on rest)
  shopStock: string[];    // item ids
  uidCounter: number;
}
