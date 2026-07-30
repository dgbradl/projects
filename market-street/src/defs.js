// Static game data: products, vendors, city map, districts, tuning constants.

export const TILE_W = 52;
export const TILE_H = 26;
export const GRID = 24;            // city is GRID x GRID tiles
export const DAY_LENGTH = 10;      // real seconds per game day at 1x
export const START_CASH = 25000;
export const WIN_CASH = 200000;
export const WIN_STORES = 8;

export const POP_FACTOR = 0.16;    // units of demand per resident per day
export const SHELF_CAP = 60;       // per product, per store
export const STAFF_WAGE = 28;      // per store staffer per day
export const HIRE_ROLE_COST = 200; // signing bonus for HQ department heads
export const TRUCK_COST = 4000;
export const TRUCK_CAP = 110;      // units per trip (before logistics bonus)
export const TRUCK_SPEED = 110;    // road tiles per day (before logistics bonus)
export const WAREHOUSE_CAP = 1500;
export const WAREHOUSE_UPGRADE = { units: 1000, cost: 8000 };
export const WAREHOUSE = { x: 11, y: 11 };

// Roads run every 4th tile in both directions.
export const isRoad = (x, y) => x % 4 === 0 || y % 4 === 0;

// `core: true` products are what every new store carries on day one.
// The rest are optional lines you add per store — if it has the shelf slots.
export const PRODUCTS = {
  produce:   { name: 'Produce',   color: '#6fd08c', cost: 1.2, retail: 2.4, weight: 0.24, spoil: 0.10, core: true },
  dairy:     { name: 'Dairy',     color: '#9ec7ef', cost: 1.5, retail: 2.6, weight: 0.18, spoil: 0.06, core: true },
  bakery:    { name: 'Bakery',    color: '#e0b070', cost: 0.8, retail: 1.9, weight: 0.14, spoil: 0.15, core: true },
  meat:      { name: 'Meat',      color: '#e8828c', cost: 3.5, retail: 6.0, weight: 0.12, spoil: 0.08, core: true },
  frozen:    { name: 'Frozen',    color: '#7fd8e0', cost: 2.0, retail: 3.4, weight: 0.12, spoil: 0,    core: true },
  pantry:    { name: 'Pantry',    color: '#c8b28a', cost: 1.0, retail: 2.0, weight: 0.20, spoil: 0,    core: true },
  beverages: { name: 'Beverages', color: '#b28ae0', cost: 0.9, retail: 1.9, weight: 0.14, spoil: 0 },
  snacks:    { name: 'Snacks',    color: '#f0a05a', cost: 0.7, retail: 1.7, weight: 0.12, spoil: 0 },
  household: { name: 'Household', color: '#a8b8c8', cost: 1.4, retail: 2.3, weight: 0.10, spoil: 0 },
  deli:      { name: 'Deli',      color: '#e0a8c0', cost: 2.2, retail: 4.2, weight: 0.10, spoil: 0.12 },
  seafood:   { name: 'Seafood',   color: '#6fa8d0', cost: 3.0, retail: 5.6, weight: 0.08, spoil: 0.18 },
};

export const START_SLOTS = 6;      // product lines a fresh store can carry
export const REMODEL = { slots: 2, baseCost: 2500, stepCost: 1800 };

// Vendors: priceMult scales product base cost; quality feeds store reputation;
// leadTime is days from order to warehouse arrival.
export const VENDORS = {
  freshfields: {
    name: 'FreshFields Farms', products: ['produce', 'dairy', 'deli'],
    priceMult: 1.0, quality: 0.95, leadTime: 1,
    blurb: 'Local farms. Fast and fresh, but they know their worth.',
  },
  bakersguild: {
    name: "Baker's Guild", products: ['bakery'],
    priceMult: 0.95, quality: 1.0, leadTime: 1,
    blurb: 'Artisan co-op. Small batches, loyal once you earn their trust.',
  },
  ironox: {
    name: 'Iron Ox Meats', products: ['meat', 'frozen'],
    priceMult: 1.05, quality: 1.1, leadTime: 2,
    blurb: 'Premium cuts and cold chain. Pricey, but customers notice.',
  },
  consolidated: {
    name: 'Consolidated Goods',
    products: ['pantry', 'frozen', 'dairy', 'beverages', 'snacks', 'household'],
    priceMult: 0.88, quality: 0.75, leadTime: 3,
    blurb: 'National distributor. Cheap and slow; quality is… fine. The only source for household goods.',
  },
  vista: {
    name: 'Vista Beverage Co.', products: ['beverages', 'snacks'],
    priceMult: 0.92, quality: 0.85, leadTime: 2,
    blurb: 'Regional drinks & snacks distributor. Solid prices, decent speed.',
  },
  harborfresh: {
    name: 'Harbor Fresh', products: ['seafood', 'deli'],
    priceMult: 1.1, quality: 1.2, leadTime: 1,
    blurb: 'Dockside daily catch. Expensive, spoils fast, sells itself.',
  },
};

export const DISTRICTS = [
  { id: 'oldtown',   name: 'Old Town',  unlock: 0,      rect: [0, 0, 12, 12],   phase: 'Your neighborhood' },
  { id: 'westside',  name: 'Westside',  unlock: 35000,  rect: [12, 0, 24, 12],  phase: 'Across town' },
  { id: 'riverside', name: 'Riverside', unlock: 65000,  rect: [0, 12, 12, 24],  phase: 'Citywide' },
  { id: 'downtown',  name: 'Downtown',  unlock: 110000, rect: [12, 12, 24, 24], phase: 'The big leagues' },
];

// Store sites. Every site tile touches a road. `owned: true` = starting stores.
export const SITES = [
  { id: 's1',  x: 2,  y: 3,  district: 'oldtown',   pop: 900,  price: 8000,  rent: 40,  owned: true },
  { id: 's2',  x: 6,  y: 7,  district: 'oldtown',   pop: 1000, price: 8500,  rent: 45,  owned: true },
  { id: 's3',  x: 9,  y: 2,  district: 'oldtown',   pop: 850,  price: 7500,  rent: 38 },
  { id: 's4',  x: 3,  y: 10, district: 'oldtown',   pop: 950,  price: 8200,  rent: 42 },
  { id: 's5',  x: 14, y: 3,  district: 'westside',  pop: 1400, price: 16000, rent: 80 },
  { id: 's6',  x: 18, y: 7,  district: 'westside',  pop: 1500, price: 17500, rent: 85 },
  { id: 's7',  x: 21, y: 10, district: 'westside',  pop: 1600, price: 19000, rent: 95 },
  { id: 's8',  x: 3,  y: 14, district: 'riverside', pop: 1800, price: 26000, rent: 115 },
  { id: 's9',  x: 7,  y: 18, district: 'riverside', pop: 1900, price: 28000, rent: 120 },
  { id: 's10', x: 10, y: 21, district: 'riverside', pop: 2000, price: 30000, rent: 130 },
  { id: 's11', x: 14, y: 15, district: 'downtown',  pop: 2600, price: 45000, rent: 175 },
  { id: 's12', x: 19, y: 18, district: 'downtown',  pop: 2800, price: 48000, rent: 185 },
  { id: 's13', x: 15, y: 21, district: 'downtown',  pop: 2700, price: 46000, rent: 180 },
  { id: 's14', x: 22, y: 21, district: 'downtown',  pop: 3000, price: 52000, rent: 200 },
];

// Chain-wide delegations, unlocked by hiring the matching department head.
// Each is a decision the player can hand off; skill governs quality/cadence.
export const DELEGATIONS = {
  negotiate: {
    role: 'buyer', name: 'Negotiate with vendors', defaultOn: true,
    desc: 'Works one vendor per day toward better rates.',
  },
  sourcing: {
    role: 'buyer', name: 'Choose vendors', defaultOn: true,
    desc: 'Switches suppliers for price (and, if skilled, quality) — and re-sources around strikes.',
  },
  reorders: {
    role: 'buyer', name: 'Tune standing orders', defaultOn: true,
    desc: 'Sets reorder points and quantities from measured demand.',
  },
  fleet: {
    role: 'logistics', name: 'Plan fleet & warehouse', defaultOn: false,
    desc: 'Buys trucks when stores run dry and expands a chronically full warehouse. Spends real money.',
  },
};

// HQ department heads. Effects scale with skill (1–3 stars).
export const ROLES = {
  buyer: {
    name: 'Head Buyer',
    desc: 'Negotiates harder and shaves 2% off all vendor prices per ★.',
  },
  logistics: {
    name: 'Logistics Manager',
    desc: 'Trucks carry 18% more and drive 18% faster per ★.',
  },
  marketing: {
    name: 'Marketing Lead',
    desc: 'Chain-wide customer demand +6% per ★.',
  },
};

export const MANAGER_SALARY = 45;  // per ★, per day

// Random city events. Duration in days ([min,max]); instant events resolve on spawn.
export const EVENTS = {
  cold_snap: {
    icon: '❄️', name: 'Cold snap', dur: [2, 4],
    desc: 'Frozen +80%, dairy +30%, produce −15% demand while it lasts.',
  },
  heat_wave: {
    icon: '🔥', name: 'Heat wave', dur: [2, 3],
    desc: 'Frozen +60% and beverages +50% demand, but perishables spoil twice as fast.',
  },
  strike: {
    icon: '✊', name: 'Vendor strike', dur: [2, 4],
    desc: 'This vendor ships nothing until it ends. Source elsewhere!',
  },
  roadworks: {
    icon: '🚧', name: 'Road construction', dur: [2, 4],
    desc: 'Trucks crawl at 60% speed citywide.',
  },
  festival: {
    icon: '🎪', name: 'Street festival', dur: [1, 2],
    desc: 'Stores in this district see +60% demand. Stock up!',
  },
  price_war: {
    icon: '⚔️', name: 'Price war', dur: [3, 5],
    desc: 'A discounter undercuts this district: demand −35% unless your prices are ≤ 90%.',
  },
  inspection: {
    icon: '🧾', name: 'Health inspection', instant: true,
    desc: 'A surprise inspection — well-run stores pass, understaffed ones get fined.',
  },
  fridge: {
    icon: '🧊', name: 'Fridge breakdown', instant: true,
    desc: 'A store loses half its dairy, meat, and frozen stock.',
  },
};

// One trait per candidate, drawn from their role's list. Every trait has a
// real mechanical effect (wired in game.js).
export const TRAITS = {
  buyer: [
    { id: 'haggler', name: 'Haggler', desc: '+8% negotiation success' },
    { id: 'pennypincher', name: 'Penny-pincher', desc: 'All goods cost 1.5% less' },
    { id: 'connected', name: 'Well-connected', desc: 'All vendor relationships +1/day' },
  ],
  logistics: [
    { id: 'speedster', name: 'Speed demon', desc: 'Trucks 10% faster' },
    { id: 'tetris', name: 'Tetris master', desc: 'Trucks carry 10% more' },
    { id: 'planner', name: 'Route planner', desc: 'Trucks 5% faster and 5% bigger' },
  ],
  marketing: [
    { id: 'adwizard', name: 'Ad wizard', desc: 'Chain demand +3%' },
    { id: 'localhero', name: 'Local hero', desc: 'Store reputations rise faster' },
    { id: 'couponer', name: 'Couponer', desc: 'High prices scare off 20% fewer shoppers' },
  ],
  manager: [
    { id: 'motivator', name: 'Motivator', desc: 'Team morale +8%' },
    { id: 'shelfhawk', name: 'Shelf hawk', desc: 'Store spoilage −25%' },
    { id: 'peopleperson', name: 'People person', desc: 'Reputation rises faster here' },
  ],
};

export const PEOPLE_NAMES = [
  'Ada Okafor', 'Grace Lindqvist', 'Marge Devine', 'Hank Solano', 'Yuki Tanaka',
  'Priya Raman', 'Omar Haddad', 'Sofia Reyes', 'Dmitri Volkov', 'June Park',
  'Carlos Mendes', 'Wren Ashby', 'Kofi Mensah', 'Elena Vasquez', 'Bao Nguyen',
];
