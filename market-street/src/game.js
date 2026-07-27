// Simulation: stores & customer demand, warehouse, truck logistics,
// vendor relationships, HQ staff, expansion milestones, save/load.

import {
  GRID, START_CASH, WIN_CASH, WIN_STORES, POP_FACTOR, SHELF_CAP, STAFF_WAGE,
  HIRE_ROLE_COST, TRUCK_COST, TRUCK_CAP, TRUCK_SPEED, WAREHOUSE_CAP,
  WAREHOUSE_UPGRADE, WAREHOUSE, isRoad, PRODUCTS, VENDORS, DISTRICTS, SITES,
  ROLES, PEOPLE_NAMES,
} from './defs.js';

const SAVE_KEY = 'market-street-save-v1';
const PROD_IDS = Object.keys(PRODUCTS);

export class Game {
  constructor() { this.reset(); }

  reset() {
    this.cash = START_CASH;
    this.peakCash = START_CASH;
    this.time = 0;              // in days (fractional)
    this.speed = 1;
    this.todayRevenue = 0;
    this.todayExpenses = 0;
    this.won = false;
    this.floaters = [];
    this.nameCursor = 0;

    this.stores = [];
    for (const site of SITES) {
      if (site.owned) this.addStore(site.id, true);
    }

    this.warehouse = { cap: WAREHOUSE_CAP, inv: {} };
    for (const p of PROD_IDS) this.warehouse.inv[p] = 100;

    this.trucks = [{ state: 'idle', path: null, pos: 0, cargo: null, storeId: null }];
    this.orders = [];           // { vendor, product, qty, arriveDay, cost }

    this.vendors = {};
    for (const v of Object.keys(VENDORS)) {
      this.vendors[v] = { rel: 30, discount: 0, lastNegDay: -1 };
    }

    // Chain-wide purchasing policy per product.
    this.purchasing = {};
    for (const p of PROD_IDS) {
      this.purchasing[p] = {
        auto: true,
        vendor: this.cheapestVendor(p),
        point: 180,             // reorder when warehouse + in-transit dips below this
        qty: 350,
      };
    }

    this.hq = { buyer: null, logistics: null, marketing: null };
  }

  addStore(siteId, seeded = false) {
    const site = SITES.find((s) => s.id === siteId);
    const store = {
      siteId,
      name: `Market St. #${this.stores.length + 1}`,
      inv: {}, staff: 2, markup: 1.0, rep: 0.5, avail: 1,
      servedToday: 0, lostToday: 0, revenueToday: 0,
    };
    for (const p of PROD_IDS) store.inv[p] = seeded ? SHELF_CAP * 0.7 : 0;
    this.stores.push(store);
    return { site, store };
  }

  // ---- lookups ----------------------------------------------------------

  day() { return Math.floor(this.time) + 1; }
  site(id) { return SITES.find((s) => s.id === id); }
  storeAt(siteId) { return this.stores.find((s) => s.siteId === siteId); }
  siteAtTile(x, y) { return SITES.find((s) => s.x === x && s.y === y); }
  district(id) { return DISTRICTS.find((d) => d.id === id); }

  districtUnlocked(id) { return this.peakCash >= this.district(id).unlock; }

  roleSkill(role) { return this.hq[role] ? this.hq[role].skill : 0; }

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
    return PRODUCTS[product].cost * v.priceMult * (1 - disc) * buyer;
  }

  chainQuality() {
    let q = 0;
    for (const p of PROD_IDS) q += VENDORS[this.purchasing[p].vendor].quality;
    return q / PROD_IDS.length;
  }

  warehouseUsed() {
    return PROD_IDS.reduce((s, p) => s + this.warehouse.inv[p], 0);
  }

  inTransit(product) {
    return this.orders
      .filter((o) => o.product === product)
      .reduce((s, o) => s + o.qty, 0);
  }

  // ---- player actions ---------------------------------------------------

  buyStore(siteId) {
    const site = this.site(siteId);
    if (!site || this.storeAt(siteId)) return false;
    if (!this.districtUnlocked(site.district)) return false;
    if (this.cash < site.price) return false;
    this.cash -= site.price;
    this.todayExpenses += site.price;
    this.addStore(siteId);
    this.addFloater(site.x, site.y, 'Grand opening!', '#f2c14e');
    return true;
  }

  closeStore(siteId) {
    const i = this.stores.findIndex((s) => s.siteId === siteId);
    if (i < 0) return false;
    const site = this.site(siteId);
    const refund = Math.round(site.price * 0.6);
    this.stores.splice(i, 1);
    this.cash += refund;
    // Any truck bound for this store turns around.
    for (const t of this.trucks) {
      if (t.storeId === siteId && t.state !== 'idle') {
        if (t.cargo) {
          // Returned cargo goes back to the warehouse (may briefly overfill).
          for (const [p, q] of Object.entries(t.cargo)) this.warehouse.inv[p] += q;
        }
        t.state = 'idle'; t.path = null; t.cargo = null; t.storeId = null;
      }
    }
    return true;
  }

  placeOrder(product, vendorId, qty) {
    qty = Math.max(0, Math.round(qty));
    const v = VENDORS[vendorId];
    if (!v || !v.products.includes(product) || qty <= 0) return false;
    const cost = Math.round(this.unitCost(product, vendorId) * qty);
    if (this.cash < cost) return false;
    this.cash -= cost;
    this.todayExpenses += cost;
    this.orders.push({
      vendor: vendorId, product, qty,
      arriveDay: this.day() + v.leadTime, cost,
    });
    // Doing business builds the relationship.
    const vs = this.vendors[vendorId];
    vs.rel = Math.min(100, vs.rel + Math.min(4, qty / 150));
    return true;
  }

  negotiate(vendorId) {
    const vs = this.vendors[vendorId];
    if (vs.lastNegDay === this.day()) return { done: true };
    vs.lastNegDay = this.day();
    const chance = 0.25 + vs.rel / 200 + 0.12 * this.roleSkill('buyer');
    if (Math.random() < chance) {
      vs.discount = Math.min(0.25, vs.discount + 0.05);
      vs.rel = Math.min(100, vs.rel + 8);
      return { success: true };
    }
    vs.rel = Math.max(0, vs.rel - 4);
    return { success: false };
  }

  buyTruck() {
    if (this.cash < TRUCK_COST) return false;
    this.cash -= TRUCK_COST;
    this.todayExpenses += TRUCK_COST;
    this.trucks.push({ state: 'idle', path: null, pos: 0, cargo: null, storeId: null });
    return true;
  }

  upgradeWarehouse() {
    if (this.cash < WAREHOUSE_UPGRADE.cost) return false;
    this.cash -= WAREHOUSE_UPGRADE.cost;
    this.todayExpenses += WAREHOUSE_UPGRADE.cost;
    this.warehouse.cap += WAREHOUSE_UPGRADE.units;
    return true;
  }

  hireRole(role) {
    if (this.hq[role] || this.cash < HIRE_ROLE_COST) return false;
    const skill = 1 + Math.floor(Math.random() * 3);
    const name = PEOPLE_NAMES[this.nameCursor % PEOPLE_NAMES.length];
    this.nameCursor++;
    this.hq[role] = { name, skill, salary: 60 * skill };
    this.cash -= HIRE_ROLE_COST;
    this.todayExpenses += HIRE_ROLE_COST;
    return true;
  }

  fireRole(role) { this.hq[role] = null; }

  // ---- simulation -------------------------------------------------------

  addFloater(x, y, text, color) {
    // Stack floaters spawned on the same tile so they don't overlap.
    const stack = this.floaters.filter((f) => f.x === x && f.y === y).length;
    this.floaters.push({ x, y, text, color, age: 0, stack });
    if (this.floaters.length > 30) this.floaters.shift();
  }

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

  tickStores(dt) {
    const mkt = 1 + 0.06 * this.roleSkill('marketing');
    const quality = this.chainQuality();
    for (const store of this.stores) {
      const site = this.site(store.siteId);
      const elastic = Math.max(0.25, Math.min(1.5, 1 + (1 - store.markup) * 1.5));
      const baseDaily = site.pop * POP_FACTOR;
      const staffNeeded = baseDaily / 55;
      const staffRatio = Math.min(1, store.staff / staffNeeded);
      const staffF = 0.55 + 0.45 * staffRatio;
      const repF = 0.6 + 0.8 * store.rep;

      let servedTick = 0, lostTick = 0;
      for (const p of PROD_IDS) {
        const rate = baseDaily * PRODUCTS[p].weight * elastic * repF * staffF * mkt;
        const want = rate * dt;
        const sold = Math.min(store.inv[p], want);
        store.inv[p] -= sold;
        const revenue = sold * PRODUCTS[p].retail * store.markup;
        this.cash += revenue;
        this.todayRevenue += revenue;
        store.revenueToday += revenue;
        servedTick += sold;
        lostTick += want - sold;
        // Perishables spoil on the shelf.
        if (PRODUCTS[p].spoil) store.inv[p] *= 1 - PRODUCTS[p].spoil * dt;
      }
      store.servedToday += servedTick;
      store.lostToday += lostTick;

      const instAvail = servedTick + lostTick > 0 ? servedTick / (servedTick + lostTick) : 1;
      store.avail += (instAvail - store.avail) * Math.min(1, 2 * dt);
      const repTarget = Math.max(0, Math.min(1,
        0.45 * staffRatio + 0.35 * store.avail + 0.20 * Math.min(1, quality)));
      store.rep += (repTarget - store.rep) * 0.6 * dt;
    }
  }

  // ---- trucks -----------------------------------------------------------

  doorTile(x, y) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && isRoad(nx, ny)) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  roadPath(from, to) {
    // BFS over road tiles.
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
    // What the store wants, minus what's already on a truck heading there.
    const enroute = {};
    for (const t of this.trucks) {
      if (t.cargo && t.storeId === store.siteId && t.state === 'toStore') {
        for (const [p, q] of Object.entries(t.cargo)) enroute[p] = (enroute[p] || 0) + q;
      }
    }
    const def = {};
    let total = 0;
    for (const p of PROD_IDS) {
      const d = Math.max(0, SHELF_CAP - store.inv[p] - (enroute[p] || 0));
      def[p] = d;
      total += Math.min(d, this.warehouse.inv[p]);
    }
    return { def, total };
  }

  tickTrucks(dt) {
    const logi = this.roleSkill('logistics');
    const speed = TRUCK_SPEED * (1 + 0.18 * logi);
    const cap = Math.round(TRUCK_CAP * (1 + 0.18 * logi));

    for (const truck of this.trucks) {
      if (truck.state === 'idle') {
        // Pick the store with the biggest fillable deficit.
        let best = null, bestTotal = 24;   // don't bother with tiny runs
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
        // Load by biggest deficit first.
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
              if (back > 0) this.warehouse.inv[p] += back; // returns leftovers later; simplified
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

  // ---- day boundary -----------------------------------------------------

  dayTick() {
    const day = this.day();

    // Vendor deliveries arrive at the warehouse.
    const arriving = this.orders.filter((o) => o.arriveDay <= day);
    this.orders = this.orders.filter((o) => o.arriveDay > day);
    for (const o of arriving) {
      const space = this.warehouse.cap - this.warehouseUsed();
      const accepted = Math.min(o.qty, Math.max(0, space));
      this.warehouse.inv[o.product] += accepted;
      this.addFloater(WAREHOUSE.x, WAREHOUSE.y,
        accepted < o.qty
          ? `+${accepted} ${PRODUCTS[o.product].name} (${o.qty - accepted} turned away!)`
          : `+${accepted} ${PRODUCTS[o.product].name}`,
        accepted < o.qty ? '#e8828c' : '#6fd08c');
    }

    // Auto-reorder against warehouse + in-transit stock.
    for (const p of PROD_IDS) {
      const pol = this.purchasing[p];
      if (!pol.auto) continue;
      if (this.warehouse.inv[p] + this.inTransit(p) < pol.point) {
        this.placeOrder(p, pol.vendor, pol.qty);
      }
    }

    // Rent, wages, salaries.
    let costs = 0;
    for (const store of this.stores) {
      costs += this.site(store.siteId).rent + store.staff * STAFF_WAGE;
      store.servedToday = 0;
      store.lostToday = 0;
      store.revenueToday = 0;
    }
    for (const role of Object.keys(ROLES)) {
      if (this.hq[role]) costs += this.hq[role].salary;
    }
    this.cash -= costs;
    this.todayRevenue = 0;
    this.todayExpenses = costs;

    // Warehouse spoilage on perishables (cold storage halves it).
    for (const p of PROD_IDS) {
      if (PRODUCTS[p].spoil) this.warehouse.inv[p] *= 1 - PRODUCTS[p].spoil * 0.5;
    }

    // Vendor relationships drift slowly toward neutral.
    for (const v of Object.values(this.vendors)) {
      v.rel += (30 - v.rel) * 0.02;
    }
  }

  // ---- persistence ------------------------------------------------------

  save() {
    const data = {
      cash: this.cash, peakCash: this.peakCash, time: this.time, won: this.won,
      nameCursor: this.nameCursor,
      stores: this.stores,
      warehouse: this.warehouse,
      truckCount: this.trucks.length,
      orders: this.orders,
      vendors: this.vendors,
      purchasing: this.purchasing,
      hq: this.hq,
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
    this.stores = d.stores;
    this.warehouse = d.warehouse;
    this.trucks = [];
    for (let i = 0; i < (d.truckCount || 1); i++) {
      this.trucks.push({ state: 'idle', path: null, pos: 0, cargo: null, storeId: null });
    }
    this.orders = d.orders ?? [];
    this.vendors = d.vendors ?? this.vendors;
    this.purchasing = d.purchasing ?? this.purchasing;
    this.hq = d.hq ?? this.hq;
    return true;
  }

  clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}
