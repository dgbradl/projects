// DOM panels: divine acts, the inspector, and the chronicle feed.

import { POWERS } from '../core/god.js';
import { ageYears, isAdult, settlementOf, displayName } from '../core/character.js';
import { membersOf, leaderOf, PROJECTS, shelterCapacity } from '../core/settlement.js';
import { seasonOf, yearOf, dayOfYear, tileAt, DAYS_PER_YEAR } from '../core/world.js';
import { religionOf, majorityReligion, countFollowers, DOCTRINES, godTone } from '../core/religion.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- top bar ----
export function updateTopBar(sim) {
  const season = seasonOf(sim.day);
  document.getElementById('date').innerHTML =
    `Year <b>${yearOf(sim.day)}</b>, day ${dayOfYear(sim.day)} — <b>${season}</b>` +
    (sim.weather.drought ? ' 🌵' : '') + (sim.weather.storm ? ' ⛈' : sim.weather.rainDays > 0 ? ' 🌧' : '');
  document.getElementById('pop').innerHTML = `Folk: <b>${sim.livingCount}</b>`;
  document.getElementById('faith').innerHTML = `Faith: <b>${Math.floor(sim.faith)}</b>`;
}

// ---- powers ----
export function buildPowerButtons(onSelect) {
  const list = document.getElementById('power-list');
  list.innerHTML = '';
  for (const [key, p] of Object.entries(POWERS)) {
    const btn = document.createElement('button');
    btn.className = 'power-btn';
    btn.dataset.power = key;
    btn.title = p.desc;
    btn.innerHTML = `<span class="icon">${p.icon}</span><span>${esc(p.name)}</span><span class="cost">${p.cost}</span>`;
    btn.addEventListener('click', () => onSelect(key));
    list.appendChild(btn);
  }
}

export function updatePowerButtons(sim, selectedPower) {
  for (const btn of document.querySelectorAll('.power-btn')) {
    const key = btn.dataset.power;
    btn.disabled = sim.faith < POWERS[key].cost;
    btn.classList.toggle('selected', key === selectedPower);
  }
}

// ---- inspector ----
export function renderInspector(sim, selection, onSelectEntity) {
  const title = document.getElementById('inspector-title');
  const body = document.getElementById('inspector-body');
  if (!selection) {
    title.textContent = 'The Vale';
    body.innerHTML = worldSummary(sim);
    drawSparkline(sim);
    return;
  }
  if (selection.kind === 'person') {
    const p = selection.ref;
    title.textContent = displayName(p) + (p.alive ? '' : ' †');
    body.innerHTML = personHtml(sim, p);
  } else if (selection.kind === 'herd') {
    const h = selection.ref;
    title.textContent = 'Deer';
    body.innerHTML = sim.herds.has(h.id)
      ? `<div class="sub">A herd of deer, ${h.size} strong. Wolves and hunters both follow where they graze.</div>`
      : '<div class="sub">The herd has scattered or fallen.</div>';
  } else if (selection.kind === 'settlement') {
    const s = selection.ref;
    title.textContent = s.name;
    body.innerHTML = settlementHtml(sim, s);
  } else if (selection.kind === 'monster') {
    const m = selection.ref;
    title.textContent = m.name;
    body.innerHTML = monsterHtml(sim, m);
  } else if (selection.kind === 'tile') {
    const t = tileAt(sim.world, selection.x, selection.y);
    title.textContent = 'The Land';
    body.innerHTML = t ? tileHtml(t) : '';
  }
  // Wire up name links
  body.querySelectorAll('a[data-person]').forEach((a) =>
    a.addEventListener('click', () => {
      const p = sim.folk.get(Number(a.dataset.person));
      if (p) onSelectEntity({ kind: 'person', ref: p });
    }));
  body.querySelectorAll('a[data-settlement]').forEach((a) =>
    a.addEventListener('click', () => {
      const s = sim.settlements.get(Number(a.dataset.settlement));
      if (s) onSelectEntity({ kind: 'settlement', ref: s });
    }));
}

function bar(v, bad = false) {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<div class="bar${bad ? ' bad' : ''}"><i style="width:${pct}%"></i></div>`;
}

function moodWord(m) {
  if (m > 0.4) return 'joyful';
  if (m > 0.1) return 'content';
  if (m > -0.1) return 'weary';
  if (m > -0.4) return 'unhappy';
  return 'despairing';
}

function traitWords(t) {
  const words = [];
  if (t.courage > 0.75) words.push('brave'); else if (t.courage < 0.25) words.push('timid');
  if (t.kindness > 0.75) words.push('kind'); else if (t.kindness < 0.25) words.push('cruel');
  if (t.diligence > 0.75) words.push('tireless'); else if (t.diligence < 0.25) words.push('idle');
  if (t.ambition > 0.75) words.push('ambitious');
  if (t.temper > 0.75) words.push('hot-tempered'); else if (t.temper < 0.25) words.push('serene');
  if (t.curiosity > 0.75) words.push('curious');
  if (t.faith > 0.75) words.push('devout'); else if (t.faith < 0.25) words.push('godless');
  return words.length ? words.join(', ') : 'unremarkable';
}

function creedLine(sim, p) {
  const creed = religionOf(sim, p);
  if (!creed) return '';
  const zeal = p.traits.faith > 0.85 ? 'zealous in' : p.traits.faith > 0.6 ? 'devoted to' : 'keeps to';
  return `<div class="sub creed">${creed.symbol} ${zeal} ${esc(creed.name)}</div>`;
}

function personHtml(sim, p) {
  if (!p.alive) {
    return `<div class="sub">Died of ${esc(p.causeOfDeath ?? 'unknown causes')}.</div>`;
  }
  const s = settlementOf(sim, p);
  const age = ageYears(sim, p);
  const stage = !isAdult(sim, p) ? 'child' : age >= 55 ? 'elder' : 'adult';
  let html = `<div class="sub">${p.sex === 'f' ? 'Woman' : 'Man'}, ${age} years (${stage}) — ${moodWord(p.mood)}` +
    `${p.sick ? ', <b>sick</b>' : ''}${p.injured > 0 ? ', injured' : ''}${p.pregnantDays > 0 ? ', with child' : ''}</div>` +
    `<div class="sub">${s ? `of <a data-settlement="${s.id}">${esc(s.name)}</a>` : 'homeless wanderer'}` +
    `${p.activity ? ` — ${esc(p.activity)}` : ''}</div>` +
    `<div class="sub" style="margin-top:4px">${traitWords(p.traits)}</div>` +
    creedLine(sim, p) +
    `<h3>Condition</h3>` +
    `health ${bar(p.health, p.health < 0.4)}` +
    `food ${bar(1 - Math.min(1, p.needs.hunger), p.needs.hunger > 0.8)}` +
    `warmth ${bar(p.needs.warmth, p.needs.warmth < 0.3)}`;

  // Relationships, strongest bonds and worst grudges
  const rels = [];
  for (const [id, r] of p.rel) {
    const o = sim.folk.get(id);
    if (!o?.alive || (Math.abs(r.aff) < 25 && !r.kin)) continue;
    rels.push({ o, r });
  }
  rels.sort((a, b) => Math.abs(b.r.aff) - Math.abs(a.r.aff));
  if (rels.length) {
    html += '<h3>Bonds</h3>';
    for (const { o, r } of rels.slice(0, 8)) {
      const cls = r.kin === 'spouse' || r.aff > 60 ? 'rel-love' : r.aff > 0 ? 'rel-friend' : 'rel-foe';
      const label = r.kin ? r.kin : r.aff > 60 ? 'dear friend' : r.aff > 0 ? 'friend' : r.aff > -60 ? 'disliked' : 'hated';
      html += `<div><a data-person="${o.id}">${esc(displayName(o))}</a> <span class="${cls}">(${label})</span></div>`;
    }
  }
  if (p.memories.length) {
    html += '<h3>Remembers</h3>';
    for (const m of [...p.memories].reverse().slice(0, 5)) {
      html += `<div class="memory">Y${yearOf(m.day)}: ${esc(m.text)}</div>`;
    }
  }
  // The world's record of them — their life as the chronicle tells it.
  const story = [];
  for (let i = sim.chronicleLog.length - 1; i >= 0 && story.length < 6; i--) {
    const e = sim.chronicleLog[i];
    if (e.who?.includes(p.id)) story.push(e);
  }
  if (story.length) {
    html += '<h3>As the chronicle tells it</h3>';
    for (const e of story) {
      html += `<div class="memory">Y${e.year}: ${esc(e.text)}</div>`;
    }
  }
  return html;
}

function settlementHtml(sim, s) {
  const members = membersOf(sim, s);
  if (!members.length) return '<div class="sub">Abandoned. The wind moves through empty doorways.</div>';
  const leader = leaderOf(sim, s);
  const b = s.buildings;
  let html = `<div class="sub">Founded year ${yearOf(s.foundedDay)} — ${members.length} folk</div>` +
    (leader ? `<div class="sub">First among them: <a data-person="${leader.id}">${esc(displayName(leader))}</a></div>` : '') +
    `<h3>Stores</h3>food ${Math.floor(s.stock.food)} · wood ${Math.floor(s.stock.wood)} · stone ${Math.floor(s.stock.stone)}` +
    `<h3>Buildings</h3>${b.shelter} shelter (room for ${shelterCapacity(s)}) · ${b.farm} farm` +
    `${b.wall ? ` · walls ×${b.wall}` : ''}${b.hall ? ' · hall' : ''}${b.temple ? ' · temple' : ''}`;
  const creed = majorityReligion(sim, s);
  if (creed) {
    const dedicated = s.templeReligion !== undefined && sim.religions.get(s.templeReligion);
    html += `<div class="sub creed">${creed.symbol} most here follow ${esc(creed.name)}` +
      (dedicated && b.temple ? `; the temple is dedicated to ${esc(dedicated.name)}` : '') + `</div>`;
  }
  if (s.project) {
    html += `<div class="sub">building ${PROJECTS[s.project.type].desc}${s.project.paid ? '' : ' (gathering materials)'}</div>`;
  }
  const foes = [], friends = [];
  for (const [id, v] of s.relations) {
    const o = sim.settlements.get(id);
    if (!o || o.members.size === 0) continue;
    if (v < -40) foes.push(o); else if (v > 40) friends.push(o);
  }
  if (foes.length || friends.length) {
    html += '<h3>Neighbors</h3>';
    for (const f of friends) html += `<div><a data-settlement="${f.id}">${esc(f.name)}</a> <span class="rel-friend">(friendly)</span></div>`;
    for (const f of foes) html += `<div><a data-settlement="${f.id}">${esc(f.name)}</a> <span class="rel-foe">(hostile)</span></div>`;
  }
  html += '<h3>Folk</h3>';
  for (const p of members.slice(0, 20)) {
    html += `<div><a data-person="${p.id}">${esc(displayName(p))}</a> <span class="sub">${ageYears(sim, p)}</span></div>`;
  }
  if (members.length > 20) html += `<div class="sub">…and ${members.length - 20} more</div>`;
  return html;
}

function monsterHtml(sim, m) {
  return `<div class="sub">A ${m.kind === 'wolfpack' ? 'pack of wolves' : m.kind}.</div>` +
    `<h3>Condition</h3>vigor ${bar(m.hp / m.maxHp)}` +
    `<div class="sub">${m.kills > 0 ? `Has killed ${m.kills} of the folk.` : 'Has killed no one — yet.'}</div>`;
}

function tileHtml(t) {
  return `<div class="sub">${esc(t.biome)}</div>` +
    `<h3>The Land</h3>` +
    `forage ${bar(t.food / 10)}` +
    `<div class="sub">wood ${Math.floor(t.wood)} · stone ${Math.floor(t.stone)}</div>` +
    (t.bounty > 0.05 ? '<div class="rel-friend">Blessed with bounty</div>' : '') +
    (t.blight > 0.05 ? '<div class="rel-foe">Cursed with blight</div>' : '');
}

function godToneLine(sim) {
  const tone = godTone(sim);
  if (tone === 'mercy') return 'The folk speak of a god of mercy.';
  if (tone === 'wrath') return 'The folk speak of a god of wrath, in whispers.';
  if (tone === 'silence') return 'The folk speak of a god who does not answer.';
  if (sim.day - sim.lastDeedDay <= DAYS_PER_YEAR * 2) return 'The folk are still deciding what kind of god watches them.';
  return 'The folk do not yet speak of any god.';
}

function worldSummary(sim) {
  const settlements = [...sim.settlements.values()].filter(s => s.members.size > 0);
  let deer = 0;
  for (const h of sim.herds.values()) deer += h.size;
  let html = `<div class="sub">${sim.livingCount} folk in ${settlements.length} settlement${settlements.length === 1 ? '' : 's'}.` +
    ` ${sim.monsters.size} beast${sim.monsters.size === 1 ? '' : 's'} roam the wilds, and some ${deer} deer.</div>` +
    `<div class="sub creed" style="margin-top:6px">${godToneLine(sim)}</div>`;
  const faiths = [...sim.religions.values()].filter(r => !r.faded)
    .map(r => ({ r, n: countFollowers(sim, r.id) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (faiths.length) {
    html += '<h3>Faiths</h3>';
    for (const { r, n } of faiths) {
      const prophet = sim.folk.get(r.prophetId);
      html += `<div>${r.symbol} ${esc(r.name)} <span class="sub">— ${n} faithful` +
        (prophet ? `, ${prophet.alive ? 'led' : 'founded'} by ${prophet ? `<a data-person="${prophet.id}">${esc(displayName(prophet))}</a>` : ''}` : '') +
        `</span></div>`;
    }
  }
  html += `<h3>Folk through the years</h3><canvas id="pop-spark" width="252" height="54"></canvas>` +
    `<div class="sub">Peak population: ${sim.peakPopulation}</div>` +
    `<div style="margin-top:14px" class="memory">Drag to pan, scroll to zoom, space to pause.<br>Click anything to know it; press F to follow it.<br>Choose a divine act, then click the map to work your will.</div>`;
  return html;
}

function drawSparkline(sim) {
  const c = document.getElementById('pop-spark');
  if (!c || sim.popHistory.length < 2) return;
  const ctx = c.getContext('2d');
  const data = sim.popHistory;
  const max = Math.max(...data, 1);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#7a9b4e';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * (c.width - 2) + 1;
    const y = c.height - 2 - (data[i] / max) * (c.height - 6);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#8d8171';
  ctx.font = '9px Georgia';
  ctx.fillText(String(max), 2, 9);
}

// ---- chronicle feed ----
export function makeChronicleFeed(sim, onLocate) {
  const list = document.getElementById('chronicle-list');
  const minorToggle = document.getElementById('chronicle-minor');
  const append = (e) => {
    if (e.importance === 0 && !minorToggle.checked) return;
    const div = document.createElement('div');
    div.className = `chron-entry imp-${e.importance}` + (e.x !== undefined ? ' locatable' : '');
    div.innerHTML = `<span class="when">Y${e.year} d${e.dayOfYear}</span>${esc(e.text)}`;
    if (e.x !== undefined) div.addEventListener('click', () => onLocate(e.x, e.y));
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.appendChild(div);
    while (list.children.length > 250) list.removeChild(list.firstChild);
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  for (const e of sim.chronicleLog) append(e);
  list.scrollTop = list.scrollHeight;
  return append;
}
