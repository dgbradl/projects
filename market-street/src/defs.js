// Static game data: products, vendors, city map, districts, tuning constants.

export const TILE_W = 52;
export const TILE_H = 26;
export const GRID = 24;            // city is GRID x GRID tiles
export const DAY_LENGTH = 10;      // real seconds per game day at 1x
export const START_CASH = 25000;
export const WIN_CASH = 200000;
export const WIN_STORES = 8;

export const POP_FACTOR = 0.18;    // units of demand per resident per day
export const SHELF_CAP = 60;       // per product, per store
export const STAFF_WAGE = 28;      // per store staffer per day
export const HIRE_ROLE_COST = 200; // signing bonus for HQ department heads
export const TRUCK_UNLOAD = 0.08; // days a truck spends parked at the store unloading
export const TRUCK_COST = 4000;
export const TRUCK_CAP = 125;      // units per trip (before logistics bonus)
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

// The calendar: four seasons per year, each with demand, spoilage, trucking,
// and procurement effects. Day 1 is the first day of spring.
export const SEASON_DAYS = 28;
export const SEASONS = [
  {
    id: 'spring', name: 'Spring', icon: '🌱',
    demand: { produce: 1.15, bakery: 1.05 },
    spoil: 1.0, truck: 1.0, cost: { produce: 0.95 },
  },
  {
    id: 'summer', name: 'Summer', icon: '☀️',
    demand: { beverages: 1.35, frozen: 1.25, seafood: 1.15, produce: 1.1, bakery: 0.9 },
    spoil: 1.25, truck: 1.0, cost: { produce: 0.9 },
  },
  {
    id: 'fall', name: 'Fall', icon: '🍂',
    demand: { pantry: 1.15, bakery: 1.1, produce: 1.05 },
    spoil: 1.0, truck: 1.0, cost: { produce: 0.85 },
  },
  {
    id: 'winter', name: 'Winter', icon: '❄️',
    demand: { pantry: 1.2, meat: 1.1, dairy: 1.05, frozen: 0.9, beverages: 0.85 },
    spoil: 0.85, truck: 0.85, cost: { produce: 1.2 },
  },
];
export const YEAR_DAYS = SEASONS.length * SEASON_DAYS;

// Holidays: day-of-year windows with demand surges, announced ahead of time
// so you can stock up against vendor lead times.
export const HOLIDAY_ANNOUNCE = 5;
export const HOLIDAYS = [
  {
    id: 'spring_fest', name: 'Spring Festival', icon: '🌸', start: 19, days: 3,
    demand: { produce: 1.4, bakery: 1.4, beverages: 1.2 },
    tip: 'produce and bakery',
    desc: 'Flowers, picnics, fresh bread.',
  },
  {
    id: 'grill_day', name: 'Grill-Out Weekend', icon: '🍖', start: 42, days: 3,
    demand: { meat: 1.6, beverages: 1.4, snacks: 1.3 },
    tip: 'meat, beverages, and snacks',
    desc: 'The whole city fires up the barbecue.',
  },
  {
    id: 'harvest', name: 'Harvest Feast', icon: '🦃', start: 76, days: 4,
    all: 1.25, demand: { meat: 1.5, bakery: 1.4, produce: 1.3 },
    tip: 'everything — especially meat, bakery, and produce',
    desc: 'The biggest table of the year.',
  },
  {
    id: 'winterfest', name: 'Winterfest', icon: '🎁', start: 100, days: 5,
    all: 1.3, demand: { snacks: 1.5, beverages: 1.4, frozen: 1.2 },
    aftermathDays: 3, aftermath: 0.8,
    tip: 'everything — snacks and beverages most of all',
    desc: 'Gifts, gatherings, and groceries. A slump follows.',
  },
];

// Per-store equipment upgrades.
export const STORE_UPGRADES = {
  coldstorage: {
    name: 'Cold storage', cost: 3000, icon: '🧊',
    desc: 'Halves spoilage in this store. Pays for itself on deli & seafood.',
  },
  selfcheckout: {
    name: 'Self-checkout', cost: 4500, icon: '🤖',
    desc: 'Counts as one extra staffer, forever, without the wage.',
  },
};

// Supply contracts: commit to weekly volume for a locked-in discount.
export const CONTRACT = {
  days: 14,          // contract length
  discount: 0.20,    // flat price cut while active (replaces, not stacks)
  weeklyMin: 350,    // units you must order per 7 days
  penalty: 400,      // breach fee
  relRequired: 50,   // relationship needed to sign
};

// Dice negotiation: a push-your-luck table sat once per vendor per day.
// Roll a pool, keep what you like, press for more — every ⚠️ locks in, and
// blowing past the vendor's patience means they walk.
export const NEGO = {
  baseDice: 3,
  maxDice: 6,
  rolls: 3,                                    // first roll + two presses
  faces: ['lev', 'lev', 'good', 'good', 'warn', 'crit'],
  // Leverage totals (🤝=1, ✨=2) → discount step won at the table.
  tiers: [
    { lev: 6, disc: 0.06 },
    { lev: 4, disc: 0.04 },
    { lev: 2, disc: 0.02 },
  ],
  // Delivery stake: leverage buys a -1 day lead window instead of a discount.
  // Top tier also splits orders into two half-shipments (first half early).
  deliveryTiers: [
    { lev: 6, days: 28, split: true },
    { lev: 4, days: 14 },
    { lev: 2, days: 7 },
  ],
  meetingsPerWeek: 3,  // sittings per week (Head Buyer adds more)
  decayPerWeek: 0.01,  // negotiated discounts age without maintenance
  riderChance: 0.55,   // odds a price counter carries a volume rider
  riderBonus: 0.02,    // extra discount the rider pays...
  riderDays: 7,        // ...if you order the committed volume in time
  riderRelFail: 6,     // relationship cost of blowing the commitment
  courtChance: 0.35,   // weekly odds BuyLow courts one of your vendors
  courtPriceMult: 1.05, // your prices at a vendor BuyLow signed, for a while
  courtDays: 14,
  counterAt: 3,        // leverage at which the vendor floats a counter-offer
  counterRel: 2,       // extra relationship for taking the counter graciously
  walkRel: 8,          // relationship lost when the vendor walks
  walkFreezeDays: 7,   // negotiated discount suspended after a blow-up
  perkRushDays: 7,     // "rush shipping" perk: -1 lead time for a week
  perkFreight: 60,     // "free pallet" perk: units delivered gratis
};

// The rival discount chain contesting the city.
export const RIVAL = {
  name: 'BuyLow',
  firstBuyDay: 14,       // when they open their first store
  buyInterval: [7, 12],  // days between openings
  maxStores: 4,          // they never lock you out of the 8-store win
};

// Stakes & drift.
export const DEBT_INTEREST = 0.02;   // daily, on negative cash
export const DEBT_GRACE_DAYS = 4;    // day-ends below -$500 before the bank calls it
export const DEBT_HARD_LIMIT = -10000;
export const WAGE_DRIFT = 0.003;     // wages & salaries +0.3%/day cost-of-living creep

// Vendors: priceMult scales product base cost; quality feeds store reputation;
// leadTime is days from order to warehouse arrival.
export const VENDORS = {
  freshfields: {
    name: 'FreshFields Farms', products: ['produce', 'dairy', 'deli'],
    priceMult: 1.0, quality: 0.95, leadTime: 1,
    blurb: 'Local farms. Fast and fresh, but they know their worth.',
    patience: 3, temper: 'Fair-minded, but they know what the restaurants pay.',
  },
  bakersguild: {
    name: "Baker's Guild", products: ['bakery'],
    priceMult: 0.95, quality: 1.0, leadTime: 1,
    blurb: 'Artisan co-op. Small batches, loyal once you earn their trust.',
    patience: 4, temper: 'Patient listeners — they would rather talk than walk.',
  },
  ironox: {
    name: 'Iron Ox Meats', products: ['meat', 'frozen'],
    priceMult: 1.05, quality: 1.1, leadTime: 2,
    blurb: 'Premium cuts and cold chain. Pricey, but customers notice.',
    patience: 2, temper: 'Proud of the product. Push too hard and the meeting is over.',
  },
  consolidated: {
    name: 'Consolidated Goods',
    products: ['pantry', 'frozen', 'dairy', 'beverages', 'snacks', 'household'],
    priceMult: 0.88, quality: 0.75, leadTime: 3,
    blurb: 'National distributor. Cheap and slow; quality is… fine. The only source for household goods.',
    patience: 2, temper: 'Corporate reps with a quota. Zero sentiment, quick exits.',
  },
  vista: {
    name: 'Vista Beverage Co.', products: ['beverages', 'snacks'],
    priceMult: 0.92, quality: 0.85, leadTime: 2,
    blurb: 'Regional drinks & snacks distributor. Solid prices, decent speed.',
    patience: 3, temper: 'Easygoing, commission-driven — they want a deal too.',
  },
  harborfresh: {
    name: 'Harbor Fresh', products: ['seafood', 'deli'],
    priceMult: 1.1, quality: 1.2, leadTime: 1,
    blurb: 'Dockside daily catch. Expensive, spoils fast, sells itself.',
    patience: 2, temper: 'The boat leaves at four. Waste their time and so do they.',
  },
};

export const DISTRICTS = [
  { id: 'oldtown',   name: 'Old Town',  unlock: 0,      rect: [0, 0, 12, 12],   phase: 'Your neighborhood' },
  { id: 'westside',  name: 'Westside',  unlock: 32000,  rect: [12, 0, 24, 12],  phase: 'Across town' },
  { id: 'riverside', name: 'Riverside', unlock: 60000,  rect: [0, 12, 12, 24],  phase: 'Citywide' },
  { id: 'downtown',  name: 'Downtown',  unlock: 100000, rect: [12, 12, 24, 24], phase: 'The big leagues' },
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
    role: 'buyer', name: 'Negotiate with vendors', defaultOn: false,
    desc: 'Spends your weekly meetings working vendors toward better rates.',
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
    icon: '🥶', name: 'Cold snap', dur: [2, 4], seasons: ['fall', 'winter'],
    desc: 'Frozen +80%, dairy +30%, produce −15% demand while it lasts.',
  },
  heat_wave: {
    icon: '🔥', name: 'Heat wave', dur: [2, 3], seasons: ['summer'],
    desc: 'Frozen +60% and beverages +50% demand, but perishables spoil twice as fast.',
  },
  flu_season: {
    icon: '🤧', name: 'Flu season', dur: [3, 5], seasons: ['fall', 'winter'],
    staffMult: 0.75,
    desc: 'A bug going around — staff effectiveness −25% chain-wide.',
  },
  food_scare: {
    icon: '☣️', name: 'Food scare', dur: [3, 5], productPick: true, productDemand: 0.35,
    desc: 'A contamination scare craters demand for one product line.',
  },
  viral_recipe: {
    icon: '📱', name: 'Viral recipe', dur: [2, 4], productPick: true, productDemand: 1.8,
    desc: 'A viral recipe sends one product flying off the shelves.',
  },
  fuel_spike: {
    icon: '⛽', name: 'Fuel price spike', dur: [3, 5], costMult: 1.12,
    desc: 'Every vendor tacks 12% onto prices while diesel is dear.',
  },
  port_delay: {
    icon: '⚓', name: 'Port congestion', dur: [3, 4], leadDelta: 1,
    desc: 'All vendor deliveries take one extra day.',
  },
  farmers_market: {
    icon: '🥕', name: 'Farmers market', dur: [2, 3], seasons: ['spring', 'summer', 'fall'],
    cost: { produce: 0.7, dairy: 0.85 },
    desc: 'Fresh goods flooding in cheap — a buying opportunity.',
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
  campaign: {
    icon: '📣', name: 'Ad campaign', player: true,
    desc: 'Your marketing blitz: +25% demand in this district while it runs.',
  },
};

export const CAMPAIGN = { cost: 1500, days: 5, boost: 1.25, cooldown: 10 };

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

// Difficulty presets, chosen in Settings; applies to the next new game.
export const DIFFICULTY = {
  relaxed: {
    name: 'Relaxed', cash: 32000, rivalFirst: 22, rivalInterval: [10, 15],
    rivalMax: 3, eventChance: 0.18,
    desc: 'More starting cash, a sleepy rival, calmer city.',
  },
  standard: {
    name: 'Standard', cash: 25000, rivalFirst: 14, rivalInterval: [7, 12],
    rivalMax: 4, eventChance: 0.28,
    desc: 'The intended experience.',
  },
  ruthless: {
    name: 'Ruthless', cash: 20000, rivalFirst: 10, rivalInterval: [5, 9],
    rivalMax: 4, eventChance: 0.36,
    desc: 'Thin cash, an aggressive rival, an eventful city.',
  },
};

// Onboarding goal ladder: sequential objectives with cash rewards.
// Completion checks live in game.js (checkGoals).
export const GOALS = [
  { id: 'negotiate', title: 'Negotiate your first discount', reward: 500,
    desc: 'Vendors tab — order to build the relationship, then push for a better rate.' },
  { id: 'manager', title: 'Hire a store manager', reward: 500,
    desc: 'Open a store panel and pick a candidate — they can run staffing and prices for you.' },
  { id: 'truck', title: 'Grow the fleet to 2 trucks', reward: 750,
    desc: 'Supply tab — one truck can\'t feed a growing chain.' },
  { id: 'range', title: 'Add a new product line', reward: 1000,
    desc: 'Remodel a store (or swap a line out) to carry something beyond the core six.' },
  { id: 'rep', title: 'Reach 80% reputation at any store', reward: 750,
    desc: 'Full shelves and healthy staffing — reputation compounds into traffic.' },
  { id: 'third', title: 'Open your third store', reward: 1000,
    desc: 'A fresh district pays better than crowding your own turf.' },
  { id: 'hq', title: 'Fill all three HQ roles', reward: 1500,
    desc: 'Buyer, Logistics, Marketing — then delegate what you don\'t want to micromanage.' },
  { id: 'districts', title: 'Operate in two districts', reward: 1500,
    desc: 'Sister stores share shoppers; fresh neighborhoods don\'t.' },
  { id: 'five', title: 'Run five stores', reward: 2000,
    desc: 'BuyLow is buying lots. Claim the good corners first.' },
];

// Achievements: earned once per run, shown in HQ Records.
export const ACHIEVEMENTS = [
  { id: 'black_friday', icon: '🛍️', name: 'Black Friday', desc: 'Bank $2,000 profit in a single day' },
  { id: 'full_house', icon: '🏬', name: 'Full House', desc: 'One store carrying all 11 product lines' },
  { id: 'dealmaker', icon: '🤝', name: 'Dealmaker', desc: '25% discounts with four vendors at once' },
  { id: 'tycoon', icon: '💰', name: 'Tycoon', desc: 'Hold $100,000 in cash' },
  { id: 'city_slicker', icon: '🌆', name: 'City Slicker', desc: 'Stores in all four districts' },
  { id: 'fleet_admiral', icon: '🚚', name: 'Fleet Admiral', desc: 'Run five trucks' },
  { id: 'people_person', icon: '👥', name: 'People Person', desc: 'Managers at four stores' },
  { id: 'ironclad', icon: '🛡️', name: 'Ironclad', desc: 'A vendor strike ends with chain availability above 90%' },
];

export const PEOPLE_NAMES = [
  'Ada Okafor', 'Grace Lindqvist', 'Marge Devine', 'Hank Solano', 'Yuki Tanaka',
  'Priya Raman', 'Omar Haddad', 'Sofia Reyes', 'Dmitri Volkov', 'June Park',
  'Carlos Mendes', 'Wren Ashby', 'Kofi Mensah', 'Elena Vasquez', 'Bao Nguyen',
];
