// Static game data: goods, recipes, buildings, tuning constants.

export const TILE_W = 64;
export const TILE_H = 32;
export const GRID = 14;          // grid is GRID x GRID tiles
export const DAY_LENGTH = 45;    // seconds of game time per day
export const BELT_SPEED = 1.4;   // tiles per second
export const START_CASH = 1000;
export const WIN_CASH = 10000;
export const HIRE_BONUS = 100;   // one-off signing bonus when hiring
export const DEMOLISH_REFUND = 0.5;

// dir: 0 = +x, 1 = +y, 2 = -x, 3 = -y (grid axes, drawn isometrically)
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export const GOODS = {
  parts:  { name: 'Parts',   color: '#7fb2e5', sell: 5,   buy: 8,  raw: true },
  chips:  { name: 'Chips',   color: '#7ee0a3', sell: 14,  buy: 20, raw: true },
  widget: { name: 'Widgets', color: '#f2c14e', sell: 42 },
  gadget: { name: 'Gadgets', color: '#e8646f', sell: 130 },
};

export const RECIPES = {
  assembler: { inputs: { parts: 2 },             output: 'widget', time: 4 },
  fab:       { inputs: { widget: 1, chips: 1 },  output: 'gadget', time: 6 },
};

export const BUILDINGS = {
  belt: {
    name: 'Conveyor', cost: 10, height: 5,
    desc: 'Moves goods one tile at a time in the direction it faces.',
  },
  depot_parts: {
    name: 'Parts Depot', cost: 150, height: 26, good: 'parts', interval: 2.5,
    desc: 'Imports raw parts (you pay the market buy price per unit) onto the conveyor it faces.',
  },
  depot_chips: {
    name: 'Chips Depot', cost: 250, height: 26, good: 'chips', interval: 4,
    desc: 'Imports chips (you pay the market buy price per unit) onto the conveyor it faces.',
  },
  assembler: {
    name: 'Assembler', cost: 300, height: 30, recipe: 'assembler', needsWorker: true,
    desc: '2 Parts → 1 Widget. Needs a worker. Outputs onto the conveyor it faces.',
  },
  fab: {
    name: 'Fabricator', cost: 600, height: 34, recipe: 'fab', needsWorker: true,
    desc: '1 Widget + 1 Chip → 1 Gadget. Needs a worker. Outputs onto the conveyor it faces.',
  },
  dock: {
    name: 'Shipping Dock', cost: 200, height: 12, dock: true,
    desc: 'Sells anything delivered to it at the current market price.',
  },
};

export const WORKER_NAMES = [
  'Ada', 'Grace', 'Linus', 'Marge', 'Hank', 'Yuki', 'Priya', 'Omar',
  'Sofia', 'Dmitri', 'June', 'Carlos', 'Wren', 'Kofi', 'Elena', 'Bao',
];
