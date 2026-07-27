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

export const PRODUCTS = {
  produce: { name: 'Produce', color: '#6fd08c', cost: 1.2, retail: 2.4, weight: 0.24, spoil: 0.10 },
  dairy:   { name: 'Dairy',   color: '#9ec7ef', cost: 1.5, retail: 2.6, weight: 0.18, spoil: 0.06 },
  bakery:  { name: 'Bakery',  color: '#e0b070', cost: 0.8, retail: 1.9, weight: 0.14, spoil: 0.15 },
  meat:    { name: 'Meat',    color: '#e8828c', cost: 3.5, retail: 6.0, weight: 0.12, spoil: 0.08 },
  frozen:  { name: 'Frozen',  color: '#7fd8e0', cost: 2.0, retail: 3.4, weight: 0.12, spoil: 0 },
  pantry:  { name: 'Pantry',  color: '#c8b28a', cost: 1.0, retail: 2.0, weight: 0.20, spoil: 0 },
};

// Vendors: priceMult scales product base cost; quality feeds store reputation;
// leadTime is days from order to warehouse arrival.
export const VENDORS = {
  freshfields: {
    name: 'FreshFields Farms', products: ['produce', 'dairy'],
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
    name: 'Consolidated Goods', products: ['pantry', 'frozen', 'dairy'],
    priceMult: 0.88, quality: 0.75, leadTime: 3,
    blurb: 'National distributor. Cheap and slow; quality is… fine.',
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

export const PEOPLE_NAMES = [
  'Ada Okafor', 'Grace Lindqvist', 'Marge Devine', 'Hank Solano', 'Yuki Tanaka',
  'Priya Raman', 'Omar Haddad', 'Sofia Reyes', 'Dmitri Volkov', 'June Park',
  'Carlos Mendes', 'Wren Ashby', 'Kofi Mensah', 'Elena Vasquez', 'Bao Nguyen',
];
