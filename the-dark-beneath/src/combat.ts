// Turn-based grid combat: initiative, move + action, spells, morale, death.
import type { Character, CombatState, Combatant, MonsterInst } from './types';
import { G, hooks, nextUid } from './state';
import { d, d20, pick, rand, randInt, roll } from './rng';
import { armorClass, attackMod, damageBonus, damageDice, statMod, grantXp, heal, mod } from './rules';
import { MONSTERS, SPELLS, LOOT, ITEMS } from './data';
import { log, logDivider, logRoll } from './log';

export const ARENA_W = 13;
export const ARENA_H = 9;
const PC_SPEED = 5;

const BOSS_FLAGS: Record<string, string> = {
  crypt_wight: 'boss_crypt',
  redtooth: 'boss_warrens',
  deep_crawler: 'boss_mine',
  vel_zaruk: 'boss_spire',
};

// ---------------------------------------------------------------- setup

export function spawnMonsters(defId: string, count: number): MonsterInst[] {
  const def = MONSTERS[defId];
  const out: MonsterInst[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ uid: nextUid(), def, hp: Math.max(1, roll(`${def.hd}d8`).total), x: 0, y: 0 });
  }
  return out;
}

export function startCombat(monsters: MonsterInst[], opts: { theme: string; surprise?: 'party' | 'monsters'; groupUid?: number; travel?: boolean }) {
  const walls = new Array<boolean>(ARENA_W * ARENA_H).fill(false);
  // scatter obstacles away from the deployment columns
  for (let i = 0; i < randInt(5, 9); i++) {
    const x = randInt(4, ARENA_W - 5), y = randInt(0, ARENA_H - 1);
    walls[y * ARENA_W + x] = true;
  }

  const order: Combatant[] = [];
  const pcs = G.party.filter(p => p.alive);
  pcs.forEach((p, i) => {
    order.push({
      kind: 'pc', pc: p,
      init: d(20) + statMod(p, 'DEX'),
      x: 1 + (i % 2), y: Math.floor(ARENA_H / 2) - 2 + i + (i > 1 ? 1 : 0),
      moves: 0,
    });
  });
  monsters.forEach((m, i) => {
    m.x = ARENA_W - 2 - (i % 2);
    m.y = 1 + Math.floor((i * (ARENA_H - 2)) / Math.max(1, monsters.length)) % (ARENA_H - 1);
    order.push({ kind: 'monster', mon: m, init: d(20) + 1, x: m.x, y: m.y, moves: 0 });
  });
  // clear deployment tiles & dedupe monster positions
  for (const c of order) {
    walls[c.y * ARENA_W + c.x] = false;
    while (order.some(o => o !== c && o.x === c.x && o.y === c.y)) {
      c.y = (c.y + 1) % ARENA_H;
    }
    if (c.mon) { c.mon.x = c.x; c.mon.y = c.y; }
  }
  order.sort((a, b) => b.init - a.init);

  G.combat = {
    w: ARENA_W, h: ARENA_H, walls, order, turn: -1, round: 1, over: false,
    theme: opts.theme, surprise: opts.surprise, groupUid: opts.groupUid, travel: opts.travel,
  };
  G.mode = 'combat';

  if (opts.surprise === 'party') log('You have the drop on them — a free round!', 'good');
  if (opts.surprise === 'monsters') log('Ambush! They were waiting for you.', 'bad');
  log(`Roll for initiative! (round 1)`, 'info');
  advanceTurn();
  hooks.refresh();
}

// ---------------------------------------------------------------- helpers

export function current(): Combatant | null {
  const cb = G.combat;
  if (!cb || cb.over) return null;
  return cb.order[cb.turn] ?? null;
}

function livingPCs(): Combatant[] {
  return G.combat!.order.filter(c => c.kind === 'pc' && c.pc!.alive);
}

function activeMonsters(): Combatant[] {
  return G.combat!.order.filter(c => c.kind === 'monster' && c.mon!.hp > 0 && !c.mon!.fled && !c.mon!.asleep);
}

function occupied(x: number, y: number): Combatant | null {
  return G.combat!.order.find(c =>
    c.x === x && c.y === y &&
    ((c.kind === 'pc' && c.pc!.alive) || (c.kind === 'monster' && c.mon!.hp > 0 && !c.mon!.fled && !c.mon!.asleep))
  ) ?? null;
}

export function blocked(x: number, y: number): boolean {
  const cb = G.combat!;
  if (x < 0 || y < 0 || x >= cb.w || y >= cb.h) return true;
  return cb.walls[y * cb.w + x];
}

function adjacent(a: Combatant, b: Combatant): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

function dist(a: Combatant, b: Combatant): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function combatLOS(x0: number, y0: number, x1: number, y1: number): boolean {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    if (!(x === x0 && y === y0) && blocked(x, y)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}

// ---------------------------------------------------------------- turn flow

export function advanceTurn() {
  const cb = G.combat;
  if (!cb || cb.over) return;
  if (checkCombatEnd()) return;

  cb.turn++;
  if (cb.turn >= cb.order.length) {
    cb.turn = 0;
    cb.round++;
    cb.surprise = undefined;
    log(`— Round ${cb.round} —`, 'system');
  }
  const c = cb.order[cb.turn];

  // skip the dead, the fled, the sleeping
  if (c.kind === 'pc' && !c.pc!.alive) return advanceTurn();
  if (c.kind === 'monster' && (c.mon!.hp <= 0 || c.mon!.fled || c.mon!.asleep)) return advanceTurn();

  // surprise round skips
  if (cb.round === 1 && cb.surprise === 'party' && c.kind === 'monster') { return advanceTurn(); }
  if (cb.round === 1 && cb.surprise === 'monsters' && c.kind === 'pc') { return advanceTurn(); }

  // dying PCs bleed out instead of acting
  if (c.kind === 'pc' && c.pc!.dyingRounds !== undefined) {
    c.pc!.dyingRounds!--;
    if (c.pc!.dyingRounds! <= 0) {
      killPC(c.pc!, 'bled out on the cold stone');
      return advanceTurn();
    }
    log(`${c.pc!.name} is dying — ${c.pc!.dyingRounds} round(s) to live. Someone help them!`, 'bad');
    return advanceTurn();
  }

  c.moves = c.kind === 'pc' ? PC_SPEED : c.mon!.def.speed;
  c.acted = false;

  if (c.kind === 'monster' && c.mon!.rooted) {
    c.mon!.rooted--;
    c.moves = 0;
    if (c.mon!.rooted === 0) log(`The ${c.mon!.def.name} tears free of the webs.`, 'info');
  }

  monsterDelay = 0; // monsters act via combatTick after a short beat
  hooks.refresh();
}

let monsterDelay = 0;

/** Called from the main animation loop; drives monster turns with a visible beat. */
export function combatTick(dtMs: number) {
  const cb = G.combat;
  if (!cb || cb.over) return;
  const c = current();
  if (!c || c.kind !== 'monster') return;
  monsterDelay += dtMs;
  if (monsterDelay < 420) return;
  monsterDelay = -10000; // guard against re-entry while acting
  monsterAct(c);
  advanceTurn();
}

// ---------------------------------------------------------------- attacks

function attackRoll(attackerName: string, targetName: string, atkMod: number, ac: number, adv?: 'adv' | 'dis') {
  const r = d20(atkMod, adv);
  const hit = !r.fumble && (r.crit || r.total >= ac);
  return { r, hit };
}

export function pcAttack(c: Combatant, target: Combatant): boolean {
  const pc = c.pc!;
  const mon = target.mon!;
  const w = pc.weapon;
  const isRanged = !!w?.ranged;
  if (!isRanged && !adjacent(c, target)) { log('Too far for a melee attack.', 'system'); return false; }
  if (isRanged && !combatLOS(c.x, c.y, target.x, target.y)) { log('No clear shot.', 'system'); return false; }
  if (c.acted) return false;

  // thief backstab: adjacent enemy also adjacent to another living PC
  const flanked = pc.cls === 'Thief' && !isRanged &&
    livingPCs().some(o => o !== c && adjacent(o, target));
  const disadv = isRanged && activeMonsters().some(m => adjacent(m, c)) ? 'dis' : undefined;
  const adv = flanked ? 'adv' : disadv;

  const { r, hit } = attackRoll(pc.name, mon.def.name, attackMod(pc), mon.def.ac, adv);
  if (hit) {
    let dmg = roll(damageDice(pc)).total + damageBonus(pc);
    if (r.crit) dmg *= 2;
    if (flanked) dmg += roll('1d4').total;
    mon.hp -= dmg;
    logRoll({
      who: pc.name, what: `${w?.name ?? 'Fists'} vs ${mon.def.name}`, roll: r, vs: mon.def.ac, vsLabel: 'AC',
      outcome: `${dmg} damage${flanked ? ' (backstab!)' : ''}${mon.hp <= 0 ? ` — the ${mon.def.name} falls!` : ''}`,
      success: true,
    });
    if (mon.hp <= 0) onMonsterDeath(target);
    else groupMoraleCheck();
  } else {
    logRoll({ who: pc.name, what: `${w?.name ?? 'Fists'} vs ${mon.def.name}`, roll: r, vs: mon.def.ac, vsLabel: 'AC', outcome: 'Miss', success: false });
  }
  c.acted = true;
  afterPCAction(c);
  return true;
}

function onMonsterDeath(target: Combatant) {
  const mon = target.mon!;
  const flag = BOSS_FLAGS[mon.def.id];
  if (flag && !G.flags[flag]) {
    G.flags[flag] = true;
    log(`★ ${mon.def.name} is destroyed! Word of this will reach Emberwick.`, 'good');
  }
  groupMoraleCheck();
}

function groupMoraleCheck() {
  const cb = G.combat!;
  const monsters = cb.order.filter(c => c.kind === 'monster');
  const alive = monsters.filter(c => c.mon!.hp > 0 && !c.mon!.fled && !c.mon!.asleep);
  if (!alive.length) return;
  const def = alive[0].mon!.def;
  if (def.morale >= 12) return;
  // check when the group first drops below half strength
  if (alive.length === Math.ceil(monsters.length / 2) && alive.length < monsters.length) {
    const r = d(6) + d(6);
    if (r > def.morale) {
      for (const c of alive) c.mon!.fled = true;
      log(`Morale breaks (2d6=${r} vs ${def.morale}) — the ${def.name}s flee into the dark!`, 'good');
    }
  }
}

// ---------------------------------------------------------------- PC actions

export function pcMove(c: Combatant, x: number, y: number): boolean {
  if (Math.abs(x - c.x) > 1 || Math.abs(y - c.y) > 1) return false;
  if (c.moves <= 0 || blocked(x, y) || occupied(x, y)) return false;
  c.x = x; c.y = y;
  c.moves--;
  hooks.refresh();
  return true;
}

export function pcWait(c: Combatant) {
  log(`${c.pc!.name} holds position.`, 'system');
  advanceTurn();
  hooks.refresh();
}

export function pcStabilize(c: Combatant, target: Combatant): boolean {
  if (c.acted || !adjacent(c, target)) return false;
  const pc = c.pc!, tgt = target.pc!;
  if (tgt.dyingRounds === undefined) return false;
  const r = d20(Math.max(statMod(pc, 'INT'), statMod(pc, 'WIS')));
  const ok = r.total >= 12 && !r.fumble;
  logRoll({ who: pc.name, what: `staunch ${tgt.name}'s wounds`, roll: r, vs: 12, outcome: ok ? 'Stabilized!' : 'Still bleeding...', success: ok });
  if (ok) { tgt.dyingRounds = undefined; tgt.hp = 1; }
  c.acted = true;
  afterPCAction(c);
  return true;
}

export function pcUsePotion(c: Combatant, itemIdx: number): boolean {
  if (c.acted) return false;
  const pc = c.pc!;
  const item = pc.gear[itemIdx];
  if (!item || item.kind !== 'potion') return false;
  const amt = roll(item.heals ?? '2d4').total;
  heal(pc, amt);
  pc.dyingRounds = undefined;
  pc.gear.splice(itemIdx, 1);
  log(`${pc.name} gulps down the ${item.name}: +${amt} HP.`, 'good');
  c.acted = true;
  afterPCAction(c);
  return true;
}

export function pcCast(c: Combatant, spellId: string, target?: Combatant, fromScroll = false): boolean {
  if (c.acted) return false;
  const pc = c.pc!;
  const sp = SPELLS[spellId];
  if (!sp) return false;
  if (!fromScroll && pc.spells[spellId] !== true) { log(`${sp.name} is spent until ${pc.name} rests.`, 'system'); return false; }

  const castStat = sp.cls === 'Wizard' ? 'INT' : 'WIS';
  const dc = 10 + sp.tier;
  const r = d20(statMod(pc, castStat as 'INT' | 'WIS') + (pc.blessed ? 1 : 0));
  const ok = !r.fumble && r.total >= dc;
  logRoll({ who: pc.name, what: `cast ${sp.name}`, roll: r, vs: dc, outcome: ok ? 'The magic takes hold!' : (r.fumble ? 'Backfire!' : 'The spell fizzles...'), success: ok });

  if (!ok) {
    if (!fromScroll) pc.spells[spellId] = false;
    if (r.fumble) {
      const dmg = roll('1d4').total;
      pc.hp -= dmg;
      log(`Wild magic scorches ${pc.name} for ${dmg}!`, 'bad');
      if (pc.hp <= 0) downPC(c);
    }
    c.acted = true;
    afterPCAction(c);
    return true;
  }

  applySpell(c, sp.id, target);
  c.acted = true;
  afterPCAction(c);
  return true;
}

function applySpell(c: Combatant, spellId: string, target?: Combatant) {
  const pc = c.pc!;
  switch (spellId) {
    case 'magic_missile': {
      if (!target?.mon) return;
      const dmg = roll('1d6+1').total;
      target.mon.hp -= dmg;
      log(`A dart of force slams into the ${target.mon.def.name}: ${dmg} damage.${target.mon.hp <= 0 ? ' It drops!' : ''}`, 'good');
      if (target.mon.hp <= 0) onMonsterDeath(target);
      break;
    }
    case 'burning_hands': {
      let hitAny = false;
      for (const m of activeMonsters()) {
        if (dist(c, m) <= 2.5) {
          const dmg = roll('1d6').total;
          m.mon!.hp -= dmg;
          hitAny = true;
          log(`Flames wash over the ${m.mon!.def.name}: ${dmg} damage.${m.mon!.hp <= 0 ? ' It burns!' : ''}`, 'good');
          if (m.mon!.hp <= 0) onMonsterDeath(m);
        }
      }
      if (!hitAny) log('Fire fans out and finds nothing but air.', 'system');
      break;
    }
    case 'sleep': {
      if (!target?.mon) return;
      if (target.mon.def.hd <= 2) {
        target.mon.asleep = true;
        log(`The ${target.mon.def.name}'s eyes roll back. It collapses, snoring.`, 'good');
      } else {
        log(`The ${target.mon.def.name} is too strong-willed for sleep.`, 'system');
      }
      break;
    }
    case 'web': {
      if (!target?.mon) return;
      target.mon.rooted = 3;
      log(`Sticky strands lash the ${target.mon.def.name} in place!`, 'good');
      break;
    }
    case 'fireball': {
      for (const m of activeMonsters()) {
        const dmg = roll('3d6').total;
        m.mon!.hp -= dmg;
        log(`The blast engulfs the ${m.mon!.def.name}: ${dmg} damage.${m.mon!.hp <= 0 ? ' Cinders.' : ''}`, 'good');
        if (m.mon!.hp <= 0) onMonsterDeath(m);
      }
      break;
    }
    case 'cure_wounds': {
      const tgt = target?.pc ?? pc;
      const amt = roll('1d6').total + pc.level;
      heal(tgt, amt);
      if (tgt.dyingRounds !== undefined) { tgt.dyingRounds = undefined; log(`${tgt.name} gasps back from the brink!`, 'good'); }
      log(`Warm light knits ${tgt.name}'s wounds: +${amt} HP.`, 'good');
      break;
    }
    case 'bless': {
      const tgt = target?.pc ?? pc;
      tgt.blessed = true;
      log(`${tgt.name} is blessed: +1 to attacks and saves.`, 'good');
      break;
    }
    case 'turn_undead': {
      let turned = 0;
      for (const m of activeMonsters()) {
        if (!m.mon!.def.undead) continue;
        if (m.mon!.def.hd > pc.level + 2) { log(`The ${m.mon!.def.name} sneers at your holy symbol.`, 'bad'); continue; }
        if (d(6) <= 4) { m.mon!.fled = true; turned++; }
      }
      log(turned ? `${turned} undead recoil from the holy light and flee!` : 'The dead do not flinch.', turned ? 'good' : 'system');
      break;
    }
    case 'holy_smite': {
      if (!target?.mon) return;
      const dmg = roll(target.mon.def.undead ? '3d6' : '2d6').total;
      target.mon.hp -= dmg;
      log(`White fire falls on the ${target.mon.def.name}: ${dmg} damage.${target.mon.hp <= 0 ? ' It is unmade.' : ''}`, 'good');
      if (target.mon.hp <= 0) onMonsterDeath(target);
      break;
    }
    case 'heal': {
      const tgt = target?.pc ?? pc;
      tgt.hp = tgt.maxHp;
      tgt.dyingRounds = undefined;
      log(`${tgt.name} is made whole.`, 'good');
      break;
    }
  }
}

function afterPCAction(c: Combatant) {
  if (checkCombatEnd()) { hooks.refresh(); return; }
  if (c.acted && c.moves <= 0) advanceTurn();
  hooks.refresh();
}

export function endTurn() {
  const c = current();
  if (c?.kind === 'pc') advanceTurn();
  hooks.refresh();
}

// ---------------------------------------------------------------- fleeing

export function partyFlee() {
  const cb = G.combat;
  if (!cb) return;
  log('You break and run for it!', 'bad');
  for (const c of livingPCs()) {
    const near = activeMonsters().find(m => adjacent(m, c));
    if (near) {
      const r = d20(statMod(c.pc!, 'DEX'));
      const ok = r.total >= 12;
      logRoll({ who: c.pc!.name, what: 'slip away', roll: r, vs: 12, outcome: ok ? 'Away clean' : 'Takes a parting blow!', success: ok });
      if (!ok) {
        const dmg = roll(near.mon!.def.dmg).total;
        c.pc!.hp -= dmg;
        log(`${c.pc!.name} takes ${dmg} damage fleeing.`, 'bad');
        if (c.pc!.hp <= 0) { killPC(c.pc!, 'cut down while fleeing'); }
      }
    }
  }
  finishCombat(false);
}

// ---------------------------------------------------------------- monster AI

function monsterAct(c: Combatant) {
  const mon = c.mon!;
  const targets = livingPCs().filter(p => p.pc!.dyingRounds === undefined);
  const anyTarget = targets.length ? targets : livingPCs();
  if (!anyTarget.length) return;

  const nearest = anyTarget.reduce((a, b) => (dist(c, a) <= dist(c, b) ? a : b));

  if (mon.def.ranged && dist(c, nearest) > 1.6 && combatLOS(c.x, c.y, nearest.x, nearest.y)) {
    monsterAttack(c, nearest);
    return;
  }

  // close the distance (BFS one shortest path step)
  let steps = c.moves;
  while (steps > 0 && !adjacent(c, nearest)) {
    const next = bfsStep(c, nearest);
    if (!next) break;
    c.x = next[0]; c.y = next[1];
    mon.x = c.x; mon.y = c.y;
    steps--;
  }
  if (adjacent(c, nearest)) monsterAttack(c, nearest);
}

function bfsStep(c: Combatant, target: Combatant): [number, number] | null {
  const cb = G.combat!;
  const key = (x: number, y: number) => y * cb.w + x;
  const prev = new Int32Array(cb.w * cb.h).fill(-2);
  const q: [number, number][] = [[c.x, c.y]];
  prev[key(c.x, c.y)] = -1;
  while (q.length) {
    const [x, y] = q.shift()!;
    if (Math.abs(x - target.x) <= 1 && Math.abs(y - target.y) <= 1 && !(x === c.x && y === c.y)) {
      // walk back to the first step
      let cur = key(x, y);
      while (prev[cur] !== -1 && prev[prev[cur]] !== -1) cur = prev[cur];
      return [cur % cb.w, Math.floor(cur / cb.w)];
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cb.w || ny >= cb.h) continue;
      if (prev[key(nx, ny)] !== -2) continue;
      if (blocked(nx, ny) || occupied(nx, ny)) continue;
      prev[key(nx, ny)] = key(x, y);
      q.push([nx, ny]);
    }
  }
  return null;
}

function monsterAttack(c: Combatant, target: Combatant) {
  const mon = c.mon!;
  const pc = target.pc!;
  const ac = armorClass(pc);
  const r = d20(mon.def.atk);
  const hit = !r.fumble && (r.crit || r.total >= ac);
  if (hit) {
    let dmg = roll(mon.def.dmg).total;
    if (r.crit) dmg *= 2;
    pc.hp -= dmg;
    logRoll({ who: mon.def.name, what: `attacks ${pc.name}`, roll: r, vs: ac, vsLabel: 'AC', outcome: `${dmg} damage`, success: true });
    if (pc.hp <= 0) downPC(target);
  } else {
    logRoll({ who: mon.def.name, what: `attacks ${pc.name}`, roll: r, vs: ac, vsLabel: 'AC', outcome: 'Miss', success: false });
  }
}

// ---------------------------------------------------------------- death & endings

function downPC(c: Combatant) {
  const pc = c.pc!;
  pc.hp = 0;
  if (pc.dyingRounds !== undefined) return;
  const timer = Math.max(1, d(4) + mod(pc.stats.CON));
  pc.dyingRounds = timer;
  log(`${pc.name} goes down! Dying — ${timer} round(s) before the dark claims them.`, 'bad');
  checkCombatEnd();
}

function killPC(pc: Character, epitaph: string) {
  pc.alive = false;
  pc.hp = 0;
  pc.dyingRounds = undefined;
  pc.epitaph = epitaph;
  G.graveyard.push(pc);
  G.party = G.party.filter(p => p !== pc);
  log(`☠ ${pc.name} is dead. ${pick(['The torch passes to another.', 'Their name goes in the book of the town chapel.', 'The dark takes its due.'])}`, 'bad');
}

function checkCombatEnd(): boolean {
  const cb = G.combat;
  if (!cb || cb.over) return true;
  const monstersLeft = activeMonsters().length > 0;
  const pcsUp = livingPCs().some(c => c.pc!.dyingRounds === undefined);

  if (!monstersLeft) { finishCombat(true); return true; }
  if (!livingPCs().length) { partyWipe(); return true; }
  if (!pcsUp) {
    // everyone is down and dying: the monsters finish the job
    for (const c of livingPCs()) killPC(c.pc!, 'dragged into the dark');
    partyWipe();
    return true;
  }
  return false;
}

function partyWipe() {
  const cb = G.combat!;
  cb.over = true;
  G.combat = null;
  G.mode = 'gameover';
  logDivider('THE LIGHT GOES OUT');
  log('No one is left to carry the torch. The dark beneath keeps its secrets a while longer.', 'bad');
  hooks.refresh();
}

function finishCombat(victory: boolean) {
  const cb = G.combat!;
  cb.over = true;

  if (victory) {
    const slain = cb.order.filter(c => c.kind === 'monster' && (c.mon!.hp <= 0 || c.mon!.asleep));
    const fled = cb.order.filter(c => c.kind === 'monster' && c.mon!.fled);
    const xp = slain.reduce((a, c) => a + c.mon!.def.xp, 0) + Math.floor(fled.reduce((a, c) => a + c.mon!.def.xp, 0) / 2);
    logDivider('VICTORY');
    if (xp) grantXp(G.party, xp);

    // pocket change + boss treasure
    const tier = G.dungeon?.tier ?? 1;
    const boss = slain.find(c => BOSS_FLAGS[c.mon!.def.id]);
    if (slain.length) {
      const gold = Math.max(1, Math.floor(roll(LOOT[tier].gold).total / 2));
      G.gold += gold;
      log(`You search the bodies: ${gold} gp.`, 'loot');
    }
    if (boss) {
      const treasureId = tier >= 3 ? 't_crown' : tier === 2 ? 't_idol' : 't_chalice';
      const item = ITEMS[treasureId];
      const carrier = G.party.find(p => p.alive);
      if (carrier) { carrier.gear.push({ ...item }); log(`Among the remains: ${item.name}!`, 'loot'); }
    }
    // clear the dungeon group
    if (cb.groupUid !== undefined && G.dungeon) {
      const g = G.dungeon.groups.find(g => g.uid === cb.groupUid);
      if (g) g.dead = true;
    }
  } else if (cb.groupUid !== undefined && G.dungeon) {
    // survivors regroup where they stood
    const g = G.dungeon.groups.find(g => g.uid === cb.groupUid);
    if (g) {
      const left = cb.order.filter(c => c.kind === 'monster' && c.mon!.hp > 0 && !c.mon!.fled).length;
      if (left <= 0) g.dead = true;
      else g.count = left;
    }
  }

  // clear per-fight statuses
  for (const p of G.party) { p.blessed = false; if (p.dyingRounds !== undefined && p.alive) { p.dyingRounds = undefined; p.hp = 1; log(`${p.name} is dragged back to their feet, barely breathing.`, 'info'); } }

  G.combat = null;
  G.mode = G.dungeon ? 'dungeon' : cb.travel ? 'overworld' : G.location === 'emberwick' ? 'town' : 'overworld';
  hooks.refresh();
}
