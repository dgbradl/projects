// DOM: top bar, map overlays (events, activity feed), sidebar tabs
// (Stores / Supply / Vendors / HQ / Books), candidate hiring, store detail.

import {
  PRODUCTS, VENDORS, DISTRICTS, ROLES, EVENTS, SHELF_CAP, STAFF_WAGE,
  TRUCK_COST, WAREHOUSE_UPGRADE, HIRE_ROLE_COST, WIN_CASH, WIN_STORES,
  REMODEL, DELEGATIONS, GOALS, CONTRACT, STORE_UPGRADES, CAMPAIGN, ACHIEVEMENTS,
} from './defs.js';
import { sfx, setMuted, isMuted, setMusic } from './audio.js';

// Which activity-log icons make which noise.
const LOG_SFX = {
  '🎯': 'goal', '🤝': 'dealYes', '🏅': 'goal', '🎓': 'hire',
  '🏪': 'event', '🥶': 'event', '🔥': 'event', '✊': 'event', '🚧': 'event',
  '🎪': 'event', '⚔️': 'event', '🧾': 'event', '🧊': 'event',
  '🤧': 'event', '☣️': 'event', '📱': 'event', '⛽': 'event', '⚓': 'event',
  '🥕': 'event', '📅': 'cash', '🌸': 'goal', '🍖': 'goal', '🦃': 'goal', '🎁': 'goal',
  '🏦': 'alert', '⚠️': 'alert', '💥': 'lose',
};

const PROD_IDS = Object.keys(PRODUCTS);
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
const signFmt = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

const SETTINGS_KEY = 'market-street-settings';
const DISTRICT_COLOR = {
  oldtown: 'var(--d-oldtown)', westside: 'var(--d-westside)',
  riverside: 'var(--d-riverside)', downtown: 'var(--d-downtown)',
};

export class UI {
  constructor(game, { fresh = false } = {}) {
    this.game = game;
    this.tab = 'stores';
    this.selectedSite = null;
    this.winShown = false;
    this.toast = null;
    this.settings = { pauseOnEvent: false, weeklyReport: true, difficulty: 'standard', music: true };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
    } catch { /* defaults are fine */ }
    this.bindTop();
    this.bindTabs();
    this.bindChips();
    this.bindFeed();
    this.bindModals();
    this.bindSettings();
    this.buildSupplyTab();
    this.buildVendorsTab();
    this.buildHqTab();
    this.buildBooksTab();
    this.renderStoreList();
    this.bindTitle();
    if (fresh) this.showTitle('fresh');
    // WebAudio unlocks on the first gesture — that's when the pad fades in.
    const startMusic = () => { if (this.settings.music) setMusic(true); };
    window.addEventListener('pointerdown', startMusic, { once: true });
    window.addEventListener('keydown', startMusic, { once: true });
    document.getElementById('btn-welcome-close').addEventListener('click', () => {
      document.getElementById('welcome-banner').classList.add('hidden');
    });
    document.getElementById('btn-week-close').addEventListener('click', () => this.closeWeeklyReport());
    document.getElementById('btn-week-run').addEventListener('click', () => this.runWeek());
    document.getElementById('btn-run-week').addEventListener('click', () => this.runWeek());
    document.getElementById('btn-nego-roll').addEventListener('click', () => {
      const g = this.game;
      if (!g.nego || g.nego.over) return;
      g.negoRoll([...this.negoKeep]);
      this.renderNego(true);
    });
    document.getElementById('btn-nego-take').addEventListener('click', () => {
      const g = this.game;
      if (!g.nego || g.nego.over) return;
      g.negoAccept(!!g.nego.counter);
      this.renderNego();
    });
    document.getElementById('btn-nego-done').addEventListener('click', () => this.closeNegotiation());
    document.querySelectorAll('#nego-stake button').forEach((b) => {
      b.addEventListener('click', () => this.startNego(b.dataset.stake));
    });
  }

  runWeek() {
    this.game.startWeek();
    this.game.save();
    const el = document.getElementById('week-report');
    if (!el.classList.contains('hidden')) el.classList.add('hidden');
  }

  // ---- title screen ------------------------------------------------------

  bindTitle() {
    document.querySelectorAll('.diff-card').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.diff-card').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        this.settings.difficulty = b.dataset.diff;
        this.saveSettings();
      });
    });
    document.getElementById('btn-title-start').addEventListener('click', () => {
      document.getElementById('title-screen').classList.add('hidden');
      this.newGame();
      this.game.speed = 1;
      sfx.goal?.();
    });
    document.getElementById('btn-title-continue').addEventListener('click', () => {
      document.getElementById('title-screen').classList.add('hidden');
      this.game.speed = this.titlePrevSpeed || 1;
    });
  }

  showTitle(mode) {
    this.titlePrevSpeed = this.game.speed || 1;
    this.game.speed = 0;
    document.querySelectorAll('.diff-card').forEach((x) =>
      x.classList.toggle('selected', x.dataset.diff === this.settings.difficulty));
    // "Keep playing" only makes sense over a live, unfinished game.
    document.getElementById('btn-title-continue').classList.toggle(
      'hidden', mode === 'fresh' || this.game.gameOver);
    document.getElementById('btn-title-start').textContent =
      mode === 'fresh' ? 'Open the doors' : 'Start a new chain';
    document.getElementById('title-screen').classList.remove('hidden');
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  newGame() {
    this.game.clearSave();
    this.game.reset(this.settings.difficulty);
    this.selectedSite = null;
    this.winShown = false;
    this.loseShown = false;
    document.getElementById('win-banner').classList.add('hidden');
    document.getElementById('lose-banner').classList.add('hidden');
    this.buildSupplyTab();
    this.buildVendorsTab();
    this.buildHqTab();
    this.buildBooksTab();
    this.renderStoreList();
  }

  bindSettings() {
    const modal = document.getElementById('settings-modal');
    document.getElementById('btn-settings').addEventListener('click', () => {
      modal.classList.toggle('hidden');
      const wm = document.getElementById('set-weekly-mode');
      if (wm) wm.checked = this.game.weeklyMode;
    });
    document.getElementById('btn-settings-close').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    const pause = document.getElementById('set-pause-event');
    pause.checked = this.settings.pauseOnEvent;
    pause.addEventListener('change', () => {
      this.settings.pauseOnEvent = pause.checked;
      this.saveSettings();
    });
    const music = document.getElementById('set-music');
    music.checked = this.settings.music;
    music.addEventListener('change', () => {
      this.settings.music = music.checked;
      setMusic(music.checked);
      this.saveSettings();
    });
    const weekly = document.getElementById('set-weekly');
    weekly.checked = this.settings.weeklyReport;
    weekly.addEventListener('change', () => {
      this.settings.weeklyReport = weekly.checked;
      this.saveSettings();
    });
    const weeklyMode = document.getElementById('set-weekly-mode');
    weeklyMode.checked = this.game.weeklyMode;
    weeklyMode.addEventListener('change', () => {
      this.game.weeklyMode = weeklyMode.checked;
      if (!weeklyMode.checked && this.game.planning) this.game.startWeek();
      this.game.save();
    });
    const diff = document.getElementById('set-difficulty');
    diff.value = this.settings.difficulty;
    diff.addEventListener('change', () => {
      this.settings.difficulty = diff.value;
      this.saveSettings();
      this.say('Difficulty applies when you start a new game (Reset).');
    });
    const io = document.getElementById('save-io');
    document.getElementById('btn-export').addEventListener('click', () => {
      io.classList.remove('hidden');
      io.value = this.game.exportSave();
      io.select();
      try { navigator.clipboard.writeText(io.value); this.say('Save copied to clipboard.'); }
      catch { this.say('Save shown below — copy it somewhere safe.'); }
    });
    document.getElementById('btn-import').addEventListener('click', () => {
      if (io.classList.contains('hidden') || !io.value.trim()) {
        io.classList.remove('hidden');
        io.value = '';
        io.placeholder = 'Paste a save here, then press Import again.';
        io.focus();
        return;
      }
      if (this.game.importSave(io.value.trim())) {
        modal.classList.add('hidden');
        this.newGameUiOnly();
        this.say('Save imported.');
      } else {
        this.say('That doesn\'t look like a valid save.');
      }
    });
  }

  // Rebuild panels around an externally loaded game state.
  newGameUiOnly() {
    this.selectedSite = null;
    this.winShown = this.game.won;
    this.loseShown = this.game.gameOver;
    this.buildSupplyTab();
    this.buildVendorsTab();
    this.buildHqTab();
    this.buildBooksTab();
    this.renderStoreList();
  }

  // ---- chrome -----------------------------------------------------------

  bindTop() {
    // Sound toggle, persisted.
    const soundBtn = document.getElementById('btn-sound');
    setMuted(localStorage.getItem('market-street-muted') === '1');
    soundBtn.textContent = isMuted() ? '🔇' : '🔊';
    soundBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      soundBtn.textContent = isMuted() ? '🔇' : '🔊';
      soundBtn.setAttribute('aria-pressed', String(isMuted()));
      try { localStorage.setItem('market-street-muted', isMuted() ? '1' : '0'); } catch { /* ignore */ }
      if (!isMuted()) sfx.cash();
    });
    document.querySelectorAll('.speeds button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.speed = Number(btn.dataset.speed);
        document.querySelectorAll('.speeds button')
          .forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    document.getElementById('btn-reset').addEventListener('click', () => this.showTitle('reset'));
    document.getElementById('btn-win-close').addEventListener('click', () => {
      document.getElementById('win-banner').classList.add('hidden');
    });
    document.getElementById('btn-lose-reset').addEventListener('click', () => {
      document.getElementById('lose-banner').classList.add('hidden');
      this.showTitle('reset');
    });
  }

  syncBackdrop() {
    const anyOpen = ['settings-modal', 'week-report', 'welcome-banner', 'win-banner', 'lose-banner', 'nego-modal']
      .some((id) => !document.getElementById(id).classList.contains('hidden'));
    document.getElementById('modal-backdrop').classList.toggle('hidden', !anyOpen);
  }

  bindModals() {
    document.querySelectorAll('.modal-x').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.close;
        if (id === 'week-report') this.closeWeeklyReport();
        else if (id === 'nego-modal') this.closeNegotiation();
        else document.getElementById(id).classList.add('hidden');
      });
    });
    document.getElementById('modal-backdrop').addEventListener('click', () => {
      // Click-outside closes the dismissable overlays (never the lose banner).
      document.getElementById('settings-modal').classList.add('hidden');
      document.getElementById('welcome-banner').classList.add('hidden');
      document.getElementById('win-banner').classList.add('hidden');
      this.closeWeeklyReport();
      this.closeNegotiation();
    });
  }

  bindFeed() {
    const feed = document.getElementById('feed');
    feed.addEventListener('click', () => {
      this.setTab('books');
      document.getElementById('log-list')?.scrollIntoView({ block: 'nearest' });
    });
  }

  bindChips() {
    document.getElementById('events-bar').addEventListener('click', (e) => {
      const district = e.target.dataset?.matchwar;
      if (!district) return;
      let n = 0;
      for (const s of this.game.stores) {
        if (this.game.site(s.siteId).district === district && s.markup > 0.9) {
          s.markup = 0.9;
          n++;
        }
      }
      this.say(`Dropped prices to 90% at ${n} store${n === 1 ? '' : 's'} to fight the discounter.`);
      document.getElementById('events-bar').dataset.key = '';   // force chip rebuild
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

  updateMapTip(clientX, clientY, tile) {
    const tip = document.getElementById('map-tip');
    const g = this.game;
    const site = tile ? g.siteAtTile(tile.x, tile.y) : null;
    if (!site) {
      tip.classList.add('hidden');
      return;
    }
    let html;
    const store = g.storeAt(site.id);
    if (store) {
      const total = PROD_IDS.reduce((s, p) => s + (store.range[p] ? store.inv[p] : 0), 0);
      const fill = Math.round(100 * total / (SHELF_CAP * Math.max(1, g.rangeCount(store))));
      html = `<b>${store.name}</b><br>Shelves ${fill}% · rep ${Math.round(store.rep * 100)}% · ${Math.round(g.marketFactor(store) * 100)}% share`;
    } else if (g.rivalAt(site.id)) {
      html = `<b>BuyLow${g.rival.plus?.[site.id] ? '+' : ''}</b><br>The rival. ${g.district(site.district).name}.`;
    } else if (g.districtUnlocked(site.district)) {
      html = `<b>For sale — ${fmt(site.price)}</b><br>~${site.pop.toLocaleString()} shoppers · rent ${fmt(site.rent)}/day`;
    } else {
      html = `<b>Locked lot</b><br>Unlocks with ${g.district(site.district).name}`;
    }
    if (tip.dataset.html !== html) {
      tip.dataset.html = html;
      tip.innerHTML = html;
    }
    const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
    tip.style.left = `${Math.min(clientX - wrap.left + 14, wrap.width - 190)}px`;
    tip.style.top = `${clientY - wrap.top + 12}px`;
    tip.classList.remove('hidden');
  }

  closeOverlays() {
    for (const id of ['settings-modal', 'welcome-banner', 'win-banner']) {
      document.getElementById(id).classList.add('hidden');
    }
    this.closeWeeklyReport();
    this.closeNegotiation();
  }

  closeWeeklyReport() {
    const el = document.getElementById('week-report');
    if (!el.classList.contains('hidden')) {
      el.classList.add('hidden');
      // During a planning stop, closing the report keeps the game paused —
      // the plan bar takes over until the player runs the week.
      if (this.game.planning) return;
      if (this.game.speed === 0) this.game.speed = this.reportPrevSpeed ?? 1;
    }
  }

  // ---- dice negotiation table -------------------------------------------

  openNegotiation(id) {
    const g = this.game;
    const can = g.canNegotiate(id);
    if (can.noMeetings) { this.say('No meetings left this week — the calendar refreshes at the weekly wrap-up.'); return; }
    if (can.done) { this.say(`${VENDORS[id].name} won't renegotiate twice in one day.`); return; }
    if (can.struck) { this.say(`${VENDORS[id].name} is on strike — nobody's at the table.`); return; }
    this.negoPrevSpeed = g.speed || 1;
    g.speed = 0;
    this.negoVendor = id;
    const v = VENDORS[id];
    const { count, mods } = g.negoDiceCount(id);
    document.getElementById('nego-title').textContent = `🤝 ${v.name}`;
    document.getElementById('nego-temper').textContent =
      `${v.temper ?? ''} (${g.meetingsLeft} meeting${g.meetingsLeft === 1 ? '' : 's'} left this week)`;
    document.getElementById('nego-bonus').innerHTML =
      [`<span>${count} dice</span>`,
        ...mods.map((m) => `<span class="${m.d < 0 ? 'm-neg' : ''}">${m.d > 0 ? '+1' : '−1'} ${m.label}</span>`)]
        .join('');
    // Stake chooser phase: the table isn't sat (and the daily sitting isn't
    // burned) until an ask is chosen.
    document.getElementById('nego-stake').classList.remove('hidden');
    document.getElementById('nego-dice').innerHTML = '';
    document.getElementById('nego-patience').innerHTML = '';
    document.getElementById('nego-lev').textContent = '';
    document.getElementById('nego-chatter').textContent = '';
    for (const b of ['btn-nego-take', 'btn-nego-roll', 'btn-nego-done']) {
      document.getElementById(b).classList.add('hidden');
    }
    document.getElementById('nego-modal').classList.remove('hidden');
    sfx.event?.();
  }

  startNego(stake) {
    const g = this.game;
    const r = g.startNegotiation(this.negoVendor, stake);
    if (r.done || r.struck) return;
    this.negoKeep = new Set();
    document.getElementById('nego-stake').classList.add('hidden');
    this.renderNego(true);
  }

  renderNego(justRolled = false) {
    const g = this.game;
    const n = g.nego;
    if (!n) return;
    const FACE = { lev: '🤝', good: '💬', warn: '⚠️', crit: '✨' };
    const TIP = {
      lev: 'Leverage +1 — click to keep',
      good: 'Goodwill: +1 relationship when you close — click to keep',
      warn: 'Offense — locked in. Too many and they walk.',
      crit: 'Critical: leverage +2 — click to keep',
    };
    const diceEl = document.getElementById('nego-dice');
    diceEl.innerHTML = '';
    n.dice.forEach((d, i) => {
      const b = document.createElement('button');
      const kept = this.negoKeep.has(i);
      b.className = 'die'
        + (d.face === 'warn' ? ' warn' : kept ? ' kept' : '')
        + (justRolled && !kept && d.face !== 'warn' ? ' rolling' : '');
      b.textContent = FACE[d.face];
      b.title = TIP[d.face];
      if (!n.over && d.face !== 'warn' && n.rollsLeft > 0) {
        b.addEventListener('click', () => {
          if (this.negoKeep.has(i)) this.negoKeep.delete(i);
          else this.negoKeep.add(i);
          this.renderNego();
        });
      }
      diceEl.appendChild(b);
    });
    document.getElementById('nego-patience').innerHTML =
      Array.from({ length: n.patience }, (_, i) => `<i class="${i < n.warns ? 'burnt' : ''}"></i>`).join('');
    const won = g.negoTierValue();
    const wonLabel = !won ? null
      : n.stake === 'delivery'
        ? `−1 day for ${won.days}d${won.split ? ' + split shipments' : ''}`
        : `+${Math.round(won.disc * 100)}%`;
    document.getElementById('nego-lev').textContent =
      `${g.negoLeverage()} → ${wonLabel ?? 'no deal yet'}`;

    const take = document.getElementById('btn-nego-take');
    const roll = document.getElementById('btn-nego-roll');
    const done = document.getElementById('btn-nego-done');
    const chat = document.getElementById('nego-chatter');
    chat.classList.remove('walked');
    if (n.over) {
      take.classList.add('hidden');
      roll.classList.add('hidden');
      done.classList.remove('hidden');
      const r = n.result;
      if (r.walked) {
        chat.classList.add('walked');
        chat.textContent = `"We're done here." They walk out — relationship takes a hit and your negotiated discount is frozen for ${r.freezeDays} days.`;
        sfx.alert?.();
      } else if (r.stake === 'delivery' && r.won) {
        chat.textContent = `Handshake. Priority routing: −1 day lead for ${r.won.days} days${r.won.split ? ', split shipments' : ''}${r.perk ? ` — and ${r.perk.text}` : ''}.`;
        sfx.dealYes?.();
      } else if (r.disc > 0) {
        const riderTxt = r.rider ? ` Rider on: ${r.rider.qty} units within ${r.rider.days} days.` : '';
        chat.textContent = `Handshake. +${Math.round(r.disc * 100)}% off (now ${Math.round(r.total * 100)}% total)${r.perk ? ` — and they threw in ${r.perk.text}.` : '.'}${riderTxt}`;
        sfx.dealYes?.();
      } else {
        chat.textContent = `No new discount today${r.relGain > 0 ? ', but the goodwill kept things warm' : ''}. There's always next week.`;
      }
      return;
    }
    take.classList.remove('hidden');
    roll.classList.remove('hidden');
    done.classList.add('hidden');
    if (n.counter) {
      const cv = n.counter.value;
      const cLabel = n.stake === 'delivery' && cv
        ? `the priority route (−1 day, ${cv.days} days)`
        : `the ${Math.round((cv?.disc ?? 0) * 100)}%`;
      chat.textContent = n.counter.rider
        ? `"Take ${cLabel} — and I'll add ${Math.round(n.counter.rider.bonus * 100)}% more if you order ${n.counter.rider.qty} units from us within ${n.counter.rider.days} days. Miss it, and it costs you."`
        : `"Tell you what — take ${cLabel} right now and we're square." (accepting a counter adds bonus relationship)`;
    } else if (n.warns >= n.patience) {
      chat.textContent = 'The room has gone very quiet. One more slip and this meeting is over.';
    } else if (n.warns === n.patience - 1 && n.patience > 1) {
      chat.textContent = 'Eyebrows are rising. Careful how hard you push.';
    } else {
      chat.textContent = 'Keep the dice you like, press for the rest — or shake on it.';
    }
    take.textContent = wonLabel ? `Take the deal (${wonLabel})` : 'Wrap up politely';
    roll.textContent = n.rollsLeft > 0
      ? `Press harder (${n.rollsLeft} roll${n.rollsLeft === 1 ? '' : 's'} left)`
      : 'No rolls left';
    roll.disabled = n.rollsLeft <= 0;
  }

  closeNegotiation() {
    const g = this.game;
    const el = document.getElementById('nego-modal');
    if (el.classList.contains('hidden')) return;
    // Leaving mid-negotiation settles quietly at whatever is on the table.
    if (g.nego && !g.nego.over) g.negoAccept(false);
    g.nego = null;
    el.classList.add('hidden');
    if (g.speed === 0 && !g.planning) g.speed = this.negoPrevSpeed ?? 1;
    g.save();
  }

  confetti() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const wrap = document.getElementById('canvas-wrap');
    const colors = ['#f2c14e', '#6fd08c', '#9ec7ef', '#e8828c', '#b28ae0'];
    for (let i = 0; i < 26; i++) {
      const bit = document.createElement('div');
      bit.className = 'confetti';
      bit.style.left = `${35 + Math.random() * 30}%`;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', `${(Math.random() - 0.5) * 260}px`);
      bit.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      bit.style.animationDelay = `${Math.random() * 0.25}s`;
      wrap.appendChild(bit);
      setTimeout(() => bit.remove(), 2400);
    }
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

  rankedStores() {
    const g = this.game;
    return [...g.stores].sort((a, b) =>
      ((g.week.stores?.[b.siteId]?.rev ?? 0) + b.today.revenue)
      - ((g.week.stores?.[a.siteId]?.rev ?? 0) + a.today.revenue));
  }

  renderStoreList() {
    const g = this.game;
    const wrap = document.getElementById('store-list');
    wrap.innerHTML = '';
    let rank = 0;
    for (const store of this.rankedStores()) {
      rank++;
      const site = g.site(store.siteId);
      const row = document.createElement('button');
      row.className = 'store-row' + (this.selectedSite === site.id ? ' selected' : '');
      row.innerHTML = `
        <span class="drow">
          <span class="srank">${rank}</span>
          <span class="ddot" style="background:${DISTRICT_COLOR[site.district]}"></span>
          <span class="sname">${store.name}</span>
          <span class="sdist">${g.district(site.district).name}</span>
          <span class="srev" data-rev="${site.id}" title="Yesterday's profit"></span>
        </span>
        <span class="srow-meta">
          <span class="mini-meter" title="Shelf fill"><i data-minibar="${site.id}"></i></span>
          <span class="srow-warn hidden" data-warn="${site.id}" title="Stocked out today">⚠</span>
          <span class="fine" data-mgr="${site.id}">${store.manager ? '👤 ' + store.manager.name.split(' ')[0] : '—'}</span>
        </span>`;
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
      box.innerHTML = `<div class="empty-state">
        <div class="es-icon">🗺️</div>
        <div>Pick a store on the map or in the list above.</div>
        <div class="fine">FOR SALE lots can be bought once their district unlocks.</div>
      </div>`;
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
      <div class="sd-header">
        <div class="sd-title">${store.name}</div>
        <span class="dbadge" style="--dc:${DISTRICT_COLOR[site.district]}">${district.name}</span>
        <span class="fine">~${site.pop.toLocaleString()} shoppers</span>
      </div>
      <div class="stat-grid">
        <div class="stile"><span>Reputation</span><div class="meter tiny"><i id="sd-rep"></i></div></div>
        <div class="stile"><span>Morale</span><div class="meter tiny"><i id="sd-morale"></i></div></div>
        <div class="stile" title="How much of the neighborhood this store captures, after sister stores and rival competition"><span>Share</span><b id="sd-market"></b></div>
        <div class="stile"><span>Rev today</span><b id="sd-rev"></b></div>
        <div class="stile"><span>Profit yday</span><b id="sd-yprofit"></b></div>
        <div class="stile"><span>Lost today</span><b id="sd-lost"></b></div>
      </div>
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
    const rDetails = document.createElement('details');
    rDetails.open = this.detailOpen?.range ?? true;
    rDetails.addEventListener('toggle', () => {
      (this.detailOpen ??= {}).range = rDetails.open;
    });
    rDetails.innerHTML = `<summary>Product range <span class="fine" id="sd-slots"></span></summary>`;
    rangeWrap.appendChild(rDetails);
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
    rDetails.appendChild(grid);
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
    // Equipment upgrades.
    for (const [uid, udef] of Object.entries(STORE_UPGRADES)) {
      const btn = document.createElement('button');
      btn.style.marginTop = '6px';
      btn.style.marginRight = '6px';
      if (store.upgrades?.[uid]) {
        btn.textContent = `${udef.icon} ${udef.name} ✓`;
        btn.disabled = true;
      } else {
        btn.textContent = `${udef.icon} ${udef.name} (${fmt(udef.cost)})`;
        btn.title = udef.desc;
        btn.addEventListener('click', () => {
          if (g.buyUpgrade(site.id, uid)) this.renderStoreDetail();
          else this.say('Not enough cash.');
        });
      }
      rDetails.appendChild(btn);
    }
    if (store.slots < PROD_IDS.length) {
      const btn = document.createElement('button');
      btn.id = 'sd-remodel';
      btn.textContent = `Remodel: +${REMODEL.slots} slots (${fmt(g.remodelCost(store))})`;
      btn.style.marginTop = '6px';
      btn.addEventListener('click', () => {
        if (g.remodelStore(site.id)) this.renderStoreDetail();
        else this.say('Not enough cash.');
      });
      rDetails.appendChild(btn);
    }

    // Manager block.
    const mgrWrap = box.querySelector('#sd-manager');
    const mDetails = document.createElement('details');
    mDetails.open = this.detailOpen?.manager ?? true;
    mDetails.addEventListener('toggle', () => {
      (this.detailOpen ??= {}).manager = mDetails.open;
    });
    mDetails.innerHTML = `<summary>Store manager${store.manager ? ` <span class="fine">— ${store.manager.name}</span>` : ' <span class="fine">— vacant</span>'}</summary>`;
    mgrWrap.appendChild(mDetails);
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
      mDetails.appendChild(row);
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
      mDetails.appendChild(del);
    } else {
      const note = document.createElement('p');
      note.className = 'fine';
      note.textContent = `No manager — the team runs on autopilot. A manager boosts coverage, morale, and cuts spoilage (${fmt(HIRE_ROLE_COST)} signing bonus).`;
      mDetails.appendChild(note);
      mDetails.appendChild(this.candidateRows('manager', (i) => {
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
        <div class="stack-bar" id="wh-stack" title="Contents by product"></div>
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

    const stack = page.querySelector('#wh-stack');
    for (const p of PROD_IDS) {
      const seg = document.createElement('i');
      seg.dataset.whseg = p;
      seg.style.background = PRODUCTS[p].color;
      seg.title = PRODUCTS[p].name;
      stack.appendChild(seg);
    }
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
          <span class="days-chip" data-days="${p}" title="Days of warehouse stock at current sales pace"></span>
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
    page.innerHTML = '<div class="panel" id="meetings-panel"><div id="meetings-left"></div></div><p class="fine pad">Negotiating opens the dice table — choose your ask first: 💰 price (discounts up to 25%) or 🚚 delivery (−1 day lead windows, split shipments). Roll 🤝 leverage for the deal, 💬 goodwill for the relationship — but ⚠️ offense locks in, and past a vendor\'s patience they walk (frozen discount, soured relationship). Relationship, a Head Buyer, contracts, seasons, and how the last sitting ended all shift your dice. Meetings are scarce — spend them well — and deals age −1% a week without a fresh handshake.</p>';
    for (const [id, v] of Object.entries(VENDORS)) {
      const card = document.createElement('div');
      card.className = 'panel vendor-card';
      const monogram = v.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
      const priceTier = v.priceMult <= 0.9 ? '$' : v.priceMult <= 1.0 ? '$$' : '$$$';
      card.innerHTML = `
        <div class="v-head">
          <span class="v-mono" style="--vc:${['#e0a54e','#c98a3f','#c0687a','#7fa8d0','#9a7ac8','#5aa8a0'][Object.keys(VENDORS).indexOf(id) % 6]}">${monogram}</span>
          <div class="v-title">
            <h3>${v.name} <span data-struck="${id}" style="color:var(--bad)"></span></h3>
            <div class="v-chips">
              <span class="v-chip" title="Price tier">${priceTier}</span>
              <span class="v-chip" title="Quality">${'★'.repeat(Math.round(v.quality * 3))}</span>
              <span class="v-chip" data-lead="${id}" title="Delivery lead time">🚚 ${v.leadTime}d</span>
            </div>
          </div>
        </div>
        <p class="fine">${v.blurb}</p>
        <div class="kv"><span>Supplies</span><b class="fine">${v.products.map((p) => PRODUCTS[p].name).join(', ')}</b></div>
        <div class="kv"><span>Relationship</span>
          <div class="meter rel-meter"><i data-rel="${id}"></i><em class="rel-mark" title="Contract threshold"></em></div>
        </div>
        <div class="kv"><span>Discount</span>
          <span class="pips" data-pips="${id}" title="Each pip is 5% off (negotiate to earn them)">
            ${'<i></i>'.repeat(5)}
          </span>
          <b data-disc="${id}"></b>
        </div>
        <div class="kv"><span>Contract</span><b data-contract="${id}" class="fine"></b></div>
        <div class="vc-actions">
          <button data-neg="${id}">Negotiate</button>
          <button data-sign="${id}" title="Commit to ${CONTRACT.weeklyMin} units/week for ${CONTRACT.days} days at ${Math.round(CONTRACT.discount * 100)}% off. Breaching costs $${CONTRACT.penalty} and sours the relationship.">Contract</button>
        </div>`;
      page.appendChild(card);
    }
    page.addEventListener('click', (e) => {
      const id = e.target.dataset?.neg;
      const signId = e.target.dataset?.sign;
      if (signId) {
        const r = g.signContract(signId);
        if (r.success) this.say(`Contract signed with ${VENDORS[signId].name}.`);
        else if (r.lowRel) this.say(`${VENDORS[signId].name} wants a relationship of ${CONTRACT.relRequired}+ before committing.`);
        else this.say('A contract is already running with them.');
        return;
      }
      if (!id) return;
      this.openNegotiation(id);
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

    const mkt = document.createElement('div');
    mkt.className = 'panel';
    mkt.innerHTML = `<h3>Marketing</h3>
      <p class="fine">With a Marketing Lead, run a district ad campaign: ${fmt(CAMPAIGN.cost)} for +${Math.round((CAMPAIGN.boost - 1) * 100)}% demand over ${CAMPAIGN.days} days (${CAMPAIGN.cooldown}-day cooldown per district).</p>
      <div id="campaigns"></div>`;
    page.appendChild(mkt);
    const cWrap = mkt.querySelector('#campaigns');
    for (const dd of DISTRICTS) {
      const btn = document.createElement('button');
      btn.dataset.campaign = dd.id;
      btn.style.marginRight = '6px';
      btn.style.marginTop = '4px';
      btn.textContent = dd.name;
      cWrap.appendChild(btn);
    }
    cWrap.addEventListener('click', (e) => {
      const did = e.target.dataset?.campaign;
      if (!did) return;
      const r = this.game.runCampaign(did);
      if (r.success) this.say(`📣 Campaign running in ${this.game.district(did).name}!`);
      else if (r.needsLead) this.say('Hire a Marketing Lead first.');
      else if (r.locked) this.say('That district isn\'t unlocked yet.');
      else if (r.cooldown) this.say(`That district needs ${r.cooldown} more day${r.cooldown > 1 ? 's' : ''} before another campaign.`);
      else this.say('Not enough cash.');
    });

    const miles = document.createElement('div');
    miles.className = 'panel';
    miles.innerHTML = '<h3>Expansion plan</h3><div id="milestones"></div>';
    page.appendChild(miles);

    const records = document.createElement('div');
    records.className = 'panel';
    records.innerHTML = '<h3>Records &amp; achievements</h3><div id="rec-stats"></div><div id="rec-achievements" class="ach-grid"></div>';
    page.appendChild(records);

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
    const key = Object.keys(ROLES).map((r) =>
      (g.hq[r] ? `${g.hq[r].name}${Math.round(g.hq[r].xp ?? 0)}` : '·')).join('|')
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
        const xp = cur.xp ?? 0;
        const next = cur.skill >= 3 ? null : xp < 15 ? 15 : 40;
        const xpBar = next
          ? `<span class="xp-wrap" title="${xp}/${next} XP to the next star (with a raise)"><i class="xp-bar" style="width:${Math.min(100, Math.round((xp / next) * 100))}%"></i></span>`
          : '<span class="ctrait">At the top of their game.</span>';
        row.innerHTML = `
          <span class="cinfo">👤 ${cur.name} <span class="stars">${'★'.repeat(cur.skill)}</span> · ${fmt(cur.salary)}/day
            <span class="ctrait">${cur.trait.name} — ${cur.trait.desc}</span>
            ${xpBar}
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
        <div id="chart-wrap"><canvas id="chart"></canvas><div id="chart-tip" class="hidden"></div></div>
      </div>
      <div class="panel">
        <h3>By store <span class="fine">(yesterday)</span></h3>
        <div id="bstores"></div>
      </div>
      <div class="panel">
        <h3>By product <span class="fine">(yesterday)</span></h3>
        <div class="bstore-row bhead"><span>Product</span><span>Units</span><span>Revenue</span><span title="Margin at current average unit cost">Margin</span></div>
        <div id="bproducts"></div>
        <p class="fine">Margin uses current average unit cost. Lines that can't
        pay their way are candidates to drop from store ranges.</p>
      </div>
      <div class="panel">
        <h3>Activity log</h3>
        <div id="log-list"></div>
      </div>`;

    // Hover a bar to inspect that day.
    const chart = page.querySelector('#chart');
    const tip = page.querySelector('#chart-tip');
    chart.addEventListener('mousemove', (e) => {
      const m = this.chartMeta;
      if (!m || !m.data.length) return;
      const rect = chart.getBoundingClientRect();
      const i = Math.floor((e.clientX - rect.left - (rect.width - m.data.length * m.bw)) / m.bw);
      if (i < 0 || i >= m.data.length) { tip.classList.add('hidden'); return; }
      const d = m.data[i];
      tip.innerHTML = `<b>Day ${d.day}</b> · rev ${fmt(d.revenue)} · <span class="${d.profit >= 0 ? 'pos' : 'neg'}">${signFmt(d.profit)}</span>`;
      tip.classList.remove('hidden');
      tip.style.left = `${Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, e.clientX - rect.left - tip.offsetWidth / 2))}px`;
      this.chartHover = i;
      this.drawChart(true);
    });
    chart.addEventListener('mouseleave', () => {
      tip.classList.add('hidden');
      this.chartHover = null;
      this.drawChart(true);
    });
  }

  refreshBooks() {
    const g = this.game;
    const t = g.today;
    const y = g.history[g.history.length - 1];
    setText('pl-day', y ? `· today so far vs day ${y.day}` : '· today so far');

    // Rent/wages/salaries accrue at day end, so "today" shows — for them.
    const body = document.getElementById('pl-body');
    const lines = [
      ['Revenue', t.revenue, y?.revenue, 'Everything rung up at the tills across the chain.'],
      ['Cost of goods', -t.cogs, y !== undefined ? -y.cogs : undefined, 'What the sold goods cost you, at weighted-average purchase price.'],
      ['Fines', -t.fines, y !== undefined ? -y.fines : undefined, 'Inspection penalties and contract breach fees.'],
      ['Debt interest', -t.interest, y !== undefined ? -(y.interest ?? 0) : undefined, '2%/day on a negative balance. The bank has limits — watch it.'],
      ['Rent (accrues nightly)', null, y !== undefined ? -y.rent : undefined, 'Per-store rent, charged at day end.'],
      ['Wages (accrues nightly)', null, y !== undefined ? -y.wages : undefined, 'Store staff pay ($28/day each, drifting up with cost of living).'],
      ['Salaries (accrues nightly)', null, y !== undefined ? -y.salaries : undefined, 'Store managers and HQ department heads.'],
    ];
    let html = '<div class="pl-row"><span></span><span><b>Today</b> · Yesterday</span></div>';
    for (const [label, today, yest, tip] of lines) {
      const tv = today === null ? '—' : signFmt(today);
      const yv = yest === undefined ? '—' : signFmt(yest);
      html += `<div class="pl-row" title="${tip}"><span>${label}</span><span><b>${tv}</b> · ${yv}</span></div>`;
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

    const bp = document.getElementById('bproducts');
    let pHtml = '';
    for (const p of PROD_IDS) {
      const d = g.yesterdayByProduct?.[p];
      if (!d || d.units < 0.5) continue;
      const cogs = d.units * g.avgCost[p];
      const margin = d.revenue > 0 ? (d.revenue - cogs) / d.revenue : 0;
      pHtml += `<div class="bstore-row">
        <span><span class="swatch" style="background:${PRODUCTS[p].color};display:inline-block;margin-right:5px"></span>${PRODUCTS[p].name}</span>
        <span>${Math.round(d.units)} u</span>
        <span>${fmt(d.revenue)}</span>
        <span class="${margin >= 0.25 ? 'pos' : margin >= 0.1 ? '' : 'neg'}">${Math.round(margin * 100)}%</span></div>`;
    }
    if (!pHtml) pHtml = '<div class="fine">No sales recorded yet.</div>';
    if (bp.dataset.key !== pHtml) { bp.dataset.key = pHtml; bp.innerHTML = pHtml; }

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

  drawChart(force = false) {
    const canvas = document.getElementById('chart');
    if (!canvas) return;
    const g = this.game;
    const data = g.history.slice(-30);
    const key = data.length ? `${data.length}-${data[data.length - 1].day}` : 'none';
    if (!force && canvas.dataset.key === key) return;
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
    // Gridlines with $ labels.
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (const frac of [-0.5, 0, 0.5]) {
      const y = zero - frac * (h - 16);
      ctx.strokeStyle = frac === 0 ? 'rgba(139, 150, 166, 0.45)' : 'rgba(139, 150, 166, 0.15)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (frac !== 0) {
        ctx.fillStyle = 'rgba(139, 150, 166, 0.7)';
        ctx.fillText(`${frac > 0 ? '+' : '−'}$${Math.round(max * Math.abs(frac) * 2).toLocaleString()}`, 3, y - 2);
      }
    }
    const bw = w / 30;
    const yFor = (v) => zero - (v / max) * (h / 2 - 10);
    this.chartMeta = { data, bw, zero, yFor };
    const gUp = ctx.createLinearGradient(0, 0, 0, zero);
    gUp.addColorStop(0, 'rgba(111, 208, 140, 0.95)');
    gUp.addColorStop(1, 'rgba(111, 208, 140, 0.45)');
    const gDn = ctx.createLinearGradient(0, zero, 0, h);
    gDn.addColorStop(0, 'rgba(232, 130, 140, 0.45)');
    gDn.addColorStop(1, 'rgba(232, 130, 140, 0.95)');
    data.forEach((d, i) => {
      const x = w - (data.length - i) * bw;
      const bh = zero - yFor(d.profit);
      const hovered = this.chartHover === i;
      ctx.globalAlpha = this.chartHover == null || hovered ? 1 : 0.45;
      ctx.fillStyle = d.profit >= 0 ? gUp : gDn;
      if (bh >= 0) ctx.fillRect(x + 1, zero - bh, bw - 2, Math.max(1, bh));
      else ctx.fillRect(x + 1, zero, bw - 2, Math.max(1, -bh));
      if (hovered) {
        ctx.strokeStyle = 'rgba(242, 193, 78, 0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, Math.min(zero, yFor(d.profit)) - 0.5, bw - 1, Math.max(2, Math.abs(zero - yFor(d.profit))) + 1);
      }
    });
    ctx.globalAlpha = 1;
    // 7-day moving average line.
    if (data.length >= 3) {
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      data.forEach((d, i) => {
        const from = Math.max(0, i - 6);
        const avg = data.slice(from, i + 1).reduce((s, e) => s + e.profit, 0) / (i + 1 - from);
        const x = w - (data.length - i) * bw + bw / 2;
        const y = yFor(avg);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // Annotate the current average.
      const lastFrom = Math.max(0, data.length - 7);
      const lastAvg = data.slice(lastFrom).reduce((s, e) => s + e.profit, 0) / (data.length - lastFrom);
      ctx.fillStyle = '#f2c14e';
      ctx.textAlign = 'right';
      ctx.fillText(`7d avg ${lastAvg >= 0 ? '+' : '−'}$${Math.abs(Math.round(lastAvg)).toLocaleString()}`, w - 4, yFor(lastAvg) - 4);
    }
  }

  refreshGoal() {
    const g = this.game;
    if (this.lastGoalIndex === undefined) this.lastGoalIndex = g.goalIndex;
    if (g.goalIndex !== this.lastGoalIndex) {
      const done = GOALS[this.lastGoalIndex];
      if (done && g.goalIndex > this.lastGoalIndex) {
        this.say(`🎯 Objective complete: ${done.title} — +${fmt(done.reward)} bonus!`);
        this.confetti();
        const gp = document.getElementById('goal-panel');
        gp.classList.remove('goal-pop');
        void gp.offsetWidth;                    // restart the animation
        gp.classList.add('goal-pop');
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

  // New log entries and completed deliveries make noise.
  refreshSounds() {
    const g = this.game;
    this.lastLogLen ??= g.logEntries.length;
    this.lastDeliveryPing ??= g.deliveryPing ?? 0;
    if (g.logEntries.length > this.lastLogLen) {
      // Play at most one sound per frame batch; latest entry wins.
      const fresh = g.logEntries.slice(this.lastLogLen);
      const hit = fresh.map((e) => LOG_SFX[e.icon]).filter(Boolean).pop();
      if (hit && sfx[hit]) sfx[hit]();
      // Optionally stop the clock when a city event lands.
      const DURATION_EVENTS = ['🥶', '🔥', '✊', '🚧', '🎪', '⚔️', '🤧', '☣️', '📱', '⛽', '⚓'];
      if (this.settings.pauseOnEvent && g.speed > 0
        && fresh.some((e) => DURATION_EVENTS.includes(e.icon))) {
        g.speed = 0;
        this.say('⏸ Paused — a city event needs your attention (Space to resume).');
      }
    }
    this.lastLogLen = g.logEntries.length;
    if ((g.deliveryPing ?? 0) > this.lastDeliveryPing) sfx.delivery();
    this.lastDeliveryPing = g.deliveryPing ?? 0;
  }

  sparkline(values) {
    if (!values?.length) return '';
    const bars = '▁▂▃▄▅▆▇█';
    const max = Math.max(...values, 1);
    return values.map((v) => bars[Math.min(7, Math.floor((v / max) * 7.99))]).join('');
  }

  showWeeklyReport(r) {
    this.reportPrevSpeed = this.game.speed || 1;
    this.game.speed = 0;
    const el = document.getElementById('week-report');
    el.querySelector('#wr-title').textContent = `Week ending day ${r.weekEndingDay}`;
    // The "run the week" button only makes sense during a planning stop.
    el.querySelector('#btn-week-run').classList.toggle('hidden', !this.game.planning);
    el.querySelector('#btn-week-close').textContent =
      this.game.planning ? 'Make some moves first' : 'Back to work';
    const lines = [];
    lines.push(`<div class="pl-row"><span>Revenue</span><b>${fmt(r.revenue)}</b></div>`);
    const chainTrend = r.prevProfit != null && Math.abs(r.prevProfit) > 1
      ? ` <span class="fine">(${r.profit >= r.prevProfit ? '▲' : '▼'} vs ${signFmt(Math.round(r.prevProfit))} last wk)</span>`
      : '';
    lines.push(`<div class="pl-row"><span>Profit</span><b class="${r.profit >= 0 ? 'pos' : 'neg'}">${signFmt(r.profit)}${chainTrend}</b></div>`);
    lines.push(`<div class="pl-row"><span>Team decisions</span><b>${r.staffActions}</b></div>`);
    lines.push(`<div class="pl-row"><span>BuyLow stores</span><b>${r.rivalStores}</b></div>`);
    for (const f of r.chain ?? []) {
      lines.push(`<div class="wr-issue chain">⚠ ${f.text}</div>`);
    }
    // Per-store scorecards: what happened, and where the problems were.
    for (const s of r.stores ?? []) {
      const arrow = s.repDelta > 0.02 ? '↗' : s.repDelta < -0.02 ? '↘' : '→';
      const fillCls = s.fill >= 0.9 ? 'pos' : s.fill >= 0.75 ? 'mid' : 'neg';
      const staffCls = s.staff >= 0.95 ? 'pos' : s.staff >= 0.85 ? 'mid' : 'neg';
      const wow = s.prevRevenue != null && s.prevRevenue > 0
        ? Math.round((s.revenue / s.prevRevenue - 1) * 100) : null;
      const wowTxt = wow == null ? ''
        : `<span class="wr-wow ${wow >= 0 ? 'pos' : 'neg'}" title="Revenue vs last week">${wow >= 0 ? '▲' : '▼'}${Math.abs(wow)}%</span>`;
      lines.push(`<div class="wr-store">
        <div class="wr-store-head">
          <b>${s.name}</b><span class="fine">${s.district}</span>
          ${wowTxt}
          <b class="${s.profit >= 0 ? 'pos' : 'neg'}">${signFmt(s.profit)}</b>
        </div>
        <div class="wr-meters">
          <span class="wr-spark" title="Daily revenue, Mon→Sun">${this.sparkline(s.revDaily)}</span>
          <span title="Demand served / total demand">shelves <b class="${fillCls}">${Math.round(s.fill * 100)}%</b></span>
          <span title="Staff coverage of the rush">staff <b class="${staffCls}">${Math.round(s.staff * 100)}%</b></span>
          <span title="Reputation now (arrow = this week's trend)">rep <b>${Math.round(s.rep * 100)}% ${arrow}</b></span>
        </div>
        ${s.issues.length
    ? s.issues.map((i) => `<div class="wr-issue">⚠ ${i.text}</div>`).join('')
    : '<div class="wr-issue ok">✓ Steady week — no problems recorded.</div>'}
      </div>`);
    }
    if (r.events.length) {
      lines.push(`<div class="fine" style="margin-top:6px"><b>This week:</b><br>${r.events.map((e) => `· ${e}`).join('<br>')}</div>`);
    }
    el.querySelector('#wr-body').innerHTML = lines.join('');
    el.classList.remove('hidden');
  }

  // ---- map overlays -----------------------------------------------------

  refreshOverlays() {
    const g = this.game;
    // Active event chips.
    const bar = document.getElementById('events-bar');
    const hol = g.currentHoliday();
    const after = g.holidayAftermath();
    const up = g.upcomingHoliday();
    const holKey = (hol ? `h${hol.id}${g.yearDay()}` : '') + (up ? `u${up.holiday.id}${up.inDays}` : '') + (after ? 'a' : '');
    const eKey = (g.activeEvents.map((e) => e.type + e.daysLeft + (e.vendor || e.district || e.product || '')).join('|') || 'none') + holKey;
    if (bar.dataset.key !== eKey) {
      bar.dataset.key = eKey;
      let holHtml = '';
      if (hol) {
        const left = hol.start + hol.days - g.yearDay();
        holHtml += `<div class="event-chip holiday">${hol.icon} <b>${hol.name}</b>
          <span class="ev-days">· ${left}d left</span><br><span class="ev-days">${hol.desc}</span></div>`;
      } else if (after) {
        holHtml += `<div class="event-chip">😮‍💨 <b>Post-${after.name} slump</b><br><span class="ev-days">Everyone's fridges are full. Demand −20% for a few days.</span></div>`;
      } else if (up) {
        holHtml += `<div class="event-chip holiday">${up.holiday.icon} <b>${up.holiday.name}</b>
          <span class="ev-days">· in ${up.inDays}d</span><br><span class="ev-days">Stock up on ${up.holiday.tip}!</span></div>`;
      }
      bar.innerHTML = holHtml + g.activeEvents.map((e) => {
        const def = EVENTS[e.type];
        let where = '';
        if (e.vendor) where = ` — ${VENDORS[e.vendor].name}`;
        if (e.district) where = ` — ${g.district(e.district).name}`;
        if (e.product) where = ` — ${PRODUCTS[e.product].name}`;
        let action = '';
        if (e.type === 'price_war'
          && g.stores.some((s) => g.site(s.siteId).district === e.district && s.markup > 0.92)) {
          action = `<br><button class="chip-action" data-matchwar="${e.district}">Match their prices (90%)</button>`;
        }
        return `<div class="event-chip ${def.player ? 'player' : ''}">${def.icon} <b>${def.name}</b>${where}
          <span class="ev-days">· ${e.daysLeft}d left</span><br>
          <span class="ev-days">${def.desc}</span>${action}</div>`;
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
    // Ease the displayed cash toward reality — big swings visibly tick.
    this.shownCash ??= g.cash;
    const diff = g.cash - this.shownCash;
    this.shownCash = Math.abs(diff) < 1 ? g.cash : this.shownCash + diff * 0.18;
    setText('stat-cash', fmt(Math.round(this.shownCash)));
    document.getElementById('stat-cash').classList.toggle('broke', g.cash < 0);
    const season = g.season();
    setText('stat-day', `Day ${g.day()} · ${season.icon} ${season.name} ${g.seasonDay()}`);
    const dp = document.getElementById('day-progress');
    if (dp) dp.style.width = `${Math.round(g.dayFrac() * 100)}%`;
    // Season effects live in the day pill's tooltip; holidays get a pill.
    const dayWrap = document.getElementById('stat-day-wrap');
    if (dayWrap && dayWrap.dataset.season !== season.id) {
      dayWrap.dataset.season = season.id;
      const fx = [];
      for (const [p, m] of Object.entries(season.demand ?? {})) {
        fx.push(`${m > 1 ? '▲' : '▼'} ${p} ${Math.round((m - 1) * 100)}%`);
      }
      if ((season.spoil ?? 1) !== 1) fx.push(`spoilage ${season.spoil > 1 ? '+' : ''}${Math.round((season.spoil - 1) * 100)}%`);
      if ((season.truck ?? 1) !== 1) fx.push(`trucks ${Math.round((season.truck - 1) * 100)}%`);
      dayWrap.title = `${season.name} effects: ${fx.join(' · ') || 'none'}`;
    }
    const holEl = document.getElementById('stat-holiday');
    if (holEl) {
      const cur = g.currentHoliday();
      const up = g.upcomingHoliday();
      let txt = '', tip = '';
      if (cur) {
        txt = `${cur.icon} ${cur.name}`;
        tip = `${cur.desc} Demand is surging — ${cur.tip}.`;
      } else if (up) {
        txt = `${up.holiday.icon} in ${up.inDays}d`;
        tip = `${up.holiday.name} in ${up.inDays} day${up.inDays === 1 ? '' : 's'} — stock up on ${up.holiday.tip} (mind vendor lead times).`;
      }
      holEl.classList.toggle('hidden', !txt);
      holEl.classList.toggle('hol-live', !!cur);
      if (holEl.textContent !== txt) holEl.textContent = txt;
      holEl.title = tip;
    }
    // A speed button or Space during a planning stop counts as running the week.
    if (g.planning && g.speed > 0) g.planning = false;
    const reportOpen = !document.getElementById('week-report').classList.contains('hidden');
    const ph = document.getElementById('paused-hint');
    if (ph) ph.classList.toggle('hidden', g.speed !== 0 || g.gameOver || g.planning || reportOpen);
    // Persistent week strip: shows progress while running, arms while planning.
    const ws = document.getElementById('week-strip');
    if (ws) {
      const planning = g.planning && !g.gameOver;
      ws.classList.toggle('planning', planning);
      const dayInWeek = ((g.day() - 1) % 7) + 1;
      const txt = planning
        ? `📋 Planning week ${g.weekNum()} — adjust orders, prices & people`
        : `Week ${g.weekNum()} · day ${dayInWeek}/7`;
      const lbl = document.getElementById('ws-label');
      if (lbl.textContent !== txt) lbl.textContent = txt;
      const prog = document.getElementById('ws-prog');
      if (prog) prog.style.width = planning ? '0%' : `${(((dayInWeek - 1) + g.dayFrac()) / 7) * 100}%`;
      document.getElementById('btn-run-week').classList.toggle('hidden', !planning || reportOpen);
    }
    this.refreshDashboard();
    setText('stat-stores', `${g.stores.length} store${g.stores.length === 1 ? '' : 's'}`);
    const repEl = document.getElementById('stat-rep');
    if (repEl && g.stores.length) {
      const avgRep = g.stores.reduce((s, st) => s + st.rep, 0) / g.stores.length;
      const txt = `${Math.round(avgRep * 100)}% ●`;
      if (repEl.textContent !== txt) repEl.textContent = txt;
      repEl.style.color = avgRep > 0.6 ? 'var(--good)' : avgRep > 0.35 ? 'var(--accent)' : 'var(--bad)';
    }
    const h7 = g.history.slice(-7);
    if (h7.length) {
      const p7 = h7.reduce((s, h) => s + h.profit, 0);
      const s7 = h7.reduce((s, h) => s + h.revenue, 0);
      setText('stat-profit7', signFmt(Math.round(p7)));
      document.getElementById('stat-profit7').className = p7 >= 0 ? 'pos' : 'neg';
      setText('stat-sales7', fmt(Math.round(s7)));
    }
    const net = g.profitToday();
    const netEl = document.getElementById('stat-net');
    const netTxt = signFmt(net);
    if (netEl.textContent !== netTxt) netEl.textContent = netTxt;
    netEl.classList.toggle('pos', net >= 0);
    netEl.classList.toggle('neg', net < 0);

    const meetEl = document.getElementById('meetings-left');
    if (meetEl) {
      const txt = `🪑 <b>${g.meetingsLeft}</b> vendor meeting${g.meetingsLeft === 1 ? '' : 's'} left this week — refreshes at the weekly wrap-up.`;
      if (meetEl.dataset.k !== txt) { meetEl.dataset.k = txt; meetEl.innerHTML = txt; }
    }

    // Attention badges on tabs.
    const badges = {
      stores: g.stores.filter((s) => Object.values(s.stockoutLogged ?? {}).some(Boolean)).length,
      vendors: Object.keys(VENDORS).filter((id) =>
        g.vendors[id].lastNegDay !== g.day()
        && g.vendors[id].discount < 0.249
        && g.carriedProducts().some((p) => g.purchasing[p].vendor === id)).length,
      hq: (g.cash >= HIRE_ROLE_COST)
        ? Object.values(g.hq).filter((r) => !r).length
        : 0,
    };
    document.querySelectorAll('#tabs button').forEach((b) => {
      const n = badges[b.dataset.tab] ?? 0;
      let dot = b.querySelector('.tab-badge');
      if (n > 0) {
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'tab-badge';
          b.appendChild(dot);
        }
        if (dot.textContent !== String(n)) dot.textContent = String(n);
      } else if (dot) {
        dot.remove();
      }
    });

    // Keep speed buttons in sync (keyboard shortcuts change speed too).
    document.querySelectorAll('.speeds button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === g.speed);
    });

    const toastEl = document.getElementById('toast');
    if (this.toast && performance.now() < this.toast.until) {
      toastEl.textContent = this.toast.text;
      toastEl.classList.remove('hidden');
    } else {
      toastEl.classList.add('hidden');
    }

    this.refreshOverlays();
    this.refreshGoal();
    this.refreshSounds();
    this.syncBackdrop();

    if (this.tab === 'stores') this.refreshStores();
    if (this.tab === 'stores') this.refreshRecentEvents();
    if (this.tab === 'supply') this.refreshSupply();
    if (this.tab === 'vendors') this.refreshVendors();
    if (this.tab === 'hq') { this.refreshRoles(); this.refreshMilestones(); this.refreshDelegations(); this.refreshRecords(); }
    if (this.tab === 'books') this.refreshBooks();

    // Weekly report.
    this.lastWeekSeen ??= g.weekReportId ?? 0;
    if (this.settings.weeklyReport && (g.weekReportId ?? 0) > this.lastWeekSeen && g.lastWeekReport) {
      this.lastWeekSeen = g.weekReportId;
      this.showWeeklyReport(g.lastWeekReport);
    } else {
      this.lastWeekSeen = Math.max(this.lastWeekSeen, g.weekReportId ?? 0);
    }

    if (g.won && !this.winShown) {
      this.winShown = true;
      sfx.win();
      this.confetti();
      this.confetti();
      this.closeWeeklyReport();
      this.closeNegotiation();
      this.fillRunSummary('win');
      document.getElementById('win-banner').classList.remove('hidden');
    }
    if (g.gameOver && !this.loseShown) {
      this.loseShown = true;
      this.closeWeeklyReport();
      this.closeNegotiation();
      this.fillRunSummary('lose');
      document.getElementById('lose-banner').classList.remove('hidden');
    }
  }

  // The story of the run, told at the end: headline numbers + profit history.
  fillRunSummary(kind) {
    const g = this.game;
    const st = g.stats ?? {};
    const wrap = document.getElementById(`${kind}-stats`);
    if (wrap) {
      wrap.innerHTML = [
        ['Days', g.day()],
        ['Stores', g.stores.length],
        ['Peak cash', fmt(g.peakCash)],
        ['Lifetime revenue', fmt(st.totalRevenue ?? 0)],
        ['Customers', Math.round(st.customersServed ?? 0).toLocaleString()],
        ['Trophies', `${Object.keys(g.achieved ?? {}).length}/${ACHIEVEMENTS.length}`],
      ].map(([k, v]) => `<div class="rs-cell"><span>${k}</span><b>${v}</b></div>`).join('');
    }
    const canvas = document.getElementById(`${kind}-chart`);
    if (!canvas || !g.history.length) { if (canvas) canvas.style.display = 'none'; return; }
    canvas.style.display = '';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr || 340 * dpr;
    canvas.height = 60 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr, h = 60;
    const data = g.history;
    const max = Math.max(50, ...data.map((d) => Math.abs(d.profit)));
    const zero = h / 2;
    ctx.strokeStyle = 'rgba(139, 150, 166, 0.35)';
    ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(w, zero); ctx.stroke();
    const bw = w / data.length;
    data.forEach((d, i) => {
      ctx.fillStyle = d.profit >= 0 ? 'rgba(111, 208, 140, 0.8)' : 'rgba(232, 130, 140, 0.8)';
      const bh = (d.profit / max) * (h / 2 - 4);
      if (bh >= 0) ctx.fillRect(i * bw, zero - bh, Math.max(1, bw - 1), Math.max(1, bh));
      else ctx.fillRect(i * bw, zero, Math.max(1, bw - 1), Math.max(1, -bh));
    });
  }

  // ---- dashboard overlays ------------------------------------------------

  refreshDashboard() {
    const g = this.game;
    this.refreshMapLabels();
    // Network summary (once a second is plenty).
    const now = performance.now();
    if (!this._dashAt || now - this._dashAt > 900) {
      this._dashAt = now;
      const net = document.getElementById('net-body');
      if (net) {
        const skus = PROD_IDS.filter((p) => g.stores.some((s) => s.range[p])).length;
        const disc = Object.values(g.vendors).filter((v) => v.discount > 0 || v.contract).length;
        const html = [
          ['🏪 Stores', `${g.stores.length} / ${14 - g.rival.stores.length}`],
          ['🚚 Trucks', g.trucks.length],
          ['🤝 Vendor deals', `${disc} / ${Object.keys(VENDORS).length}`],
          ['📦 Lines carried', `${skus} / ${PROD_IDS.length}`],
          ['🪑 Meetings left', g.meetingsLeft],
        ].map(([k, v]) => `<div class="net-row"><span>${k}</span><b>${v}</b></div>`).join('');
        if (net.dataset.k !== html) { net.dataset.k = html; net.innerHTML = html; }
      }
      // Alerts: live conditions that deserve a glance.
      const alerts = [];
      const outStores = g.stores.filter((s) => Object.values(s.stockoutLogged ?? {}).some(Boolean)).length;
      if (outStores) alerts.push(['warn', `Stockouts · ${outStores} store${outStores > 1 ? 's' : ''}`]);
      if (g.cash < 3000) alerts.push(['bad', 'Low cash — watch the balance']);
      if (g.cash < 0) alerts.push(['bad', 'In debt — interest accruing']);
      if (g.warehouseUsed() / g.warehouse.cap > 0.92) alerts.push(['warn', 'Warehouse nearly full']);
      const tu = g.week?.truckSamples > 200 ? g.week.truckBusy / g.week.truckSamples : 0;
      if (tu > 0.95 && g.trucks.length < g.stores.length) alerts.push(['warn', `Fleet saturated · ${Math.round(tu * 100)}%`]);
      for (const vid of Object.keys(VENDORS)) {
        if (g.vendorStruck(vid)) alerts.push(['bad', `${VENDORS[vid].name} on strike`]);
      }
      if (g.rival.courting) alerts.push(['warn', `BuyLow courting ${VENDORS[g.rival.courting.vendor].name}`]);
      const card = document.getElementById('alerts-card');
      const list = document.getElementById('alerts-list');
      if (card && list) {
        card.classList.toggle('hidden', !alerts.length);
        const html = alerts.slice(0, 5).map(([sev, txt]) =>
          `<div class="alert-row ${sev}"><i></i>${txt}</div>`).join('');
        if (list.dataset.k !== html) { list.dataset.k = html; list.innerHTML = html; }
      }
      const ver = document.getElementById('rail-version');
      if (ver && !ver.textContent) ver.textContent = 'v0.16';
    }
    // Performance strip: rebuilt when a new day lands in history.
    const strip = document.getElementById('perf-strip');
    if (!strip) return;
    const hist = g.history;
    const dayKey = hist.length ? String(hist[hist.length - 1].day) : 'none';
    if (strip.dataset.day === dayKey) return;
    strip.dataset.day = dayKey;
    if (hist.length < 2) { strip.innerHTML = ''; return; }
    const last7 = hist.slice(-7);
    const prev7 = hist.slice(-14, -7);
    const avg = (arr, k) => arr.reduce((s, h) => s + h[k], 0) / Math.max(1, arr.length);
    const latest = hist[hist.length - 1];
    const cards = [
      { label: 'Sales /d', val: fmt(Math.round(avg(last7, 'revenue'))), k: 'revenue', delta: prev7.length ? avg(last7, 'revenue') / Math.max(1, avg(prev7, 'revenue')) - 1 : null },
      { label: 'Profit /d', val: signFmt(Math.round(avg(last7, 'profit'))), k: 'profit', delta: null, signed: true },
      { label: 'Demand filled', val: `${Math.round((latest.fill ?? 1) * 100)}%`, k: 'fill', delta: prev7.length ? avg(last7, 'fill') - avg(prev7, 'fill') : null, pp: true },
      { label: 'Shelf stock', val: `${Math.round((latest.shelf ?? 0) * 100)}%`, k: 'shelf' },
      { label: 'Warehouse', val: `${Math.round((latest.wh ?? 0) * 100)}%`, k: 'wh' },
    ];
    strip.innerHTML = cards.map((c, i) => `
      <div class="perf-card">
        <span class="pc-label">${c.label}</span>
        <span class="pc-row"><b class="pc-val">${c.val}</b>${c.delta != null
    ? `<em class="pc-delta ${c.delta >= 0 ? 'pos' : 'neg'}">${c.delta >= 0 ? '▲' : '▼'}${c.pp ? `${Math.abs(c.delta * 100).toFixed(0)}pp` : `${Math.abs(c.delta * 100).toFixed(0)}%`}</em>` : ''}</span>
        <canvas class="pc-spark" data-spark="${i}" width="86" height="20"></canvas>
      </div>`).join('');
    cards.forEach((c, i) => {
      const cv = strip.querySelector(`[data-spark="${i}"]`);
      const ctx = cv.getContext('2d');
      const data = hist.slice(-14).map((h) => h[c.k] ?? 0);
      const min = Math.min(...data), max = Math.max(...data);
      const span = max - min || 1;
      ctx.strokeStyle = c.signed && avg(last7, 'profit') < 0 ? 'rgba(232,130,140,0.9)' : 'rgba(111,208,140,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      data.forEach((v, j) => {
        const x = (j / (data.length - 1)) * 82 + 2;
        const y = 17 - ((v - min) / span) * 14;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  // Floating chips pinned to buildings on the map, like the reference mock:
  // player stores with live sales, the warehouse with capacity, BuyLow in red.
  refreshMapLabels() {
    const g = this.game;
    const r = window.renderer;
    const layer = document.getElementById('map-labels');
    if (!layer || !r) return;
    const wanted = [
      ...g.stores.map((st) => ({ id: st.siteId, kind: 'store' })),
      { id: 'wh', kind: 'wh' },
      ...g.rival.stores.map((sid) => ({ id: `r-${sid}`, kind: 'rival', sid })),
    ];
    const key = wanted.map((w) => w.id).join('|');
    if (layer.dataset.k !== key) {
      layer.dataset.k = key;
      layer.innerHTML = '';
      for (const w of wanted) {
        const chip = document.createElement('button');
        chip.className = `map-chip ${w.kind}`;
        chip.dataset.chip = w.id;
        if (w.kind === 'store') {
          chip.addEventListener('click', () => {
            this.selectedSite = w.id;
            this.setTab?.('stores');
            document.querySelector('[data-tab="stores"]')?.click();
            this.renderStoreList();
          });
        }
        layer.appendChild(chip);
      }
    }
    const pad = 40;
    for (const w of wanted) {
      const chip = layer.querySelector(`[data-chip="${w.id}"]`);
      if (!chip) continue;
      let x, y, html;
      if (w.kind === 'store') {
        const st = g.storeAt(w.id);
        const site = g.site(w.id);
        if (!st || !site) { chip.style.display = 'none'; continue; }
        ({ sx: x, sy: y } = r.toScreen(site.x, site.y));
        y -= 34 * r.scale;
        const sales = st.yesterday?.revenue || st.today.revenue;
        html = `<i></i>${st.name}<b>${fmt(sales)}</b>`;
        chip.title = st.yesterday?.revenue ? "Yesterday's sales" : "Today's sales so far";
      } else if (w.kind === 'wh') {
        ({ sx: x, sy: y } = r.toScreen(11, 11));
        y -= 38 * r.scale;
        html = `<i></i>Warehouse<b>${Math.round((g.warehouseUsed() / g.warehouse.cap) * 100)}%</b>`;
      } else {
        const site = g.site(w.sid);
        if (!g.rivalAt(w.sid)) { chip.style.display = 'none'; continue; }
        ({ sx: x, sy: y } = r.toScreen(site.x, site.y));
        y -= 30 * r.scale;
        html = `<i></i>BuyLow${g.rival.plus?.[w.sid] ? '+' : ''}`;
      }
      const off = x < -pad || x > r.w + pad || y < 10 || y > r.h + pad;
      chip.style.display = off ? 'none' : '';
      if (!off) {
        if (chip.dataset.h !== html) { chip.dataset.h = html; chip.innerHTML = html; }
        chip.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      }
    }
  }

  refreshStores() {
    const g = this.game;
    const wrap = document.getElementById('store-list');
    const order = this.rankedStores().map((s) => s.siteId).join('|');
    if (wrap.children.length !== g.stores.length || wrap.dataset.order !== order) {
      wrap.dataset.order = order;
      this.renderStoreList();
    }
    for (const store of g.stores) {
      const el = wrap.querySelector(`[data-rev="${store.siteId}"]`);
      if (el) {
        const p = store.yesterday.profit;
        setEl(el, signFmt(p));
        el.style.color = p >= 0 ? 'var(--good)' : 'var(--bad)';
      }
      const bar = wrap.querySelector(`[data-minibar="${store.siteId}"]`);
      if (bar) {
        const total = PROD_IDS.reduce((s, p2) => s + (store.range[p2] ? store.inv[p2] : 0), 0);
        const f = total / (SHELF_CAP * Math.max(1, g.rangeCount(store)));
        bar.style.width = `${Math.round(Math.min(1, f) * 100)}%`;
        bar.style.background = f > 0.45 ? 'var(--good)' : f > 0.18 ? 'var(--accent)' : 'var(--bad)';
      }
      const mgr = wrap.querySelector(`[data-mgr="${store.siteId}"]`);
      if (mgr) setEl(mgr, store.manager ? '👤 ' + store.manager.name.split(' ')[0] : '—');
      const warn = wrap.querySelector(`[data-warn="${store.siteId}"]`);
      if (warn) warn.classList.toggle('hidden', !Object.values(store.stockoutLogged ?? {}).some(Boolean));
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
      setEl(mEl, `${Math.round(mf * 100)}%${rivals ? ' 🦈' : ''}`);
      mEl.title = rivals ? `${rivals} BuyLow store${rivals > 1 ? 's' : ''} competing in this district` : '';
      mEl.style.color = mf > 0.85 ? 'var(--good)' : mf > 0.6 ? 'var(--accent)' : 'var(--bad)';
    }
    setEl(box.querySelector('#sd-rev'), fmt(store.today.revenue));
    const yp = box.querySelector('#sd-yprofit');
    setEl(yp, signFmt(store.yesterday.profit));
    yp.style.color = store.yesterday.profit >= 0 ? 'var(--good)' : 'var(--bad)';
    const lostEl = box.querySelector('#sd-lost');
    setEl(lostEl, `${Math.round(store.lostToday)} 🚶`);
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

  refreshRecentEvents() {
    const g = this.game;
    const wrap = document.getElementById('recent-events');
    if (!wrap) return;
    const entries = g.logEntries.slice(-5).reverse();
    const key = entries.length ? `${g.logEntries.length}-${entries[0].text}` : 'none';
    if (wrap.dataset.k === key) return;
    wrap.dataset.k = key;
    const GOOD = ['🤝', '🎉', '🏆', '📜', '🎯', '💼', '🏗️'];
    const BAD = ['💢', '🫙', '⚠️', '✊', '🦈', '💥', '🧊'];
    wrap.innerHTML = entries.length
      ? entries.map((e) => `<div class="rev-row">
          <span class="rev-day">D${e.day}</span>
          <span class="${GOOD.includes(e.icon) ? 'rev-good' : BAD.includes(e.icon) ? 'rev-bad' : ''}">${e.icon} ${e.text}</span>
        </div>`).join('')
      : 'Quiet so far.';
  }

  refreshSupply() {
    const g = this.game;
    setText('wh-cap', `${Math.round(g.warehouseUsed())} / ${g.warehouse.cap} units`);
    const f = g.warehouseUsed() / g.warehouse.cap;
    const stackEl = document.getElementById('wh-stack');
    if (stackEl) stackEl.classList.toggle('crammed', f > 0.92);
    for (const p of PROD_IDS) {
      const seg = document.querySelector(`[data-whseg="${p}"]`);
      if (seg) seg.style.width = `${Math.min(100, (g.warehouse.inv[p] / g.warehouse.cap) * 100)}%`;
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
      const daysEl = document.querySelector(`[data-days="${p}"]`);
      if (daysEl) {
        const ema = g.demandEma[p] ?? 0;
        if (!carried || ema < 1) {
          setEl(daysEl, '');
          daysEl.style.display = 'none';
        } else {
          daysEl.style.display = '';
          const days = (g.warehouse.inv[p] + g.inTransit(p)) / ema;
          setEl(daysEl, `${days > 9 ? '9+' : days.toFixed(1)}d`);
          daysEl.style.color = days < 1.5 ? 'var(--bad)' : days < 3 ? 'var(--accent)' : 'var(--good)';
          daysEl.style.borderColor = days < 1.5 ? 'var(--bad)' : days < 3 ? 'var(--accent)' : 'var(--border)';
        }
      }
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
      const sorted = [...g.orders].sort((a, b) => a.arriveDay - b.arriveDay);
      list.innerHTML = sorted.length
        ? sorted.map((o) => {
          const eta = o.arriveDay - g.day();
          const etaTxt = g.vendorStruck(o.vendor) ? '✊ held'
            : eta <= 0 ? 'tonight' : eta === 1 ? 'tomorrow' : `${eta}d`;
          return `<div class="order-row">
            <span class="swatch" style="background:${PRODUCTS[o.product].color}"></span>
            <span class="oqty">${o.qty}×</span> ${PRODUCTS[o.product].name}
            <span class="fine ofrom">· ${VENDORS[o.vendor].name}</span>
            <span class="eta ${g.vendorStruck(o.vendor) ? 'held' : eta <= 1 ? 'soon' : ''}">${etaTxt}</span>
          </div>`;
        }).join('')
        : '<div class="fine">Nothing inbound — standing orders place themselves at day start.</div>';
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
      if (disc) {
        const frozenFor = (g.vendors[id].frozenUntil ?? 0) - g.day();
        setEl(disc, frozenFor > 0
          ? `${Math.round(g.vendors[id].discount * 100)}% ❄️ frozen ${frozenFor}d`
          : `${Math.round(g.vendors[id].discount * 100)}%`);
      }
      const pips = document.querySelector(`[data-pips="${id}"]`);
      if (pips) {
        const n = Math.round(g.vendors[id].discount / 0.05);
        [...pips.children].forEach((pip, i) => pip.classList.toggle('on', i < n));
      }
      const leadEl = document.querySelector(`[data-lead="${id}"]`);
      if (leadEl) {
        const rushLeft = (g.vendors[id].rushUntil ?? 0) - g.day();
        const v = VENDORS[id];
        setEl(leadEl, rushLeft > 0
          ? `🚚 ${Math.max(1, v.leadTime - 1)}d ⚡${rushLeft}d`
          : `🚚 ${v.leadTime}d`);
        leadEl.style.color = rushLeft > 0 ? 'var(--gold, #f2c14e)' : '';
      }
      const struck = document.querySelector(`[data-struck="${id}"]`);
      if (struck) {
        setEl(struck, g.vendorStruck(id) ? '✊ ON STRIKE'
          : g.rival.courting?.vendor === id ? '🦈 BUYLOW COURTING'
            : g.day() < (g.vendors[id].courtLossUntil ?? 0) ? '🦈 favoring BuyLow' : '');
      }
      const btn = document.querySelector(`[data-neg="${id}"]`);
      if (btn) {
        const used = g.vendors[id].lastNegDay === g.day();
        const noMeet = g.meetingsLeft <= 0;
        btn.disabled = used || noMeet;
        const label = used ? 'Negotiated today' : noMeet ? 'No meetings left' : 'Negotiate';
        if (btn.textContent !== label) btn.textContent = label;
      }
      const cEl = document.querySelector(`[data-contract="${id}"]`);
      const sBtn = document.querySelector(`[data-sign="${id}"]`);
      const c = g.vendors[id].contract;
      if (cEl) {
        const rider = g.vendors[id].rider;
        const riderTxt = rider ? ` · rider ${Math.min(rider.qty, Math.round(rider.ordered))}/${rider.qty} by day ${rider.deadline}` : '';
        setEl(cEl, (c
          ? `${Math.round(c.weekOrdered)}/${CONTRACT.weeklyMin} this week · ends day ${c.until}`
          : g.vendors[id].rel >= CONTRACT.relRequired ? 'available' : `needs ${CONTRACT.relRequired}+ relationship`) + riderTxt);
        cEl.style.color = c && c.weekOrdered < CONTRACT.weeklyMin * 0.5 ? 'var(--accent)' : '';
      }
      if (sBtn) sBtn.disabled = !!c || g.vendors[id].rel < CONTRACT.relRequired;
    }
  }

  refreshRecords() {
    const g = this.game;
    const st = g.stats ?? {};
    const wrap = document.getElementById('rec-stats');
    if (!wrap) return;
    const html = [
      ['Days in business', g.day()],
      ['Customers served', Math.round(st.customersServed ?? 0).toLocaleString()],
      ['Lifetime revenue', fmt(st.totalRevenue ?? 0)],
      ['Peak cash', fmt(g.peakCash)],
      ['Stores opened', st.storesOpened ?? g.stores.length],
      ['Events weathered', st.eventsWeathered ?? 0],
    ].map(([k, v]) => `<div class="pl-row"><span>${k}</span><b>${v}</b></div>`).join('');
    if (wrap.dataset.key !== html) { wrap.dataset.key = html; wrap.innerHTML = html; }
    const aWrap = document.getElementById('rec-achievements');
    const aKey = Object.keys(g.achieved ?? {}).join('|');
    if (aWrap.dataset.key !== aKey) {
      aWrap.dataset.key = aKey;
      aWrap.innerHTML = ACHIEVEMENTS.map((a) => {
        const got = g.achieved?.[a.id];
        return `<div class="ach ${got ? 'got' : ''}" title="${a.desc}${got ? ` — earned day ${got}` : ''}">
          <span class="ach-icon">${a.icon}</span><span>${a.name}</span></div>`;
      }).join('');
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
