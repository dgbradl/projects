// Global game state, save/load, and the refresh hook that decouples
// game modules from the UI layer.
import type { GameState } from './types';
import { QUESTS, SHOP_STOCK } from './data';
import { generateParty, generateCharacter } from './rules';
import { seedRng, rngState, randInt } from './rng';

export const SAVE_KEY = 'dark-beneath-save-v1';

// Set by main.ts; called by any module after mutating state.
export const hooks = {
  refresh: () => {},
  render: () => {},
};

export let G: GameState = null as unknown as GameState;

export function setState(s: GameState) {
  G = s;
}

export function newGame(party?: GameState['party']): GameState {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  seedRng(seed);
  const s: GameState = {
    mode: 'town',
    seed,
    party: party ?? generateParty(),
    graveyard: [],
    gold: 30,
    torches: 5,
    torchLit: false,
    torchLeft: 0,
    rations: 6,
    location: 'emberwick',
    day: 1,
    dungeon: null,
    dungeonSaves: {},
    combat: null,
    quests: QUESTS.map(q => ({ ...q })),
    flags: {},
    recruits: [generateCharacter(), generateCharacter()],
    shopStock: SHOP_STOCK.slice(),
    uidCounter: 1,
  };
  setState(s);
  return s;
}

export function nextUid(): number {
  return G.uidCounter++;
}

export function saveGame(): boolean {
  try {
    // combat is transient — never persist mid-fight
    const { combat, ...rest } = G;
    const payload = { ...rest, combat: null, mode: G.mode === 'combat' ? 'dungeon' : G.mode, rng: rngState() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    const { rng, ...stateData } = data;
    setState(stateData as GameState);
    seedRng(rng ?? data.seed ?? randInt(1, 0x7fffffff));
    return true;
  } catch {
    return false;
  }
}

export function hasSave(): boolean {
  return !!localStorage.getItem(SAVE_KEY);
}
