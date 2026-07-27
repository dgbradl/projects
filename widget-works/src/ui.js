// DOM panels: build toolbar, market, staff, inspector, top bar.

import { GOODS, RECIPES, BUILDINGS, HIRE_BONUS } from './defs.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.tool = 'select';        // 'select' | 'demolish' | building type
    this.dir = 0;
    this.selected = null;        // { x, y } of inspected building
    this.buildToolbar();
    this.bindTop();
    this.marketRows = {};
    this.buildMarket();
    this.winShown = false;
  }

  buildToolbar() {
    const wrap = document.getElementById('build-buttons');
    const tools = [
      ['select', 'Select', 'Inspect buildings'],
      ['demolish', 'Demolish', 'Remove for a 50% refund'],
      ...Object.entries(BUILDINGS).map(([id, d]) => [id, d.name, d.desc, d.cost]),
    ];
    for (const [id, label, desc, cost] of tools) {
      const btn = document.createElement('button');
      btn.dataset.tool = id;
      btn.title = desc;
      btn.innerHTML = `<span>${label}</span>` + (cost ? `<span class="cost">$${cost}</span>` : '');
      btn.addEventListener('click', () => this.setTool(id));
      wrap.appendChild(btn);
    }
    this.setTool('select');
  }

  setTool(id) {
    this.tool = id;
    if (id !== 'select') this.selected = null;
    document.querySelectorAll('#build-buttons button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === id);
    });
  }

  bindTop() {
    document.querySelectorAll('.speeds button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.speed = Number(btn.dataset.speed);
        document.querySelectorAll('.speeds button').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
      });
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('Wipe the save and start a fresh company?')) return;
      this.game.clearSave();
      this.game.reset();
      this.selected = null;
      this.winShown = false;
      document.getElementById('win-banner').classList.add('hidden');
    });
    document.getElementById('btn-hire').addEventListener('click', () => {
      this.game.hire();
    });
    document.getElementById('btn-win-close').addEventListener('click', () => {
      document.getElementById('win-banner').classList.add('hidden');
    });
  }

  buildMarket() {
    const wrap = document.getElementById('market-list');
    for (const [id, g] of Object.entries(GOODS)) {
      const row = document.createElement('div');
      row.className = 'market-row';
      row.innerHTML = `
        <span class="swatch" style="background:${g.color}"></span>
        <span class="gname">${g.name}</span>
        <span class="buyat"></span>
        <span class="trend"></span>
        <span class="price"></span>`;
      wrap.appendChild(row);
      this.marketRows[id] = row;
    }
  }

  // Called every frame (cheap DOM updates only when text changes).
  refresh() {
    const g = this.game;
    setText('stat-cash', `$${Math.round(g.cash).toLocaleString()}`);
    document.getElementById('stat-cash').classList.toggle('broke', g.cash < 0);
    setText('stat-day', `Day ${g.day}`);
    const net = Math.round(g.todayRevenue - g.todayExpenses);
    const netEl = document.getElementById('stat-net');
    netEl.textContent = `${net >= 0 ? '+' : '−'}$${Math.abs(net).toLocaleString()} today`;
    netEl.classList.toggle('pos', net >= 0);
    netEl.classList.toggle('neg', net < 0);

    for (const [id, row] of Object.entries(this.marketRows)) {
      const price = g.sellPrice(id);
      const prev = g.market[id].prevPrice;
      row.querySelector('.price').textContent = `$${price}`;
      const buy = g.buyPrice(id);
      row.querySelector('.buyat').textContent = buy ? `buy $${buy}` : '';
      const trendEl = row.querySelector('.trend');
      trendEl.textContent = price > prev ? '▲' : price < prev ? '▼' : '·';
      trendEl.className = 'trend ' + (price > prev ? 'up' : price < prev ? 'down' : '');
    }

    this.refreshWorkers();
    this.refreshInspector();

    if (g.won && !this.winShown) {
      this.winShown = true;
      document.getElementById('win-banner').classList.remove('hidden');
    }
  }

  refreshWorkers() {
    const g = this.game;
    const machines = g.machines().length;
    setText('staff-summary', ` ${Math.min(g.workers.length, machines)}/${machines} machines staffed`);
    const wrap = document.getElementById('worker-list');
    const key = g.workers.map((w) => w.name + w.skill).join('|');
    if (wrap.dataset.key === key) return;
    wrap.dataset.key = key;
    wrap.innerHTML = '';
    if (g.workers.length === 0) {
      wrap.innerHTML = '<div class="fine">No staff yet — machines sit idle without a worker.</div>';
    }
    g.workers.forEach((w, i) => {
      const row = document.createElement('div');
      row.className = 'worker-row';
      row.innerHTML = `
        <span class="wname">${w.name}</span>
        <span class="skill">${'★'.repeat(w.skill)}</span>
        <span class="wage">$${w.wage}/day</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Fire';
      btn.addEventListener('click', () => g.fire(i));
      row.appendChild(btn);
      wrap.appendChild(row);
    });
    document.getElementById('btn-hire').disabled = g.cash < HIRE_BONUS;
  }

  refreshInspector() {
    const body = document.getElementById('info-body');
    const g = this.game;
    if (!this.selected) {
      if (body.dataset.state !== 'empty') {
        body.dataset.state = 'empty';
        body.innerHTML = 'Select tool + click a building.';
      }
      return;
    }
    const { x, y } = this.selected;
    const b = g.cell(x, y);
    if (!b) { this.selected = null; return; }
    const def = BUILDINGS[b.type];
    let html = `<b>${def.name}</b><br>${def.desc}<br>`;
    if (def.recipe) {
      const r = RECIPES[def.recipe];
      const ins = Object.entries(r.inputs)
        .map(([gid, n]) => `${GOODS[gid].name}: ${b.buf[gid]}/${n * 2}`).join(' · ');
      html += `<br>Input buffer — ${ins}<br>Output queue: ${b.outCount}/3<br>` +
        `Worker: ${b.worker ? `${b.worker.name} (${'★'.repeat(b.worker.skill)})` : '<span style="color:#e8646f">none — idle</span>'}`;
    }
    if (def.good) {
      html += `<br>Status: ${b.enabled ? 'importing' : 'paused'} · unit cost $${g.buyPrice(def.good)}`;
    }
    const stateKey = JSON.stringify([x, y, html]);
    if (body.dataset.state === stateKey) return;
    body.dataset.state = stateKey;
    body.innerHTML = html;
    if (def.good) {
      const toggle = document.createElement('button');
      toggle.textContent = b.enabled ? 'Pause imports' : 'Resume imports';
      toggle.addEventListener('click', () => { b.enabled = !b.enabled; });
      body.appendChild(toggle);
    }
    const demo = document.createElement('button');
    demo.textContent = 'Demolish (50% refund)';
    demo.addEventListener('click', () => {
      g.demolish(x, y);
      this.selected = null;
    });
    body.appendChild(demo);
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el.textContent !== text) el.textContent = text;
}
