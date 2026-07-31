// Simulation unit tests: economy, logistics, vendors, people, stakes, goals.
import { describe, it, expect, beforeEach } from 'vitest';
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

import { DIFFICULTY, CAMPAIGN } from '../../src/defs.js';

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
