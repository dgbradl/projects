// Simulation: stores & customer demand, warehouse, truck logistics,
// vendor relationships, staff & managers, city events, P&L ledger, save/load.

import {
  GRID, START_CASH, WIN_CASH, WIN_STORES, POP_FACTOR, SHELF_CAP, STAFF_WAGE,
  HIRE_ROLE_COST, TRUCK_COST, TRUCK_CAP, TRUCK_SPEED, WAREHOUSE_CAP,
  WAREHOUSE_UPGRADE, WAREHOUSE, MANAGER_SALARY, START_SLOTS, REMODEL,
  isRoad, PRODUCTS, VENDORS, DISTRICTS, SITES, ROLES, EVENTS, TRAITS,
  DELEGATIONS, PEOPLE_NAMES,
} from './defs.js';

const SAVE_KEY = 'market-street-save-v2';
const PROD_IDS = Object.keys(PRODUCTS);
const PERISHABLE = PROD_IDS.filter((p) => PRODUCTS[p].spoil > 0);

export class Game {
  constructor() { this.reset(); }

  reset() {
    this.cash = START_CASH;
    this.peakCash = START_CASH;
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
      this.vendors[v] = { rel: 30, discount: 0, lastNegDay: -1 };
    }

    this.purchasing = {};
    for (const p of PROD_IDS) {
      const core = !!PRODUCTS[p].core;
      this.purchasing[p] = {
        auto: true,
        vendor: this.cheapestVendor(p),
        point: core ? 180 : 120,
        qty: core ? 350 : 250,
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
    this.demandEma = {};
    for (const p of PROD_IDS) { this.soldToday[p] = 0; this.demandEma[p] = 0; }
    this.whFullStreak = 0;
  }

  blankLedger() {
    return { revenue: 0, cogs: 0, rent: 0, wages: 0, salaries: 0, fines: 0 };
  }

  addStore(siteId, seeded = false) {
    const store = {
      siteId,
      name: `Market St. #${this.stores.length + 1}`,
      inv: {}, staff: 2, markup: 1.0, rep: 0.5, avail: 1, morale: 0.7,
      manager: null,
      range: {}, slots: START_SLOTS, remodels: 0,
      delegate: { staffing: true, pricing: true },   // used only with a manager
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
    const disc = this.vendors[vendorId].discount;
    const buyer = 1 - 0.02 * this.roleSkill('buyer');
    const trait = this.hasTrait('buyer', 'pennypincher') ? 0.985 : 1;
    return PRODUCTS[product].cost * v.priceMult * (1 - disc) * buyer * trait;
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
    let c = 0;
    for (const store of this.stores) {
      c += this.site(store.siteId).rent + store.staff * STAFF_WAGE;
      if (store.manager) c += store.manager.salary;
    }
    for (const role of Object.keys(ROLES)) {
      if (this.hq[role]) c += this.hq[role].salary;
    }
    return c;
  }

  profitToday() {
    const t = this.today;
    return t.revenue - t.cogs - t.fines - this.dailyOpex() * this.dayFrac();
  }

  // ---- people -----------------------------------------------------------

  nextName() {
    const name = PEOPLE_NAMES[this.nameCursor % PEOPLE_NAMES.length];
    this.nameCursor++;
    return name;
  }

  makeCandidates(role) {
    const traits = TRAITS[role];
    const baseSalary = role === 'manager' ? MANAGER_SALARY : 60;
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
    if (!site || this.storeAt(siteId)) return false;
    if (!this.districtUnlocked(site.district)) return false;
    if (this.cash < site.price) return false;
    this.cash -= site.price;
    const store = this.addStore(siteId);
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
    this.orders.push({
      vendor: vendorId, product, qty,
      arriveDay: this.day() + v.leadTime, unitCost: unit,
    });
    const vs = this.vendors[vendorId];
    vs.rel = Math.min(100, vs.rel + Math.min(4, qty / 150));
    return true;
  }

  negotiate(vendorId) {
    const vs = this.vendors[vendorId];
    if (vs.lastNegDay === this.day()) return { done: true };
    vs.lastNegDay = this.day();
    let chance = 0.25 + vs.rel / 200 + 0.12 * this.roleSkill('buyer');
    if (this.hasTrait('buyer', 'haggler')) chance += 0.08;
    if (Math.random() < chance) {
      vs.discount = Math.min(0.25, vs.discount + 0.05);
      vs.rel = Math.min(100, vs.rel + 8);
      this.log('🤝', `${VENDORS[vendorId].name} agreed to ${Math.round(vs.discount * 100)}% off.`);
      return { success: true };
    }
    vs.rel = Math.max(0, vs.rel - 4);
    return { success: false };
  }

  buyTruck() {
    if (this.cash < TRUCK_COST) return false;
    this.cash -= TRUCK_COST;
    this.trucks.push({ state: 'idle', path: null, pos: 0, cargo: null, storeId: null });
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
  }

  addFloater(x, y, text, color) {
    const stack = this.floaters.filter((f) => f.x === x && f.y === y).length;
    this.floaters.push({ x, y, text, color, age: 0, stack });
    if (this.floaters.length > 30) this.floaters.shift();
  }

  // ---- simulation -------------------------------------------------------

  tick(dt) {
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
      }
    }
    return m;
  }

  tickStores(dt) {
    let mkt = 1 + 0.06 * this.roleSkill('marketing');
    if (this.hasTrait('marketing', 'adwizard')) mkt *= 1.03;
    const quality = this.chainQuality();
    const heatWave = !!this.eventOfType('heat_wave');
    const repTraitBonus = this.hasTrait('marketing', 'localhero') ? 0.03 : 0;

    for (const store of this.stores) {
      const site = this.site(store.siteId);

      // Price elasticity (Couponer softens the high-price penalty).
      let elastic = 1 + (1 - store.markup) * 1.5;
      if (store.markup > 1 && this.hasTrait('marketing', 'couponer')) {
        elastic = 1 + (1 - store.markup) * 1.5 * 0.8;
      }
      elastic = Math.max(0.25, Math.min(1.5, elastic));

      const baseDaily = site.pop * POP_FACTOR;
      const effStaff = store.staff + (store.manager ? 0.5 * store.manager.skill : 0);
      // A wider assortment brings in more traffic — and needs more hands.
      const staffNeeded = (baseDaily * this.enabledWeight(store)) / 55;
      const staffRatio = Math.min(1, effStaff / staffNeeded);
      const moraleF = 0.75 + 0.35 * store.morale;
      const staffF = (0.55 + 0.45 * staffRatio) * moraleF;
      const repF = 0.6 + 0.8 * store.rep;

      let spoilMult = heatWave ? 2 : 1;
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
        this.today.revenue += revenue;
        this.today.cogs += cogs;
        store.today.revenue += revenue;
        store.today.cogs += cogs;
        this.soldToday[p] += sold;
        servedTick += sold;
        lostTick += want - sold;
        if (PRODUCTS[p].spoil) store.inv[p] *= 1 - PRODUCTS[p].spoil * spoilMult * dt;
        // Log a stockout once per product per day.
        if (store.inv[p] <= 0.01 && want > 0 && !store.stockoutLogged[p]) {
          store.stockoutLogged[p] = true;
          this.log('🫙', `${store.name} is out of ${PRODUCTS[p].name} — customers walking out.`);
        }
      }
      store.servedToday += servedTick;
      store.lostToday += lostTick;

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

  storeDeficit(store) {
    const enroute = {};
    for (const t of this.trucks) {
      if (t.cargo && t.storeId === store.siteId && t.state === 'toStore') {
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
    cap = Math.round(cap);

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
      } else {
        truck.pos += speed * dt;
        if (truck.pos < truck.path.length - 1) continue;
        if (truck.state === 'toStore') {
          const store = this.storeAt(truck.storeId);
          if (store) {
            let dropped = 0;
            for (const [p, q] of Object.entries(truck.cargo)) {
              const add = Math.min(q, SHELF_CAP - store.inv[p]);
              store.inv[p] += add;
              dropped += add;
              const back = q - add;
              if (back > 0) this.warehouse.inv[p] += back;
            }
            const site = this.site(truck.storeId);
            if (dropped > 0) this.addFloater(site.x, site.y, `+${Math.round(dropped)} stock`, '#9ec7ef');
          } else if (truck.cargo) {
            for (const [p, q] of Object.entries(truck.cargo)) this.warehouse.inv[p] += q;
          }
          truck.cargo = null;
          truck.path = [...truck.path].reverse();
          truck.pos = 0;
          truck.state = 'return';
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
    const pool = Object.keys(EVENTS).filter((t) => {
      if (t === 'strike') return this.day() >= 8;
      return true;
    });
    const type = pool[Math.floor(Math.random() * pool.length)];
    const def = EVENTS[type];

    if (type === 'inspection') {
      if (!this.stores.length) return;
      const store = this.stores[Math.floor(Math.random() * this.stores.length)];
      const site = this.site(store.siteId);
      const effStaff = store.staff + (store.manager ? 0.5 * store.manager.skill : 0);
      const ok = effStaff / (site.pop * POP_FACTOR * this.enabledWeight(store) / 55) >= 0.85;
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
        const needed = (site.pop * POP_FACTOR * this.enabledWeight(store)) / 55;
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

      if (this.delegationActive('negotiate')) {
        const targets = Object.keys(VENDORS)
          .filter((vid) => this.vendors[vid].discount < 0.249
            && this.vendors[vid].lastNegDay !== day
            && carried.some((p) => this.purchasing[p].vendor === vid))
          .sort((a, b) => this.vendors[b].rel - this.vendors[a].rel);
        if (targets.length) this.negotiate(targets[0]);   // success logs itself
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
    let rent = 0, wages = 0, salaries = 0;
    for (const store of this.stores) {
      rent += this.site(store.siteId).rent;
      wages += store.staff * STAFF_WAGE;
      if (store.manager) salaries += store.manager.salary;
    }
    for (const role of Object.keys(ROLES)) {
      if (this.hq[role]) salaries += this.hq[role].salary;
    }
    this.cash -= rent + wages + salaries;
    this.today.rent = rent;
    this.today.wages = wages;
    this.today.salaries = salaries;
    const t = this.today;
    this.history.push({
      day: day - 1,
      revenue: t.revenue, cogs: t.cogs, rent, wages, salaries, fines: t.fines,
      profit: t.revenue - t.cogs - rent - wages - salaries - t.fines,
    });
    if (this.history.length > 60) this.history.shift();
    this.today = this.blankLedger();

    // Update measured demand (for the buyer's reorder tuning), then reset.
    for (const p of PROD_IDS) {
      const sold = this.soldToday[p];
      this.demandEma[p] = this.demandEma[p] > 0
        ? 0.75 * this.demandEma[p] + 0.25 * sold
        : sold;
      this.soldToday[p] = 0;
    }

    for (const store of this.stores) {
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
      if (this.placeOrder(p, pol.vendor, qty, true)) projected += qty;
    }
    this.whFullStreak = warnedFull ? this.whFullStreak + 1 : 0;

    // Warehouse spoilage (cold storage halves shelf rates).
    for (const p of PERISHABLE) {
      this.warehouse.inv[p] *= 1 - PRODUCTS[p].spoil * 0.5;
    }

    // Events: age out, then maybe spawn one (only one running at a time).
    for (const e of this.activeEvents) e.daysLeft--;
    for (const e of this.activeEvents) {
      if (e.daysLeft <= 0) this.log('✅', `${EVENTS[e.type].name} is over.`);
    }
    this.activeEvents = this.activeEvents.filter((e) => e.daysLeft > 0);
    if (this.activeEvents.length === 0 && day >= 4 && Math.random() < 0.28) {
      this.spawnEvent();
    }

    // Relationships drift toward neutral; a connected buyer counteracts it.
    const connected = this.hasTrait('buyer', 'connected');
    for (const v of Object.values(this.vendors)) {
      v.rel += (30 - v.rel) * 0.02 + (connected ? 1 : 0);
      v.rel = Math.min(100, v.rel);
    }
  }

  // ---- persistence ------------------------------------------------------

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
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }

  load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!d || !Array.isArray(d.stores)) return false;
    this.reset();
    this.cash = d.cash; this.peakCash = d.peakCash ?? d.cash;
    this.time = d.time; this.won = !!d.won;
    this.nameCursor = d.nameCursor ?? 0;
    this.today = d.today ?? this.blankLedger();
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
    return true;
  }

  clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}
