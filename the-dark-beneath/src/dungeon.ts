// Dungeon exploration: map parsing, procgen caves, fog of war, torchlight,
// doors, traps, secrets, loot, and monster proximity.
import type { DungeonState, Tile, TileType, DungeonMonsterGroup, Character } from './types';
import { DUNGEONS, MONSTERS, LOOT, ITEMS, ENCOUNTERS, WORLD } from './data';
import { G, hooks, nextUid } from './state';
import { d, pick, rand, randInt, roll } from './rng';
import { check, DC, heal, gearSlots, slotsUsed, grantXp } from './rules';
import { log, logDivider } from './log';
import { startCombat, spawnMonsters } from './combat';

export const TORCH_TURNS = 60;

// ---------------------------------------------------------------- build

const CHAR_TILE: Record<string, TileType> = {
  '#': 'wall', '.': 'floor', '+': 'door', 'L': 'locked', 'S': 'secret',
  '<': 'exit', '>': 'stairs', 'C': 'chest', 'T': 'trap', 'B': 'brazier',
  'A': 'altar', '~': 'water', '%': 'rubble', ' ': 'wall',
};

export function enterDungeon(nodeId: string) {
  const saved = G.dungeonSaves[nodeId];
  if (saved) {
    G.dungeon = saved;
    // re-enter at the entrance
    const idx = saved.tiles.findIndex(t => t.t === 'exit');
    saved.px = idx % saved.w;
    saved.py = Math.floor(idx / saved.w);
    G.mode = 'dungeon';
    logDivider(saved.name);
    log('You descend once more into the dark. It remembers you.', 'gm');
  } else {
    const dun = buildDungeon(nodeId);
    G.dungeon = dun;
    G.mode = 'dungeon';
    logDivider(dun.name);
    const def = DUNGEONS[WORLD[nodeId]?.dungeonId ?? ''];
    log(def ? def.intro : 'Cold air breathes up from below, smelling of wet stone and something older.', 'gm');
  }
  lightTorchIfNeeded();
  revealAround();
  hooks.refresh();
}

function buildDungeon(nodeId: string): DungeonState {
  const wnode = WORLD[nodeId];
  if (wnode?.dungeonId) return buildAuthored(nodeId, wnode.dungeonId);
  return buildCave(nodeId, wnode?.tier ?? 1, wnode?.name ?? 'The Cave');
}

function buildAuthored(nodeId: string, key: string): DungeonState {
  const def = DUNGEONS[key];
  const h = def.map.length;
  const w = def.map[0].length;
  const tiles: Tile[] = [];
  const groups: DungeonMonsterGroup[] = [];
  let px = 1, py = 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = def.map[y][x];
      if (/[1-9]/.test(ch)) {
        const g = def.groups[ch];
        groups.push({
          uid: nextUid(), defId: g.defId,
          count: typeof g.count === 'string' && g.count.includes('d') ? roll(g.count).total : parseInt(String(g.count)),
          x, y, boss: g.boss,
        });
        tiles.push({ t: 'floor', seen: false });
      } else {
        const t = CHAR_TILE[ch] ?? 'floor';
        tiles.push({ t, seen: false, open: false, found: t !== 'secret' && t !== 'trap' });
        if (ch === '<') { px = x; py = y; }
      }
    }
  }

  const dun: DungeonState = {
    id: nodeId, name: def.name, w, h, tiles, px, py, groups,
    level: 1, tier: def.tier, theme: def.theme, notes: { ...(def.notes ?? {}) },
  };
  if (!def.map.some(r => r.includes('<'))) throw new Error(`dungeon ${key} has no entrance`);
  G.dungeonSaves[nodeId] = dun;
  return dun;
}

// Cellular-automata cave. Regenerates on every visit.
function buildCave(nodeId: string, tier: number, name: string): DungeonState {
  const w = 30, h = 18;
  let cells: boolean[] = []; // true = wall
  for (let i = 0; i < w * h; i++) cells.push(rand() < 0.44);
  for (let it = 0; it < 4; it++) {
    const next = cells.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || cells[ny * w + nx]) walls++;
      }
      next[y * w + x] = y === 0 || x === 0 || y === h - 1 || x === w - 1 ? true : walls >= 5 ? true : walls <= 3 ? false : cells[y * w + x];
    }
    cells = next;
  }
  // keep the largest open region
  const region = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, rid = 0;
  for (let i = 0; i < w * h; i++) {
    if (cells[i] || region[i] >= 0) continue;
    let size = 0;
    const q = [i];
    region[i] = rid;
    while (q.length) {
      const j = q.pop()!;
      size++;
      const jx = j % w, jy = Math.floor(j / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (!cells[k] && region[k] < 0) { region[k] = rid; q.push(k); }
      }
    }
    if (size > bestSize) { bestSize = size; best = rid; }
    rid++;
  }
  for (let i = 0; i < w * h; i++) if (!cells[i] && region[i] !== best) cells[i] = true;

  const tiles: Tile[] = cells.map(wall => ({ t: wall ? 'wall' : 'floor', seen: false, found: true } as Tile));
  const open: number[] = [];
  for (let i = 0; i < w * h; i++) if (!cells[i]) open.push(i);

  // entrance: lowest open tile
  const entrance = open.reduce((a, b) => (Math.floor(b / w) > Math.floor(a / w) ? b : a));
  tiles[entrance] = { t: 'exit', seen: false, found: true };
  const px = entrance % w, py = Math.floor(entrance / w);

  const farOpen = open.filter(i => {
    const dx = (i % w) - px, dy = Math.floor(i / w) - py;
    return dx * dx + dy * dy > 25;
  });

  const groups: DungeonMonsterGroup[] = [];
  const table = ENCOUNTERS[tier] ?? ENCOUNTERS[1];
  const nGroups = randInt(3, 5);
  for (let i = 0; i < nGroups; i++) {
    const spot = pick(farOpen);
    const e = pick(table);
    groups.push({ uid: nextUid(), defId: e.defId, count: roll(e.count.includes('d') ? e.count : `1d1+${parseInt(e.count) - 1}`).total, x: spot % w, y: Math.floor(spot / w) });
  }
  for (let i = 0; i < randInt(2, 4); i++) {
    const spot = pick(farOpen);
    tiles[spot] = { t: 'chest', seen: false, found: true };
  }
  for (let i = 0; i < randInt(1, 2); i++) {
    const spot = pick(farOpen);
    if (tiles[spot].t === 'floor') tiles[spot] = { t: 'trap', seen: false, found: false };
  }

  return {
    id: nodeId, name, w, h, tiles, px, py, groups,
    level: 1, tier, theme: 'cave', notes: {},
  };
}

// ---------------------------------------------------------------- light & vision

export function lightTorchIfNeeded() {
  if (!G.torchLit && G.torches > 0) {
    G.torches--;
    G.torchLit = true;
    G.torchLeft = TORCH_TURNS;
    log('You strike flint. A torch flares to life, pushing the dark back a few precious feet.', 'info');
  }
}

export function lightRadius(): number {
  if (G.torchLit) return 4;
  return G.party.some(p => p.alive && p.ancestry === 'Goblin') ? 1.5 : 0.8;
}

function tileAt(x: number, y: number): Tile | null {
  const dn = G.dungeon!;
  if (x < 0 || y < 0 || x >= dn.w || y >= dn.h) return null;
  return dn.tiles[y * dn.w + x];
}

function opaque(x: number, y: number): boolean {
  const t = tileAt(x, y);
  if (!t) return true;
  if (t.t === 'wall') return true;
  if ((t.t === 'door' || t.t === 'locked') && !t.open) return true;
  if (t.t === 'secret' && !t.open) return true;
  return false;
}

export function lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    if (!(x === x0 && y === y0) && opaque(x, y)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}

/** Returns light level 0..1 per tile index for rendering, and marks seen. */
export function computeVisibility(): Float32Array {
  const dn = G.dungeon!;
  const lum = new Float32Array(dn.w * dn.h);
  const sources: { x: number; y: number; r: number }[] = [{ x: dn.px, y: dn.py, r: lightRadius() }];
  for (let i = 0; i < dn.tiles.length; i++) {
    if (dn.tiles[i].t === 'brazier') sources.push({ x: i % dn.w, y: Math.floor(i / dn.w), r: 3 });
  }
  for (const s of sources) {
    const R = Math.ceil(s.r);
    for (let y = s.y - R; y <= s.y + R; y++) for (let x = s.x - R; x <= s.x + R; x++) {
      const t = tileAt(x, y);
      if (!t) continue;
      const dist = Math.hypot(x - s.x, y - s.y);
      if (dist > s.r + 0.5) continue;
      if (!lineOfSight(s.x, s.y, x, y) && !(x === s.x && y === s.y)) continue;
      const v = Math.max(0, 1 - dist / (s.r + 0.5));
      const i = y * dn.w + x;
      lum[i] = Math.max(lum[i], v);
    }
  }
  return lum;
}

export function revealAround() {
  const dn = G.dungeon!;
  const lum = computeVisibility();
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] > 0.05) dn.tiles[i].seen = true;
  }
}

// ---------------------------------------------------------------- turn cost & hazards

function tickTurn(count = 1) {
  for (let i = 0; i < count; i++) {
    if (G.torchLit) {
      G.torchLeft--;
      if (G.torchLeft === 20) log('Your torch gutters — it won\'t last much longer.', 'bad');
      if (G.torchLeft <= 0) {
        G.torchLit = false;
        log('Your torch dies. The dark rushes in like water.', 'bad');
        lightTorchIfNeeded();
        if (!G.torchLit) log('You have no torches left. You can barely see your own hands.', 'bad');
      }
    }
    // wandering monsters — more likely in the dark
    const chance = G.torchLit ? 40 : 14;
    if (randInt(1, chance) === 1) {
      wanderingMonsters();
      return;
    }
  }
}

function wanderingMonsters() {
  const dn = G.dungeon!;
  const table = ENCOUNTERS[dn.tier] ?? ENCOUNTERS[1];
  const e = pick(table);
  const n = roll(e.count.includes('d') ? e.count : `1d1+${parseInt(e.count) - 1}`).total;
  log('Something has been following your light...', 'bad');
  startCombat(spawnMonsters(e.defId, n), { theme: dn.theme, surprise: G.torchLit ? undefined : 'monsters' });
}

// ---------------------------------------------------------------- movement & interaction

/** Try to step the party by (dx,dy). Returns true if a turn passed. */
export function step(dx: number, dy: number): boolean {
  const dn = G.dungeon;
  if (!dn || G.mode !== 'dungeon') return false;
  const nx = dn.px + dx, ny = dn.py + dy;
  const t = tileAt(nx, ny);
  if (!t) return false;

  switch (t.t) {
    case 'wall':
      return false;
    case 'secret':
      if (!t.found) return false;
      if (!t.open) { t.open = true; log('The secret door swings inward on silent hinges.', 'info'); afterTurn(); return true; }
      break;
    case 'door':
      if (!t.open) { t.open = true; log('The door creaks open.', 'gm'); afterTurn(); return true; }
      break;
    case 'locked':
      if (!t.open) { attemptLock(t); afterTurn(); return true; }
      break;
    case 'water':
      // wading is slow and loud
      break;
    case 'rubble':
      break;
  }

  dn.px = nx; dn.py = ny;

  // arrival effects
  if (t.t === 'trap' && !t.found && !t.looted) springTrap(t);
  if (t.t === 'chest' && !t.looted) openChest(t);
  if (t.t === 'altar' && !t.looted) touchAltar(t);
  if (t.t === 'exit') { offerExit(); }

  const note = dn.notes[`${nx},${ny}`];
  if (note) { log(note, 'gm'); delete dn.notes[`${nx},${ny}`]; }

  thiefPassiveTrapSense();
  afterTurn();
  return true;
}

function afterTurn() {
  tickTurn();
  if (G.mode !== 'dungeon') { hooks.refresh(); return; } // combat interrupted us
  revealAround();
  monstersAct();
  hooks.refresh();
}

function attemptLock(t: Tile) {
  const thief = G.party.find(p => p.alive && p.cls === 'Thief');
  const strongest = G.party.filter(p => p.alive).sort((a, b) => b.stats.STR - a.stats.STR)[0];
  if (!strongest) return;
  const hasCrowbar = G.party.some(p => p.alive && p.gear.some(g => g.id === 'crowbar'));
  if (thief && check(thief, 'DEX', DC.normal, 'pick the lock')) {
    t.open = true;
    log('The lock clicks open under nimble fingers.', 'good');
  } else if (check(strongest, 'STR', DC.normal, 'force the door', hasCrowbar ? 'adv' : undefined)) {
    t.open = true;
    log('The door bursts open with a crack that echoes much too far.', 'good');
  } else {
    log('The door holds. Somewhere in the dark, something heard that.', 'bad');
  }
}

function springTrap(t: Tile) {
  t.looted = true; t.found = true;
  const victims = G.party.filter(p => p.alive);
  if (!victims.length) return;
  const v = victims[0]; // front of the marching order
  const dn = G.dungeon!;
  const dmg = roll(dn.tier >= 2 ? '2d6' : '1d6').total;
  if (check(v, 'DEX', DC.normal, 'dodge the trap')) {
    log(`${v.name} leaps aside as ${pick(['darts hiss from the wall', 'the floor drops away', 'a scything blade sweeps past'])}!`, 'good');
  } else {
    v.hp -= dmg;
    log(`A trap! ${v.name} takes ${dmg} damage.`, 'bad');
    checkDeath(v, 'killed by a trap');
  }
}

function thiefPassiveTrapSense() {
  const dn = G.dungeon!;
  const thief = G.party.find(p => p.alive && p.cls === 'Thief');
  if (!thief) return;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const t = tileAt(dn.px + dx, dn.py + dy);
    if (t && t.t === 'trap' && !t.found && !t.looted && rand() < 0.5) {
      t.found = true;
      log(`${thief.name} freezes, hand raised — a trap, right there in the floor.`, 'info');
    }
  }
}

function openChest(t: Tile) {
  t.looted = true;
  const dn = G.dungeon!;
  const table = LOOT[dn.tier] ?? LOOT[1];
  const gold = roll(table.gold).total;
  G.gold += gold;
  const found: string[] = [`${gold} gp`];
  for (const [id, chance] of table.items) {
    if (rand() < chance) {
      const item = ITEMS[id];
      const carrier = G.party.find(p => p.alive && slotsUsed(p) + item.slots <= gearSlots(p));
      if (id === 'torch') { G.torches++; found.push('a torch'); }
      else if (carrier) { carrier.gear.push({ ...item }); found.push(item.name); }
    }
  }
  log(`You pry open the chest: ${found.join(', ')}.`, 'loot');
  grantXp(G.party, dn.tier * 3);
}

function touchAltar(t: Tile) {
  t.looted = true;
  const priest = G.party.find(p => p.alive && p.cls === 'Priest');
  if (priest) {
    log(`${priest.name} scrapes the grave-soil from the altar and speaks the old rites. Warm light washes over you.`, 'good');
    for (const p of G.party) if (p.alive) { heal(p, roll('1d6').total + 2); p.blessed = true; }
    log('The party is healed and blessed (+1 to attacks until you next leave a fight).', 'good');
  } else {
    log('The defiled altar radiates a cold sorrow. Without a priest, you can only bow your heads and move on.', 'gm');
  }
}

let exitOffered = false;
function offerExit() {
  exitOffered = true;
  log('The way out is here. Use "Leave" when you\'re ready to return to the surface.', 'info');
}

export function canLeave(): boolean {
  const dn = G.dungeon;
  if (!dn) return false;
  return tileAt(dn.px, dn.py)?.t === 'exit';
}

export function leaveDungeon() {
  const dn = G.dungeon;
  if (!dn) return;
  exitOffered = false;
  // caves regenerate; authored dungeons persist
  if (!WORLD[dn.id]?.dungeonId) delete G.dungeonSaves[dn.id];
  G.dungeon = null;
  G.mode = 'overworld';
  G.torchLit = false; G.torchLeft = 0;
  log('You climb back into daylight. It feels thinner than you remembered, but it is daylight.', 'gm');
  hooks.refresh();
}

// ---------------------------------------------------------------- actions

export function searchAction() {
  if (G.mode !== 'dungeon') return;
  const dn = G.dungeon!;
  const searcher = G.party.filter(p => p.alive).sort((a, b) => b.stats.WIS - a.stats.WIS)[0];
  if (!searcher) return;
  const adv = searcher.ancestry === 'Elf' ? 'adv' : undefined;
  const ok = check(searcher, 'WIS', DC.normal, 'search the area', adv);
  let foundAny = false;
  if (ok) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = tileAt(dn.px + dx, dn.py + dy);
      if (!t || t.found) continue;
      if (t.t === 'secret') { t.found = true; t.seen = true; foundAny = true; log('Cold air whistles through a hairline seam — a secret door!', 'good'); }
      if (t.t === 'trap' && !t.looted) { t.found = true; foundAny = true; log('A tripwire, nearly invisible in the dust. Found it.', 'good'); }
    }
  }
  if (!foundAny) log(ok ? 'You find nothing but dust and old dread.' : 'You see nothing. The dark stares back.', 'gm');
  tickTurn(3);
  if (G.mode === 'dungeon') { revealAround(); monstersAct(); }
  hooks.refresh();
}

export function campAction() {
  if (G.mode !== 'dungeon') return;
  if (G.rations < G.party.filter(p => p.alive).length) {
    log('Not enough rations to make camp.', 'bad');
    return;
  }
  G.rations -= G.party.filter(p => p.alive).length;
  log('You risk a cold camp, chewing rations in a defensible corner while one of you watches the dark.', 'gm');
  tickTurn(10);
  if (G.mode !== 'dungeon') { hooks.refresh(); return; } // ambushed!
  for (const p of G.party) if (p.alive) heal(p, roll('1d4').total);
  log('A short rest. Everyone recovers a little strength (1d4 HP).', 'good');
  revealAround();
  hooks.refresh();
}

// ---------------------------------------------------------------- monsters

function monstersAct() {
  const dn = G.dungeon!;
  const lum = computeVisibility();
  for (const g of dn.groups) {
    if (g.dead) continue;
    const dist = Math.hypot(g.x - dn.px, g.y - dn.py);
    const litUp = lum[g.y * dn.w + g.x] > 0.05 && lineOfSight(g.x, g.y, dn.px, dn.py);

    if (!g.alerted && litUp && dist <= 7) {
      g.alerted = true;
      const def = MONSTERS[g.defId];
      const who = g.count > 1 ? `${g.count} ${def.name}s catch` : `${def.name} catches`;
      log(`${who} sight of your torchlight!`, 'bad');
    }

    if (g.alerted) {
      // chase: one greedy step toward the party
      const sx = Math.sign(dn.px - g.x), sy = Math.sign(dn.py - g.y);
      const options = [[g.x + sx, g.y], [g.x, g.y + sy], [g.x + sx, g.y + sy]];
      for (const [nx, ny] of options) {
        const t = tileAt(nx, ny);
        if (t && !opaque(nx, ny) && t.t !== 'trap') { g.x = nx; g.y = ny; break; }
      }
      if (Math.hypot(g.x - dn.px, g.y - dn.py) <= 1.5) {
        engageGroup(g, false);
        return;
      }
    } else if (dist <= 1.5) {
      // stumbled into them unawares — you get the drop
      engageGroup(g, true);
      return;
    }
  }
}

export function engageGroup(g: DungeonMonsterGroup, partySurprise: boolean) {
  const dn = G.dungeon!;
  const def = MONSTERS[g.defId];
  logDivider('COMBAT');
  log(g.boss ? `${def.name}. ${def.desc}` : `${g.count} × ${def.name}. ${def.desc}`, 'bad');
  startCombat(spawnMonsters(g.defId, g.count), {
    theme: dn.theme,
    surprise: partySurprise ? 'party' : undefined,
    groupUid: g.uid,
  });
}

export function checkDeath(c: Character, epitaph: string) {
  if (c.hp <= 0) {
    c.hp = 0;
    c.alive = false;
    c.epitaph = epitaph;
    G.graveyard.push(c);
    G.party = G.party.filter(p => p !== c);
    log(`☠ ${c.name} is dead. ${pick(['The dark takes its due.', 'Light a candle in Emberwick.', 'They will not see the sun again.'])}`, 'bad');
    if (!G.party.some(p => p.alive)) {
      G.mode = 'gameover';
    }
  }
}
