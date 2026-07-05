// DOM UI: status bar, party cards, contextual action buttons, modals.
import type { Character, Combatant } from './types';
import { G, newGame, saveGame, loadGame, hasSave, hooks } from './state';
import { WORLD, SPELLS, ITEMS, SHOP_STOCK } from './data';
import { armorClass, attackMod, damageDice, damageBonus, gearSlots, slotsUsed, mod, xpToLevel } from './rules';
import { CLASS_COLORS } from './render';
import { log, logDivider } from './log';
import * as combat from './combat';
import * as dungeon from './dungeon';
import * as town from './town';
import * as overworld from './overworld';
import { pick } from './rng';

export let pendingSpell: { spellId: string; fromScroll?: number } | null = null;
export function clearPending() { pendingSpell = null; }

const $ = (id: string) => document.getElementById(id)!;

export function initUI() {
  $('btn-save').onclick = () => {
    if (!G) return;
    if (saveGame()) log('Game saved. The chronicler dips his quill.', 'system');
  };
  $('btn-menu').onclick = () => showMenu();
}

// ---------------------------------------------------------------- refresh

export function refresh() {
  if (!G) return;
  renderStatusBar();
  renderParty();
  renderActions();
  renderBanner();
  if (G.mode === 'gameover') showGameOver();
}

function renderStatusBar() {
  const loc = G.dungeon ? G.dungeon.name : WORLD[G.location]?.name ?? '';
  $('st-location').textContent = `⚑ ${loc}`;
  const torchEl = $('st-torch');
  if (G.mode === 'dungeon' || G.mode === 'combat') {
    if (G.torchLit) {
      torchEl.textContent = `🔥 Torch: ${G.torchLeft} turns (${G.torches} spare)`;
      torchEl.className = 'lit';
    } else {
      torchEl.textContent = `🕯 DARKNESS (${G.torches} torches)`;
      torchEl.className = 'dark';
    }
  } else {
    torchEl.textContent = `🕯 ${G.torches} torches · ${G.rations} rations`;
    torchEl.className = '';
  }
  $('st-gold').textContent = `◉ ${G.gold} gp`;
  $('st-day').textContent = `Day ${G.day}`;
}

function renderBanner() {
  const b = $('map-banner');
  const cur = combat.current();
  if (G.mode === 'combat' && cur?.kind === 'pc') {
    b.classList.remove('hidden');
    b.textContent = pendingSpell
      ? `${SPELLS[pendingSpell.spellId].name} — choose a target`
      : `${cur.pc!.name}: move ${cur.moves} · ${cur.acted ? 'action spent' : 'click an enemy to attack'}`;
  } else if (G.mode === 'overworld') {
    b.classList.remove('hidden');
    b.textContent = 'Click a connected location to travel';
  } else {
    b.classList.add('hidden');
  }
}

function renderParty() {
  const wrap = $('party');
  wrap.innerHTML = '';
  const cur = combat.current();
  for (const p of G.party) {
    const card = document.createElement('div');
    card.className = 'pc-card'
      + (cur?.pc === p ? ' active-turn' : '')
      + (p.dyingRounds !== undefined ? ' dying' : '')
      + (!p.alive ? ' dead-card' : '');
    const frac = p.maxHp ? Math.max(0, p.hp / p.maxHp) : 0;
    card.innerHTML = `
      <div class="pc-name"><span class="pc-class-dot" style="background:${CLASS_COLORS[p.cls]}"></span>${p.name}</div>
      <div class="pc-sub">Lv ${p.level} ${p.ancestry} ${p.cls}</div>
      <div class="pc-hpbar"><div class="pc-hpfill ${frac > 0.5 ? 'healthy' : ''}" style="width:${frac * 100}%"></div></div>
      <div class="pc-hptext"><span>HP ${p.hp}/${p.maxHp}</span><span>AC ${armorClass(p)}</span></div>
      ${p.dyingRounds !== undefined ? `<div class="pc-status">DYING — ${p.dyingRounds} rounds</div>` : ''}
      ${p.blessed ? '<div class="pc-status" style="color:#d8b45a">✦ blessed</div>' : ''}
    `;
    card.onclick = () => showSheet(p);
    wrap.appendChild(card);
  }
}

// ---------------------------------------------------------------- actions

function btn(label: string, fn: () => void, cls = '', disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'action-btn ' + cls;
  b.textContent = label;
  b.disabled = disabled;
  b.onclick = fn;
  return b;
}

function hint(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'action-hint';
  d.textContent = text;
  return d;
}

function renderActions() {
  const wrap = $('actions');
  wrap.innerHTML = '';

  switch (G.mode) {
    case 'town': {
      wrap.appendChild(btn(`Rest at Inn (${town.PRICES.rest}g)`, () => town.restAtInn(), 'primary'));
      wrap.appendChild(btn('Shop', () => showShop()));
      wrap.appendChild(btn('Temple', () => showTemple()));
      wrap.appendChild(btn('Tavern', () => showTavern()));
      wrap.appendChild(btn('Notice Board', () => showBoard()));
      wrap.appendChild(btn('Set Out ⚑', () => { G.mode = 'overworld'; log('You shoulder your packs and pass through the town gate.', 'gm'); hooks.refresh(); }, 'danger'));
      break;
    }
    case 'overworld': {
      const here = WORLD[G.location];
      if (here.kind === 'town') wrap.appendChild(btn('Enter Emberwick', () => { G.mode = 'town'; overworld.arrive(); hooks.refresh(); }, 'primary'));
      if (here.kind === 'dungeon' || here.kind === 'cave') {
        wrap.appendChild(btn(`Descend into ${here.name}`, () => dungeon.enterDungeon(here.id), 'danger'));
      }
      for (const l of here.links) {
        wrap.appendChild(btn(`→ ${WORLD[l].name}`, () => overworld.travelTo(l)));
      }
      break;
    }
    case 'dungeon': {
      wrap.appendChild(hint('Move: arrow keys / WASD, or click a lit tile. Every step burns torchlight.'));
      wrap.appendChild(btn('Search (3 turns)', () => dungeon.searchAction()));
      wrap.appendChild(btn(`Camp (${G.party.filter(p => p.alive).length} rations)`, () => dungeon.campAction()));
      if (!G.torchLit && G.torches > 0) wrap.appendChild(btn('Light Torch', () => { dungeon.lightTorchIfNeeded(); dungeon.revealAround(); hooks.refresh(); }, 'primary'));
      if (dungeon.canLeave()) wrap.appendChild(btn('Leave the Dungeon', () => dungeon.leaveDungeon(), 'primary'));
      break;
    }
    case 'combat': renderCombatActions(wrap); break;
    case 'gameover': {
      wrap.appendChild(btn('Begin a New Company', () => startNewGame(), 'primary'));
      break;
    }
  }
}

function renderCombatActions(wrap: HTMLElement) {
  const cur = combat.current();
  if (!cur || cur.kind !== 'pc') {
    wrap.appendChild(hint('The enemy moves...'));
    return;
  }
  const pc = cur.pc!;

  if (pendingSpell) {
    const sp = SPELLS[pendingSpell.spellId];
    wrap.appendChild(hint(`${sp.name}: click an enemy on the map.`));
    wrap.appendChild(btn('Cancel', () => { clearPending(); hooks.refresh(); }));
    return;
  }

  wrap.appendChild(hint(`${pc.name} — click adjacent tile to move (${cur.moves} left), click an enemy to attack.`));

  // spells
  if (!cur.acted) {
    for (const [id, ready] of Object.entries(pc.spells)) {
      const sp = SPELLS[id];
      if (!sp) continue;
      wrap.appendChild(btn(`✦ ${sp.name}`, () => armSpell(cur, id), '', !ready));
    }
    // scrolls
    pc.gear.forEach((it, idx) => {
      if (it.kind === 'scroll' && (pc.cls === 'Priest' || pc.cls === 'Wizard')) {
        wrap.appendChild(btn(`📜 ${it.name}`, () => armSpell(cur, it.spell!, idx)));
      }
    });
    // potion
    const pi = pc.gear.findIndex(g => g.kind === 'potion');
    if (pi >= 0) wrap.appendChild(btn(`🧪 ${pc.gear[pi].name}`, () => combat.pcUsePotion(cur, pi)));
    // stabilize
    const dyingAdj = G.combat!.order.find(o =>
      o.kind === 'pc' && o.pc!.alive && o.pc!.dyingRounds !== undefined &&
      Math.abs(o.x - cur.x) <= 1 && Math.abs(o.y - cur.y) <= 1);
    if (dyingAdj) wrap.appendChild(btn(`✚ Stabilize ${dyingAdj.pc!.name}`, () => combat.pcStabilize(cur, dyingAdj), 'primary'));
  }

  wrap.appendChild(btn('End Turn', () => combat.endTurn(), 'primary'));
  wrap.appendChild(btn('Flee!', () => combat.partyFlee(), 'danger'));
}

function armSpell(cur: Combatant, spellId: string, scrollIdx?: number) {
  const sp = SPELLS[spellId];
  if (!sp) return;
  if (sp.target === 'enemy') {
    pendingSpell = { spellId, fromScroll: scrollIdx };
    hooks.refresh();
    return;
  }
  if (sp.target === 'ally') {
    // quick chooser
    showAllyPicker(cur, spellId, scrollIdx);
    return;
  }
  // self / area / all-enemies: cast immediately
  castNow(cur, spellId, undefined, scrollIdx);
}

export function castNow(cur: Combatant, spellId: string, target?: Combatant, scrollIdx?: number) {
  const pc = cur.pc!;
  const ok = combat.pcCast(cur, spellId, target, scrollIdx !== undefined);
  if (ok && scrollIdx !== undefined) {
    pc.gear.splice(scrollIdx, 1);
    log('The scroll crumbles to ash as its magic releases.', 'system');
  }
  clearPending();
  hooks.refresh();
}

function showAllyPicker(cur: Combatant, spellId: string, scrollIdx?: number) {
  const sp = SPELLS[spellId];
  openModal(`
    <h1>${sp.name}</h1>
    <p class="subtitle">${sp.desc}</p>
    <div id="ally-list"></div>
    <button class="modal-btn modal-close" id="m-close">Cancel</button>
  `);
  const list = $('ally-list');
  for (const o of G.combat!.order) {
    if (o.kind !== 'pc' || !o.pc!.alive) continue;
    const row = document.createElement('div');
    row.className = 'modal-row';
    row.innerHTML = `<span class="mr-name">${o.pc!.name}</span><span class="mr-detail">HP ${o.pc!.hp}/${o.pc!.maxHp}${o.pc!.dyingRounds !== undefined ? ' · DYING' : ''}</span>`;
    const b = document.createElement('button');
    b.className = 'modal-btn';
    b.textContent = 'Choose';
    b.onclick = () => { closeModal(); castNow(cur, spellId, o, scrollIdx); };
    row.appendChild(b);
    list.appendChild(row);
  }
  $('m-close').onclick = closeModal;
}

// ---------------------------------------------------------------- modals

function openModal(html: string) {
  $('modal').innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}

export function closeModal() {
  $('modal-overlay').classList.add('hidden');
}

export function showTitle() {
  openModal(`
    <div class="title-splash">
      <div class="flame">🔥</div>
      <h1>THE DARK BENEATH</h1>
      <p class="subtitle">an old-school sandbox of torchlight & consequence</p>
      <p class="title-quote">"Keep your torch lit, your blade close, and your will written.<br>The Ember Marches keep what they kill."</p>
      <button class="modal-btn" id="m-new" style="font-size:17px;padding:8px 26px">⚔ New Company</button>
      ${hasSave() ? '<button class="modal-btn" id="m-continue" style="font-size:17px;padding:8px 26px">🕯 Continue</button>' : ''}
      <p style="margin-top:18px;font-size:12.5px;color:#6a512f">A party of four against the dark · d20 rolls in the open · death is forever (recruits are not)</p>
    </div>
  `);
  $('m-new').onclick = () => startNewGame();
  const cont = document.getElementById('m-continue');
  if (cont) cont.onclick = () => {
    if (loadGame()) {
      closeModal();
      logDivider('THE TALE RESUMES');
      log('The chronicler finds your page and reads back the last line...', 'system');
      hooks.refresh();
    }
  };
}

export function startNewGame() {
  newGame();
  closeModal();
  logDivider('THE DARK BENEATH');
  log('Four strangers answer Emberwick\'s call for torchbearers. The pay is bad, the odds are worse, and the town chapel keeps a fresh page in its book of names.', 'gm');
  log('Your company gathers at lantern-hour: ' + G.party.map(p => `${p.name} the ${p.ancestry} ${p.cls}`).join(', ') + '.', 'info');
  log('Visit the Notice Board for work. Buy torches. Buy more torches than that.', 'system');
  saveGame();
  hooks.refresh();
}

function showGameOver() {
  const fallen = G.graveyard.map(p => `<div class="modal-row"><span class="mr-name">${p.name} the ${p.ancestry} ${p.cls}</span><span class="mr-detail">Lv ${p.level} — ${p.epitaph ?? 'lost to the dark'}</span></div>`).join('');
  openModal(`
    <h1>The Light Goes Out</h1>
    <p class="subtitle">Day ${G.day}. No one returned to Emberwick.</p>
    <h2>The Book of Names</h2>
    ${fallen || '<p>The dark left nothing to bury.</p>'}
    <p style="margin-top:14px">The notice board will find new hands. It always does.</p>
    <button class="modal-btn" id="m-new">⚔ A New Company Forms</button>
  `);
  $('m-new').onclick = () => startNewGame();
}

export function showSheet(p: Character) {
  const stats = (['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const).map(s => `
    <div class="sheet-stat"><div class="ss-label">${s}</div><div class="ss-val">${p.stats[s]}</div><div class="ss-mod">${mod(p.stats[s]) >= 0 ? '+' : ''}${mod(p.stats[s])}</div></div>
  `).join('');
  const gear = p.gear.map(g => `<div class="modal-row"><span class="mr-name">${g.name}</span><span class="mr-detail">${g.slots} slot${g.slots === 1 ? '' : 's'}${g.kind === 'treasure' ? ` · worth ${g.value}gp` : ''}</span></div>`).join('') || '<p style="color:#6a512f">Empty pockets.</p>';
  const spells = Object.entries(p.spells).map(([id, ready]) => {
    const sp = SPELLS[id];
    return `<div class="modal-row"><span class="mr-name">${sp.name} <i style="font-size:11px">(tier ${sp.tier})</i></span><span class="mr-detail">${ready ? 'ready' : 'spent — rest to recover'}</span></div><p style="font-size:12px;color:#6a512f;margin:0 8px 6px">${sp.desc}</p>`;
  }).join('');
  openModal(`
    <button class="modal-btn modal-close" id="m-close">✕ Close</button>
    <h1>${p.name}</h1>
    <p class="subtitle">Level ${p.level} ${p.ancestry} ${p.cls} · ${p.alive ? '' : '☠ DEAD'}</p>
    <div class="sheet-stats">${stats}</div>
    <div class="sheet-line">
      <span><b>HP</b> ${p.hp}/${p.maxHp}</span>
      <span><b>AC</b> ${armorClass(p)}</span>
      <span><b>Attack</b> +${attackMod(p)} (${damageDice(p)}${damageBonus(p) ? `+${damageBonus(p)}` : ''})</span>
      <span><b>XP</b> ${p.xp}/${xpToLevel(p.level)}</span>
    </div>
    <div class="sheet-line">
      <span><b>Weapon</b> ${p.weapon?.name ?? '—'}</span>
      <span><b>Armor</b> ${p.armor?.name ?? '—'}</span>
      <span><b>Shield</b> ${p.shield?.name ?? '—'}</span>
    </div>
    <h2>Gear (${slotsUsed(p)}/${gearSlots(p)} slots)</h2>
    ${gear}
    ${spells ? `<h2>Spells</h2>${spells}` : ''}
  `);
  $('m-close').onclick = closeModal;
}

function showShop() {
  const charOpts = G.party.map(p => `<option value="${p.id}">${p.name} (${p.cls})</option>`).join('');
  const rows = SHOP_STOCK.map(id => {
    const it = ITEMS[id];
    const detail = it.dmg ? `${it.dmg} dmg${it.ranged ? ' · ranged' : ''}${it.twoHanded ? ' · 2H' : ''}`
      : it.ac ? (it.kind === 'shield' ? `+${it.ac} AC` : `AC ${it.ac}${it.noDex ? ' (no DEX)' : ''}`)
      : it.heals ? `heals ${it.heals}` : (it.desc ?? '');
    return `<div class="modal-row"><span class="mr-name">${it.name}</span><span class="mr-detail">${detail}</span><span class="mr-detail" style="min-width:52px;text-align:right">${it.cost} gp</span><button class="modal-btn" data-buy="${id}">Buy</button></div>`;
  }).join('');
  const sellables = G.party.flatMap(p => p.gear.map((g, i) => ({ p, g, i })))
    .filter(x => x.g.kind === 'treasure' || x.g.cost > 0)
    .map(x => {
      const price = x.g.kind === 'treasure' ? (x.g.value ?? 0) : Math.floor(x.g.cost / 2);
      return `<div class="modal-row"><span class="mr-name">${x.g.name}</span><span class="mr-detail">${x.p.name}</span><span class="mr-detail" style="min-width:52px;text-align:right">${price} gp</span><button class="modal-btn" data-sell="${x.p.id}:${x.i}">Sell</button></div>`;
    }).join('');
  openModal(`
    <button class="modal-btn modal-close" id="m-close">✕ Close</button>
    <h1>The Provisioner</h1>
    <p class="subtitle">"Torches. You'll want torches. They always think they have enough torches."</p>
    <p>Your gold: <b id="shop-gold">${G.gold}</b> gp · Buying for: <select id="shop-char">${charOpts}</select></p>
    <h2>For Sale</h2>
    ${rows}
    ${sellables ? `<h2>Sell</h2>${sellables}` : ''}
  `);
  $('m-close').onclick = closeModal;
  document.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(b => {
    b.onclick = () => {
      const sel = document.getElementById('shop-char') as HTMLSelectElement;
      town.buyItem(b.dataset.buy!, sel.value);
      const g = document.getElementById('shop-gold');
      if (g) g.textContent = String(G.gold);
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach(b => {
    b.onclick = () => {
      const [pid, idx] = b.dataset.sell!.split(':');
      town.sellGear(pid, parseInt(idx));
      showShop(); // re-render list
    };
  });
}

function showTemple() {
  openModal(`
    <button class="modal-btn modal-close" id="m-close">✕ Close</button>
    <h1>The Temple of Saint Maren</h1>
    <p class="subtitle">Candles gutter before the reliquary. The old priest looks up from his book of names.</p>
    <p>"The dead we can bury with honor. The living we can still mend. Which brings you?"</p>
    <div class="modal-row"><span class="mr-name">Healing rites</span><span class="mr-detail">party healed to full</span><span class="mr-detail">${town.PRICES.templeHeal} gp</span><button class="modal-btn" id="m-heal">Pray</button></div>
    <div class="modal-row"><span class="mr-name">Blessing of the flame</span><span class="mr-detail">+1 attacks until after your next battle</span><span class="mr-detail">${town.PRICES.templeBless} gp</span><button class="modal-btn" id="m-bless">Pray</button></div>
    ${G.graveyard.length ? `<h2>The Book of Names</h2>${G.graveyard.map(p => `<div class="modal-row"><span class="mr-name">${p.name} the ${p.ancestry} ${p.cls}</span><span class="mr-detail">Lv ${p.level} — ${p.epitaph ?? 'lost'}</span></div>`).join('')}` : ''}
  `);
  $('m-close').onclick = closeModal;
  $('m-heal').onclick = () => { town.templeHeal(); closeModal(); };
  $('m-bless').onclick = () => { town.templeBless(); closeModal(); };
}

function showTavern() {
  const rows = G.recruits.map((r, i) => `
    <div class="modal-row">
      <span class="mr-name">${r.name} the ${r.ancestry} ${r.cls}</span>
      <span class="mr-detail">Lv ${r.level} · HP ${r.maxHp} · AC ${armorClass(r)}</span>
      <button class="modal-btn" data-hire="${i}">Hire (${town.PRICES.hire}g)</button>
    </div>`).join('') || '<p style="color:#6a512f">The tavern is empty tonight, save for the regulars and their regrets.</p>';
  openModal(`
    <button class="modal-btn modal-close" id="m-close">✕ Close</button>
    <h1>The Gutted Candle</h1>
    <p class="subtitle">Sellswords and torchbearers nurse their drinks, waiting for someone with coin and bad ideas.</p>
    <p>Party: ${G.party.length}/4 ${G.party.length >= 4 ? '— full company' : ''}</p>
    ${rows}
    <button class="modal-btn" id="m-rumor">Buy a round & listen for rumors (2g)</button>
  `);
  $('m-close').onclick = closeModal;
  document.querySelectorAll<HTMLButtonElement>('[data-hire]').forEach(b => {
    b.onclick = () => { town.hireRecruit(parseInt(b.dataset.hire!)); showTavern(); };
  });
  $('m-rumor').onclick = () => {
    if (G.gold < 2) return;
    G.gold -= 2;
    log(`Rumor: "${pick(RUMORS)}"`, 'info');
    closeModal();
    hooks.refresh();
  };
}

const RUMORS = [
  'The goblin king files his teeth on quarried altar-stone. Blasphemy gives him courage.',
  'There\'s an altar down in the Sunken Crypt. A real priest could cleanse it — and be glad they did.',
  'The Whispering Hollow rearranges itself. Went in twice, two different caves. Both had teeth.',
  'The miners say the Weeping Thing only wants company. The ones who kept listening are still down there.',
  'Search the walls in the old places. The builders loved their secret doors more than their gods.',
  'Vel Zaruk\'s tower has no birds on it. Even the crows know better than adventurers.',
  'When your torch dies down there, don\'t run. Running is how they know you\'re food.',
  'Wounded goblins break and run. Skeletons don\'t. Plan your fights around who can be frightened.',
];

function showBoard() {
  town.collectBounties();
  const rows = G.quests.map(q => `
    <div class="modal-row" style="align-items:flex-start">
      <div style="flex:1">
        <div class="mr-name" style="font-weight:bold">${q.paid ? '✓ ' : ''}${q.title}</div>
        <div class="mr-detail" style="margin-top:2px">${q.desc}</div>
      </div>
      <span class="mr-detail" style="white-space:nowrap">${q.paid ? 'PAID' : q.done ? 'COMPLETE!' : `${q.reward} gp`}</span>
    </div>`).join('');
  openModal(`
    <button class="modal-btn modal-close" id="m-close">✕ Close</button>
    <h1>The Notice Board</h1>
    <p class="subtitle">Nailed parchment, rain-curled and desperate.</p>
    ${rows}
  `);
  $('m-close').onclick = closeModal;
}

function showMenu() {
  openModal(`
    <button class="modal-btn modal-close" id="m-close">✕ Close</button>
    <h1>Menu</h1>
    <button class="modal-btn" id="m-save">Save Game</button>
    <button class="modal-btn" id="m-newgame">Abandon & Start New</button>
    <h2>How to Play</h2>
    <p><b>The vibe:</b> you are four fragile people with one torch, and the world does not scale to you. North is worse. Run from what you can't kill.</p>
    <p><b>Exploring:</b> arrow keys / WASD or click to move. Each step burns torch turns. When the torch dies, you are nearly blind and the dark gets bold. <b>Search</b> reveals secret doors and traps. <b>Camp</b> heals a little, but costs rations and time.</p>
    <p><b>Combat:</b> initiative order, one move + one action each turn. Click enemies to attack, use spell buttons, drag the dying away from death. Fleeing is honorable. Mostly.</p>
    <p><b>Death:</b> at 0 HP you're dying — a few rounds to be stabilized or healed, then gone. Dead is dead: bury them at the temple and hire someone braver at the tavern.</p>
    <p><b>Advancement:</b> XP comes from monsters, chests, and bounties. Spend gold in town; spend lives sparingly.</p>
  `);
  $('m-close').onclick = closeModal;
  $('m-save').onclick = () => { if (G && saveGame()) { log('Game saved.', 'system'); closeModal(); } };
  $('m-newgame').onclick = () => startNewGame();
}
