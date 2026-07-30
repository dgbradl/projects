// DOM: top bar, map overlays (events, activity feed), sidebar tabs
// (Stores / Supply / Vendors / HQ / Books), candidate hiring, store detail.

import {
  PRODUCTS, VENDORS, DISTRICTS, ROLES, EVENTS, SHELF_CAP, STAFF_WAGE,
  TRUCK_COST, WAREHOUSE_UPGRADE, HIRE_ROLE_COST, WIN_CASH, WIN_STORES,
  REMODEL, DELEGATIONS, GOALS,
} from './defs.js';

const PROD_IDS = Object.keys(PRODUCTS);
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
const signFmt = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

export class UI {
  constructor(game) {
    this.game = game;
    this.tab = 'stores';
    this.selectedSite = null;
    this.winShown = false;
    this.toast = null;
    this.bindTop();
    this.bindTabs();
    this.buildSupplyTab();
    this.buildVendorsTab();
    this.buildHqTab();
    this.buildBooksTab();
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
      this.buildBooksTab();
      this.renderStoreList();
    });
    document.getElementById('btn-win-close').addEventListener('click', () => {
      document.getElementById('win-banner').classList.add('hidden');
    });
    document.getElementById('btn-lose-reset').addEventListener('click', () => {
      this.game.clearSave();
      this.game.reset();
      this.selectedSite = null;
      this.winShown = false;
      this.loseShown = false;
      document.getElementById('lose-banner').classList.add('hidden');
      this.buildSupplyTab();
      this.buildVendorsTab();
      this.buildHqTab();
      this.buildBooksTab();
      this.renderStoreList();
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

  clickTile(x, y) {
    const site = this.game.siteAtTile(x, y);
    if (!site) return;
    this.selectedSite = site.id;
    this.setTab('stores');
    this.renderStoreList();
  }

  rangeSummary(store) {
    return `${this.game.rangeCount(store)}/${store.slots} slots used`;
  }

  // ---- candidates (shared by HQ roles and store managers) ---------------

  candidateRows(role, hireFn) {
    const g = this.game;
    const wrap = document.createElement('div');
    g.candidatesFor(role).forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cand-row';
      row.innerHTML = `
        <span class="cinfo">👤 ${c.name} <span class="stars">${'★'.repeat(c.skill)}</span> · ${fmt(c.salary)}/day
          <span class="ctrait">${c.trait.name} — ${c.trait.desc}</span>
        </span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Hire';
      btn.disabled = g.cash < HIRE_ROLE_COST;
      btn.addEventListener('click', () => hireFn(i));
      row.appendChild(btn);
      wrap.appendChild(row);
    });
    return wrap;
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
        <span class="srev" data-rev="${site.id}" title="Yesterday's profit"></span>`;
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

    if (g.rivalAt(site.id)) {
      box.innerHTML = `
        <h4>BuyLow — ${district.name}</h4>
        <p class="fine">The discount rival got here first. Their stores siphon shoppers from yours in this
        district — fight back with sharper prices and better reputation.</p>`;
      return;
    }

    if (!store) {
      const unlocked = g.districtUnlocked(site.district);
      const sisters = g.stores.filter((s) => g.site(s.siteId).district === site.district).length;
      const projShare = Math.round(100 / (1 + 0.18 * sisters));
      box.innerHTML = `
        <h4>Vacant lot — ${district.name}</h4>
        <p class="fine">Neighborhood of ~${site.pop.toLocaleString()} shoppers · rent ${fmt(site.rent)}/day</p>
        ${sisters > 0 ? `<p class="fine" style="color:var(--accent)">⚠ You already run ${sisters} store${sisters > 1 ? 's' : ''} in ${district.name} — each would capture ~${projShare}% of its neighborhood. Fresh districts pay better.</p>` : ''}`;
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
      <div class="kv"><span>Team morale</span><div class="meter"><i id="sd-morale"></i></div></div>
      <div class="kv"><span>Local market share</span><b id="sd-market" title="How much of the neighborhood this store captures, after sister stores and rival competition"></b></div>
      <div class="kv"><span>Revenue today</span><b id="sd-rev"></b></div>
      <div class="kv"><span>Profit yesterday</span><b id="sd-yprofit"></b></div>
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
      <div id="sd-manager"></div>
      <div id="sd-range"></div>
      <div id="sd-inv"></div>
      <button id="sd-close" class="danger">Close store (recover 60%)</button>`;

    // Product range block: choose which lines this store carries.
    const rangeWrap = box.querySelector('#sd-range');
    const rTitle = document.createElement('h4');
    rTitle.innerHTML = `Product range <span class="fine" id="sd-slots"></span>`;
    rTitle.style.marginTop = '8px';
    rangeWrap.appendChild(rTitle);
    const grid = document.createElement('div');
    grid.className = 'range-grid';
    for (const p of PROD_IDS) {
      const label = document.createElement('label');
      label.className = 'range-item';
      label.innerHTML = `
        <input type="checkbox" data-range="${p}" ${store.range[p] ? 'checked' : ''}>
        <span class="swatch" style="background:${PRODUCTS[p].color}"></span>
        <span>${PRODUCTS[p].name}</span>`;
      grid.appendChild(label);
    }
    rangeWrap.appendChild(grid);
    grid.addEventListener('change', (e) => {
      const p = e.target.dataset?.range;
      if (!p) return;
      if (!g.toggleProduct(site.id, p)) {
        e.target.checked = store.range[p];
        this.say(`No shelf space — remodel to carry more lines (${this.rangeSummary(store)}).`);
      } else {
        this.renderStoreDetail();
      }
    });
    if (store.slots < PROD_IDS.length) {
      const btn = document.createElement('button');
      btn.id = 'sd-remodel';
      btn.textContent = `Remodel: +${REMODEL.slots} slots (${fmt(g.remodelCost(store))})`;
      btn.style.marginTop = '6px';
      btn.addEventListener('click', () => {
        if (g.remodelStore(site.id)) this.renderStoreDetail();
        else this.say('Not enough cash.');
      });
      rangeWrap.appendChild(btn);
    }

    // Manager block.
    const mgrWrap = box.querySelector('#sd-manager');
    const title = document.createElement('h4');
    title.textContent = 'Store manager';
    title.style.marginTop = '8px';
    mgrWrap.appendChild(title);
    if (store.manager) {
      const m = store.manager;
      const row = document.createElement('div');
      row.className = 'cand-row';
      row.innerHTML = `
        <span class="cinfo">👤 ${m.name} <span class="stars">${'★'.repeat(m.skill)}</span> · ${fmt(m.salary)}/day
          <span class="ctrait">${m.trait.name} — ${m.trait.desc}</span>
        </span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Let go';
      btn.addEventListener('click', () => {
        g.fireManager(site.id);
        this.renderStoreDetail();
      });
      row.appendChild(btn);
      mgrWrap.appendChild(row);
      // What this manager is trusted to decide.
      const del = document.createElement('div');
      del.className = 'delegate-row';
      del.innerHTML = `
        <label class="range-item"><input type="checkbox" data-del="staffing" ${store.delegate.staffing ? 'checked' : ''}> Sets staffing</label>
        <label class="range-item"><input type="checkbox" data-del="pricing" ${store.delegate.pricing ? 'checked' : ''}> Sets prices</label>
        <span class="fine">${'★'.repeat(m.skill)} = ${m.skill === 3 ? 'sharp calls, daily' : m.skill === 2 ? 'decent calls, most days' : 'rough calls, every few days'}</span>`;
      del.addEventListener('change', (e) => {
        const k = e.target.dataset?.del;
        if (k) store.delegate[k] = e.target.checked;
      });
      mgrWrap.appendChild(del);
    } else {
      const note = document.createElement('p');
      note.className = 'fine';
      note.textContent = `No manager — the team runs on autopilot. A manager boosts coverage, morale, and cuts spoilage (${fmt(HIRE_ROLE_COST)} signing bonus).`;
      mgrWrap.appendChild(note);
      mgrWrap.appendChild(this.candidateRows('manager', (i) => {
        if (g.hireManager(site.id, i)) this.renderStoreDetail();
        else this.say('Not enough cash.');
      }));
    }

    setEl(box.querySelector('#sd-slots'), this.rangeSummary(store));

    const invWrap = box.querySelector('#sd-inv');
    for (const p of PROD_IDS) {
      if (!store.range[p] && store.inv[p] < 0.5) continue;
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
      row.dataset.prow = p;
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
      } else if (g.vendorStruck(pol.vendor)) {
        this.say(`${VENDORS[pol.vendor].name} is on strike — pick another vendor.`);
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
        <h3>${v.name} <span data-struck="${id}" style="color:var(--bad)"></span></h3>
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
      row.innerHTML = `<div class="role-head"><b>${def.name}</b></div>
        <p class="fine">${def.desc}</p>
        <div class="role-body" data-body="${id}"></div>`;
      roles.appendChild(row);
    }
    const deleg = document.createElement('div');
    deleg.className = 'panel';
    deleg.innerHTML = '<h3>Delegation</h3><p class="fine">Hand decisions to your department heads. Their skill decides how good the calls are — watch the activity feed to see them work. Store staffing &amp; pricing are delegated per store, in each store\'s manager section.</p><div id="delegations"></div>';
    page.appendChild(deleg);
    const dWrap = deleg.querySelector('#delegations');
    for (const [id, def] of Object.entries(DELEGATIONS)) {
      const row = document.createElement('label');
      row.className = 'deleg-item';
      row.innerHTML = `
        <input type="checkbox" data-deleg="${id}">
        <span class="dinfo"><b>${def.name}</b> <span class="fine" data-dwho="${id}"></span>
          <span class="ctrait">${def.desc}</span></span>`;
      dWrap.appendChild(row);
    }
    dWrap.addEventListener('change', (e) => {
      const id = e.target.dataset?.deleg;
      if (id) this.game.delegation[id] = e.target.checked;
    });

    const miles = document.createElement('div');
    miles.className = 'panel';
    miles.innerHTML = '<h3>Expansion plan</h3><div id="milestones"></div>';
    page.appendChild(miles);
    this.refreshRoles(true);
    this.refreshDelegations();
  }

  refreshDelegations() {
    const g = this.game;
    for (const [id, def] of Object.entries(DELEGATIONS)) {
      const box = document.querySelector(`[data-deleg="${id}"]`);
      if (!box) continue;
      const holder = g.hq[def.role];
      box.disabled = !holder;
      if (box.checked !== (g.delegation[id] && !!holder)) {
        box.checked = g.delegation[id] && !!holder;
      }
      const who = document.querySelector(`[data-dwho="${id}"]`);
      if (who) {
        setEl(who, holder
          ? `— ${holder.name} ${'★'.repeat(holder.skill)}`
          : `(hire a ${ROLES[def.role].name})`);
      }
    }
  }

  refreshRoles(force = false) {
    const g = this.game;
    const wrap = document.getElementById('roles');
    if (!wrap) return;
    const key = Object.keys(ROLES).map((r) => (g.hq[r] ? g.hq[r].name : '·')).join('|')
      + (g.cash < HIRE_ROLE_COST ? 'poor' : 'ok');
    if (!force && wrap.dataset.key === key) return;
    wrap.dataset.key = key;
    for (const id of Object.keys(ROLES)) {
      const body = wrap.querySelector(`[data-body="${id}"]`);
      body.innerHTML = '';
      const cur = g.hq[id];
      if (cur) {
        const row = document.createElement('div');
        row.className = 'cand-row';
        row.innerHTML = `
          <span class="cinfo">👤 ${cur.name} <span class="stars">${'★'.repeat(cur.skill)}</span> · ${fmt(cur.salary)}/day
            <span class="ctrait">${cur.trait.name} — ${cur.trait.desc}</span>
          </span>`;
        const btn = document.createElement('button');
        btn.textContent = 'Let go';
        btn.addEventListener('click', () => {
          g.fireRole(id);
          this.refreshRoles(true);
        });
        row.appendChild(btn);
        body.appendChild(row);
      } else {
        const note = document.createElement('div');
        note.className = 'fine';
        note.textContent = `Candidates (${fmt(HIRE_ROLE_COST)} signing bonus):`;
        body.appendChild(note);
        body.appendChild(this.candidateRows(id, (i) => {
          if (g.hireRole(id, i)) this.refreshRoles(true);
          else this.say('Not enough cash.');
        }));
      }
    }
  }

  // ---- books tab --------------------------------------------------------

  buildBooksTab() {
    const page = document.getElementById('tab-books');
    page.innerHTML = `
      <div class="panel">
        <h3>Profit &amp; loss <span class="fine" id="pl-day"></span></h3>
        <div id="pl-body"></div>
      </div>
      <div class="panel">
        <h3>Daily profit — last 30 days</h3>
        <canvas id="chart"></canvas>
      </div>
      <div class="panel">
        <h3>By store <span class="fine">(yesterday)</span></h3>
        <div id="bstores"></div>
      </div>
      <div class="panel">
        <h3>Activity log</h3>
        <div id="log-list"></div>
      </div>`;
  }

  refreshBooks() {
    const g = this.game;
    const t = g.today;
    const y = g.history[g.history.length - 1];
    setText('pl-day', y ? `· today so far vs day ${y.day}` : '· today so far');

    // Rent/wages/salaries accrue at day end, so "today" shows — for them.
    const body = document.getElementById('pl-body');
    const lines = [
      ['Revenue', t.revenue, y?.revenue],
      ['Cost of goods', -t.cogs, y !== undefined ? -y.cogs : undefined],
      ['Fines', -t.fines, y !== undefined ? -y.fines : undefined],
      ['Debt interest', -t.interest, y !== undefined ? -(y.interest ?? 0) : undefined],
      ['Rent (accrues nightly)', null, y !== undefined ? -y.rent : undefined],
      ['Wages (accrues nightly)', null, y !== undefined ? -y.wages : undefined],
      ['Salaries (accrues nightly)', null, y !== undefined ? -y.salaries : undefined],
    ];
    let html = '<div class="pl-row"><span></span><span><b>Today</b> · Yesterday</span></div>';
    for (const [label, today, yest] of lines) {
      const tv = today === null ? '—' : signFmt(today);
      const yv = yest === undefined ? '—' : signFmt(yest);
      html += `<div class="pl-row"><span>${label}</span><span><b>${tv}</b> · ${yv}</span></div>`;
    }
    const profitNow = g.profitToday();
    const yProfit = y ? y.profit : undefined;
    html += `<div class="pl-row total"><span>Profit</span>
      <span><b class="${profitNow >= 0 ? 'pos' : 'neg'}">${signFmt(profitNow)}</b> · ${yProfit === undefined ? '—' : `<span class="${yProfit >= 0 ? 'pos' : 'neg'}">${signFmt(yProfit)}</span>`}</span></div>`;
    if (body.dataset.key !== html) { body.dataset.key = html; body.innerHTML = html; }

    this.drawChart();

    const bs = document.getElementById('bstores');
    let bHtml = '';
    for (const store of g.stores) {
      const p = store.yesterday.profit;
      bHtml += `<div class="bstore-row"><span>${store.name}</span>
        <span>rev ${fmt(store.yesterday.revenue)}</span>
        <span class="${p >= 0 ? 'pos' : 'neg'}">${signFmt(p)}</span></div>`;
    }
    if (!g.stores.length) bHtml = '<div class="fine">No stores.</div>';
    if (bs.dataset.key !== bHtml) { bs.dataset.key = bHtml; bs.innerHTML = bHtml; }

    const logWrap = document.getElementById('log-list');
    const entries = g.logEntries.slice(-40).reverse();
    const lKey = entries.length ? `${entries.length}-${entries[0].day}-${entries[0].text}` : 'none';
    if (logWrap.dataset.key !== lKey) {
      logWrap.dataset.key = lKey;
      logWrap.innerHTML = entries.length
        ? entries.map((e) => `<div><span class="fday">D${e.day}</span>${e.icon} ${e.text}</div>`).join('')
        : '<div class="fine">Nothing yet.</div>';
    }
  }

  drawChart() {
    const canvas = document.getElementById('chart');
    if (!canvas) return;
    const g = this.game;
    const data = g.history.slice(-30);
    const key = data.length ? `${data.length}-${data[data.length - 1].day}` : 'none';
    if (canvas.dataset.key === key) return;
    canvas.dataset.key = key;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    if (!data.length) {
      ctx.fillStyle = '#8b96a6';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('No full days yet.', 6, 20);
      return;
    }
    const max = Math.max(50, ...data.map((d) => Math.abs(d.profit)));
    const zero = h / 2;
    ctx.strokeStyle = 'rgba(139, 150, 166, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, zero);
    ctx.lineTo(w, zero);
    ctx.stroke();
    const bw = w / 30;
    data.forEach((d, i) => {
      const x = w - (data.length - i) * bw;
      const bh = (d.profit / max) * (h / 2 - 4);
      ctx.fillStyle = d.profit >= 0 ? '#6fd08c' : '#e8828c';
      if (bh >= 0) ctx.fillRect(x + 1, zero - bh, bw - 2, Math.max(1, bh));
      else ctx.fillRect(x + 1, zero, bw - 2, Math.max(1, -bh));
    });
  }

  refreshGoal() {
    const g = this.game;
    if (this.lastGoalIndex === undefined) this.lastGoalIndex = g.goalIndex;
    if (g.goalIndex !== this.lastGoalIndex) {
      const done = GOALS[this.lastGoalIndex];
      if (done && g.goalIndex > this.lastGoalIndex) {
        this.say(`🎯 Objective complete: ${done.title} — +${fmt(done.reward)} bonus!`);
      }
      this.lastGoalIndex = g.goalIndex;
    }
    const goal = GOALS[g.goalIndex];
    const key = goal ? goal.id : 'final';
    const panel = document.getElementById('goal-panel');
    if (panel.dataset.key === key) return;
    panel.dataset.key = key;
    if (goal) {
      setText('goal-reward', `+${fmt(goal.reward)}`);
      setText('goal-title', goal.title);
      setText('goal-desc', goal.desc);
    } else {
      setText('goal-reward', '');
      setText('goal-title', 'Final goal: 8 stores & $200k');
      setText('goal-desc', 'Outgrow BuyLow and the board approves multi-state expansion.');
    }
  }

  // ---- map overlays -----------------------------------------------------

  refreshOverlays() {
    const g = this.game;
    // Active event chips.
    const bar = document.getElementById('events-bar');
    const eKey = g.activeEvents.map((e) => e.type + e.daysLeft + (e.vendor || e.district || '')).join('|') || 'none';
    if (bar.dataset.key !== eKey) {
      bar.dataset.key = eKey;
      bar.innerHTML = g.activeEvents.map((e) => {
        const def = EVENTS[e.type];
        let where = '';
        if (e.vendor) where = ` — ${VENDORS[e.vendor].name}`;
        if (e.district) where = ` — ${g.district(e.district).name}`;
        return `<div class="event-chip">${def.icon} <b>${def.name}</b>${where}
          <span class="ev-days">· ${e.daysLeft}d left</span><br>
          <span class="ev-days">${def.desc}</span></div>`;
      }).join('');
    }
    // Activity feed: last 4 log entries.
    const feed = document.getElementById('feed');
    const entries = g.logEntries.slice(-4);
    const fKey = entries.map((e) => e.day + e.text).join('|') || 'none';
    if (feed.dataset.key !== fKey) {
      feed.dataset.key = fKey;
      feed.innerHTML = [...entries].reverse()
        .map((e) => `<div class="feed-entry"><span class="fday">D${e.day}</span>${e.icon} ${e.text}</div>`)
        .join('');
    }
  }

  // ---- per-frame refresh ------------------------------------------------

  refresh() {
    const g = this.game;
    setText('stat-cash', fmt(g.cash));
    document.getElementById('stat-cash').classList.toggle('broke', g.cash < 0);
    setText('stat-day', `Day ${g.day()}`);
    setText('stat-stores', `${g.stores.length} store${g.stores.length === 1 ? '' : 's'}`);
    const net = g.profitToday();
    const netEl = document.getElementById('stat-net');
    const netTxt = `${signFmt(net)} today`;
    if (netEl.textContent !== netTxt) netEl.textContent = netTxt;
    netEl.classList.toggle('pos', net >= 0);
    netEl.classList.toggle('neg', net < 0);

    const toastEl = document.getElementById('toast');
    if (this.toast && performance.now() < this.toast.until) {
      toastEl.textContent = this.toast.text;
      toastEl.classList.remove('hidden');
    } else {
      toastEl.classList.add('hidden');
    }

    this.refreshOverlays();
    this.refreshGoal();

    if (this.tab === 'stores') this.refreshStores();
    if (this.tab === 'supply') this.refreshSupply();
    if (this.tab === 'vendors') this.refreshVendors();
    if (this.tab === 'hq') { this.refreshRoles(); this.refreshMilestones(); this.refreshDelegations(); }
    if (this.tab === 'books') this.refreshBooks();

    if (g.won && !this.winShown) {
      this.winShown = true;
      document.getElementById('win-banner').classList.remove('hidden');
    }
    if (g.gameOver && !this.loseShown) {
      this.loseShown = true;
      document.getElementById('lose-banner').classList.remove('hidden');
    }
  }

  refreshStores() {
    const g = this.game;
    const wrap = document.getElementById('store-list');
    if (wrap.children.length !== g.stores.length) this.renderStoreList();
    for (const store of g.stores) {
      const el = wrap.querySelector(`[data-rev="${store.siteId}"]`);
      if (el) {
        const p = store.yesterday.profit;
        setEl(el, signFmt(p));
        el.style.color = p >= 0 ? 'var(--good)' : 'var(--bad)';
      }
    }
    const store = this.selectedSite ? g.storeAt(this.selectedSite) : null;
    if (!store) return;
    const box = document.getElementById('store-detail');
    const rep = box.querySelector('#sd-rep');
    if (!rep) return;
    rep.style.width = `${Math.round(store.rep * 100)}%`;
    rep.style.background = store.rep > 0.6 ? 'var(--good)' : store.rep > 0.35 ? 'var(--accent)' : 'var(--bad)';
    const mor = box.querySelector('#sd-morale');
    mor.style.width = `${Math.round(store.morale * 100)}%`;
    mor.style.background = store.morale > 0.6 ? 'var(--good)' : store.morale > 0.35 ? 'var(--accent)' : 'var(--bad)';
    const mEl = box.querySelector('#sd-market');
    if (mEl) {
      const mf = g.marketFactor(store);
      const site2 = g.site(store.siteId);
      const rivals = g.rival.stores.filter((id) => g.site(id).district === site2.district).length;
      setEl(mEl, `${Math.round(mf * 100)}%${rivals ? ` (${rivals} BuyLow nearby)` : ''}`);
      mEl.style.color = mf > 0.85 ? 'var(--good)' : mf > 0.6 ? 'var(--accent)' : 'var(--bad)';
    }
    setEl(box.querySelector('#sd-rev'), fmt(store.today.revenue));
    const yp = box.querySelector('#sd-yprofit');
    setEl(yp, signFmt(store.yesterday.profit));
    yp.style.color = store.yesterday.profit >= 0 ? 'var(--good)' : 'var(--bad)';
    const lostEl = box.querySelector('#sd-lost');
    setEl(lostEl, `${Math.round(store.lostToday)} customers`);
    lostEl.style.color = store.lostToday > 20 ? 'var(--bad)' : 'var(--dim)';
    setEl(box.querySelector('#sd-staff'), String(store.staff));
    setEl(box.querySelector('#sd-markup-val'), `${Math.round(store.markup * 100)}%`);
    // A delegated manager may move the slider — keep it in sync.
    const slider = box.querySelector('#sd-markup');
    if (slider && document.activeElement !== slider) {
      const v = String(Math.round(store.markup * 100));
      if (slider.value !== v) slider.value = v;
    }
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
      const carried = g.stores.some((s) => s.range[p]);
      if (c) {
        setEl(c, carried
          ? `$${g.unitCost(p, g.purchasing[p].vendor).toFixed(2)}/unit`
          : 'no store carries this');
      }
      const rowEl = document.querySelector(`[data-prow="${p}"]`);
      if (rowEl) rowEl.style.opacity = carried ? '1' : '0.45';
      // The buyer may retune these under delegation — keep inputs in sync
      // (but never yank a field the player is editing).
      for (const [attr, val] of [['point', g.purchasing[p].point], ['qty', g.purchasing[p].qty]]) {
        const input = document.querySelector(`[data-${attr}="${p}"]`);
        if (input && document.activeElement !== input && Number(input.value) !== val) {
          input.value = val;
        }
      }
      const vsel = document.querySelector(`[data-vendor="${p}"]`);
      if (vsel && document.activeElement !== vsel && vsel.value !== g.purchasing[p].vendor) {
        vsel.value = g.purchasing[p].vendor;
      }
    }
    setText('truck-count', String(g.trucks.length));
    const list = document.getElementById('orders-list');
    const key = g.orders.map((o) => o.vendor + o.product + o.arriveDay + o.qty).join('|') || 'none';
    if (list.dataset.key !== key) {
      list.dataset.key = key;
      list.innerHTML = g.orders.length
        ? g.orders.map((o) =>
            `<div>${o.qty} × ${PRODUCTS[o.product].name} from ${VENDORS[o.vendor].name} — arrives day ${o.arriveDay}${g.vendorStruck(o.vendor) ? ' <span style="color:var(--bad)">(held by strike)</span>' : ''}</div>`
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
      const struck = document.querySelector(`[data-struck="${id}"]`);
      if (struck) setEl(struck, g.vendorStruck(id) ? '✊ ON STRIKE' : '');
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
