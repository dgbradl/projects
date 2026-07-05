// The GM narration log + dice roll cards. DOM-only, no game imports.
import type { RollResult } from './rng';
import { fmtMod } from './rng';

let logEl: HTMLElement | null = null;

export function initLog() {
  logEl = document.getElementById('log');
}

function push(el: HTMLElement) {
  if (!logEl) return;
  logEl.appendChild(el);
  // keep the log bounded
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild!);
  logEl.scrollTop = logEl.scrollHeight;
}

export type LogKind = 'gm' | 'info' | 'good' | 'bad' | 'loot' | 'system';

export function log(text: string, kind: LogKind = 'gm') {
  const div = document.createElement('div');
  div.className = `log-line log-${kind}`;
  div.textContent = text;
  push(div);
}

export function logDivider(title: string) {
  const div = document.createElement('div');
  div.className = 'log-divider';
  div.textContent = `— ${title} —`;
  push(div);
}

/** A visible dice-roll card: "Thorin attacks Goblin — d20+3 = 17 vs AC 12 · HIT" */
export function logRoll(opts: {
  who: string;
  what: string;
  roll: RollResult;
  vs?: number;
  vsLabel?: string;
  outcome?: string;
  success?: boolean;
}) {
  const { who, what, roll, vs, vsLabel, outcome, success } = opts;
  const card = document.createElement('div');
  card.className = 'roll-card' + (roll.crit ? ' roll-crit' : roll.fumble ? ' roll-fumble' : '');

  const die = document.createElement('div');
  die.className = 'roll-die';
  die.textContent = String(roll.natural);
  card.appendChild(die);

  const body = document.createElement('div');
  body.className = 'roll-body';
  const head = document.createElement('div');
  head.className = 'roll-head';
  head.textContent = `${who} · ${what}`;
  body.appendChild(head);

  const detail = document.createElement('div');
  detail.className = 'roll-detail';
  const diceStr = roll.sides === 20 && roll.adv
    ? `2d20${roll.adv === 'adv' ? 'kh' : 'kl'}[${roll.dice.join(',')}]`
    : `${roll.count}d${roll.sides}${roll.count > 1 ? `[${roll.dice.join('+')}]` : ''}`;
  let text = `${diceStr}${roll.mod ? fmtMod(roll.mod) : ''} = ${roll.total}`;
  if (vs !== undefined) text += ` vs ${vsLabel ?? 'DC'} ${vs}`;
  detail.textContent = text;
  body.appendChild(detail);

  if (outcome) {
    const out = document.createElement('div');
    out.className = 'roll-outcome ' + (success === undefined ? '' : success ? 'roll-ok' : 'roll-no');
    out.textContent = roll.crit ? `CRITICAL! ${outcome}` : roll.fumble ? `FUMBLE! ${outcome}` : outcome;
    body.appendChild(out);
  }
  card.appendChild(body);
  push(card);
}
