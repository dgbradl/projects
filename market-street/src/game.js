// Simulation: stores & customer demand, warehouse, truck logistics,
// vendor relationships, staff & managers, city events, P&L ledger, save/load.

import {
  GRID, WIN_CASH, WIN_STORES, POP_FACTOR, SHELF_CAP, STAFF_WAGE,
  HIRE_ROLE_COST, TRUCK_COST, TRUCK_CAP, TRUCK_SPEED, TRUCK_UNLOAD, WAREHOUSE_CAP,
  WAREHOUSE_UPGRADE, WAREHOUSE, MANAGER_SALARY, START_SLOTS, REMODEL,
  isRoad, PRODUCTS, VENDORS, DISTRICTS, SITES, ROLES, EVENTS, TRAITS,
  DELEGATIONS, PEOPLE_NAMES, RIVAL, DEBT_INTEREST, DEBT_GRACE_DAYS,
  DEBT_HARD_LIMIT, WAGE_DRIFT, GOALS, DIFFICULTY, CONTRACT, STORE_UPGRADES,
  CAMPAIGN, ACHIEVEMENTS, SEASONS, SEASON_DAYS, YEAR_DAYS, HOLIDAYS,
  HOLIDAY_ANNOUNCE, NEGO,
} from './defs.js';

const SAVE_KEY = 'market-street-save-v2';
const PROD_IDS = Object.keys(PRODUCTS);
const PERISHABLE = PROD_IDS.filter((p) => PRODUCTS[p].spoil > 0);

export class Game {
  constructor() { this.reset(); }

  reset(diffId) {
    this.diffId = DIFFICULTY[diffId] ? diffId : (DIFFICULTY[this.diffId] ? this.diffId : 'standard');
    const D = DIFFICULTY[this.diffId];
    this.cash = D.cash;
    this.peakCash = D.cash;
    this.time = 0;              // in days (fractional)
    this.speed = 1;
    this.won = false;
    this.floaters = [];
    this.nameCursor = Math.floor(Math.random() * PEOPLE_NAMES.length);

    // Accrual ledger for the current day, plus daily history for the Books tab.
    this.today = this.blankLedger();
    this.history = [];          // [{day, revenue, cogs, rent, wages, salaries, fines, profit}]
    this.logEntries = [];       // [{day, icon, text}]

    // Weighted-average unit cost per product (for honest COGS).
    this.avgCost = {};
    for (const p of PROD_IDS) this.avgCost[p] = PRODUCTS[p].cost;

    this.stores = [];
    for (const site of SITES) {
      if (site.owned) this.addStore(site.id, true);
    }

    this.warehouse = { cap: WAREHOUSE_CAP, inv: {} };
    for (const p of PROD_IDS) this.warehouse.inv[p] = 100;

    this.trucks = [{ state: 'idle', path: null, pos: 0, cargo: null, storeId: null }];
    this.orders = [];           // { vendor, product, qty, arriveDay, unitCost }

    this.vendors = {};
    for (const v of Object.keys(VENDORS)) {
      this.vendors[v] = { rel: 30, discount: 0, lastNegDay: -1, contract: null };
    }

    this.purchasing = {};
    const chainPop = this.stores.reduce((s2, st) => s2 + this.site(st.siteId).pop, 0);
    for (const p of PROD_IDS) {
      const vendor = this.cheapestVendor(p);
      // Expected chain demand/day if every store carries the line, buffered
      // by that vendor's lead time — slow vendors get deeper reorder points.
      const est = chainPop * POP_FACTOR * PRODUCTS[p].weight;
      const lead = VENDORS[vendor].leadTime;
      this.purchasing[p] = {
        auto: true,
        vendor,
        point: Math.max(75, Math.round(est * (lead + 1.5) / 25) * 25),
        qty: Math.max(150, Math.round(est * 4 / 25) * 25),
      };
    }

    this.hq = { buyer: null, logistics: null, marketing: null };
    this.candidates = {};       // role -> [candidate x3], generated on demand
    this.activeEvents = [];     // [{type, daysLeft, vendor?, district?, siteId?}]

    // Delegation: chain-wide toggles (active only while the role is filled).
    this.delegation = {};
    for (const [id, d] of Object.entries(DELEGATIONS)) this.delegation[id] = d.defaultOn;
    // Demand measurement for the buyer's reorder tuning.
    this.soldToday = {};
    this.revToday = {};
    this.demandEma = {};
    for (const p of PROD_IDS) { this.soldToday[p] = 0; this.revToday[p] = 0; this.demandEma[p] = 0; }
    this.yesterdayByProduct = {};   // p -> { units, revenue }
    // Weekly digest accumulators.
    this.week = this.blankWeek(1);
    this.lastWeekReport = null;
    this.weekReportId = 0;
    this.whFullStreak = 0;
    // Weekly planning mode: pause at each week boundary so the player can
    // review the wrap-up, adjust the plan, then let the week run.
    this.weeklyMode = true;
    this.planning = false;
    this.preWeekSpeed = 1;
    this.meetingsLeft = NEGO.meetingsPerWeek;

    // The rival chain, and the stakes.
    this.rival = { stores: [], nextBuyDay: D.rivalFirst, openedDay: {}, plus: {} };
    this.debtDays = 0;
    this.gameOver = false;
    this.goalIndex = 0;
    this.deliveryPing = 0;      // bumped on each completed delivery (for SFX)
    this.lastCampaignDay = {};  // district -> day a campaign last started
    this.achieved = {};         // achievement id -> day earned
    this.stats = { customersServed: 0, totalRevenue: 0, trucksBought: 0, storesOpened: 2, eventsWeathered: 0 };
  }

  blankWeek(startDay) {
    return {
      start: startDay, events: [], staffActions: 0, storeProfit: {},
      stores: {},        // siteId -> { rev, profit, served, lost, so, staffAcc, days, repStart }
      whShort: {},       // product -> days the warehouse was effectively empty
      truckBusy: 0, truckSamples: 0,
    };
  }

  blankLedger() {
    return { revenue: 0, cogs: 0, rent: 0, wages: 0, salaries: 0, fines: 0, interest: 0 };
  }

  addStore(siteId, seeded = false) {
    const store = {
      siteId,
      name: `Market St. #${this.stores.length + 1}`,
      inv: {}, staff: 2, markup: 1.0, rep: 0.5, avail: 1, morale: 0.7,
      manager: null,
      range: {}, slots: START_SLOTS, remodels: 0,
      delegate: { staffing: true, pricing: true },   // used only with a manager
      upgrades: {},
      today: { revenue: 0, cogs: 0 },
      yesterday: { revenue: 0, cogs: 0, profit: 0 },
      servedToday: 0, lostToday: 0,
      stockoutLogged: {},
    };
    for (const p of PROD_IDS) {
      store.range[p] = !!PRODUCTS[p].core;
      store.inv[p] = seeded && store.range[p] ? SHELF_CAP * 0.7 : 0;
    }
    this.stores.push(store);
    return store;
  }

  // ---- lookups ----------------------------------------------------------

  day() { return Math.floor(this.time) + 1; }
  dayFrac() { return this.time - Math.floor(this.time); }
  site(id) { return SITES.find((s) => s.id === id); }
  storeAt(siteId) { return this.stores.find((s) => s.siteId === siteId); }
  siteAtTile(x, y) { return SITES.find((s) => s.x === x && s.y === y); }
  district(id) { return DISTRICTS.find((d) => d.id === id); }
  districtUnlocked(id) { return this.peakCash >= this.district(id).unlock; }

  rivalAt(siteId) { return this.rival.stores.includes(siteId); }
  wageMult() { return 1 + WAGE_DRIFT * this.day(); }

  // ---- calendar ---------------------------------------------------------

  yearDay() { return (this.day() - 1) % YEAR_DAYS; }
  season() { return SEASONS[Math.floor(this.yearDay() / SEASON_DAYS)]; }
  seasonDay() { return (this.yearDay() % SEASON_DAYS) + 1; }

  currentHoliday() {
    const doy = this.yearDay();
    return HOLIDAYS.find((h) => doy >= h.start && doy < h.start + h.days) ?? null;
  }

  holidayAftermath() {
    const doy = this.yearDay();
    return HOLIDAYS.find((h) => h.aftermathDays
      && doy >= h.start + h.days && doy < h.start + h.days + h.aftermathDays) ?? null;
  }

  upcomingHoliday() {
    const doy = this.yearDay();
    for (const h of HOLIDAYS) {
      const delta = (h.start - doy + YEAR_DAYS) % YEAR_DAYS;
      if (delta > 0 && delta <= HOLIDAY_ANNOUNCE) return { holiday: h, inDays: delta };
    }
    return null;
  }

  // How much of its neighborhood a store actually captures: sister stores in
  // the district share the pie, and rival stores siphon shoppers — worse if
  // your prices are high, softened by strong reputation.
  marketFactor(store) {
    const district = this.site(store.siteId).district;
    const sisters = this.stores.filter((s) => this.site(s.siteId).district === district).length;
    const sharing = 1 / (1 + 0.18 * (sisters - 1));
    const rivals = this.rival.stores
      .filter((id) => this.site(id).district === district)
      .reduce((s, id) => s + (this.rival.plus?.[id] ? 1.35 : 1), 0);
    let competition = 1;
    if (rivals > 0) {
      let penalty = Math.max(0.05, Math.min(0.20, 0.08 + 0.25 * (store.markup - 0.90)));
      penalty *= 1.3 - 0.6 * store.rep;
      competition = 1 - Math.min(0.55, rivals * penalty);
    }
    return sharing * competition;
  }

  effStaff(store) {
    return store.staff
      + (store.manager ? 0.5 * store.manager.skill : 0)
      + (store.upgrades?.selfcheckout ? 1 : 0);
  }

  roleSkill(role) { return this.hq[role] ? this.hq[role].skill : 0; }
  hasTrait(role, traitId) { return this.hq[role]?.trait?.id === traitId; }
  managerTrait(store, traitId) { return store.manager?.trait?.id === traitId; }

  cheapestVendor(product) {
    let best = null, bestCost = Infinity;
    for (const [id, v] of Object.entries(VENDORS)) {
      if (!v.products.includes(product)) continue;
      if (v.priceMult < bestCost) { bestCost = v.priceMult; best = id; }
    }
    return best;
  }

  unitCost(product, vendorId) {
    const v = VENDORS[vendorId];
    const vs = this.vendors[vendorId];
    const negotiated = this.day() < (vs.frozenUntil ?? 0) ? 0 : vs.discount;
    const courtPenalty = this.day() < (vs.courtLossUntil ?? 0) ? NEGO.courtPriceMult : 1;
    const disc = Math.max(negotiated, vs.contract ? CONTRACT.discount : 0);
    const buyer = 1 - 0.02 * this.roleSkill('buyer');
    const trait = this.hasTrait('buyer', 'pennypincher') ? 0.985 : 1;
    let mult = this.season().cost?.[product] ?? 1;
    for (const e of this.activeEvents) {
      const def = EVENTS[e.type];
      if (def?.costMult) mult *= def.costMult;
      if (def?.cost?.[product]) mult *= def.cost[product];
    }
    return PRODUCTS[product].cost * v.priceMult * (1 - disc) * buyer * trait * mult * courtPenalty;
  }

  // Extra vendor lead time from active events (port congestion etc.).
  leadDelta() {
    return this.activeEvents.reduce((s, e) => s + (EVENTS[e.type]?.leadDelta ?? 0), 0);
  }

  // Products carried by at least one store.
  carriedProducts() {
    return PROD_IDS.filter((p) => this.stores.some((s) => s.range[p]));
  }

  enabledWeight(store) {
    return PROD_IDS.reduce((s, p) => s + (store.range[p] ? PRODUCTS[p].weight : 0), 0);
  }

  rangeCount(store) {
    return PROD_IDS.filter((p) => store.range[p]).length;
  }

  remodelCost(store) {
    return REMODEL.baseCost + REMODEL.stepCost * store.remodels;
  }

  chainQuality() {
    const carried = this.carriedProducts();
    if (!carried.length) return 1;
    let q = 0;
    for (const p of carried) q += VENDORS[this.purchasing[p].vendor].quality;
    return q / carried.length;
  }

  warehouseUsed() {
    return PROD_IDS.reduce((s, p) => s + this.warehouse.inv[p], 0);
  }

  inTransit(product) {
    return this.orders
      .filter((o) => o.product === product)
      .reduce((s, o) => s + o.qty, 0);
  }

  vendorStruck(vendorId) {
    return this.activeEvents.some((e) => e.type === 'strike' && e.vendor === vendorId);
  }

  eventOfType(type) { return this.activeEvents.find((e) => e.type === type); }

  // Daily fixed costs, for smooth "profit so far today" display.
  dailyOpex() {
    const w = this.wageMult();
    let c = 0;
    for (const store of this.stores) {
      c += this.site(store.siteId).rent + store.staff * STAFF_WAGE * w;
      if (store.manager) c += store.manager.salary * w;
    }
    for (const role of Object.keys(ROLES)) {
      if (this.hq[role]) c += this.hq[role].salary * w;
    }
    return c;
  }

  profitToday() {
    const t = this.today;
    return t.revenue - t.cogs - t.fines - t.interest - this.dailyOpex() * this.dayFrac();
  }

  // ---- people -----------------------------------------------------------

  nextName() {
    const name = PEOPLE_NAMES[this.nameCursor % PEOPLE_NAMES.length];
    this.nameCursor++;
    return name;
  }

  makeCandidates(role) {
    const traits = TRAITS[role];
    const baseSalary = role === 'manager' ? MANAGER_SALARY : 48;
    const out = [];
    for (let i = 0; i < 3; i++) {
      const skill = 1 + Math.floor(Math.random() * 3);
      out.push({
        name: this.nextName(),
        skill,
        salary: Math.round(baseSalary * skill * (0.9 + Math.random() * 0.25)),
        trait: traits[Math.floor(Math.random() * traits.length)],
      });
    }
    return out;
  }

  candidatesFor(role) {
    if (!this.candidates[role]) this.candidates[role] = this.makeCandidates(role);
    return this.candidates[role];
  }

  hireRole(role, index = 0) {
    if (this.hq[role] || this.cash < HIRE_ROLE_COST) return false;
    const pick = this.candidatesFor(role)[index];
    if (!pick) return false;
    this.hq[role] = pick;
    this.candidates[role] = null;
    this.cash -= HIRE_ROLE_COST;
    this.log('🤝', `${pick.name} joined as ${ROLES[role].name} (${'★'.repeat(pick.skill)}, ${pick.trait.name}).`);
    return true;
  }

  fireRole(role) {
    if (this.hq[role]) this.log('👋', `${this.hq[role].name} left the ${ROLES[role].name} role.`);
    this.hq[role] = null;
  }

  hireManager(siteId, index = 0) {
    const store = this.storeAt(siteId);
    if (!store || store.manager || this.cash < HIRE_ROLE_COST) return false;
    const pick = this.candidatesFor('manager')[index];
    if (!pick) return false;
    store.manager = pick;
    this.candidates.manager = null;
    this.cash -= HIRE_ROLE_COST;
    this.log('🤝', `${pick.name} now manages ${store.name} (${'★'.repeat(pick.skill)}, ${pick.trait.name}).`);
    return true;
  }

  fireManager(siteId) {
    const store = this.storeAt(siteId);
    if (store?.manager) {
      this.log('👋', `${store.manager.name} left ${store.name}.`);
      store.manager = null;
      store.morale = Math.max(0.2, store.morale - 0.15);
    }
  }

  // ---- player actions ---------------------------------------------------

  buyStore(siteId) {
    const site = this.site(siteId);
    if (!site || this.storeAt(siteId) || this.rivalAt(siteId)) return false;
    if (!this.districtUnlocked(site.district)) return false;
    if (this.cash < site.price) return false;
    this.cash -= site.price;
    const popBefore = this.stores.reduce((s, st) => s + this.site(st.siteId).pop, 0);
    const store = this.addStore(siteId);
    // Auto standing orders grow with the chain: more mouths, deeper buffers.
    const ratio = (popBefore + site.pop) / Math.max(1, popBefore);
    for (const p of PROD_IDS) {
      const pol = this.purchasing[p];
      if (!pol.auto) continue;
      pol.point = Math.round(pol.point * ratio / 25) * 25;
      pol.qty = Math.round(pol.qty * ratio / 25) * 25;
    }
    this.stats.storesOpened++;
    this.addFloater(site.x, site.y, 'Grand opening!', '#f2c14e');
    this.log('🎉', `${store.name} opened in ${this.district(site.district).name}.`);
    return true;
  }

  closeStore(siteId) {
    const i = this.stores.findIndex((s) => s.siteId === siteId);
    if (i < 0) return false;
    const site = this.site(siteId);
    const store = this.stores[i];
    const refund = Math.round(site.price * 0.6);
    this.stores.splice(i, 1);
    this.cash += refund;
    this.log('🏚️', `${store.name} closed. Recovered $${refund.toLocaleString()}.`);
    for (const t of this.trucks) {
      if (t.storeId === siteId && t.state !== 'idle') {
        if (t.cargo) {
          for (const [p, q] of Object.entries(t.cargo)) this.warehouse.inv[p] += q;
        }
        t.state = 'idle'; t.path = null; t.cargo = null; t.storeId = null;
      }
    }
    return true;
  }

  toggleProduct(siteId, product) {
    const store = this.storeAt(siteId);
    if (!store || !PRODUCTS[product]) return false;
    if (store.range[product]) {
      store.range[product] = false;
      return true;
    }
    if (this.rangeCount(store) >= store.slots) return false;
    store.range[product] = true;
    return true;
  }

  buyUpgrade(siteId, upgradeId) {
    const store = this.storeAt(siteId);
    const def = STORE_UPGRADES[upgradeId];
    if (!store || !def || store.upgrades?.[upgradeId]) return false;
    if (this.cash < def.cost) return false;
    this.cash -= def.cost;
    store.upgrades ??= {};
    store.upgrades[upgradeId] = true;
    this.log(def.icon, `${store.name} installed ${def.name}.`);
    return true;
  }

  remodelStore(siteId) {
    const store = this.storeAt(siteId);
    if (!store || store.slots >= PROD_IDS.length) return false;
    const cost = this.remodelCost(store);
    if (this.cash < cost) return false;
    this.cash -= cost;
    store.slots = Math.min(PROD_IDS.length, store.slots + REMODEL.slots);
    store.remodels++;
    this.log('🔨', `${store.name} remodeled — now fits ${store.slots} product lines.`);
    return true;
  }

  placeOrder(product, vendorId, qty, quiet = false) {
    qty = Math.max(0, Math.round(qty));
    const v = VENDORS[vendorId];
    if (!v || !v.products.includes(product) || qty <= 0) return false;
    if (this.vendorStruck(vendorId)) {
      if (!quiet) this.log('✊', `${v.name} is on strike — order refused.`);
      return false;
    }
    const unit = this.unitCost(product, vendorId);
    const cost = Math.round(unit * qty);
    if (this.cash < cost) return false;
    this.cash -= cost;
    const vs = this.vendors[vendorId];
    if (vs.rider) vs.rider.ordered += qty;
    const arrive = this.day()
      + Math.max(1, v.leadTime - (this.day() < (vs.rushUntil ?? 0) ? 1 : 0))
      + this.leadDelta();
    if (this.day() < (vs.splitUntil ?? 0) && qty >= 100) {
      // Negotiated split shipments: half arrives a day early.
      const half = Math.floor(qty / 2);
      this.orders.push({ vendor: vendorId, product, qty: qty - half,
        arriveDay: Math.max(this.day() + 1, arrive - 1), unitCost: unit });
      this.orders.push({ vendor: vendorId, product, qty: half, arriveDay: arrive, unitCost: unit });
    } else {
      this.orders.push({ vendor: vendorId, product, qty, arriveDay: arrive, unitCost: unit });
    }
    vs.rel = Math.min(100, vs.rel + Math.min(4, qty / 150));
    if (vs.contract) vs.contract.weekOrdered += qty;
    return true;
  }

  // Background negotiation used by the delegated negotiator: no table, just
  // your Head Buyer quietly working the phones for the small step.
  negotiate(vendorId) {
    const vs = this.vendors[vendorId];
    if (vs.lastNegDay === this.day()) return { done: true };
    vs.lastNegDay = this.day();
    let chance = 0.25 + vs.rel / 200 + 0.12 * this.roleSkill('buyer');
    if (this.hasTrait('buyer', 'haggler')) chance += 0.08;
    if (Math.random() < chance) {
      vs.discount = Math.min(0.25, vs.discount + 0.03);
      vs.rel = Math.min(100, vs.rel + 6);
      this.log('🤝', `${VENDORS[vendorId].name} agreed to ${Math.round(vs.discount * 100)}% off.`);
      return { success: true };
    }
    vs.rel = Math.max(0, vs.rel - 4);
    return { success: false };
  }

  // ---- dice negotiation --------------------------------------------------
  // Sitting down at the table: roll a pool, keep dice, press your luck.
  // ⚠️ dice lock in where they land; more of them than the vendor has
  // patience for and they walk — relationship hit, discount frozen a week.

  negoDiceCount(vendorId) {
    const vs = this.vendors[vendorId];
    const v = VENDORS[vendorId];
    const mods = [];
    if (vs.rel >= 50) mods.push({ d: 1, label: 'Good relationship (rel 50+)' });
    if (vs.rel >= 80) mods.push({ d: 1, label: 'Trusted partner (rel 80+)' });
    if (this.roleSkill('buyer') >= 1) mods.push({ d: 1, label: `Head Buyer at the table (★${this.roleSkill('buyer')})` });
    if (this.roleSkill('buyer') >= 3) mods.push({ d: 1, label: 'Master buyer' });
    if (vs.contract) mods.push({ d: 1, label: 'Active supply contract' });
    // How the last sitting ended carries into this one.
    if ((vs.mood ?? 0) > 0) mods.push({ d: 1, label: 'Goodwill from last sitting' });
    if ((vs.mood ?? 0) < 0) mods.push({ d: -1, label: 'Grudge from last sitting' });
    // The world at the table: seasons and events shift your hand.
    if (this.season().id === 'fall' && v.products.includes('produce')) {
      mods.push({ d: 1, label: 'Harvest glut — buyers hold the cards' });
    }
    if (this.eventOfType('farmers_market') && v.products.includes('produce')) {
      mods.push({ d: 1, label: 'Farmers market undercuts them' });
    }
    if (this.eventOfType('fuel_spike')) {
      mods.push({ d: -1, label: 'Fuel spike has vendors defensive' });
    }
    const count = Math.max(2, Math.min(NEGO.maxDice,
      NEGO.baseDice + mods.reduce((s, m) => s + m.d, 0)));
    return { count, mods };
  }

  meetingsCap() {
    const b = this.hq.buyer;
    return NEGO.meetingsPerWeek + (b ? 1 : 0) + (b?.skill >= 3 ? 1 : 0);
  }

  canNegotiate(vendorId) {
    if (this.meetingsLeft <= 0) return { noMeetings: true };
    if (this.vendors[vendorId].lastNegDay === this.day()) return { done: true };
    if (this.vendorStruck(vendorId)) return { struck: true };
    return { ok: true };
  }

  startNegotiation(vendorId, stake = 'price') {
    const vs = this.vendors[vendorId];
    if (this.meetingsLeft <= 0) return { noMeetings: true };
    if (vs.lastNegDay === this.day()) return { done: true };
    if (this.vendorStruck(vendorId)) return { struck: true };
    const { count, mods } = this.negoDiceCount(vendorId);
    vs.lastNegDay = this.day();
    this.meetingsLeft--;
    vs.mood = 0;                       // grudges & goodwill spend on sitting down
    this.nego = {
      vendor: vendorId,
      stake,
      dice: Array.from({ length: count }, () => null),
      rollsLeft: NEGO.rolls,
      patience: VENDORS[vendorId].patience ?? 3,
      warns: 0,
      mods,
      counter: null,
      counterAccepted: false,
      over: false,
      result: null,
    };
    this.negoRoll([]);
    return this.nego;
  }

  negoRoll(keep = []) {
    const n = this.nego;
    if (!n || n.over || n.rollsLeft <= 0) return n;
    n.rollsLeft--;
    n.counter = null;
    n.dice = n.dice.map((d, i) => {
      // ⚠️ dice are locked where they land; kept dice stay by choice.
      if (d && (d.face === 'warn' || keep.includes(i))) return d;
      return { face: NEGO.faces[Math.floor(Math.random() * NEGO.faces.length)] };
    });
    n.warns = n.dice.filter((d) => d.face === 'warn').length;
    if (n.warns > n.patience) {
      this.negoWalk();
      return n;
    }
    // With decent leverage on the table and presses left, the vendor floats
    // a counter: take this now, and we part as friends.
    if (n.rollsLeft > 0 && this.negoLeverage() >= NEGO.counterAt) {
      n.counter = { value: this.negoTierValue() };
      // Some price counters come with strings attached: a volume commitment
      // that pays extra if honored, and stings if blown.
      if (n.stake === 'price' && n.counter.value && Math.random() < NEGO.riderChance) {
        const vs2 = this.vendors[n.vendor];
        if (!vs2.rider) {
          const est = VENDORS[n.vendor].products
            .reduce((s, p) => s + (this.demandEma[p] ?? 0), 0);
          n.counter.rider = {
            qty: Math.max(100, Math.round(est * 2 / 25) * 25),
            days: NEGO.riderDays,
            bonus: NEGO.riderBonus,
          };
        }
      }
    }
    return n;
  }

  negoLeverage() {
    return (this.nego?.dice ?? []).reduce(
      (s, d) => s + (d?.face === 'lev' ? 1 : d?.face === 'crit' ? 2 : 0), 0);
  }

  negoGoodwill() {
    return (this.nego?.dice ?? []).filter((d) => d?.face === 'good').length;
  }

  negoTierDisc() {
    const lev = this.negoLeverage();
    for (const t of NEGO.tiers) if (lev >= t.lev) return t.disc;
    return 0;
  }

  // The current roll's winnings under the active stake: {disc} for price,
  // {days, split} for delivery, or null below the first tier.
  negoTierValue() {
    if (!this.nego) return null;
    if (this.nego.stake === 'delivery') {
      const lev = this.negoLeverage();
      for (const t of NEGO.deliveryTiers) if (lev >= t.lev) return { days: t.days, split: !!t.split };
      return null;
    }
    const disc = this.negoTierDisc();
    return disc > 0 ? { disc } : null;
  }

  negoAccept(fromCounter = false) {
    const n = this.nego;
    if (!n || n.over) return n?.result;
    const vs = this.vendors[n.vendor];
    const won = this.negoTierValue();
    const good = this.negoGoodwill();
    n.counterAccepted = fromCounter;
    let perk = null;
    if (n.stake === 'delivery') {
      if (won) {
        vs.rushUntil = Math.max(vs.rushUntil ?? 0, this.day()) + won.days;
        if (won.split) vs.splitUntil = Math.max(vs.splitUntil ?? 0, this.day()) + won.days;
        // Top-tier delivery closes flourish with a small discount instead.
        if (won.split) {
          vs.discount = Math.min(0.25, vs.discount + 0.02);
          perk = { kind: 'disc', text: 'an extra 2% off' };
        }
        this.log('🚚', `${VENDORS[n.vendor].name} bumped you up the route: −1 day lead for ${won.days} days${won.split ? ', shipments split for smoother arrivals' : ''}.`);
      }
    } else if (won) {
      vs.discount = Math.min(0.25, vs.discount + won.disc);
      if (won.disc >= NEGO.tiers[0].disc) perk = this.negoPerk(n.vendor);
      this.log('🤝', `${VENDORS[n.vendor].name} agreed to ${Math.round(vs.discount * 100)}% off${perk ? ` — plus ${perk.text}` : ''}.`);
    }
    const relGain = good + (won ? 2 : 0) + (fromCounter ? NEGO.counterRel : 0);
    vs.rel = Math.min(100, vs.rel + relGain);
    if (fromCounter) vs.mood = 1;      // taking the counter graciously is remembered
    let rider = null;
    if (fromCounter && n.counter?.rider) {
      rider = n.counter.rider;
      vs.discount = Math.min(0.25, vs.discount + rider.bonus);
      vs.rider = { qty: rider.qty, ordered: 0, deadline: this.day() + rider.days, bonus: rider.bonus };
      this.log('📦', `${VENDORS[n.vendor].name} added ${Math.round(rider.bonus * 100)}% more — for ${rider.qty} units ordered within ${rider.days} days.`);
    }
    // Closing any deal while BuyLow is courting this vendor fends them off.
    if (won && this.rival.courting?.vendor === n.vendor) {
      this.rival.courting = null;
      vs.rel = Math.min(100, vs.rel + 4);
      this.log('🦈', `Your deal kept ${VENDORS[n.vendor].name} out of BuyLow's hands.`);
    }
    n.over = true;
    n.result = {
      walked: false, stake: n.stake, won, good, relGain, perk, rider,
      disc: n.stake === 'price' && won ? won.disc : 0,
      total: vs.discount,
    };
    this.stats.negotiations = (this.stats.negotiations ?? 0) + 1;
    return n.result;
  }

  negoWalk() {
    const n = this.nego;
    const vs = this.vendors[n.vendor];
    vs.rel = Math.max(0, vs.rel - NEGO.walkRel);
    vs.frozenUntil = this.day() + NEGO.walkFreezeDays;
    vs.mood = -1;
    n.over = true;
    n.result = { walked: true, freezeDays: NEGO.walkFreezeDays };
    this.log('💢', `${VENDORS[n.vendor].name} walked out of the negotiation — your discount is suspended for ${NEGO.walkFreezeDays} days.`);
    return n.result;
  }

  // Top-tier deals close with a flourish: a perk beyond the price cut.
  negoPerk(vendorId) {
    const vs = this.vendors[vendorId];
    const v = VENDORS[vendorId];
    const roll = Math.floor(Math.random() * 3);
    if (roll === 0) {
      vs.rushUntil = this.day() + NEGO.perkRushDays;
      return { kind: 'rush', text: `rush shipping (−1 day lead) for ${NEGO.perkRushDays} days` };
    }
    if (roll === 1) {
      const p = v.products[0];
      const space = Math.max(0, this.warehouse.cap - this.warehouseUsed());
      const qty = Math.min(NEGO.perkFreight, space);
      if (qty > 0) {
        this.warehouse.inv[p] = (this.warehouse.inv[p] ?? 0) + qty;
        return { kind: 'freight', text: `${qty} units of ${PRODUCTS[p].name} on the house` };
      }
    }
    vs.rel = Math.min(100, vs.rel + 8);
    return { kind: 'goodwill', text: 'a warm handshake (+8 relationship)' };
  }

  signContract(vendorId) {
    const vs = this.vendors[vendorId];
    if (!vs || vs.contract) return { already: true };
    if (vs.rel < CONTRACT.relRequired) return { lowRel: true };
    const day = this.day();
    vs.contract = {
      until: day + CONTRACT.days,
      weekEnd: day + 7,
      weekOrdered: 0,
    };
    this.log('📜', `Signed a ${CONTRACT.days}-day supply contract with ${VENDORS[vendorId].name}: ${Math.round(CONTRACT.discount * 100)}% off for ${CONTRACT.weeklyMin} units/week.`);
    return { success: true };
  }

  runCampaign(districtId) {
    if (!this.hq.marketing) return { needsLead: true };
    if (!this.districtUnlocked(districtId)) return { locked: true };
    const last = this.lastCampaignDay[districtId] ?? -Infinity;
    if (this.day() - last < CAMPAIGN.cooldown) {
      return { cooldown: CAMPAIGN.cooldown - (this.day() - last) };
    }
    if (this.cash < CAMPAIGN.cost) return { poor: true };
    this.cash -= CAMPAIGN.cost;
    this.lastCampaignDay[districtId] = this.day();
    this.activeEvents.push({ type: 'campaign', daysLeft: CAMPAIGN.days, district: districtId });
    this.log('📣', `Ad campaign launched in ${this.district(districtId).name} — ${this.hq.marketing.name} expects a ${Math.round((CAMPAIGN.boost - 1) * 100)}% traffic bump.`);
    return { success: true };
  }

  buyTruck() {
    if (this.cash < TRUCK_COST) return false;
    this.cash -= TRUCK_COST;
    this.trucks.push({ state: 'idle', path: null, pos: 0, cargo: null, storeId: null });
    this.stats.trucksBought++;
    this.log('🚚', `Truck #${this.trucks.length} joined the fleet.`);
    return true;
  }

  upgradeWarehouse() {
    if (this.cash < WAREHOUSE_UPGRADE.cost) return false;
    this.cash -= WAREHOUSE_UPGRADE.cost;
    this.warehouse.cap += WAREHOUSE_UPGRADE.units;
    this.log('🏗️', `Warehouse expanded to ${this.warehouse.cap.toLocaleString()} units.`);
    return true;
  }

  // ---- logging ----------------------------------------------------------

  log(icon, text) {
    this.logEntries.push({ day: this.day(), icon, text });
    if (this.logEntries.length > 120) this.logEntries.shift();
    if (this.week) {
      if (icon === '🧠' || icon === '💼') this.week.staffActions++;
      const EVENT_ICONS = ['🥶', '🔥', '✊', '🚧', '🎪', '⚔️', '🧾', '🧊', '🏪',
        '🤧', '☣️', '📱', '⛽', '⚓', '🥕', '📅', '🌸', '🍖', '🦃', '🎁'];
      if (EVENT_ICONS.includes(icon)) this.week.events.push(text);
    }
  }

  addFloater(x, y, text, color) {
    const stack = this.floaters.filter((f) => f.x === x && f.y === y).length;
    this.floaters.push({ x, y, text, color, age: 0, stack });
    if (this.floaters.length > 30) this.floaters.shift();
  }

  // ---- simulation -------------------------------------------------------

  tick(dt) {
    if (this.gameOver) return;
    const prevDay = this.day();
    this.time += dt;
    if (this.day() !== prevDay) this.dayTick();

    this.tickStores(dt);
    this.tickTrucks(dt);

    for (const f of this.floaters) f.age += dt * 10;
    this.floaters = this.floaters.filter((f) => f.age < 1.6);

    if (this.cash > this.peakCash) this.peakCash = this.cash;
    if (!this.won && this.cash >= WIN_CASH && this.stores.length >= WIN_STORES) {
      this.won = true;
    }
    this.checkGoals();
  }

  goalMet(id) {
    switch (id) {
      case 'negotiate': return Object.values(this.vendors).some((v) => v.discount >= 0.02);
      case 'manager': return this.stores.some((s) => s.manager);
      case 'truck': return this.trucks.length >= 2;
      case 'range': return this.stores.some((s) =>
        PROD_IDS.some((p) => s.range[p] && !PRODUCTS[p].core));
      case 'rep': return this.stores.some((s) => s.rep >= 0.8);
      case 'third': return this.stores.length >= 3;
      case 'hq': return !!(this.hq.buyer && this.hq.logistics && this.hq.marketing);
      case 'districts': return new Set(this.stores.map((s) => this.site(s.siteId).district)).size >= 2;
      case 'five': return this.stores.length >= 5;
      default: return false;
    }
  }

  unlockAchievement(id) {
    if (this.achieved[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.achieved[id] = this.day();
    this.log('🏅', `Achievement: ${a.icon} ${a.name} — ${a.desc}.`);
  }

  checkAchievements() {
    if (this.history.some((h) => h.profit >= 2000)) this.unlockAchievement('black_friday');
    if (this.stores.some((s) => this.rangeCount(s) >= PROD_IDS.length)) this.unlockAchievement('full_house');
    if (Object.values(this.vendors).filter((v) => v.discount >= 0.249).length >= 4) this.unlockAchievement('dealmaker');
    if (this.cash >= 100000) this.unlockAchievement('tycoon');
    if (new Set(this.stores.map((s) => this.site(s.siteId).district)).size >= 4) this.unlockAchievement('city_slicker');
    if (this.trucks.length >= 5) this.unlockAchievement('fleet_admiral');
    if (this.stores.filter((s) => s.manager).length >= 4) this.unlockAchievement('people_person');
  }

  checkGoals() {
    const goal = GOALS[this.goalIndex];
    if (!goal || !this.goalMet(goal.id)) return;
    this.cash += goal.reward;
    this.log('🎯', `Objective complete: ${goal.title} (+$${goal.reward.toLocaleString()} bonus).`);
    this.goalIndex++;
  }

  // Event-driven demand multiplier for one product at one store.
  demandMult(store, product) {
    let m = 1;
    const site = this.site(store.siteId);
    for (const e of this.activeEvents) {
      if (e.type === 'cold_snap') {
        if (product === 'frozen') m *= 1.8;
        else if (product === 'dairy') m *= 1.3;
        else if (product === 'produce') m *= 0.85;
      } else if (e.type === 'heat_wave') {
        if (product === 'frozen') m *= 1.6;
        else if (product === 'beverages') m *= 1.5;
      } else if (e.type === 'festival' && e.district === site.district) {
        m *= 1.6;
      } else if (e.type === 'price_war' && e.district === site.district) {
        if (store.markup > 0.92) m *= 0.65;
      } else if (e.type === 'campaign' && e.district === site.district) {
        m *= CAMPAIGN.boost;
      }
      const def = EVENTS[e.type];
      if (def?.productDemand && e.product === product) m *= def.productDemand;
    }
    // Season, holiday, and post-holiday slump.
    const season = this.season();
    m *= season.demand[product] ?? 1;
    const hol = this.currentHoliday();
    if (hol) {
      m *= hol.all ?? 1;
      m *= hol.demand?.[product] ?? 1;
    }
    const after = this.holidayAftermath();
    if (after) m *= after.aftermath;
    return m;
  }

  tickStores(dt) {
    let mkt = 1 + 0.06 * this.roleSkill('marketing');
    if (this.hasTrait('marketing', 'adwizard')) mkt *= 1.03;
    const quality = this.chainQuality();
    const heatWave = !!this.eventOfType('heat_wave');
    const staffEventMult = this.activeEvents.reduce(
      (m, e) => m * (EVENTS[e.type]?.staffMult ?? 1), 1);
    const repTraitBonus = this.hasTrait('marketing', 'localhero') ? 0.03 : 0;

    for (const store of this.stores) {
      const site = this.site(store.siteId);

      // Price elasticity (Couponer softens the high-price penalty).
      let elastic = 1 + (1 - store.markup) * 1.5;
      if (store.markup > 1 && this.hasTrait('marketing', 'couponer')) {
        elastic = 1 + (1 - store.markup) * 1.5 * 0.8;
      }
      elastic = Math.max(0.25, Math.min(1.5, elastic));

      const market = this.marketFactor(store);
      const baseDaily = site.pop * POP_FACTOR * market;
      const effStaff = this.effStaff(store) * staffEventMult;
      // A wider assortment brings in more traffic — and needs more hands.
      const staffNeeded = (baseDaily * this.enabledWeight(store)) / 55;
      const staffRatio = Math.min(1, effStaff / staffNeeded);
      const moraleF = 0.75 + 0.35 * store.morale;
      store.lastStaffRatio = staffRatio;
      const staffF = (0.55 + 0.45 * staffRatio) * moraleF;
      const repF = 0.6 + 0.8 * store.rep;

      let spoilMult = (heatWave ? 2 : 1) * (this.season().spoil ?? 1);
      if (store.upgrades?.coldstorage) spoilMult *= 0.5;
      if (store.manager) spoilMult *= 1 - 0.12 * store.manager.skill * (this.managerTrait(store, 'shelfhawk') ? 2 : 1);
      spoilMult = Math.max(0.2, spoilMult);

      let servedTick = 0, lostTick = 0;
      for (const p of PROD_IDS) {
        if (!store.range[p]) {
          // Leftover stock of a dropped line still spoils on the shelf.
          if (PRODUCTS[p].spoil) store.inv[p] *= 1 - PRODUCTS[p].spoil * spoilMult * dt;
          continue;
        }
        const rate = baseDaily * PRODUCTS[p].weight * elastic * repF * staffF * mkt
          * this.demandMult(store, p);
        const want = rate * dt;
        const sold = Math.min(store.inv[p], want);
        store.inv[p] -= sold;
        const revenue = sold * PRODUCTS[p].retail * store.markup;
        const cogs = sold * this.avgCost[p];
        this.cash += revenue;
        this.stats.totalRevenue += revenue;
        this.today.revenue += revenue;
        this.today.cogs += cogs;
        store.today.revenue += revenue;
        store.today.cogs += cogs;
        this.soldToday[p] += sold;
        this.revToday[p] += revenue;
        servedTick += sold;
        lostTick += want - sold;
        if (want - sold > 0.0001) {
          store.lostByP ??= {};
          store.lostByP[p] = (store.lostByP[p] ?? 0) + (want - sold);
        }
        if (PRODUCTS[p].spoil) store.inv[p] *= 1 - PRODUCTS[p].spoil * spoilMult * dt;
        // Log a stockout once per product per day.
        if (store.inv[p] <= 0.01 && want > 0 && !store.stockoutLogged[p]) {
          store.stockoutLogged[p] = true;
          this.log('🫙', `${store.name} is out of ${PRODUCTS[p].name} — customers walking out.`);
        }
      }
      store.servedToday += servedTick;
      store.lostToday += lostTick;
      this.stats.customersServed += servedTick / 2.5;   // ~basket size
      this.stats.totalRevenue = (this.stats.totalRevenue ?? 0);

      const instAvail = servedTick + lostTick > 0 ? servedTick / (servedTick + lostTick) : 1;
      store.avail += (instAvail - store.avail) * Math.min(1, 2 * dt);

      let repTarget = 0.45 * staffRatio + 0.35 * store.avail + 0.20 * Math.min(1, quality)
        + repTraitBonus + (this.managerTrait(store, 'peopleperson') ? 0.04 : 0);
      repTarget = Math.max(0, Math.min(1, repTarget));
      const repRate = (repTraitBonus || this.managerTrait(store, 'peopleperson')) ? 0.8 : 0.6;
      store.rep += (repTarget - store.rep) * repRate * dt;

      // Morale: adequate staffing + a manager keep spirits up.
      let moraleTarget = 0.45 + 0.35 * staffRatio
        + (store.manager ? 0.05 + 0.05 * store.manager.skill : 0)
        + (this.managerTrait(store, 'motivator') ? 0.08 : 0);
      moraleTarget = Math.max(0.1, Math.min(1, moraleTarget));
      store.morale += (moraleTarget - store.morale) * 0.4 * dt;
    }
  }

  // ---- trucks -----------------------------------------------------------

  doorTile(x, y) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && isRoad(nx, ny)) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  roadPath(from, to) {
    const key = (x, y) => x * GRID + y;
    const prev = new Map([[key(from.x, from.y), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.x === to.x && cur.y === to.y) {
        const path = [];
        let k = key(cur.x, cur.y), node = cur;
        while (node) {
          path.push(node);
          node = prev.get(k);
          if (node) k = key(node.x, node.y);
        }
        return path.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        if (!isRoad(nx, ny)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, cur);
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  finishUnload(truck, delivered) {
    if (delivered > 0.5) {
      this.deliveryPing++;
      const site = this.site(truck.storeId);
      if (site) this.addFloater(site.x, site.y, `+${Math.round(delivered)} stock`, '#9ec7ef');
    }
    truck.cargo = null;
    truck.cargo0 = null;
    truck.path = [...truck.path].reverse();
    truck.pos = 0;
    truck.state = 'return';
  }

  storeDeficit(store) {
    const enroute = {};
    for (const t of this.trucks) {
      if (t.cargo && t.storeId === store.siteId && (t.state === 'toStore' || t.state === 'unloading')) {
        for (const [p, q] of Object.entries(t.cargo)) enroute[p] = (enroute[p] || 0) + q;
      }
    }
    const def = {};
    let total = 0;
    for (const p of PROD_IDS) {
      if (!store.range[p]) { def[p] = 0; continue; }
      const d = Math.max(0, SHELF_CAP - store.inv[p] - (enroute[p] || 0));
      def[p] = d;
      total += Math.min(d, this.warehouse.inv[p]);
    }
    return { def, total };
  }

  tickTrucks(dt) {
    const logi = this.roleSkill('logistics');
    let speed = TRUCK_SPEED * (1 + 0.18 * logi);
    let cap = TRUCK_CAP * (1 + 0.18 * logi);
    if (this.hasTrait('logistics', 'speedster')) speed *= 1.10;
    if (this.hasTrait('logistics', 'tetris')) cap *= 1.10;
    if (this.hasTrait('logistics', 'planner')) { speed *= 1.05; cap *= 1.05; }
    if (this.eventOfType('roadworks')) speed *= 0.6;
    speed *= this.season().truck ?? 1;
    cap = Math.round(cap);

    if (this.week) {
      this.week.truckSamples++;
      if (this.trucks.some((t) => t.state !== 'idle')) this.week.truckBusy++;
    }
    for (const truck of this.trucks) {
      if (truck.state === 'idle') {
        let best = null, bestTotal = 24;
        for (const store of this.stores) {
          const { total } = this.storeDeficit(store);
          if (total > bestTotal) { bestTotal = total; best = store; }
        }
        if (!best) continue;
        const site = this.site(best.siteId);
        const whDoor = this.doorTile(WAREHOUSE.x, WAREHOUSE.y);
        const stDoor = this.doorTile(site.x, site.y);
        const path = whDoor && stDoor ? this.roadPath(whDoor, stDoor) : null;
        if (!path) continue;
        const { def } = this.storeDeficit(best);
        const cargo = {};
        let space = cap;
        for (const p of [...PROD_IDS].sort((a, b) => def[b] - def[a])) {
          if (space <= 0) break;
          const take = Math.min(def[p], this.warehouse.inv[p], space);
          if (take <= 0) continue;
          cargo[p] = take;
          this.warehouse.inv[p] -= take;
          space -= take;
        }
        if (space === cap) continue;
        truck.state = 'toStore';
        truck.path = path;
        truck.pos = 0;
        truck.cargo = cargo;
        truck.storeId = best.siteId;
      } else if (truck.state === 'unloading') {
        const store = this.storeAt(truck.storeId);
        if (!store) {
          // Store closed mid-delivery — haul it all back.
          for (const [p, q] of Object.entries(truck.cargo)) this.warehouse.inv[p] += q;
          this.finishUnload(truck, 0);
          continue;
        }
        // Hand-truck the goods in crate by crate.
        const frac = Math.min(1, dt / TRUCK_UNLOAD);
        let remaining = 0;
        for (const p of Object.keys(truck.cargo)) {
          const step = (truck.cargo0[p] ?? 0) * frac;
          const move = Math.min(truck.cargo[p], step);
          const add = Math.min(move, Math.max(0, SHELF_CAP - store.inv[p]));
          store.inv[p] += add;
          truck.cargo[p] -= move;
          this.warehouse.inv[p] += move - add;   // shelf overflow rides back later
          truck.delivered += add;
          remaining += truck.cargo[p];
        }
        truck.unloadT += dt;
        if (remaining <= 0.01 || truck.unloadT > TRUCK_UNLOAD * 1.5) {
          for (const [p, q] of Object.entries(truck.cargo)) this.warehouse.inv[p] += q;
          this.finishUnload(truck, truck.delivered);
        }
      } else {
        truck.pos += speed * dt;
        if (truck.pos < truck.path.length - 1) continue;
        if (truck.state === 'toStore') {
          truck.state = 'unloading';
          truck.unloadT = 0;
          truck.delivered = 0;
          truck.cargo0 = { ...truck.cargo };
        } else {
          truck.state = 'idle';
          truck.path = null;
          truck.storeId = null;
        }
      }
    }
  }

  // ---- events -----------------------------------------------------------

  spawnEvent() {
    const seasonId = this.season().id;
    const pool = Object.keys(EVENTS).filter((t) => {
      const def = EVENTS[t];
      if (def.player) return false;               // campaigns are yours to launch
      if (def.seasons && !def.seasons.includes(seasonId)) return false;
      if (t === 'strike') return this.day() >= 8;
      return true;
    });
    const type = pool[Math.floor(Math.random() * pool.length)];
    const def = EVENTS[type];

    if (type === 'inspection') {
      if (!this.stores.length) return;
      const store = this.stores[Math.floor(Math.random() * this.stores.length)];
      const site = this.site(store.siteId);
      const effStaff = this.effStaff(store);
      const ok = effStaff / (site.pop * POP_FACTOR * this.marketFactor(store) * this.enabledWeight(store) / 55) >= 0.85;
      if (ok) {
        store.rep = Math.min(1, store.rep + 0.08);
        this.log('🧾', `Health inspection at ${store.name}: passed with flying colors. Reputation up.`);
      } else {
        this.cash -= 500;
        this.today.fines += 500;
        store.rep = Math.max(0, store.rep - 0.1);
        this.log('🧾', `Health inspection at ${store.name}: understaffed and sloppy. Fined $500.`);
      }
      return;
    }

    if (type === 'fridge') {
      if (!this.stores.length) return;
      const store = this.stores[Math.floor(Math.random() * this.stores.length)];
      for (const p of ['dairy', 'meat', 'frozen']) store.inv[p] *= 0.5;
      this.log('🧊', `Fridge breakdown at ${store.name} — half the dairy, meat, and frozen stock lost.`);
      return;
    }

    const ev = {
      type,
      daysLeft: def.dur[0] + Math.floor(Math.random() * (def.dur[1] - def.dur[0] + 1)),
    };
    if (def.productPick) {
      const carried = this.carriedProducts();
      if (!carried.length) return;
      ev.product = carried[Math.floor(Math.random() * carried.length)];
      this.log(def.icon, `${def.name}: ${PRODUCTS[ev.product].name}. ${def.desc}`);
      this.activeEvents.push(ev);
      return;
    }
    if (type === 'strike') {
      const vendorIds = Object.keys(VENDORS);
      ev.vendor = vendorIds[Math.floor(Math.random() * vendorIds.length)];
      this.log(def.icon, `${VENDORS[ev.vendor].name} workers walked out — no deliveries until it's settled.`);
    } else if (type === 'festival' || type === 'price_war') {
      const open = DISTRICTS.filter((d) => this.districtUnlocked(d.id));
      ev.district = open[Math.floor(Math.random() * open.length)].id;
      this.log(def.icon, `${def.name} in ${this.district(ev.district).name}: ${def.desc}`);
    } else {
      this.log(def.icon, `${def.name}: ${def.desc}`);
    }
    this.activeEvents.push(ev);
  }

  // ---- delegation: staff who make decisions ------------------------------

  delegationActive(id) {
    return this.delegation[id] && !!this.hq[DELEGATIONS[id].role];
  }

  runDelegation(day) {
    // --- Store managers: staffing & pricing at their own cadence. ---------
    this.stores.forEach((store, idx) => {
      const m = store.manager;
      if (!m) return;
      const cadence = 4 - m.skill;               // ★★★ acts daily, ★ every 3rd day
      if ((day + idx) % cadence !== 0) return;
      const site = this.site(store.siteId);

      if (store.delegate.staffing) {
        const needed = (site.pop * POP_FACTOR * this.marketFactor(store) * this.enabledWeight(store)) / 55;
        const noise = (Math.random() - 0.5) * (3 - m.skill) * 0.8;
        const target = Math.max(1, Math.min(8, Math.round(needed + 0.3 + noise)));
        if (target > store.staff) {
          store.staff++;
          this.log('🧠', `${m.name} hired a stocker at ${store.name} for the rush (${store.staff} staff).`);
        } else if (target < store.staff) {
          store.staff--;
          this.log('🧠', `${m.name} trimmed the roster at ${store.name} (${store.staff} staff).`);
        }
      }

      if (store.delegate.pricing) {
        let target = 1.0 + 0.05 * (m.skill - 1);  // skilled managers hold higher prices
        if (store.rep < 0.45) target = 0.95;      // win shoppers back
        const war = this.activeEvents.find((e) => e.type === 'price_war' && e.district === site.district);
        if (war) target = 0.90;                   // undercut the discounter
        target += (Math.random() - 0.5) * 0.05 * (3 - m.skill);
        target = Math.max(0.8, Math.min(1.4, Math.round(target * 20) / 20));
        if (Math.abs(target - store.markup) >= 0.049) {
          store.markup += Math.sign(target - store.markup) * 0.05;
          store.markup = Math.round(store.markup * 20) / 20;
          const why = war ? ' to fight the price war' : store.rep < 0.45 ? ' to win back shoppers' : '';
          this.log('🧠', `${m.name} set ${store.name} prices to ${Math.round(store.markup * 100)}%${why}.`);
        }
      }
    });

    // --- Head Buyer: sourcing, negotiation, reorder tuning. ---------------
    const buyer = this.hq.buyer;
    if (buyer) {
      const carried = this.carriedProducts();

      if (this.delegationActive('sourcing')) {
        const qWeight = 0.10 * (buyer.skill - 1);  // skilled buyers value quality
        for (const p of carried) {
          const pol = this.purchasing[p];
          const score = (vid) =>
            this.unitCost(p, vid) * (1 - qWeight * (VENDORS[vid].quality - 1));
          let best = null;
          for (const vid of Object.keys(VENDORS)) {
            if (!VENDORS[vid].products.includes(p) || this.vendorStruck(vid)) continue;
            if (!best || score(vid) < score(best)) best = vid;
          }
          if (!best || best === pol.vendor) continue;
          const mustSwitch = this.vendorStruck(pol.vendor);
          if (mustSwitch || score(best) < score(pol.vendor) * 0.96) {
            const from = VENDORS[pol.vendor].name, to = VENDORS[best].name;
            pol.vendor = best;
            this.log('💼', mustSwitch
              ? `${buyer.name} re-sourced ${PRODUCTS[p].name} to ${to} around the ${from} strike.`
              : `${buyer.name} switched ${PRODUCTS[p].name} sourcing from ${from} to ${to}.`);
          }
        }
      }

      if (this.delegationActive('negotiate') && this.meetingsLeft > 0) {
        const targets = Object.keys(VENDORS)
          .filter((vid) => this.vendors[vid].discount < 0.249
            && this.vendors[vid].lastNegDay !== day
            && carried.some((p) => this.purchasing[p].vendor === vid))
          .sort((a, b) => this.vendors[b].rel - this.vendors[a].rel);
        if (targets.length) { this.meetingsLeft--; this.negotiate(targets[0]); }   // success logs itself
      }

      if (this.delegationActive('reorders')) {
        let retuned = 0;
        for (const p of carried) {
          const avg = this.demandEma[p];
          if (avg < 2) continue;
          const pol = this.purchasing[p];
          const lead = VENDORS[pol.vendor].leadTime;
          const point = Math.ceil(avg * (lead + 1 + 0.5 * buyer.skill) / 25) * 25;
          const qty = Math.max(50, Math.ceil(avg * 3.5 / 25) * 25);
          if (Math.abs(point - pol.point) / Math.max(pol.point, 1) > 0.2
            || Math.abs(qty - pol.qty) / Math.max(pol.qty, 1) > 0.2) retuned++;
          pol.point = point;
          pol.qty = qty;
        }
        if (retuned >= 2) {
          this.log('💼', `${buyer.name} retuned standing orders on ${retuned} product lines to match demand.`);
        }
      }
    }

    // --- Logistics Manager: fleet & warehouse capex (opt-in). -------------
    if (this.delegationActive('fleet')) {
      const lm = this.hq.logistics;
      const starving = this.stores.filter((s) => {
        const total = PROD_IDS.reduce((sum, p) => sum + (s.range[p] ? s.inv[p] : 0), 0);
        return total < SHELF_CAP * this.rangeCount(s) * 0.35;
      }).length;
      if (starving >= 2 && this.cash > TRUCK_COST * 2.5 && this.trucks.length < this.stores.length) {
        this.buyTruck();
        this.log('💼', `${lm.name}: "${starving} stores are running dry — I bought us another truck."`);
      }
      if (this.whFullStreak >= 2 && this.cash > WAREHOUSE_UPGRADE.cost * 2) {
        this.upgradeWarehouse();
        this.whFullStreak = 0;
        this.log('💼', `${lm.name}: "The warehouse was bursting — I signed off on an expansion."`);
      }
    }
  }

  // ---- day boundary -----------------------------------------------------

  dayTick() {
    const day = this.day();

    // Close out yesterday's books first (opex accrues here for real).
    const w = this.wageMult();
    let rent = 0, wages = 0, salaries = 0;
    for (const store of this.stores) {
      rent += this.site(store.siteId).rent;
      wages += store.staff * STAFF_WAGE * w;
      if (store.manager) salaries += store.manager.salary * w;
    }
    for (const role of Object.keys(ROLES)) {
      if (this.hq[role]) salaries += this.hq[role].salary * w;
    }
    this.cash -= rent + wages + salaries;

    // Debt: the bank charges interest on a negative balance — and has limits.
    let interest = 0;
    if (this.cash < 0) {
      interest = -this.cash * DEBT_INTEREST;
      this.cash -= interest;
    }
    this.today.interest += interest;
    if (this.cash < -500) {
      this.debtDays++;
      if (this.debtDays >= DEBT_GRACE_DAYS || this.cash < DEBT_HARD_LIMIT) {
        this.gameOver = true;
        this.log('💥', 'The bank pulled your credit line. It\'s over.');
      } else {
        this.log('🏦', `Bank warning ${this.debtDays}/${DEBT_GRACE_DAYS}: get back in the black or lose the company.`);
      }
    } else {
      this.debtDays = 0;
    }

    this.today.rent = rent;
    this.today.wages = wages;
    this.today.salaries = salaries;
    const t = this.today;
    // Chain KPIs for the dashboard: fill rate, shelf stock, warehouse use.
    let served = 0, lost = 0, shelfInv = 0, shelfCap = 0;
    for (const st of this.stores) {
      served += st.servedToday;
      lost += st.lostToday;
      for (const p of PROD_IDS) if (st.range[p]) { shelfInv += st.inv[p]; shelfCap += SHELF_CAP; }
    }
    this.history.push({
      day: day - 1,
      revenue: t.revenue, cogs: t.cogs, rent, wages, salaries, fines: t.fines,
      interest: t.interest,
      profit: t.revenue - t.cogs - rent - wages - salaries - t.fines - t.interest,
      fill: served + lost > 0 ? served / (served + lost) : 1,
      shelf: shelfCap > 0 ? shelfInv / shelfCap : 0,
      wh: this.warehouseUsed() / this.warehouse.cap,
    });
    if (this.history.length > 60) this.history.shift();
    this.today = this.blankLedger();

    // Update measured demand (for the buyer's reorder tuning), then reset.
    for (const p of PROD_IDS) {
      const sold = this.soldToday[p];
      this.yesterdayByProduct[p] = { units: sold, revenue: this.revToday[p] ?? 0 };
      this.demandEma[p] = this.demandEma[p] > 0
        ? 0.75 * this.demandEma[p] + 0.25 * sold
        : sold;
      this.soldToday[p] = 0;
      this.revToday[p] = 0;
    }

    // Warehouse shortage days: lines the depot couldn't have shipped today.
    for (const p of PROD_IDS) {
      if (this.warehouse.inv[p] < 15 && this.stores.some((s) => s.range[p])) {
        this.week.whShort[p] = (this.week.whShort[p] ?? 0) + 1;
      }
    }
    for (const store of this.stores) {
      const dayProfit = store.today.revenue - store.today.cogs
        - this.site(store.siteId).rent - store.staff * STAFF_WAGE * this.wageMult()
        - (store.manager ? store.manager.salary * this.wageMult() : 0);
      this.week.storeProfit[store.siteId] =
        (this.week.storeProfit[store.siteId] ?? 0) + dayProfit;
      const ws = this.week.stores[store.siteId] ??= {
        rev: 0, profit: 0, served: 0, lost: 0, so: {}, lostByP: {},
        revDaily: [], staffAcc: 0, days: 0, repStart: store.rep,
      };
      ws.rev += store.today.revenue;
      ws.profit += dayProfit;
      ws.served += store.servedToday;
      ws.lost += store.lostToday;
      ws.staffAcc += store.lastStaffRatio ?? 1;
      ws.revDaily.push(Math.round(store.today.revenue));
      ws.days++;
      for (const p of PROD_IDS) {
        if (store.stockoutLogged[p]) ws.so[p] = (ws.so[p] ?? 0) + 1;
        if (store.lostByP?.[p]) ws.lostByP[p] = (ws.lostByP[p] ?? 0) + store.lostByP[p];
      }
      store.lostByP = {};
      store.yesterday = {
        revenue: store.today.revenue,
        cogs: store.today.cogs,
        profit: store.today.revenue - store.today.cogs
          - this.site(store.siteId).rent - store.staff * STAFF_WAGE
          - (store.manager ? store.manager.salary : 0),
      };
      store.today = { revenue: 0, cogs: 0 };
      store.servedToday = 0;
      store.lostToday = 0;
      store.stockoutLogged = {};
    }

    // Volume riders come due: honored builds trust, blown ones sting.
    for (const [vid, vs] of Object.entries(this.vendors)) {
      if (!vs.rider) continue;
      if (vs.rider.ordered >= vs.rider.qty) {
        vs.rel = Math.min(100, vs.rel + 4);
        this.log('📦', `Volume commitment honored with ${VENDORS[vid].name} — they'll remember that.`);
        vs.rider = null;
      } else if (day >= vs.rider.deadline) {
        vs.rel = Math.max(0, vs.rel - NEGO.riderRelFail);
        vs.discount = Math.max(0, vs.discount - vs.rider.bonus);
        this.log('📦', `Missed the ${vs.rider.qty}-unit commitment to ${VENDORS[vid].name} — the extra ${Math.round(vs.rider.bonus * 100)}% is gone and trust took a hit.`);
        vs.rider = null;
      }
    }

    // Vendor deliveries (strikes hold shipments at the depot).
    const arriving = [];
    this.orders = this.orders.filter((o) => {
      if (o.arriveDay > day) return true;
      if (this.vendorStruck(o.vendor)) { o.arriveDay = day + 1; return true; }
      arriving.push(o);
      return false;
    });
    for (const o of arriving) {
      const space = Math.floor(this.warehouse.cap - this.warehouseUsed());
      const accepted = Math.min(o.qty, Math.max(0, space));
      // Update weighted-average cost with the accepted units.
      const prevInv = this.warehouse.inv[o.product];
      if (prevInv + accepted > 0) {
        this.avgCost[o.product] =
          (prevInv * this.avgCost[o.product] + accepted * o.unitCost) / (prevInv + accepted);
      }
      this.warehouse.inv[o.product] += accepted;
      if (accepted < o.qty) {
        this.log('🏭', `Warehouse full — turned away ${o.qty - accepted} ${PRODUCTS[o.product].name}.`);
      }
      this.addFloater(WAREHOUSE.x, WAREHOUSE.y, `+${accepted} ${PRODUCTS[o.product].name}`, '#6fd08c');
    }

    // Let the staff make their delegated calls before the standing orders run.
    this.runDelegation(day);

    // Auto-reorder (skip lines no store carries — no point warehousing them).
    // Capacity-aware: never order what the warehouse can't take on arrival.
    const carried = new Set(this.carriedProducts());
    let projected = this.warehouseUsed()
      + this.orders.reduce((s, o) => s + o.qty, 0);
    let warnedFull = false;
    // Most-depleted lines (relative to their reorder point) order first, so
    // a tight warehouse squeezes every line a little instead of starving one.
    const needy = PROD_IDS
      .filter((p) => {
        const pol = this.purchasing[p];
        return pol.auto && carried.has(p) && pol.point > 0
          && this.warehouse.inv[p] + this.inTransit(p) < pol.point;
      })
      .sort((a, b) =>
        (this.warehouse.inv[a] + this.inTransit(a)) / this.purchasing[a].point
        - (this.warehouse.inv[b] + this.inTransit(b)) / this.purchasing[b].point);
    for (const p of needy) {
      const pol = this.purchasing[p];
      const space = this.warehouse.cap - projected;
      const qty = Math.min(pol.qty, Math.floor(space));
      if (qty < 25) {
        if (!warnedFull) {
          warnedFull = true;
          this.log('🏭', `Warehouse too full to reorder ${PRODUCTS[p].name} — expand it or trim standing orders.`);
        }
        continue;
      }
      if (this.placeOrder(p, pol.vendor, qty, true)) {
        projected += qty;
      } else if (this.cash < this.unitCost(p, pol.vendor) * qty && !this.cashCrunchWarned) {
        this.cashCrunchWarned = true;
        this.log('⚠️', `Not enough cash to restock ${PRODUCTS[p].name} — empty shelves will follow. Raise cash or cut costs!`);
      }
    }
    this.cashCrunchWarned = false;
    this.whFullStreak = warnedFull ? this.whFullStreak + 1 : 0;

    // Warehouse spoilage (cold storage halves shelf rates).
    for (const p of PERISHABLE) {
      this.warehouse.inv[p] *= 1 - PRODUCTS[p].spoil * 0.5;
    }

    // Calendar beats: season changes, holiday announcements, starts, ends.
    if (this.seasonDay() === 1 && day > 1) {
      const s = this.season();
      this.log(s.icon, `${s.name} has arrived.`);
    }
    const up = this.upcomingHoliday();
    if (up) {
      const key = `${up.holiday.id}@${Math.floor((this.yearDay() + up.inDays) / YEAR_DAYS)}-${this.day() + up.inDays}`;
      if (this.announcedHoliday !== up.holiday.id + key.split('-')[1]) {
        this.announcedHoliday = up.holiday.id + key.split('-')[1];
        if (up.inDays === HOLIDAY_ANNOUNCE) {
          this.log('📅', `${up.holiday.icon} ${up.holiday.name} in ${up.inDays} days — stock up on ${up.holiday.tip}!`);
        }
      }
    }
    const hol = this.currentHoliday();
    if (hol && this.activeHolidayId !== hol.id) {
      this.activeHolidayId = hol.id;
      this.log(hol.icon, `${hol.name} begins! ${hol.desc}`);
    } else if (!hol && this.activeHolidayId) {
      const ended = HOLIDAYS.find((h) => h.id === this.activeHolidayId);
      this.log('📅', `${ended?.name ?? 'The holiday'} is over${ended?.aftermathDays ? ' — expect a few slow days' : ''}.`);
      this.activeHolidayId = null;
    }

    // Events: age out, then maybe spawn one (only one running at a time).
    for (const e of this.activeEvents) e.daysLeft--;
    for (const e of this.activeEvents) {
      if (e.daysLeft <= 0) {
        this.log('✅', `${EVENTS[e.type].name} is over.`);
        this.stats.eventsWeathered++;
        if (e.type === 'strike' && this.stores.length) {
          const avail = this.stores.reduce((s, st) => s + st.avail, 0) / this.stores.length;
          if (avail > 0.9) this.unlockAchievement('ironclad');
        }
      }
    }
    this.activeEvents = this.activeEvents.filter((e) => e.daysLeft > 0);
    const randomActive = this.activeEvents.some((e) => !EVENTS[e.type].player);
    if (!randomActive && day >= 4
      && Math.random() < DIFFICULTY[this.diffId].eventChance) {
      this.spawnEvent();
    }

    // The rival chain shops for real estate. Unlike you, they aren't gated
    // by district unlocks — a discounter grabs empty markets first and only
    // contests your turf when the easy lots are gone.
    if (day >= this.rival.nextBuyDay && this.rival.stores.length < DIFFICULTY[this.diffId].rivalMax) {
      const vacant = SITES.filter((s) => !this.storeAt(s.id) && !this.rivalAt(s.id));
      if (vacant.length) {
        const weighted = [];
        for (const s of vacant) {
          const contested = this.stores.some((st) => this.site(st.siteId).district === s.district);
          for (let i = 0; i < (contested ? 1 : 3); i++) weighted.push(s);
        }
        const pick = weighted[Math.floor(Math.random() * weighted.length)];
        this.rival.stores.push(pick.id);
        this.rival.openedDay[pick.id] = day;
        const dname = this.district(pick.district).name;
        const contested = this.stores.some((st) => this.site(st.siteId).district === pick.district);
        this.log('🏪', contested
          ? `${RIVAL.name} opened a discount store in ${dname} — right in your backyard!`
          : `${RIVAL.name} claimed a prime lot in ${dname} before you got there.`);
        this.addFloater(pick.x, pick.y, `${RIVAL.name} opens!`, '#e8828c');
      }
      const [lo, hi] = DIFFICULTY[this.diffId].rivalInterval;
      this.rival.nextBuyDay = day + lo + Math.floor(Math.random() * (hi - lo + 1));
    }

    // Close out the week every 7 days: snapshot a digest for the report.
    if (day > 1 && (day - 1) % 7 === 0) {
      const days = this.history.slice(-7);
      const profit = days.reduce((s, h) => s + h.profit, 0);
      const revenue = days.reduce((s, h) => s + h.revenue, 0);
      const ranked = Object.entries(this.week.storeProfit)
        .map(([sid, p]) => ({ name: this.storeAt(sid)?.name ?? 'closed store', profit: p }))
        .sort((a, b) => b.profit - a.profit);
      const truckUtil = this.week.truckSamples > 0
        ? this.week.truckBusy / this.week.truckSamples : 0;
      this.lastWeekReport = {
        weekEndingDay: day - 1,
        profit, revenue,
        best: ranked[0] ?? null,
        worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
        events: this.week.events.slice(0, 5),
        staffActions: this.week.staffActions,
        rivalStores: this.rival.stores.length,
        stores: this.stores.map((st) => this.storeScorecard(st)).filter(Boolean),
        chain: this.chainFindings(truckUtil),
        truckUtil,
      };
      this.weekReportId++;
      this.meetingsLeft = this.meetingsCap();
      // Deals age: unmaintained discounts drift back down.
      let decayed = false;
      for (const vs of Object.values(this.vendors)) {
        if (vs.discount > 0) { vs.discount = Math.max(0, vs.discount - NEGO.decayPerWeek); decayed = true; }
      }
      if (decayed) this.log('🤝', 'Vendor deals aged a little — discounts drift −1% each week without a fresh handshake.');
      // BuyLow courtship: an unanswered courtship costs you the vendor's favor.
      if (this.rival.courting) {
        const vid = this.rival.courting.vendor;
        const vs = this.vendors[vid];
        vs.courtLossUntil = day + NEGO.courtDays;
        vs.rel = Math.max(0, vs.rel - 10);
        this.log('🦈', `${RIVAL.name} signed a supply deal with ${VENDORS[vid].name} — your prices there are +${Math.round((NEGO.courtPriceMult - 1) * 100)}% for ${NEGO.courtDays} days.`);
        this.rival.courting = null;
      }
      if (this.rival.stores.length > 0 && Math.random() < NEGO.courtChance) {
        const vids = Object.keys(VENDORS).filter((v) => !this.vendors[v].courtLossUntil || day >= this.vendors[v].courtLossUntil);
        const pick = vids[Math.floor(Math.random() * vids.length)];
        if (pick) {
          this.rival.courting = { vendor: pick, until: day + 7 };
          this.log('🦈', `${RIVAL.name} is courting ${VENDORS[pick].name} — close any deal with them this week to keep the account.`);
        }
      }
      this.prevWeekStores = {};
      for (const [sid, ws] of Object.entries(this.week.stores)) {
        this.prevWeekStores[sid] = { rev: ws.rev, profit: ws.profit };
      }
      this.lastWeekReport.prevProfit = this.prevWeekProfit ?? null;
      this.prevWeekProfit = profit;
      this.week = this.blankWeek(day);
      // In weekly mode the week boundary is a planning stop: pause the sim
      // until the player runs the next week.
      if (this.weeklyMode && !this.gameOver) {
        this.preWeekSpeed = this.speed || this.preWeekSpeed || 1;
        this.speed = 0;
        this.planning = true;
      }
    }

    // BuyLow invests: a store older than 20 days becomes a BuyLow+ superstore.
    for (const sid of this.rival.stores) {
      if (!this.rival.plus[sid] && day - (this.rival.openedDay[sid] ?? day) >= 20) {
        this.rival.plus[sid] = true;
        const dname = this.district(this.site(sid).district).name;
        this.log('🏪', `BuyLow upgraded its ${dname} location to a BuyLow+ superstore — expect a harder squeeze there.`);
      }
    }

    // People grow: a day worked is a day learned. Promotions at 15/40 XP.
    const people = [
      ...Object.entries(this.hq).filter(([, p]) => p).map(([role, p]) => [p, `your ${ROLES[role].name}`]),
      ...this.stores.filter((s) => s.manager).map((s) => [s.manager, `${s.name}'s manager`]),
    ];
    for (const [p, title] of people) {
      p.xp = (p.xp || 0) + 1;
      const threshold = p.skill === 1 ? 15 : p.skill === 2 ? 40 : Infinity;
      if (p.xp >= threshold) {
        p.skill++;
        p.salary = Math.round(p.salary * 1.25);
        this.log('🎓', `${p.name} grew into the job — now ${'★'.repeat(p.skill)} (${title}, salary $${p.salary}/day).`);
      }
    }

    // Supply contracts: weekly volume checks, expiry, breaches.
    for (const [vid, vs] of Object.entries(this.vendors)) {
      const c = vs.contract;
      if (!c) continue;
      if (day >= c.weekEnd) {
        if (c.weekOrdered < CONTRACT.weeklyMin) {
          this.cash -= CONTRACT.penalty;
          this.today.fines += CONTRACT.penalty;
          vs.rel = Math.max(0, vs.rel - 15);
          vs.contract = null;
          this.log('📜', `Contract breached with ${VENDORS[vid].name} — only ${Math.round(c.weekOrdered)}/${CONTRACT.weeklyMin} units ordered. $${CONTRACT.penalty} penalty.`);
          continue;
        }
        c.weekOrdered = 0;
        c.weekEnd = day + 7;
      }
      if (day >= c.until) {
        vs.contract = null;
        vs.rel = Math.min(100, vs.rel + 10);
        this.log('📜', `Contract with ${VENDORS[vid].name} completed in full — they remember that.`);
      }
    }

    this.checkAchievements();

    // Relationships drift toward neutral; a connected buyer counteracts it.
    const connected = this.hasTrait('buyer', 'connected');
    for (const v of Object.values(this.vendors)) {
      v.rel += (30 - v.rel) * 0.02 + (connected ? 1 : 0);
      v.rel = Math.min(100, v.rel);
    }
  }

  // ---- persistence ------------------------------------------------------

  // ---- weekly scorecards -------------------------------------------------
  // What happened at each store this week, stated as facts — the decisions
  // stay with the player.

  storeScorecard(store) {
    const ws = this.week.stores[store.siteId];
    if (!ws || ws.days === 0) return null;
    const fill = ws.served + ws.lost > 0 ? ws.served / (ws.served + ws.lost) : 1;
    const staff = ws.staffAcc / ws.days;
    const repDelta = store.rep - ws.repStart;
    const issues = [];
    // Dry shelves, ranked by sales actually missed (momentary dips that cost
    // almost nothing stay out of the report), and split by whether the depot
    // could even have shipped the line.
    const dry = Object.entries(ws.lostByP)
      .filter(([, units]) => units >= 25)
      .sort((a, b) => b[1] - a[1]);
    if (dry.length) {
      const depotToo = dry.filter(([p]) => (this.week.whShort[p] ?? 0) >= 2);
      const list = dry.slice(0, 3)
        .map(([p, units]) => `${PRODUCTS[p].name} (~${Math.round(units)} missed${ws.so[p] ? `, dry ${ws.so[p]}d` : ''})`)
        .join(', ');
      issues.push({
        id: depotToo.length ? 'dry-depot' : 'dry-delivery',
        text: depotToo.length
          ? `Missed sales: ${list} — the warehouse was also empty of ${depotToo.slice(0, 2).map(([p]) => PRODUCTS[p].name).join(' & ')}.`
          : `Missed sales: ${list} — the warehouse had stock that never reached the shelves.`,
      });
    }
    if (staff < 0.85) {
      issues.push({ id: 'understaffed', text: `Staff covered ${Math.round(staff * 100)}% of the traffic — customers waited or walked.` });
    }
    if (ws.profit < 0) {
      issues.push({ id: 'unprofitable', text: `Lost $${Math.round(-ws.profit).toLocaleString()} this week.` });
    }
    if (repDelta < -0.04) {
      issues.push({ id: 'rep-slide', text: `Reputation slid ${Math.round(ws.repStart * 100)}% → ${Math.round(store.rep * 100)}%.` });
    }
    const prev = this.prevWeekStores?.[store.siteId];
    return {
      siteId: store.siteId,
      name: store.name,
      district: this.district(this.site(store.siteId).district).name,
      profit: Math.round(ws.profit),
      revenue: Math.round(ws.rev),
      fill, staff, repDelta, rep: store.rep,
      revDaily: ws.revDaily.slice(),
      prevRevenue: prev ? Math.round(prev.rev) : null,
      prevProfit: prev ? Math.round(prev.profit) : null,
      issues,
    };
  }

  chainFindings(truckUtil) {
    const out = [];
    if (truckUtil > 0.92) {
      out.push({ id: 'fleet-maxed', text: `The truck fleet ran ${Math.round(truckUtil * 100)}% of the week — deliveries queued behind it.` });
    }
    const short = Object.entries(this.week.whShort).filter(([, d]) => d >= 3)
      .sort((a, b) => b[1] - a[1]);
    if (short.length) {
      out.push({
        id: 'depot-dry',
        text: `Warehouse ran empty of ${short.slice(0, 3).map(([p, d]) => `${PRODUCTS[p].name} (${d}d)`).join(', ')}.`,
      });
    }
    const wh = this.warehouseUsed() / this.warehouse.cap;
    if (wh > 0.92) out.push({ id: 'depot-full', text: `Warehouse ended the week ${Math.round(wh * 100)}% full.` });
    if (this.rival.courting) {
      out.push({ id: 'courting', text: `${RIVAL.name} is courting ${VENDORS[this.rival.courting.vendor].name} — no deal has been closed with them yet.` });
    }
    return out;
  }

  // Leave the planning stop and let the new week play out at the speed the
  // player was cruising at before the pause.
  startWeek() {
    this.planning = false;
    if (this.speed === 0) this.speed = this.preWeekSpeed || 1;
  }

  weekNum() {
    return Math.floor((this.day() - 1) / 7) + 1;
  }

  save() {
    const data = {
      cash: this.cash, peakCash: this.peakCash, time: this.time, won: this.won,
      nameCursor: this.nameCursor,
      today: this.today, history: this.history, logEntries: this.logEntries,
      avgCost: this.avgCost,
      stores: this.stores,
      warehouse: this.warehouse,
      truckCount: this.trucks.length,
      orders: this.orders,
      vendors: this.vendors,
      purchasing: this.purchasing,
      hq: this.hq,
      activeEvents: this.activeEvents,
      delegation: this.delegation,
      demandEma: this.demandEma,
      rival: this.rival,
      debtDays: this.debtDays,
      gameOver: this.gameOver,
      goalIndex: this.goalIndex,
      diffId: this.diffId,
      lastCampaignDay: this.lastCampaignDay,
      achieved: this.achieved,
      stats: this.stats,
      weeklyMode: this.weeklyMode,
      planning: this.planning,
      preWeekSpeed: this.preWeekSpeed,
      meetingsLeft: this.meetingsLeft,
      prevWeekStores: this.prevWeekStores ?? null,
      prevWeekProfit: this.prevWeekProfit ?? null,
      lastWeekReport: this.lastWeekReport ?? null,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }

  load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!d || !Array.isArray(d.stores)) return false;
    this.reset(d.diffId);
    this.cash = d.cash; this.peakCash = d.peakCash ?? d.cash;
    this.time = d.time; this.won = !!d.won;
    this.nameCursor = d.nameCursor ?? 0;
    this.today = { ...this.blankLedger(), ...(d.today ?? {}) };
    this.history = d.history ?? [];
    this.logEntries = d.logEntries ?? [];
    this.avgCost = d.avgCost ?? this.avgCost;
    this.stores = d.stores;
    for (const s of this.stores) {
      s.morale ??= 0.7;
      s.manager ??= null;
      s.today ??= { revenue: 0, cogs: 0 };
      s.yesterday ??= { revenue: 0, cogs: 0, profit: 0 };
      s.stockoutLogged ??= {};
      s.slots ??= START_SLOTS;
      s.remodels ??= 0;
      s.delegate ??= { staffing: true, pricing: true };
      s.upgrades ??= {};
      s.range ??= {};
      for (const p of PROD_IDS) {
        s.range[p] ??= !!PRODUCTS[p].core;
        s.inv[p] ??= 0;
      }
    }
    this.warehouse = d.warehouse;
    for (const p of PROD_IDS) {
      this.warehouse.inv[p] ??= 0;
      this.avgCost[p] ??= PRODUCTS[p].cost;
    }
    this.trucks = [];
    for (let i = 0; i < (d.truckCount || 1); i++) {
      this.trucks.push({ state: 'idle', path: null, pos: 0, cargo: null, storeId: null });
    }
    this.orders = d.orders ?? [];
    this.vendors = d.vendors ?? this.vendors;
    for (const o of this.orders) o.unitCost ??= PRODUCTS[o.product].cost;
    this.purchasing = { ...this.purchasing, ...(d.purchasing ?? {}) };
    this.hq = d.hq ?? this.hq;
    this.activeEvents = d.activeEvents ?? [];
    this.delegation = { ...this.delegation, ...(d.delegation ?? {}) };
    this.demandEma = { ...this.demandEma, ...(d.demandEma ?? {}) };
    this.rival = d.rival ?? this.rival;
    this.rival.openedDay ??= {};
    this.rival.plus ??= {};
    this.debtDays = d.debtDays ?? 0;
    this.gameOver = !!d.gameOver;
    this.goalIndex = d.goalIndex ?? 0;
    this.lastCampaignDay = d.lastCampaignDay ?? {};
    this.achieved = d.achieved ?? {};
    this.stats = { ...this.stats, ...(d.stats ?? {}) };
    this.weeklyMode = d.weeklyMode ?? true;
    this.planning = d.planning ?? false;
    this.preWeekSpeed = d.preWeekSpeed ?? 1;
    this.meetingsLeft = d.meetingsLeft ?? NEGO.meetingsPerWeek;
    this.prevWeekStores = d.prevWeekStores ?? null;
    this.prevWeekProfit = d.prevWeekProfit ?? null;
    this.lastWeekReport = d.lastWeekReport ?? this.lastWeekReport;
    if (this.planning) this.speed = 0;
    return true;
  }

  clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }

  exportSave() {
    this.save();
    try { return localStorage.getItem(SAVE_KEY) || ''; } catch { return ''; }
  }

  importSave(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return false; }
    if (!parsed || !Array.isArray(parsed.stores)) return false;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(parsed)); } catch { return false; }
    return this.load();
  }
}
