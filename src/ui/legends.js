// The Legends browser: the whole history of the world, browsable —
// every soul living and dead, every settlement, faith and war.

import { ageYears, fullName, displayName } from '../core/character.js';
import { chiefOf } from '../core/settlement.js';
import { countFollowers, DOCTRINES } from '../core/religion.js';
import { yearOf } from '../core/world.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let activeTab = 'folk';

export function openLegends(sim, callbacks) {
  const overlay = document.getElementById('legends');
  overlay.classList.remove('hidden');
  document.getElementById('legends-search').value = '';
  renderTab(sim, callbacks);

  document.querySelectorAll('#legends-tabs button').forEach((btn) => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      renderTab(sim, callbacks);
    };
  });
  document.getElementById('legends-search').oninput = () => renderTab(sim, callbacks);
  document.getElementById('legends-close').onclick = closeLegends;
  overlay.onclick = (e) => { if (e.target === overlay) closeLegends(); };
}

export function closeLegends() {
  document.getElementById('legends').classList.add('hidden');
}

function renderTab(sim, callbacks) {
  document.querySelectorAll('#legends-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === activeTab));
  const q = document.getElementById('legends-search').value.toLowerCase();
  const list = document.getElementById('legends-list');
  const rows = {
    folk: folkRows, settlements: settlementRows, faiths: faithRows, wars: warRows,
  }[activeTab](sim, q);
  list.innerHTML = rows.length ? rows.map(r => r.html).join('') : '<div class="sub" style="padding:20px">Nothing yet. History takes time.</div>';
  list.querySelectorAll('[data-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      const r = rows[Number(el.dataset.idx)];
      if (r.action) { r.action(callbacks); closeLegends(); }
    });
  });
}

function lifeSpan(sim, p) {
  const born = yearOf(p.bornDay);
  if (p.alive) return `Y${born}–, ${ageYears(sim, p)} years`;
  const died = p.diedDay !== null && p.diedDay !== undefined ? yearOf(p.diedDay) : '?';
  return `Y${born}–Y${died}, died of ${p.causeOfDeath ?? 'unknown causes'}`;
}

function folkRows(sim, q) {
  // The living and recently dead, plus the long dead from the obituary rolls.
  const pruned = sim.obituaries.filter(o => !sim.folk.has(o.id));
  const all = [...sim.folk.values(), ...pruned]
    .filter(p => !q || fullName(p).toLowerCase().includes(q))
    .sort((a, b) => (b.fame - a.fame) || ((b.alive ? 1 : 0) - (a.alive ? 1 : 0)));
  return all.slice(0, 120).map((p, i) => ({
    action: (cb) => cb.onSelect({ kind: 'person', ref: p }),
    html: `<div class="legend-row" data-idx="${i}">
      <b>${esc(fullName(p))}${p.alive ? '' : ' †'}</b>
      ${p.fame >= 3 ? '<span class="star">★</span>' : ''}
      <span class="sub">${esc(lifeSpan(sim, p))}${p.outlaw ? ' · outlaw' : ''}</span>
    </div>`,
  }));
}

function settlementRows(sim, q) {
  const all = [...sim.settlements.values()]
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => b.members.size - a.members.size);
  return all.map((s, i) => {
    const chief = chiefOf(sim, s);
    const alive = s.members.size > 0;
    return {
      action: (cb) => cb.onSelect({ kind: 'settlement', ref: s }),
      html: `<div class="legend-row" data-idx="${i}">
        <b>${esc(s.name)}</b>
        <span class="sub">founded Y${yearOf(s.foundedDay)} · ${alive
          ? `${s.members.size} folk${chief ? ` · chief ${esc(displayName(chief))}` : ''}`
          : 'fallen'}</span>
      </div>`,
    };
  });
}

function faithRows(sim, q) {
  const all = [...sim.religions.values()]
    .filter(r => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => countFollowers(sim, b.id) - countFollowers(sim, a.id));
  return all.map((r, i) => {
    const prophet = sim.folk.get(r.prophetId);
    const n = countFollowers(sim, r.id);
    return {
      action: (cb) => cb.onSelect({ kind: 'religion', ref: r }),
      html: `<div class="legend-row" data-idx="${i}">
        <b>${r.symbol} ${esc(r.name)}</b>
        <span class="sub">${esc(DOCTRINES[r.doctrine].word)} · proclaimed Y${yearOf(r.bornDay)}` +
        `${prophet ? ` by ${esc(displayName(prophet))}` : ''} · ${r.faded ? 'faded' : `${n} faithful`}</span>
      </div>`,
    };
  });
}

function warRows(sim, q) {
  const wars = sim.chronicleLog
    .filter(e => (e.kind === 'war' || e.kind === 'battle') && (!q || e.text.toLowerCase().includes(q)))
    .slice(-120)
    .reverse();
  return wars.map((e, i) => ({
    action: e.x !== undefined ? (cb) => cb.onLocate(e.x, e.y) : null,
    html: `<div class="legend-row" data-idx="${i}">
      <span class="sub">Y${e.year}</span> ${esc(e.text)}
    </div>`,
  }));
}
