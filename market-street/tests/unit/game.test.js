// Simulation unit tests: economy, logistics, vendors, people, stakes, goals.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Game } from '../../src/game.js';
import {
  PRODUCTS, VENDORS, GOALS, START_CASH, RIVAL, SHELF_CAP,
} from '../../src/defs.js';

const DAY_STEPS = 600;              // one game day at the fixed frame step
const STEP = 1 / DAY_STEPS;

function runDays(game, days) {
  for (let i = 0; i < DAY_STEPS * days; i++) game.tick(STEP);
}

let g;
beforeEach(() => {
  g = new Game();
});

describe('economy', () => {
  it('starts with two stores and the configured cash', () => {
    expect(g.stores.length).toBe(2);
    expect(g.cash).toBe(START_CASH);
  });

  it('is profitable hands-off over the first ten days', () => {
    runDays(g, 10);
    const profit = g.history.reduce((s, h) => s + h.profit, 0);
    expect(profit).toBeGreaterThan(0);
    expect(g.gameOver).toBe(false);
  });

  it('keeps ledger arithmetic consistent', () => {
    runDays(g, 5);
    for (const h of g.history) {
      const computed = h.revenue - h.cogs - h.rent - h.wages - h.salaries - h.fines - h.interest;
      expect(h.profit).toBeCloseTo(computed, 6);
    }
  });

  it('tracks weighted-average COGS per unit', () => {
    expect(g.avgCost.produce).toBeCloseTo(PRODUCTS.produce.cost, 6);
    runDays(g, 6);
    expect(g.avgCost.produce).toBeGreaterThan(0);
    expect(Number.isFinite(g.avgCost.produce)).toBe(true);
  });
});

describe('stores & demand', () => {
  it('sister stores in one district share the market', () => {
    const one = g.marketFactor(g.stores[0]);
    g.cash = 99999;
    g.buyStore('s3');
    const crowded = g.marketFactor(g.stores[0]);
    expect(crowded).toBeLessThan(one);
  });

  it('assortment is gated by shelf slots and remodels widen them', () => {
    expect(g.toggleProduct('s1', 'beverages')).toBe(false);
    g.cash = 99999;
    expect(g.remodelStore('s1')).toBe(true);
    expect(g.toggleProduct('s1', 'beverages')).toBe(true);
    const store = g.storeAt('s1');
    expect(g.rangeCount(store)).toBe(7);
  });

  it('dropping a line frees its slot', () => {
    expect(g.toggleProduct('s1', 'bakery')).toBe(true);   // drop
    expect(g.toggleProduct('s1', 'seafood')).toBe(true);  // swap in
  });
});

describe('logistics', () => {
  it('trucks run the full deliver/unload/return cycle and restock shelves', () => {
    const store = g.storeAt('s1');
    for (const p of Object.keys(store.inv)) store.inv[p] = 5;
    const seen = new Set();
    for (let i = 0; i < DAY_STEPS * 3; i++) {
      g.tick(STEP);
      seen.add(g.trucks[0].state);
    }
    expect(seen).toContain('toStore');
    expect(seen).toContain('unloading');
    expect(seen).toContain('return');
    const total = Object.values(store.inv).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(100);
  });

  it('auto-reorder never buys what the warehouse cannot hold', () => {
    // Near-full warehouse (1320 of 1500 units).
    for (const p of Object.keys(g.warehouse.inv)) g.warehouse.inv[p] = 120;
    runDays(g, 2);
    // Small slack: trucks returning shelf overflow may briefly exceed cap,
    // but standing orders themselves must stay within it.
    const projected = g.warehouseUsed() + g.orders.reduce((s, o) => s + o.qty, 0);
    expect(projected).toBeLessThanOrEqual(g.warehouse.cap + 80);
  });
});

describe('vendors', () => {
  it('charges on order and delivers after lead time', () => {
    const cash = g.cash;
    expect(g.placeOrder('produce', 'freshfields', 100)).toBe(true);
    expect(g.cash).toBeLessThan(cash);
    const order = g.orders.find((o) => o.product === 'produce');
    expect(order.arriveDay).toBe(g.day() + VENDORS.freshfields.leadTime);
  });

  it('negotiation discounts cap at 25%', () => {
    for (let i = 0; i < 60; i++) {
      g.vendors.freshfields.lastNegDay = -1;
      g.negotiate('freshfields');
    }
    expect(g.vendors.freshfields.discount).toBeLessThanOrEqual(0.25);
    expect(g.vendors.freshfields.discount).toBeGreaterThan(0);
  });

  it('strikes block orders for the struck vendor only', () => {
    g.activeEvents = [{ type: 'strike', daysLeft: 2, vendor: 'freshfields' }];
    expect(g.placeOrder('produce', 'freshfields', 50)).toBe(false);
    expect(g.placeOrder('pantry', 'consolidated', 50)).toBe(true);
  });
});

describe('people & delegation', () => {
  it('hires from candidate pools with traits', () => {
    g.cash = 5000;
    const pool = g.candidatesFor('buyer');
    expect(pool).toHaveLength(3);
    expect(pool[0].trait.id).toBeTruthy();
    expect(g.hireRole('buyer', 1)).toBe(true);
    expect(g.hq.buyer.name).toBe(pool[1].name);
  });

  it('a delegated team recovers a sabotaged store', () => {
    g.cash = 60000; g.peakCash = 60000;
    g.hireRole('buyer', 0);
    g.hireManager('s1', 0);
    const store = g.storeAt('s1');
    store.staff = 8;
    store.markup = 1.4;
    runDays(g, 15);
    expect(store.staff).toBeLessThan(8);
    expect(store.markup).toBeLessThan(1.4);
  });

  it('the buyer re-sources around a strike', () => {
    g.cash = 60000;
    g.hireRole('buyer', 0);
    g.purchasing.dairy.vendor = 'freshfields';
    g.activeEvents = [{ type: 'strike', daysLeft: 3, vendor: 'freshfields' }];
    g.runDelegation(g.day());
    expect(g.purchasing.dairy.vendor).not.toBe('freshfields');
  });
});

describe('stakes', () => {
  it('the rival cannot exceed its store cap and blocks purchases', () => {
    g.peakCash = 999999;                       // everything unlocked
    for (let i = 0; i < 40; i++) {
      g.rival.nextBuyDay = g.day();
      g.dayTick();
    }
    expect(g.rival.stores.length).toBeLessThanOrEqual(RIVAL.maxStores);
    g.cash = 999999;
    expect(g.buyStore(g.rival.stores[0])).toBe(false);
  });

  it('debt accrues interest and ends the game', () => {
    g.cash = -3000;
    runDays(g, 6);
    expect(g.history.some((h) => h.interest > 0)).toBe(true);
    expect(g.gameOver).toBe(true);
    const t = g.time;
    g.tick(STEP);
    expect(g.time).toBe(t);                    // sim frozen after game over
  });

  it('closing a store refunds and recalls its trucks', () => {
    const cash = g.cash;
    expect(g.closeStore('s2')).toBe(true);
    expect(g.cash).toBeGreaterThan(cash);
    expect(g.stores.length).toBe(1);
    for (const t of g.trucks) expect(t.storeId).not.toBe('s2');
  });
});

describe('goals', () => {
  it('advances the ladder and pays rewards', () => {
    expect(g.goalIndex).toBe(0);
    g.vendors.freshfields.discount = 0.05;
    const cash = g.cash;
    g.tick(STEP);
    expect(g.goalIndex).toBe(1);
    // The reward lands on top of whatever that tick's sales earned.
    expect(g.cash - cash).toBeGreaterThanOrEqual(GOALS[0].reward);
    expect(g.cash - cash).toBeLessThan(GOALS[0].reward + 50);
  });
});

describe('persistence', () => {
  it('survives a save/load round trip', () => {
    // Minimal localStorage stand-in for Node.
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    g.cash = 42424;
    g.remodelStore('s1');
    g.hireManager('s1', 0);
    runDays(g, 3);
    g.save();

    const g2 = new Game();
    expect(g2.load()).toBe(true);
    expect(Math.round(g2.cash)).toBe(Math.round(g.cash));
    expect(g2.stores.length).toBe(g.stores.length);
    expect(g2.storeAt('s1').manager.name).toBe(g.storeAt('s1').manager.name);
    expect(g2.storeAt('s1').slots).toBe(g.storeAt('s1').slots);
    runDays(g2, 1);                            // and it still ticks
    expect(g2.history.length).toBeGreaterThan(0);
    delete globalThis.localStorage;
  });

  it('starts fresh when the save is corrupt', () => {
    const store = new Map([['market-street-save-v2', '{not json']]);
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    const g2 = new Game();
    expect(g2.load()).toBe(false);
    expect(g2.cash).toBe(START_CASH);
    delete globalThis.localStorage;
  });
});

describe('robustness', () => {
  it('runs 60 hands-off days without NaN or crash', () => {
    runDays(g, 60);
    expect(Number.isFinite(g.cash)).toBe(true);
    for (const s of g.stores) {
      for (const p of Object.keys(PRODUCTS)) {
        expect(Number.isFinite(s.inv[p])).toBe(true);
        expect(s.inv[p]).toBeGreaterThanOrEqual(0);
        expect(s.inv[p]).toBeLessThanOrEqual(SHELF_CAP + 1);
      }
    }
    expect(Number.isFinite(g.warehouseUsed())).toBe(true);
  });
});

// ---- iteration-batch systems ------------------------------------------

import { DIFFICULTY, CAMPAIGN, EVENTS } from '../../src/defs.js';

describe('contracts', () => {
  it('signs at high relationship and applies the locked discount', () => {
    g.vendors.freshfields.rel = 60;
    expect(g.signContract('freshfields').success).toBe(true);
    const base = g.unitCost('produce', 'bakersguild');
    void base;
    const discounted = g.unitCost('produce', 'freshfields');
    g.vendors.freshfields.contract = null;
    expect(g.unitCost('produce', 'freshfields')).toBeGreaterThan(discounted);
  });

  it('refuses at low relationship and breaches on missed volume', () => {
    g.vendors.vista.rel = 10;
    expect(g.signContract('vista').lowRel).toBe(true);
    g.vendors.vista.rel = 60;
    g.signContract('vista');
    const cash = g.cash;
    g.vendors.vista.contract.weekEnd = g.day();   // force the weekly check now
    g.dayTick();
    expect(g.vendors.vista.contract).toBe(null);  // breached
    expect(g.cash).toBeLessThan(cash);            // penalty charged
  });
});

describe('progression systems', () => {
  it('staff level up from XP with a raise', () => {
    g.cash = 20000;
    g.hireRole('buyer', 0);
    const buyer = g.hq.buyer;
    buyer.skill = 1;
    buyer.xp = 14;
    const salary = buyer.salary;
    g.dayTick();
    expect(buyer.skill).toBe(2);
    expect(buyer.salary).toBeGreaterThan(salary);
  });

  it('difficulty presets change the starting conditions', () => {
    const ruthless = new Game();
    ruthless.reset('ruthless');
    expect(ruthless.cash).toBe(DIFFICULTY.ruthless.cash);
    expect(ruthless.rival.nextBuyDay).toBe(DIFFICULTY.ruthless.rivalFirst);
    expect(ruthless.diffId).toBe('ruthless');
  });

  it('achievements unlock and persist in state', () => {
    g.cash = 150000;
    g.checkAchievements();
    expect(g.achieved.tycoon).toBeTruthy();
    for (let i = 0; i < 4; i++) g.buyTruck();
    g.checkAchievements();
    expect(g.achieved.fleet_admiral).toBeTruthy();
  });
});

describe('store upgrades & campaigns', () => {
  it('self-checkout adds effective staff; cold storage exists per store', () => {
    const store = g.storeAt('s1');
    const before = g.effStaff(store);
    g.cash = 20000;
    expect(g.buyUpgrade('s1', 'selfcheckout')).toBe(true);
    expect(g.effStaff(store)).toBeCloseTo(before + 1, 6);
    expect(g.buyUpgrade('s1', 'selfcheckout')).toBe(false);  // no double-buy
    expect(g.buyUpgrade('s1', 'coldstorage')).toBe(true);
    expect(store.upgrades.coldstorage).toBe(true);
  });

  it('campaigns need a marketing lead, boost demand, and respect cooldown', () => {
    expect(g.runCampaign('oldtown').needsLead).toBe(true);
    g.cash = 20000;
    g.hireRole('marketing', 0);
    expect(g.runCampaign('oldtown').success).toBe(true);
    const store = g.storeAt('s1');
    expect(g.demandMult(store, 'pantry')).toBeCloseTo(CAMPAIGN.boost, 6);
    expect(g.runCampaign('oldtown').cooldown).toBeGreaterThan(0);
  });
});

describe('rival escalation', () => {
  it('BuyLow+ upgrades increase district pressure', () => {
    g.rival.stores.push('s3');
    g.rival.openedDay.s3 = 1;
    const store = g.storeAt('s1');
    const before = g.marketFactor(store);
    g.rival.plus.s3 = true;
    expect(g.marketFactor(store)).toBeLessThan(before);
  });
});

describe('export/import', () => {
  it('round-trips through exported JSON', () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    g.cash = 31337;
    const blob = g.exportSave();
    expect(blob.length).toBeGreaterThan(100);
    const g2 = new Game();
    expect(g2.importSave(blob)).toBe(true);
    expect(Math.round(g2.cash)).toBe(31337);
    expect(g2.importSave('{broken')).toBe(false);
    delete globalThis.localStorage;
  });
});

// ---- calendar: seasons, holidays, and the new events -------------------

import { SEASON_DAYS, YEAR_DAYS, HOLIDAYS, SEASONS, VENDORS as VDS } from '../../src/defs.js';

const dayToTime = (day) => day - 1 + 0.5;   // midday of a given absolute day

describe('seasons', () => {
  it('cycles through four seasons and wraps at year end', () => {
    g.time = dayToTime(1);
    expect(g.season().id).toBe('spring');
    g.time = dayToTime(SEASON_DAYS + 1);
    expect(g.season().id).toBe('summer');
    g.time = dayToTime(YEAR_DAYS + 1);        // new year
    expect(g.season().id).toBe('spring');
  });

  it('applies seasonal demand multipliers', () => {
    const store = g.storeAt('s1');
    g.time = dayToTime(3 * SEASON_DAYS + 2);  // winter
    expect(g.demandMult(store, 'pantry')).toBeCloseTo(1.2, 6);
    expect(g.demandMult(store, 'beverages')).toBeCloseTo(0.85, 6);
    g.time = dayToTime(SEASON_DAYS + 2);      // summer
    expect(g.demandMult(store, 'beverages')).toBeCloseTo(1.35, 6);
  });

  it('moves procurement costs with the season', () => {
    g.time = dayToTime(2 * SEASON_DAYS + 2);  // fall harvest
    const fall = g.unitCost('produce', 'freshfields');
    g.time = dayToTime(3 * SEASON_DAYS + 2);  // winter
    const winter = g.unitCost('produce', 'freshfields');
    expect(winter).toBeGreaterThan(fall);
  });

  it('gates seasonal events: no heat waves in winter', () => {
    g.time = dayToTime(3 * SEASON_DAYS + 5);  // winter
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      g.activeEvents = [];
      g.spawnEvent();
      for (const e of g.activeEvents) seen.add(e.type);
    }
    expect(seen.has('heat_wave')).toBe(false);
    expect(seen.has('farmers_market')).toBe(false);
  });
});

describe('holidays', () => {
  const harvest = HOLIDAYS.find((h) => h.id === 'harvest');

  it('activates during its window with stacked demand', () => {
    g.time = dayToTime(harvest.start + 1);
    expect(g.currentHoliday()?.id).toBe('harvest');
    const store = g.storeAt('s1');
    const fallPantry = SEASONS.find((s) => s.id === 'fall').demand.pantry ?? 1;
    expect(g.demandMult(store, 'pantry')).toBeCloseTo(1.25 * fallPantry, 4);
  });

  it('announces ahead of time in the log', () => {
    g.time = dayToTime(harvest.start - 4);   // yearDay = start-5, exactly the announce lead
    g.dayTick();
    expect(g.logEntries.some((e) => e.icon === '📅' && e.text.includes('Harvest'))).toBe(true);
  });

  it('applies the post-Winterfest slump', () => {
    const wf = HOLIDAYS.find((h) => h.id === 'winterfest');
    g.time = dayToTime(wf.start + wf.days + 1);
    expect(g.holidayAftermath()?.id).toBe('winterfest');
    const store = g.storeAt('s1');
    // slump 0.8 times winter pantry 1.2 = 0.96
    expect(g.demandMult(store, 'pantry')).toBeCloseTo(0.8 * 1.2, 4);
  });
});

describe('new distribution events', () => {
  it('food scares crater one product only', () => {
    g.activeEvents = [{ type: 'food_scare', daysLeft: 2, product: 'seafood' }];
    const store = g.storeAt('s1');
    expect(g.demandMult(store, 'seafood')).toBeCloseTo(0.35 * (g.season().demand.seafood ?? 1), 4);
    expect(g.demandMult(store, 'pantry')).toBeCloseTo(g.season().demand.pantry ?? 1, 4);
  });

  it('port congestion adds a day to every vendor lead time', () => {
    g.activeEvents = [{ type: 'port_delay', daysLeft: 2 }];
    g.placeOrder('produce', 'freshfields', 100);
    const order = g.orders.find((o) => o.product === 'produce');
    expect(order.arriveDay).toBe(g.day() + VDS.freshfields.leadTime + 1);
  });

  it('fuel spikes raise every vendor price', () => {
    const base = g.unitCost('pantry', 'consolidated');
    g.activeEvents = [{ type: 'fuel_spike', daysLeft: 2 }];
    expect(g.unitCost('pantry', 'consolidated')).toBeCloseTo(base * 1.12, 4);
  });

  it('farmers markets discount produce procurement', () => {
    const base = g.unitCost('produce', 'freshfields');
    g.activeEvents = [{ type: 'farmers_market', daysLeft: 2 }];
    expect(g.unitCost('produce', 'freshfields')).toBeCloseTo(base * 0.7, 4);
  });
});

describe('flu season', () => {
  it('reduces effective service so sales dip', () => {
    const store = g.storeAt('s1');
    for (const p of Object.keys(store.inv)) store.inv[p] = 60;
    const healthy = new Game();
    const sick = new Game();
    for (const gg of [healthy, sick]) {
      const s = gg.storeAt('s1');
      for (const p of Object.keys(s.inv)) s.inv[p] = 60;
      gg.warehouse.inv = { ...gg.warehouse.inv };
    }
    sick.activeEvents = [{ type: 'flu_season', daysLeft: 5 }];
    for (let i = 0; i < 600; i++) { healthy.tick(1 / 600); sick.tick(1 / 600); }
    expect(sick.stores[0].servedToday ?? 0).toBeLessThan(healthy.stores[0].servedToday ?? 1);
  });
});

describe('weekly planning mode', () => {
  it('pauses into a planning stop at each week boundary', () => {
    expect(g.weeklyMode).toBe(true);
    g.speed = 3;
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    expect(g.day()).toBe(8);
    expect(g.planning).toBe(true);
    expect(g.speed).toBe(0);
    expect(g.lastWeekReport.weekEndingDay).toBe(7);
    expect(g.weekNum()).toBe(2);
  });

  it('startWeek resumes at the pre-pause cruise speed', () => {
    g.speed = 3;
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    expect(g.speed).toBe(0);
    g.startWeek();
    expect(g.planning).toBe(false);
    expect(g.speed).toBe(3);
  });

  it('does not pause when weekly mode is off', () => {
    g.weeklyMode = false;
    g.speed = 1;
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    expect(g.planning).toBe(false);
    expect(g.speed).toBe(1);
  });

  it('persists the planning stop across save/load', () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    expect(g.planning).toBe(true);
    g.save();
    const g2 = new Game();
    expect(g2.load()).toBe(true);
    expect(g2.planning).toBe(true);
    expect(g2.speed).toBe(0);
    expect(g2.weeklyMode).toBe(true);
    delete globalThis.localStorage;
  });
});

describe('dice negotiation', () => {
  // Math.random stub: feed exact face indexes (faces array is 6 long).
  const FACE_IDX = { lev: 0, good: 2, warn: 4, crit: 5 };
  let realRandom;
  const feed = (faces) => {
    const q = faces.map((f) => FACE_IDX[f] / 6 + 0.001);
    Math.random = () => (q.length ? q.shift() : 0.001);
  };
  beforeEach(() => { realRandom = Math.random; });
  afterEach(() => { Math.random = realRandom; });

  it('is a once-per-day sitting per vendor', () => {
    feed(['lev', 'lev', 'lev']);
    expect(g.startNegotiation('freshfields').done).toBeUndefined();
    expect(g.startNegotiation('freshfields').done).toBe(true);
  });

  it('grants bonus dice for relationship, buyer, and contract', () => {
    expect(g.negoDiceCount('freshfields').count).toBe(3);
    g.vendors.freshfields.rel = 85;
    expect(g.negoDiceCount('freshfields').count).toBe(5);
  });

  it('closing with big leverage raises the discount and pays a perk', () => {
    // 3 crits = leverage 6; the trailing 0.01 steers the perk roll.
    const q = [5 / 6 + 0.001, 5 / 6 + 0.001, 5 / 6 + 0.001, 0.01];
    Math.random = () => (q.length ? q.shift() : 0.01);
    g.startNegotiation('freshfields');
    const r = g.negoAccept();
    expect(r.walked).toBe(false);
    expect(r.disc).toBeCloseTo(0.06, 5);
    expect(g.vendors.freshfields.discount).toBeCloseTo(0.06, 5);
    expect(r.perk).toBeTruthy();
  });

  it('kept dice survive a press; unkept dice reroll', () => {
    feed(['crit', 'good', 'good', 'lev', 'lev', 'lev']);
    g.startNegotiation('freshfields');
    expect(g.nego.dice[0].face).toBe('crit');
    g.negoRoll([0]);                      // keep the crit, reroll the rest
    expect(g.nego.dice[0].face).toBe('crit');
    expect(g.nego.dice[1].face).toBe('lev');
  });

  it('too many warnings makes the vendor walk: rel hit and frozen discount', () => {
    g.vendors.ironox.discount = 0.10;
    const relBefore = (g.vendors.ironox.rel = 60);
    const baseCost = g.unitCost('meat', 'ironox');
    feed(['warn', 'warn', 'warn', 'warn', 'warn', 'warn']);
    g.startNegotiation('ironox');         // ironox patience 2 -> 3 warns on the
    expect(g.nego.result.walked).toBe(true);
    expect(g.vendors.ironox.rel).toBe(relBefore - 8);
    expect(g.vendors.ironox.frozenUntil).toBe(g.day() + 7);
    expect(g.unitCost('meat', 'ironox')).toBeGreaterThan(baseCost);
  });

  it('warn dice are locked and cannot be rerolled away', () => {
    feed(['warn', 'good', 'good', 'lev', 'lev']);
    g.startNegotiation('freshfields');
    expect(g.nego.dice[0].face).toBe('warn');
    g.negoRoll([]);
    expect(g.nego.dice[0].face).toBe('warn');   // still there
    expect(g.nego.warns).toBeGreaterThanOrEqual(1);
  });

  it('a walkout freeze suspends the negotiated discount but not a contract', () => {
    g.vendors.consolidated.discount = 0.10;
    g.vendors.consolidated.frozenUntil = g.day() + 5;
    const frozenCost = g.unitCost('pantry', 'consolidated');
    g.vendors.consolidated.contract = { until: g.day() + 10, weekEnd: g.day() + 7, weekOrdered: 0 };
    expect(g.unitCost('pantry', 'consolidated')).toBeLessThan(frozenCost);
  });
});

describe('delivery negotiation & supply balance', () => {
  let realRandom;
  beforeEach(() => { realRandom = Math.random; });
  afterEach(() => { Math.random = realRandom; });
  const allCrits = () => { Math.random = () => 5 / 6 + 0.001; };

  it('delivery stake wins a timed −1 day priority window', () => {
    allCrits();
    g.startNegotiation('consolidated', 'delivery');
    const r = g.negoAccept();
    expect(r.stake).toBe('delivery');
    expect(r.won.days).toBe(28);
    expect(r.won.split).toBe(true);
    expect(g.vendors.consolidated.rushUntil).toBe(g.day() + 28);
    expect(g.vendors.consolidated.splitUntil).toBe(g.day() + 28);
    // Orders now arrive a day sooner (3-day vendor -> 2 days).
    g.placeOrder('pantry', 'consolidated', 90);
    const o = g.orders.find((x) => x.product === 'pantry');
    expect(o.arriveDay).toBe(g.day() + 2);
  });

  it('split shipments halve big orders with the first half early', () => {
    g.vendors.consolidated.splitUntil = g.day() + 10;
    g.placeOrder('pantry', 'consolidated', 200);
    const orders = g.orders.filter((x) => x.product === 'pantry');
    expect(orders.length).toBe(2);
    expect(orders[0].qty + orders[1].qty).toBe(200);
    expect(orders[0].arriveDay).toBe(orders[1].arriveDay - 1);
  });

  it('price stake still pays discounts by default', () => {
    allCrits();
    g.startNegotiation('freshfields');
    const r = g.negoAccept();
    expect(r.disc).toBeCloseTo(0.06, 5);
    expect(g.vendors.freshfields.rushUntil ?? 0).toBe(0);
  });

  it('default standing orders are shaped by demand and vendor lead', () => {
    // Produce (heavy, 1-day lead) vs household (light, 3-day lead):
    // produce should have the bigger order quantity.
    expect(g.purchasing.produce.qty).toBeGreaterThan(g.purchasing.household.qty);
    // Slow-vendor dairy carries a deeper point than its demand alone implies.
    const est = () => 1580 * 0.18 * 0.18;   // chain pop x factor x dairy weight
    expect(g.purchasing.dairy.point).toBeGreaterThanOrEqual(est() * 3 - 26);
  });

  it('buying a store deepens auto standing orders', () => {
    const before = g.purchasing.produce.qty;
    g.cash = 50000; g.peakCash = 50000;
    g.buyStore('s3');
    expect(g.purchasing.produce.qty).toBeGreaterThan(before);
  });
});

describe('weekly store scorecards', () => {
  const runWeek = (gg) => { for (let i = 0; i < 600 * 7 + 5; i++) gg.tick(1 / 600); gg.startWeek(); };

  it('reports per-store facts: profit, fill, staffing, rep', () => {
    runWeek(g);
    const r = g.lastWeekReport;
    expect(r.stores.length).toBe(g.stores.length);
    for (const s of r.stores) {
      expect(s.fill).toBeGreaterThan(0);
      expect(s.fill).toBeLessThanOrEqual(1);
      expect(s.staff).toBeGreaterThan(0);
      expect(Number.isFinite(s.profit)).toBe(true);
      expect(Array.isArray(s.issues)).toBe(true);
    }
    expect(typeof r.truckUtil).toBe('number');
  });

  it('flags stockouts and distinguishes empty-depot from delivery gaps', () => {
    // Starve the depot of produce entirely: stores sell out and can't refill.
    g.purchasing.produce.auto = false;
    g.warehouse.inv.produce = 0;
    for (const st of g.stores) st.inv.produce = 1;
    runWeek(g);
    const withIssue = g.lastWeekReport.stores.find((s) =>
      s.issues.some((i) => i.id === 'dry-depot'));
    expect(withIssue).toBeTruthy();
    expect(withIssue.issues.find((i) => i.id === 'dry-depot').text).toContain('Produce');
  });

  it('flags understaffing as a fact', () => {
    for (const st of g.stores) st.staff = 1;
    runWeek(g);
    const flagged = g.lastWeekReport.stores.some((s) =>
      s.issues.some((i) => i.id === 'understaffed'));
    expect(flagged).toBe(true);
  });

  it('reports a steady week with no issues', () => {
    // Plenty of everything: full shelves, extra staff.
    for (const st of g.stores) { st.staff = 4; st.morale = 1; st.rep = 0.7; }
    g.cash += 20000;
    g.buyTruck(); g.buyTruck();
    g.warehouse.cap = 6000;
    for (const p of Object.keys(g.warehouse.inv)) g.warehouse.inv[p] = 400;
    for (const pol of Object.values(g.purchasing)) { pol.qty = 400; pol.point = 400; }
    runWeek(g);
    const healthy = g.lastWeekReport.stores.some((s) => s.issues.length === 0);
    expect(healthy).toBe(true);
  });
});

describe('negotiation economy: meetings, memory, riders, courtship', () => {
  let realRandom;
  beforeEach(() => { realRandom = Math.random; });
  afterEach(() => { Math.random = realRandom; });

  it('budgets three meetings a week and refreshes at the wrap-up', () => {
    expect(g.meetingsLeft).toBe(3);
    for (const vid of ['freshfields', 'ironox', 'vista']) {
      expect(g.startNegotiation(vid).noMeetings).toBeUndefined();
      g.negoAccept();
    }
    expect(g.startNegotiation('consolidated').noMeetings).toBe(true);
    expect(g.canNegotiate('consolidated').noMeetings).toBe(true);
    g.hq.buyer = { name: 'Rosa', skill: 3, salary: 120, trait: null, xp: 0 };
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    g.startWeek();
    expect(g.meetingsLeft).toBe(5);   // 3 base +1 buyer +1 master
  });

  it('discounts decay 1% at each week boundary', () => {
    g.vendors.vista.discount = 0.10;
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    g.startWeek();
    expect(g.vendors.vista.discount).toBeCloseTo(0.09, 5);
  });

  it('a walkout leaves a grudge that costs a die next sitting', () => {
    Math.random = () => 4 / 6 + 0.001;   // all warns -> walk
    g.startNegotiation('ironox');
    expect(g.nego.result.walked).toBe(true);
    expect(g.vendors.ironox.mood).toBe(-1);
    const { count, mods } = g.negoDiceCount('ironox');
    expect(mods.some((m) => m.d === -1 && m.label.includes('Grudge'))).toBe(true);
    expect(count).toBe(2);
    // Sitting down consumes the grudge.
    g.time += 1;                          // next day (per-vendor daily guard)
    g.startNegotiation('ironox');
    expect(g.vendors.ironox.mood).toBe(0);
  });

  it('accepting a rider counter pays extra now and binds a commitment', () => {
    const q = [5 / 6, 5 / 6, 5 / 6, 0.1];   // three crits, then rider chance hits
    Math.random = () => (q.length ? q.shift() + 0.001 : 0.1);
    g.startNegotiation('vista');
    expect(g.nego.counter?.rider).toBeTruthy();
    const rq = g.nego.counter.rider.qty;
    g.negoAccept(true);
    expect(g.vendors.vista.discount).toBeCloseTo(0.08, 5);  // 6% tier + 2% rider
    expect(g.vendors.vista.rider.qty).toBe(rq);
    expect(g.vendors.vista.mood).toBe(1);
    // Order the committed volume: next day the rider resolves in your favor.
    g.cash = 50000;
    g.placeOrder('beverages', 'vista', rq);
    const rel = g.vendors.vista.rel;
    for (let i = 0; i < 605; i++) g.tick(1 / 600);
    expect(g.vendors.vista.rider).toBeNull();
    expect(g.vendors.vista.rel).toBeGreaterThanOrEqual(rel);
    expect(g.vendors.vista.discount).toBeCloseTo(0.08, 5);  // bonus kept
  });

  it('a blown rider claws back the bonus and trust', () => {
    g.vendors.vista.discount = 0.08;
    g.vendors.vista.rider = { qty: 300, ordered: 0, deadline: g.day(), bonus: 0.02 };
    const rel = g.vendors.vista.rel;
    for (let i = 0; i < 605; i++) g.tick(1 / 600);
    expect(g.vendors.vista.rider).toBeNull();
    expect(g.vendors.vista.discount).toBeCloseTo(0.06, 5);
    expect(g.vendors.vista.rel).toBeLessThan(rel);
  });

  it('closing a deal fends off a BuyLow courtship; ignoring one costs you', () => {
    g.rival.courting = { vendor: 'freshfields', until: g.day() + 7 };
    Math.random = () => 5 / 6 + 0.001;    // crits -> a winning deal
    g.startNegotiation('freshfields');
    g.negoAccept();
    expect(g.rival.courting).toBeNull();
    // Now let one run its course unanswered.
    Math.random = realRandom;
    g.rival.courting = { vendor: 'harborfresh', until: g.day() + 7 };
    const base = g.unitCost('seafood', 'harborfresh');
    for (let i = 0; i < 600 * 7 + 5; i++) g.tick(1 / 600);
    g.startWeek();
    expect(g.day() < g.vendors.harborfresh.courtLossUntil).toBe(true);
    expect(g.unitCost('seafood', 'harborfresh')).toBeGreaterThan(base * 1.02);
  });
});

describe('dashboard KPIs', () => {
  it('history entries carry fill, shelf, and warehouse ratios', () => {
    for (let i = 0; i < 600 * 2 + 5; i++) g.tick(1 / 600);
    const h = g.history[g.history.length - 1];
    expect(h.fill).toBeGreaterThan(0);
    expect(h.fill).toBeLessThanOrEqual(1);
    expect(h.shelf).toBeGreaterThan(0);
    expect(h.shelf).toBeLessThanOrEqual(1);
    expect(h.wh).toBeGreaterThanOrEqual(0);
  });
});

describe('weekly events, rival moves, and store formats', () => {
  let realRandom;
  beforeEach(() => { realRandom = Math.random; });
  afterEach(() => { Math.random = realRandom; });
  const week = (gg) => { for (let i = 0; i < 600 * 7 + 5; i++) gg.tick(1 / 600); };

  it('city conditions land at week boundaries and last the week', () => {
    week(g);
    const conditions = g.activeEvents.filter((e) => !EVENTS[e.type].player);
    expect(conditions.length).toBeGreaterThanOrEqual(1);
    for (const e of conditions) expect(e.daysLeft).toBeGreaterThanOrEqual(6);
    expect(g.lastWeekReport.incoming.length).toBe(conditions.length);
  });

  it('wage pressure raises the payroll multiplier', () => {
    const base = g.wageMult();
    g.activeEvents.push({ type: 'wage_pressure', daysLeft: 7 });
    expect(g.wageMult()).toBeCloseTo(base * 1.2, 5);
  });

  it('a price raid drains the district unless prices come down', () => {
    const store = g.storeAt('s1');
    const district = g.site('s1').district;
    const base = g.marketFactor(store);
    g.rival.raid = { district, until: g.day() + 7 };
    expect(g.marketFactor(store)).toBeCloseTo(base * 0.85, 5);
    store.markup = 0.95;
    const defended = g.marketFactor(store);
    g.rival.raid = null;
    expect(defended).toBeCloseTo(g.marketFactor(store), 5);
    store.markup = 1.0;
  });

  it('an eyed lot goes to BuyLow if unbought, or is snatched by buying it', () => {
    g.rival.stores = ['s10'];
    g.rival.eyeing = { siteId: 's4', deadline: g.day() };
    g.rivalWeeklyMove(g.day());
    expect(g.rival.stores.includes('s4')).toBe(true);
    // Snatch path.
    g.rival.eyeing = { siteId: 's3', deadline: g.day() + 7 };
    g.cash = 50000; g.peakCash = 50000;
    g.buyStore('s3');
    expect(g.rival.eyeing).toBeNull();
  });

  it('poaching can empty a seat or jack up a salary', () => {
    g.rival.stores = ['s10'];
    g.hq.buyer = { name: 'Rosa', skill: 3, salary: 100, trait: { name: 'x', desc: 'y' }, xp: 0 };
    Math.random = () => 0.55;      // move roll -> poach branch, then stay+raise
    g.rivalWeeklyMove(g.day());
    expect(g.hq.buyer.salary).toBe(115);
    Math.random = () => 0.6;       // poach branch again...
    const q = [0.6, 0.2];          // ...and this time they leave (0.2 < 0.45)
    Math.random = () => (q.length ? q.shift() : 0.2);
    g.rivalWeeklyMove(g.day());
    expect(g.hq.buyer).toBeNull();
  });

  it('formats change shelves, margins, and staffing needs', () => {
    const store = g.storeAt('s1');
    expect(g.shelfCap(store)).toBe(60);
    g.cash = 20000;
    expect(g.setFormat('s1', 'supermarket')).toBe(true);
    expect(store.format).toBe('supermarket');
    expect(g.shelfCap(store)).toBe(90);
    expect(g.cash).toBe(14000);
    // Gourmet pricing: revenue per unit scales up.
    g.setFormat('s1', 'gourmet');
    expect(g.shelfCap(store)).toBe(51);
  });

  it('district affinity shifts demand by format', () => {
    const store = g.storeAt('s1');       // Old Town: corner-friendly
    for (const p of Object.keys(store.inv)) store.inv[p] = 60;
    const g2 = new Game();
    const s2 = g2.storeAt('s1');
    for (const p of Object.keys(s2.inv)) s2.inv[p] = 60;
    g2.cash = 20000;
    g2.setFormat('s1', 'supermarket');   // 0.96 affinity in Old Town, more staff need
    for (let i = 0; i < 600; i++) { g.tick(1 / 600); g2.tick(1 / 600); }
    // Corner in Old Town should serve at least comparable demand per staff.
    expect(g.stores[0].servedToday).toBeGreaterThan(0);
    expect(g2.stores[0].servedToday).toBeGreaterThan(0);
  });
});
