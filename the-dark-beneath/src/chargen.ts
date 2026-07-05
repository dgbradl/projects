// Character generation: build the company of four, one companion at a time.
// Honest 3d6 rolls (reroll as your conscience allows), ancestry, class, name.
import type { Character, ClassName, Stat } from './types';
import { STATS } from './types';
import { ANCESTRIES, NAMES, SPELLS } from './data';
import { rollStatBlock, makeCharacter, bestClass, primeStat, mod, generateCharacter, armorClass } from './rules';
import { newGame, saveGame, hooks, G } from './state';
import { openModal, closeModal, showTitleScreen } from './modal';
import { log, logDivider } from './log';
import { sfx, setAmbience } from './sound';
import { pick } from './rng';

const CLASS_BLURBS: Record<ClassName, string> = {
  Fighter: 'd8 hit die, heavy armor, +1 damage. The wall between the party and the dark.',
  Thief: 'd4 hit die. Picks locks, senses traps, and backstabs anything an ally distracts.',
  Priest: 'd6 hit die. Prayers that close wounds and scatter the restless dead.',
  Wizard: 'd4 hit die, no armor. Spells that end fights — when they take hold.',
};

const SPELL_CHOICES: Partial<Record<ClassName, string[]>> = {
  Priest: ['bless', 'turn_undead'],
  Wizard: ['burning_hands', 'sleep'],
};

interface Draft {
  stats: Record<Stat, number>;
  ancestry: Character['ancestry'];
  cls: ClassName;
  name: string;
  spellChoice?: string;
}

let built: Character[] = [];
let draft: Draft;

function freshDraft(): Draft {
  const stats = rollStatBlock();
  const cls = bestClass(stats);
  const ancestry = pick(ANCESTRIES).name;
  return { stats, cls, ancestry, name: pick(NAMES[ancestry]), spellChoice: SPELL_CHOICES[cls]?.[0] };
}

export function openChargen() {
  built = [];
  draft = freshDraft();
  renderChargen();
}

// ---------------------------------------------------------------- render

function statCells(stats: Record<Stat, number>): string {
  return STATS.map(s => {
    const m = mod(stats[s]);
    const prime = s === primeStat(draft.cls);
    return `<div class="sheet-stat${prime ? ' cg-prime' : ''}">
      <div class="ss-label">${s}</div>
      <div class="ss-val">${stats[s]}</div>
      <div class="ss-mod">${m >= 0 ? '+' : ''}${m}</div>
    </div>`;
  }).join('');
}

function renderChargen() {
  const n = built.length + 1;
  const suggested = bestClass(draft.stats);

  const ancestryRows = ANCESTRIES.map(a => `
    <label class="cg-option ${draft.ancestry === a.name ? 'cg-selected' : ''}">
      <input type="radio" name="cg-anc" value="${a.name}" ${draft.ancestry === a.name ? 'checked' : ''}>
      <b>${a.name}</b> — <span>${a.perk}</span>
    </label>`).join('');

  const classRows = (['Fighter', 'Thief', 'Priest', 'Wizard'] as ClassName[]).map(c => `
    <label class="cg-option ${draft.cls === c ? 'cg-selected' : ''}">
      <input type="radio" name="cg-cls" value="${c}" ${draft.cls === c ? 'checked' : ''}>
      <b>${c}</b>${c === suggested ? ' <span class="cg-badge">the dice favor this</span>' : ''} — <span>${CLASS_BLURBS[c]}</span>
    </label>`).join('');

  const spellOpts = SPELL_CHOICES[draft.cls];
  const spellRow = spellOpts ? `
    <h2>Second Spell <span class="cg-note">(${draft.cls === 'Priest' ? 'Cure Wounds' : 'Magic Missile'} is already known)</span></h2>
    ${spellOpts.map(id => `
      <label class="cg-option ${draft.spellChoice === id ? 'cg-selected' : ''}">
        <input type="radio" name="cg-spell" value="${id}" ${draft.spellChoice === id ? 'checked' : ''}>
        <b>${SPELLS[id].name}</b> — <span>${SPELLS[id].desc}</span>
      </label>`).join('')}` : '';

  const rosterLine = built.length
    ? `<p class="cg-roster">Sworn so far: ${built.map(b => `${b.name} the ${b.ancestry} ${b.cls}`).join(' · ')}</p>`
    : '';

  openModal(`
    <h1>Companion ${n} of 4</h1>
    <p class="subtitle">The chronicler readies a fresh page. Who steps up to the lantern?</p>
    ${rosterLine}
    <h2>Abilities (3d6, as the dice fall) <button class="modal-btn cg-small" id="cg-reroll">🎲 Reroll</button></h2>
    <div class="sheet-stats">${statCells(draft.stats)}</div>
    <h2>Ancestry</h2>
    ${ancestryRows}
    <h2>Class</h2>
    ${classRows}
    ${spellRow}
    <h2>Name</h2>
    <p><input type="text" id="cg-name" maxlength="16" value="${draft.name}">
    <button class="modal-btn cg-small" id="cg-rename">🎲</button></p>
    <div style="margin-top:16px">
      <button class="modal-btn" id="cg-next" style="font-size:16px">${n < 4 ? '⚔ Swear them in — next companion' : '🔥 Muster the Company'}</button>
      <button class="modal-btn" id="cg-quick">Quick Start (fate picks the rest)</button>
      <button class="modal-btn" id="cg-cancel">Cancel</button>
    </div>
  `);

  const $ = (id: string) => document.getElementById(id)!;

  $('cg-reroll').onclick = () => {
    draft.stats = rollStatBlock();
    sfx('dice');
    renderChargen();
  };
  $('cg-rename').onclick = () => {
    draft.name = pick(NAMES[draft.ancestry]);
    sfx('dice');
    renderChargen();
  };
  document.querySelectorAll<HTMLInputElement>('input[name="cg-anc"]').forEach(r => {
    r.onchange = () => {
      draft.ancestry = r.value as Character['ancestry'];
      draft.name = pick(NAMES[draft.ancestry]);
      renderChargen();
    };
  });
  document.querySelectorAll<HTMLInputElement>('input[name="cg-cls"]').forEach(r => {
    r.onchange = () => {
      draft.cls = r.value as ClassName;
      draft.spellChoice = SPELL_CHOICES[draft.cls]?.[0];
      renderChargen();
    };
  });
  document.querySelectorAll<HTMLInputElement>('input[name="cg-spell"]').forEach(r => {
    r.onchange = () => { draft.spellChoice = r.value; };
  });
  ($('cg-name') as HTMLInputElement).oninput = e => {
    draft.name = (e.target as HTMLInputElement).value;
  };

  $('cg-next').onclick = () => {
    commitDraft();
    if (built.length >= 4) showSummary();
    else { draft = freshDraft(); renderChargen(); }
  };
  $('cg-quick').onclick = () => {
    commitDraft();
    const want: ClassName[] = ['Fighter', 'Thief', 'Priest', 'Wizard'];
    for (const cls of want) {
      if (built.length >= 4) break;
      if (!built.some(b => b.cls === cls)) built.push(generateCharacter(cls));
    }
    while (built.length < 4) built.push(generateCharacter());
    showSummary();
  };
  $('cg-cancel').onclick = () => {
    closeModal();
    if (!G) showTitleScreen(true);
  };
}

function commitDraft() {
  const name = draft.name.trim() || pick(NAMES[draft.ancestry]);
  built.push(makeCharacter({
    name, ancestry: draft.ancestry, cls: draft.cls,
    stats: draft.stats, spellChoice: draft.spellChoice,
  }));
  sfx('levelup');
}

function showSummary() {
  const rows = built.map(p => `
    <div class="modal-row">
      <span class="mr-name"><b>${p.name}</b> the ${p.ancestry} ${p.cls}</span>
      <span class="mr-detail">HP ${p.maxHp} · AC ${armorClass(p)} · ${p.weapon?.name ?? 'fists'}${Object.keys(p.spells).length ? ' · ' + Object.keys(p.spells).map(id => SPELLS[id].name).join(', ') : ''}</span>
    </div>`).join('');
  openModal(`
    <h1>The Company Stands Ready</h1>
    <p class="subtitle">Four names on the muster roll. The chronicler blots the ink and does not say what he is thinking.</p>
    ${rows}
    <p style="margin-top:10px">Shared purse: 30 gp · 5 torches · 6 rations</p>
    <div style="margin-top:14px">
      <button class="modal-btn" id="cg-begin" style="font-size:17px">🕯 Begin, in Emberwick</button>
      <button class="modal-btn" id="cg-restart">Start over</button>
    </div>
  `);
  document.getElementById('cg-begin')!.onclick = () => beginGame(built);
  document.getElementById('cg-restart')!.onclick = () => openChargen();
}

export function beginGame(party?: Character[]) {
  newGame(party);
  closeModal();
  showTitleScreen(false);
  setAmbience('surface');
  sfx('drum');
  logDivider('THE DARK BENEATH');
  log('Four strangers answer Emberwick\'s call for torchbearers. The pay is bad, the odds are worse, and the town chapel keeps a fresh page in its book of names.', 'gm');
  log('Your company gathers at lantern-hour: ' + G.party.map(p => `${p.name} the ${p.ancestry} ${p.cls}`).join(', ') + '.', 'info');
  log('Visit the Notice Board for work. Buy torches. Buy more torches than that.', 'system');
  saveGame();
  hooks.refresh();
}
