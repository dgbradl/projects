// DOM: top bar, sidebar tabs (Stores / Supply / Vendors / HQ), store detail.

import {
  PRODUCTS, VENDORS, DISTRICTS, SITES, ROLES, SHELF_CAP, STAFF_WAGE,
  TRUCK_COST, WAREHOUSE_UPGRADE, HIRE_ROLE_COST, WIN_CASH, WIN_STORES,
} from './defs.js';

const PROD_IDS = Object.keys(PRODUCTS);
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;

export class UI {
  constructor(game) {
    this.game = game;
    this.tab = 'stores';
    this.selectedSite = null;    // site id
    this.winShown = false;
    this.toast = null;
    this.bindTop();
    this.bindTabs();
    this.buildSupplyTab();
    this.buildVendorsTab();
    this.buildHqTab();
    this.renderStoreList();
  }

  // ---- chrome -----------------------------------------------------------

  bindTop() {
    document.querySelectorAll('.speeds button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.speed = Number(btn.dataset.speed);
        document.querySelectorAll('.speeds button')
          .forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('Wipe the save and start a new chain?')) return;
      this.game.clearSave();
      this.game.reset();
      this.selectedSite = null;
      this.winShown = false;
      document.getElementById('win-banner').classList.add('hidden');
      this.buildSupplyTab();
      this.buildVendorsTab();
      this.buildHqTab();
      this.renderStoreList();
    });
    document.getElementById('btn-win-close').addEventListener('click', () => {
      document.getElementById('win-banner').classList.add('hidden');
    });
  }

  bindTabs() {
    document.querySelectorAll('#tabs button').forEach((btn) => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab));
    });
    this.setTab('stores');
  }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('#tabs button')
      .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-page')
      .forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  }

  say(text) {
    this.toast = { text, until: performance.now() + 2600 };
  }

  // Map click → select site, jump to Stores tab.
  clickTile(x, y) {
    const site = this.game.siteAtTile(x, y);
    if (!site) return;
    this.selectedSite = site.id;
    this.setTab('stores');
    this.renderStoreList();
  }

  // ---- stores tab -------------------------------------------------------

  renderStoreList() {
    const g = this.game;
    const wrap = document.getElementById('store-list');
    wrap.innerHTML = '';
    for (const store of g.stores) {
      const site = g.site(store.siteId);
      const row = document.createElement('button');
      row.className = 'store-row' + (this.selectedSite === site.id ? ' selected' : '');
      row.innerHTML = `
        <span class="sname">${store.name}</span>
        <span class="sdist">${g.district(site.district).name}</span>
        <span class="srev" data-rev="${site.id}"></span>`;
      row.addEventListener('click', () => {
        this.selectedSite = site.id;
        this.renderStoreList();
      });
      wrap.appendChild(row);
    }
    this.renderStoreDetail();
  }

  renderStoreDetail() {
    const g = this.game;
    const box = document.getElementById('store-detail');
    box.innerHTML = '';
    const site = this.selectedSite ? g.site(this.selectedSite) : null;
    if (!site) {
      box.innerHTML = '<p class="fine">Click a store on the map or in the list above. Lots marked FOR SALE can be bought once their district is unlocked.</p>';
      return;
    }
    const store = g.storeAt(site.id);
    const district = g.district(site.district);

    if (!store) {
      const unlocked = g.districtUnlocked(site.district);
      box.innerHTML = `
        <h4>Vacant lot — ${district.name}</h4>
        <p class="fine">Neighborhood of ~${site.pop.toLocaleString()} shoppers · rent ${fmt(site.rent)}/day</p>`;
      const btn = document.createElement('button');
      btn.className = 'primary';
      if (!unlocked) {
        btn.textContent = `Locked — reach ${fmt(district.unlock)} to expand here`;
        btn.disabled = true;
      } else {
        btn.textContent = `Open store here for ${fmt(site.price)}`;
        btn.disabled = g.cash < site.price;
        btn.addEventListener('click', () => {
          if (g.buyStore(site.id)) this.renderStoreList();
        });
      }
      box.appendChild(btn);
      return;
    }

    box.innerHTML = `
      <h4>${store.name} <span class="fine">· ${district.name} · ~${site.pop.toLocaleString()} shoppers</span></h4>
      <div class="kv"><span>Reputation</span><div class="meter"><i id="sd-rep"></i></div></div>
      <div class="kv"><span>Revenue today</span><b id="sd-rev"></b></div>
      <div class="kv"><span>Lost sales today</span><b id="sd-lost"></b></div>
      <div class="kv"><span>Rent</span><b>${fmt(site.rent)}/day</b></div>
      <div class="kv"><span>Staff <span class="fine">(${fmt(STAFF_WAGE)}/day each)</span></span>
        <span class="stepper">
          <button id="sd-staff-minus">−</button>
          <b id="sd-staff"></b>
          <button id="sd-staff-plus">+</button>
        </span>
      </div>
      <div class="kv"><span>Prices <b id="sd-markup-val"></b></span>
        <input type="range" id="sd-markup" min="80" max="140" step="5">
      </div>
      <div id="sd-inv"></div>
      <button id="sd-close" class="danger">Close store (recover 60%)</button>`;

    const invWrap = box.querySelector('#sd-inv');
    for (const p of PROD_IDS) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      row.innerHTML = `
        <span class="swatch" style="background:${PRODUCTS[p].color}"></span>
        <span class="pname">${PRODUCTS[p].name}</span>
        <div class="meter wide"><i data-inv="${p}"></i></div>
        <span class="fine" data-invn="${p}"></span>`;
      invWrap.appendChild(row);
    }

    box.querySelector('#sd-markup').value = Math.round(store.markup * 100);
    box.querySelector('#sd-markup').addEventListener('input', (e) => {
      store.markup = Number(e.target.value) / 100;
    });
    box.querySelector('#sd-staff-minus').addEventListener('click', () => {
      store.staff = Math.max(1, store.staff - 1);
    });
    box.querySelector('#sd-staff-plus').addEventListener('click', () => {
      store.staff = Math.min(8, store.staff + 1);
    });
    box.querySelector('#sd-close').addEventListener('click', () => {
      if (!confirm(`Close ${store.name}?`)) return;
      g.closeStore(site.id);
      this.selectedSite = null;
      this.renderStoreList();
    });
  }

  // ---- supply tab -------------------------------------------------------

  buildSupplyTab() {
    const g = this.game;
    const page = document.getElementById('tab-supply');
    page.innerHTML = `
      <div class="panel">
        <h3>Warehouse</h3>
        <div class="kv"><span>Capacity</span><b id="wh-cap"></b></div>
        <div class="meter wide"><i id="wh-fill"></i></div>
        <div id="wh-inv"></div>
        <button id="wh-upgrade">Expand +${WAREHOUSE_UPGRADE.units} units (${fmt(WAREHOUSE_UPGRADE.cost)})</button>
      </div>
      <div class="panel">
        <h3>Purchasing</h3>
        <p class="fine">Standing orders: when warehouse + in-transit stock for a product dips below the reorder point, your office places the order automatically at day start.</p>
        <div id="purchasing"></div>
      </div>
      <div class="panel">
        <h3>Inbound orders</h3>
        <div id="orders-list" class="fine"></div>
      </div>
      <div class="panel">
        <h3>Fleet</h3>
        <div class="kv"><span>Trucks</span><b id="truck-count"></b></div>
        <p class="fine">Trucks shuttle stock from the warehouse to whichever store needs it most.</p>
        <button id="btn-truck">Buy truck (${fmt(TRUCK_COST)})</button>
      </div>`;

    const whInv = page.querySelector('#wh-inv');
    for (const p of PROD_IDS) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      row.innerHTML = `
        <span class="swatch" style="background:${PRODUCTS[p].color}"></span>
        <span class="pname">${PRODUCTS[p].name}</span>
        <span class="fine" data-whn="${p}"></span>`;
      whInv.appendChild(row);
    }

    const purch = page.querySelector('#purchasing');
    for (const p of PROD_IDS) {
      const pol = g.purchasing[p];
      const row = document.createElement('div');
      row.className = 'purch-row';
      const vendorOpts = Object.entries(VENDORS)
        .filter(([, v]) => v.products.includes(p))
        .map(([id, v]) => `<option value="${id}" ${pol.vendor === id ? 'selected' : ''}>${v.name}</option>`)
        .join('');
      row.innerHTML = `
        <div class="purch-head">
          <span class="swatch" style="background:${PRODUCTS[p].color}"></span>
          <span class="pname">${PRODUCTS[p].name}</span>
          <span class="fine" data-cost="${p}"></span>
          <label class="fine auto"><input type="checkbox" data-auto="${p}" ${pol.auto ? 'checked' : ''}> auto</label>
        </div>
        <div class="purch-controls">
          <select data-vendor="${p}">${vendorOpts}</select>
          <label class="fine">at <input type="number" data-point="${p}" value="${pol.point}" min="0" step="50"></label>
          <label class="fine">order <input type="number" data-qty="${p}" value="${pol.qty}" min="50" step="50"></label>
          <button data-now="${p}" title="Place this order immediately">Order now</button>
        </div>`;
      purch.appendChild(row);
    }
    purch.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.auto) g.purchasing[t.dataset.auto].auto = t.checked;
      if (t.dataset.vendor) g.purchasing[t.dataset.vendor].vendor = t.value;
      if (t.dataset.point) g.purchasing[t.dataset.point].point = Math.max(0, Number(t.value) || 0);
      if (t.dataset.qty) g.purchasing[t.dataset.qty].qty = Math.max(0, Number(t.value) || 0);
    });
    purch.addEventListener('click', (e) => {
      const p = e.target.dataset?.now;
      if (!p) return;
      const pol = g.purchasing[p];
      if (g.placeOrder(p, pol.vendor, pol.qty)) {
        this.say(`Ordered ${pol.qty} ${PRODUCTS[p].name} from ${VENDORS[pol.vendor].name}.`);
      } else {
        this.say('Order failed — check cash.');
      }
    });

    page.querySelector('#wh-upgrade').addEventListener('click', () => {
      if (!g.upgradeWarehouse()) this.say('Not enough cash.');
    });
    page.querySelector('#btn-truck').addEventListener('click', () => {
      if (!g.buyTruck()) this.say('Not enough cash.');
    });
  }

  // ---- vendors tab ------------------------------------------------------

  buildVendorsTab() {
    const g = this.game;
    const page = document.getElementById('tab-vendors');
    page.innerHTML = '<p class="fine pad">Relationships grow when you order; a strong relationship makes negotiations land. Each success locks in another 5% off (max 25%). A Head Buyer helps a lot.</p>';
    for (const [id, v] of Object.entries(VENDORS)) {
      const card = document.createElement('div');
      card.className = 'panel vendor-card';
      card.innerHTML = `
        <h3>${v.name}</h3>
        <p class="fine">${v.blurb}</p>
        <div class="kv"><span>Supplies</span><b>${v.products.map((p) => PRODUCTS[p].name).join(', ')}</b></div>
        <div class="kv"><span>Lead time</span><b>${v.leadTime} day${v.leadTime > 1 ? 's' : ''}</b></div>
        <div class="kv"><span>Quality</span><b>${'★'.repeat(Math.round(v.quality * 3))}</b></div>
        <div class="kv"><span>Relationship</span><div class="meter"><i data-rel="${id}"></i></div></div>
        <div class="kv"><span>Negotiated discount</span><b data-disc="${id}"></b></div>
        <button data-neg="${id}">Negotiate</button>`;
      page.appendChild(card);
    }
    page.addEventListener('click', (e) => {
      const id = e.target.dataset?.neg;
      if (!id) return;
      const r = g.negotiate(id);
      if (r.done) this.say(`${VENDORS[id].name} won't renegotiate twice in one day.`);
      else if (r.success) this.say(`Deal! ${VENDORS[id].name} agreed to a better rate.`);
      else this.say(`${VENDORS[id].name} didn't budge. Order more, build trust, try tomorrow.`);
    });
  }

  // ---- hq tab -----------------------------------------------------------

  buildHqTab() {
    const g = this.game;
    const page = document.getElementById('tab-hq');
    page.innerHTML = '';
    const office = document.createElement('div');
    office.className = 'panel';
    office.innerHTML = '<h3>Head office</h3><div id="roles"></div>';
    page.appendChild(office);
    const roles = office.querySelector('#roles');
    for (const [id, def] of Object.entries(ROLES)) {
      const row = document.createElement('div');
      row.className = 'role-row';
      row.dataset.role = id;
      row.innerHTML = `<div class="role-head"><b>${def.name}</b></div>
        <p class="fine">${def.desc}</p>
        <div class="role-body" data-body="${id}"></div>`;
      roles.appendChild(row);
    }
    roles.addEventListener('click', (e) => {
      const hireId = e.target.dataset?.hire;
      const fireId = e.target.dataset?.fire;
      if (hireId && !g.hireRole(hireId)) this.say('Not enough cash.');
      if (fireId) g.fireRole(fireId);
      if (hireId || fireId) this.refreshRoles(true);
    });

    const miles = document.createElement('div');
    miles.className = 'panel';
    miles.innerHTML = '<h3>Expansion plan</h3><div id="milestones"></div>';
    page.appendChild(miles);
    this.refreshRoles(true);
  }

  refreshRoles(force = false) {
    const g = this.game;
    const key = Object.keys(ROLES).map((r) => (g.hq[r] ? g.hq[r].name : '·')).join('|') + g.cash;
    const wrap = document.getElementById('roles');
    if (!wrap) return;
    if (!force && wrap.dataset.key === key) return;
    wrap.dataset.key = key;
    for (const id of Object.keys(ROLES)) {
      const body = wrap.querySelector(`[data-body="${id}"]`);
      const cur = g.hq[id];
      if (cur) {
        body.innerHTML = `<span>👤 ${cur.name} <span class="stars">${'★'.repeat(cur.skill)}</span> · ${fmt(cur.salary)}/day</span>
          <button data-fire="${id}">Let go</button>`;
      } else {
        body.innerHTML = `<span class="fine">Position vacant</span>
          <button data-hire="${id}" ${g.cash < HIRE_ROLE_COST ? 'disabled' : ''}>Hire (${fmt(HIRE_ROLE_COST)} + salary)</button>`;
      }
    }
  }

  // ---- per-frame refresh ------------------------------------------------

  refresh() {
    const g = this.game;
    setText('stat-cash', fmt(g.cash));
    document.getElementById('stat-cash').classList.toggle('broke', g.cash < 0);
    setText('stat-day', `Day ${g.day()}`);
    setText('stat-stores', `${g.stores.length} store${g.stores.length === 1 ? '' : 's'}`);
    const net = g.todayRevenue - g.todayExpenses;
    const netEl = document.getElementById('stat-net');
    const netTxt = `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net)).slice(0)} today`;
    if (netEl.textContent !== netTxt) netEl.textContent = netTxt;
    netEl.classList.toggle('pos', net >= 0);
    netEl.classList.toggle('neg', net < 0);

    // Toast.
    const toastEl = document.getElementById('toast');
    if (this.toast && performance.now() < this.toast.until) {
      toastEl.textContent = this.toast.text;
      toastEl.classList.remove('hidden');
    } else {
      toastEl.classList.add('hidden');
    }

    if (this.tab === 'stores') this.refreshStores();
    if (this.tab === 'supply') this.refreshSupply();
    if (this.tab === 'vendors') this.refreshVendors();
    if (this.tab === 'hq') { this.refreshRoles(); this.refreshMilestones(); }

    if (g.won && !this.winShown) {
      this.winShown = true;
      document.getElementById('win-banner').classList.remove('hidden');
    }
  }

  refreshStores() {
    const g = this.game;
    // Keep list rows in sync if store count changed under us.
    const wrap = document.getElementById('store-list');
    if (wrap.children.length !== g.stores.length) this.renderStoreList();
    for (const store of g.stores) {
      const el = wrap.querySelector(`[data-rev="${store.siteId}"]`);
      if (el) setEl(el, fmt(store.revenueToday));
    }
    const store = this.selectedSite ? g.storeAt(this.selectedSite) : null;
    if (!store) return;
    const box = document.getElementById('store-detail');
    const rep = box.querySelector('#sd-rep');
    if (!rep) return;
    rep.style.width = `${Math.round(store.rep * 100)}%`;
    rep.style.background = store.rep > 0.6 ? 'var(--good)' : store.rep > 0.35 ? 'var(--accent)' : 'var(--bad)';
    setEl(box.querySelector('#sd-rev'), fmt(store.revenueToday));
    const lostEl = box.querySelector('#sd-lost');
    setEl(lostEl, `${Math.round(store.lostToday)} customers`);
    lostEl.style.color = store.lostToday > 20 ? 'var(--bad)' : 'var(--dim)';
    setEl(box.querySelector('#sd-staff'), String(store.staff));
    setEl(box.querySelector('#sd-markup-val'), `${Math.round(store.markup * 100)}%`);
    for (const p of PROD_IDS) {
      const bar = box.querySelector(`[data-inv="${p}"]`);
      if (bar) {
        const f = store.inv[p] / SHELF_CAP;
        bar.style.width = `${Math.round(f * 100)}%`;
        bar.style.background = f > 0.4 ? 'var(--good)' : f > 0.15 ? 'var(--accent)' : 'var(--bad)';
      }
      const n = box.querySelector(`[data-invn="${p}"]`);
      if (n) setEl(n, `${Math.round(store.inv[p])}/${SHELF_CAP}`);
    }
  }

  refreshSupply() {
    const g = this.game;
    setText('wh-cap', `${Math.round(g.warehouseUsed())} / ${g.warehouse.cap} units`);
    const fillEl = document.getElementById('wh-fill');
    const f = g.warehouseUsed() / g.warehouse.cap;
    fillEl.style.width = `${Math.min(100, Math.round(f * 100))}%`;
    fillEl.style.background = f > 0.92 ? 'var(--bad)' : 'var(--good)';
    for (const p of PROD_IDS) {
      const el = document.querySelector(`[data-whn="${p}"]`);
      if (el) setEl(el, `${Math.round(g.warehouse.inv[p])} units · ${Math.round(g.inTransit(p))} inbound`);
      const c = document.querySelector(`[data-cost="${p}"]`);
      if (c) setEl(c, `$${g.unitCost(p, g.purchasing[p].vendor).toFixed(2)}/unit`);
    }
    setText('truck-count', String(g.trucks.length));
    const list = document.getElementById('orders-list');
    const key = g.orders.map((o) => o.vendor + o.product + o.arriveDay + o.qty).join('|') || 'none';
    if (list.dataset.key !== key) {
      list.dataset.key = key;
      list.innerHTML = g.orders.length
        ? g.orders.map((o) =>
            `<div>${o.qty} × ${PRODUCTS[o.product].name} from ${VENDORS[o.vendor].name} — arrives day ${o.arriveDay}</div>`
          ).join('')
        : 'Nothing inbound.';
    }
  }

  refreshVendors() {
    const g = this.game;
    for (const id of Object.keys(VENDORS)) {
      const rel = document.querySelector(`[data-rel="${id}"]`);
      if (rel) {
        rel.style.width = `${Math.round(g.vendors[id].rel)}%`;
        rel.style.background = 'var(--accent)';
      }
      const disc = document.querySelector(`[data-disc="${id}"]`);
      if (disc) setEl(disc, `${Math.round(g.vendors[id].discount * 100)}%`);
      const btn = document.querySelector(`[data-neg="${id}"]`);
      if (btn) {
        const used = g.vendors[id].lastNegDay === g.day();
        btn.disabled = used;
        const label = used ? 'Negotiated today' : 'Negotiate';
        if (btn.textContent !== label) btn.textContent = label;
      }
    }
  }

  refreshMilestones() {
    const g = this.game;
    const wrap = document.getElementById('milestones');
    if (!wrap) return;
    const lines = [];
    for (const d of DISTRICTS) {
      if (d.unlock === 0) continue;
      const done = g.districtUnlocked(d.id);
      lines.push(`<div class="mile ${done ? 'done' : ''}">${done ? '✅' : '⬜'} ${d.phase}: unlock ${d.name} <span class="fine">(reach ${fmt(d.unlock)})</span></div>`);
    }
    const wonStores = g.stores.length >= WIN_STORES;
    const wonCash = g.cash >= WIN_CASH;
    lines.push(`<div class="mile ${wonStores ? 'done' : ''}">${wonStores ? '✅' : '⬜'} Run ${WIN_STORES} stores <span class="fine">(${g.stores.length}/${WIN_STORES})</span></div>`);
    lines.push(`<div class="mile ${wonCash ? 'done' : ''}">${wonCash ? '✅' : '⬜'} Bank ${fmt(WIN_CASH)} — ready to go multi-state</div>`);
    const html = lines.join('');
    if (wrap.dataset.key !== html) { wrap.dataset.key = html; wrap.innerHTML = html; }
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}
function setEl(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}
