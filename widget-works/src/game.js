// Simulation: grid state, conveyor flow, machines, market economics, staff.

import {
  GRID, DAY_LENGTH, BELT_SPEED, START_CASH, WIN_CASH, HIRE_BONUS,
  DEMOLISH_REFUND, DX, DY, GOODS, RECIPES, BUILDINGS, WORKER_NAMES,
} from './defs.js';

const SAVE_KEY = 'widget-works-save-v1';

export class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.grid = [];
    for (let x = 0; x < GRID; x++) {
      this.grid.push(new Array(GRID).fill(null));
    }
    this.cash = START_CASH;
    this.day = 1;
    this.dayClock = 0;
    this.time = 0;
    this.speed = 1;
    this.todayRevenue = 0;
    this.todayExpenses = 0;
    this.workers = [];
    this.hiredCount = 0;
    this.won = false;
    this.floaters = [];       // transient "+$42" texts
    this.log = [];
    // Per-good market state: demand drifts down when you sell, recovers over time.
    this.market = {};
    for (const id of Object.keys(GOODS)) {
      this.market[id] = { demand: 1, phase: Math.random() * Math.PI * 2, prevPrice: GOODS[id].sell };
    }
  }

  // ---- queries ----------------------------------------------------------

  cell(x, y) {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return undefined;
    return this.grid[x][y];
  }

  sellPrice(goodId) {
    const g = GOODS[goodId];
    const m = this.market[goodId];
    const seasonal = 1 + 0.12 * Math.sin(this.time * 0.05 + m.phase);
    return Math.max(1, Math.round(g.sell * seasonal * m.demand));
  }

  buyPrice(goodId) {
    const g = GOODS[goodId];
    if (!g.buy) return null;
    const m = this.market[goodId];
    const seasonal = 1 + 0.1 * Math.sin(this.time * 0.04 + m.phase + 2);
    return Math.max(1, Math.round(g.buy * seasonal));
  }

  machines() {
    const out = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const b = this.grid[x][y];
        if (b && BUILDINGS[b.type].needsWorker) out.push(b);
      }
    }
    return out;
  }

  // First N machines (in placement order) get the first N workers.
  assignWorkers() {
    const ms = this.machines().sort((a, b) => a.placedAt - b.placedAt);
    ms.forEach((m, i) => { m.worker = i < this.workers.length ? this.workers[i] : null; });
  }

  // ---- build / demolish -------------------------------------------------

  canPlace(type, x, y) {
    const def = BUILDINGS[type];
    return !!def && this.cell(x, y) === null && this.cash >= def.cost;
  }

  place(type, x, y, dir) {
    if (!this.canPlace(type, x, y)) return false;
    const def = BUILDINGS[type];
    const b = { type, x, y, dir, placedAt: this.time + Math.random() * 1e-6 };
    if (type === 'belt') b.item = null;                    // { good, progress }
    if (def.good) { b.timer = 0; b.enabled = true; }
    if (def.recipe) {
      b.buf = {};
      for (const g of Object.keys(RECIPES[def.recipe].inputs)) b.buf[g] = 0;
      b.working = false;
      b.t = 0;
      b.outCount = 0;
      b.worker = null;
    }
    this.grid[x][y] = b;
    this.cash -= def.cost;
    this.todayExpenses += def.cost;
    this.assignWorkers();
    return true;
  }

  demolish(x, y) {
    const b = this.cell(x, y);
    if (!b) return false;
    const refund = Math.round(BUILDINGS[b.type].cost * DEMOLISH_REFUND);
    this.grid[x][y] = null;
    this.cash += refund;
    this.addFloater(x, y, `+$${refund}`, '#8b96a6');
    this.assignWorkers();
    return true;
  }

  // ---- staff ------------------------------------------------------------

  hire() {
    if (this.cash < HIRE_BONUS) return false;
    const skill = 1 + Math.floor(Math.random() * 3);       // 1..3
    const name = WORKER_NAMES[this.hiredCount % WORKER_NAMES.length];
    this.hiredCount++;
    this.workers.push({ name, skill, wage: 40 + skill * 15 });
    this.cash -= HIRE_BONUS;
    this.todayExpenses += HIRE_BONUS;
    this.assignWorkers();
    return true;
  }

  fire(index) {
    if (index < 0 || index >= this.workers.length) return;
    this.workers.splice(index, 1);
    this.assignWorkers();
  }

  // ---- simulation -------------------------------------------------------

  addFloater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, age: 0 });
    if (this.floaters.length > 40) this.floaters.shift();
  }

  recordSale(goodId, x, y) {
    const price = this.sellPrice(goodId);
    this.cash += price;
    this.todayRevenue += price;
    const m = this.market[goodId];
    m.demand = Math.max(0.35, m.demand - 0.015);
    this.addFloater(x, y, `+$${price}`, '#6fd08c');
    if (!this.won && this.cash >= WIN_CASH) this.won = true;
  }

  tick(dt) {
    this.time += dt;
    this.dayClock += dt;

    // Market demand recovers toward 1.
    for (const id of Object.keys(GOODS)) {
      const m = this.market[id];
      m.demand += (1 - m.demand) * 0.03 * dt;
    }

    // Depots import raw goods onto the belt they face.
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const b = this.grid[x][y];
        if (!b) continue;
        const def = BUILDINGS[b.type];
        if (!def.good || !b.enabled) continue;
        b.timer += dt;
        if (b.timer < def.interval) continue;
        const target = this.cell(x + DX[b.dir], y + DY[b.dir]);
        if (!target || target.type !== 'belt' || target.item) continue;
        const cost = this.buyPrice(def.good);
        if (this.cash < cost) continue;
        b.timer = 0;
        this.cash -= cost;
        this.todayExpenses += cost;
        target.item = { good: def.good, progress: 0 };
      }
    }

    // Belts: advance items, then transfer completed ones downstream.
    const ready = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const b = this.grid[x][y];
        if (!b || b.type !== 'belt' || !b.item) continue;
        b.item.progress = Math.min(1, b.item.progress + BELT_SPEED * dt);
        if (b.item.progress >= 1) ready.push(b);
      }
    }
    // Process farthest-downstream first so chains compress nicely.
    ready.sort((a, b) => (b.x + b.y) - (a.x + a.y));
    for (const belt of ready) {
      const nx = belt.x + DX[belt.dir], ny = belt.y + DY[belt.dir];
      const target = this.cell(nx, ny);
      if (!target) continue;
      const good = belt.item.good;
      const tdef = BUILDINGS[target.type];
      if (target.type === 'belt') {
        if (!target.item) {
          target.item = { good, progress: 0 };
          belt.item = null;
        }
      } else if (tdef.dock) {
        this.recordSale(good, nx, ny);
        belt.item = null;
      } else if (tdef.recipe) {
        const need = RECIPES[tdef.recipe].inputs[good];
        if (need && target.buf[good] < need * 2) {
          target.buf[good]++;
          belt.item = null;
        }
      }
    }

    // Machines: consume inputs, process, push output.
    for (const m of this.machines()) {
      const recipe = RECIPES[BUILDINGS[m.type].recipe];
      // Push finished output onto the faced belt.
      if (m.outCount > 0) {
        const target = this.cell(m.x + DX[m.dir], m.y + DY[m.dir]);
        if (target && target.type === 'belt' && !target.item) {
          target.item = { good: recipe.output, progress: 0 };
          m.outCount--;
        }
      }
      if (!m.working && m.worker && m.outCount < 3) {
        const haveAll = Object.entries(recipe.inputs).every(([g, n]) => m.buf[g] >= n);
        if (haveAll) {
          for (const [g, n] of Object.entries(recipe.inputs)) m.buf[g] -= n;
          m.working = true;
          m.t = 0;
        }
      }
      if (m.working) {
        const speedMult = m.worker ? 0.7 + 0.3 * m.worker.skill : 0;
        m.t += dt * speedMult;
        if (m.t >= recipe.time) {
          m.working = false;
          m.outCount++;
        }
      }
    }

    // Floating texts age out.
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < 1.4);

    // End of day: pay wages, roll the date.
    if (this.dayClock >= DAY_LENGTH) {
      this.dayClock -= DAY_LENGTH;
      const wages = this.workers.reduce((s, w) => s + w.wage, 0);
      this.cash -= wages;
      this.day++;
      this.todayRevenue = 0;
      this.todayExpenses = wages;
      for (const id of Object.keys(GOODS)) {
        this.market[id].prevPrice = this.sellPrice(id);
      }
    }
  }

  // ---- persistence ------------------------------------------------------

  save() {
    const tiles = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const b = this.grid[x][y];
        if (b) tiles.push({ type: b.type, x, y, dir: b.dir, enabled: b.enabled !== false });
      }
    }
    const data = {
      cash: this.cash, day: this.day, time: this.time, won: this.won,
      workers: this.workers, hiredCount: this.hiredCount, tiles,
      demand: Object.fromEntries(Object.keys(GOODS).map((id) => [id, this.market[id].demand])),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
  }

  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!data || !Array.isArray(data.tiles)) return false;
    this.reset();
    this.cash = data.cash ?? START_CASH;
    this.day = data.day ?? 1;
    this.time = data.time ?? 0;
    this.won = !!data.won;
    this.workers = data.workers ?? [];
    this.hiredCount = data.hiredCount ?? this.workers.length;
    for (const t of data.tiles) {
      if (!BUILDINGS[t.type]) continue;
      const savedCash = this.cash;
      this.cash = Infinity;                 // placement is free when restoring
      this.place(t.type, t.x, t.y, t.dir ?? 0);
      this.cash = savedCash;
      const b = this.cell(t.x, t.y);
      if (b && b.enabled !== undefined) b.enabled = t.enabled !== false;
    }
    this.todayExpenses = 0;
    for (const [id, d] of Object.entries(data.demand ?? {})) {
      if (this.market[id]) this.market[id].demand = d;
    }
    this.assignWorkers();
    return true;
  }

  clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}
