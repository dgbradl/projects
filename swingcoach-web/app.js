/* SwingCoach app shell: state, tabs, rendering, storage, optional AI coach. */

const STORAGE_SHOTS = 'swingcoach.shots';
const STORAGE_SETTINGS = 'swingcoach.settings';

const state = {
  shot: newShot(),
  shots: loadJSON(STORAGE_SHOTS, []),
  settings: loadJSON(STORAGE_SETTINGS, { handedness: 'right', apiKey: '' }),
};

function newShot(keepClub) {
  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    club: keepClub || 'driver',
    startLine: 'straight',
    curve: 'straight',
    contact: 'flush',
    trajectory: 'normal',
    note: '',
  };
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveShots() { localStorage.setItem(STORAGE_SHOTS, JSON.stringify(state.shots)); }
function saveSettings() { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings)); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* ------------------------------------------------------------------ tabs */

const TAB_TITLES = {
  new: 'Describe your shot',
  history: 'Shot history',
  trends: 'Trends',
  settings: 'Settings',
};

function showTab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');
  document.querySelectorAll('#tabbar button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.getElementById('screen-title').textContent = TAB_TITLES[name];
  if (name === 'history') renderHistory();
  if (name === 'trends') renderTrends();
  window.scrollTo(0, 0);
}

document.querySelectorAll('#tabbar button').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

/* -------------------------------------------------------------- new shot */

function renderChoices(containerId, options, field, useShortLabels) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = useShortLabels ? opt.label : opt.label;
    btn.classList.toggle('selected', state.shot[field] === opt.id);
    btn.addEventListener('click', () => {
      state.shot[field] = opt.id;
      renderChoices(containerId, options, field, useShortLabels);
    });
    el.appendChild(btn);
  });
}

function renderNewShotForm() {
  const clubSel = document.getElementById('club');
  clubSel.innerHTML = CLUBS.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  clubSel.value = state.shot.club;

  renderChoices('contact-grid', CONTACTS, 'contact');
  renderChoices('start-seg', STARTS, 'startLine');
  renderChoices('curve-grid', CURVES, 'curve');
  renderChoices('traj-seg', TRAJECTORIES, 'trajectory');
  document.getElementById('note').value = state.shot.note;
}

document.getElementById('club').addEventListener('change', e => {
  state.shot.club = e.target.value;
});
document.getElementById('note').addEventListener('input', e => {
  state.shot.note = e.target.value;
});

document.getElementById('analyze-btn').addEventListener('click', () => {
  state.shot.date = new Date().toISOString();
  state.shots.unshift(state.shot);
  saveShots();
  showDiagnosis(state.shot);
  // Keep the club (you usually hit several with the same one), reset the rest.
  state.shot = newShot(state.shot.club);
  renderNewShotForm();
});

/* ------------------------------------------------------------- diagnosis */

function showDiagnosis(shot) {
  const d = diagnose(shot, state.settings.handedness);
  const parts = [];

  parts.push(`<p class="headline">${esc(d.headline)}</p>`);
  parts.push(`<p class="shot-summary">${esc(shotSummary(shot))}</p>`);

  if (d.whatHappened) {
    parts.push(`<div class="card"><h3>What happened at impact</h3><p>${esc(d.whatHappened)}</p></div>`);
  }
  if (d.likelyCauses.length) {
    parts.push(`<div class="card"><h3>Most likely causes</h3><ul>${
      d.likelyCauses.map(c => `<li>${esc(c)}</li>`).join('')
    }</ul></div>`);
  }
  if (d.fixes.length) {
    parts.push(`<div class="card"><h3>${d.isPositive ? 'Keep it going' : 'What to work on'}</h3><ul>${
      d.fixes.map(f => `<li>${esc(f)}</li>`).join('')
    }</ul></div>`);
  }
  if (d.drills.length) {
    parts.push(`<div class="card"><h3>Drills</h3><ul>${
      d.drills.map(dr => `<li><span class="drill-name">${esc(dr.name)}</span><p class="drill-how">${esc(dr.howTo)}</p></li>`).join('')
    }</ul></div>`);
  }
  if (state.settings.apiKey) {
    parts.push(`<div class="card" id="ai-card"><h3>AI coach</h3><button class="link-btn" id="ai-btn">✨ Get personalized AI advice</button><div id="ai-result"></div></div>`);
  }

  document.getElementById('diagnosis-content').innerHTML = parts.join('');
  document.getElementById('diagnosis-overlay').classList.remove('hidden');

  const aiBtn = document.getElementById('ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', () => askAI(shot));
}

document.getElementById('diagnosis-done').addEventListener('click', () => {
  document.getElementById('diagnosis-overlay').classList.add('hidden');
});

/* ---------------------------------------------------------------- AI coach */

async function askAI(shot) {
  const result = document.getElementById('ai-result');
  const btn = document.getElementById('ai-btn');
  btn.classList.add('hidden');
  result.innerHTML = '<p><span class="spinner"></span>Asking your AI coach…</p>';

  const handednessLabel = state.settings.handedness === 'left' ? 'Left-handed' : 'Right-handed';
  const description = [
    `Golfer: ${handednessLabel}.`,
    `Club: ${labelFor(CLUBS, shot.club)}.`,
    `Contact: ${labelFor(CONTACTS, shot.contact)}.`,
    `Start line: ${labelFor(STARTS, shot.startLine)} of target line.`,
    `Curve: ${labelFor(CURVES, shot.curve)}.`,
    `Trajectory: ${labelFor(TRAJECTORIES, shot.trajectory)}.`,
    shot.note ? `Golfer's own description: ${shot.note}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': state.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        system: 'You are a friendly, expert golf instructor. The golfer will describe one shot. ' +
          'Give practical, encouraging advice about the most likely swing cause and ONE specific ' +
          'thing to work on, with a drill. Be concise (under 200 words), use plain language, and ' +
          'never blame the golfer.',
        messages: [{ role: 'user', content: description }],
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error((json && json.error && json.error.message) || ('HTTP ' + res.status));
    }
    if (json.stop_reason === 'refusal') {
      throw new Error('The AI declined to answer this request.');
    }
    const text = (json.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    if (!text) throw new Error('Empty answer.');

    result.innerHTML = text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  } catch (err) {
    btn.classList.remove('hidden');
    result.innerHTML = `<p class="ai-error">${esc(err.message || String(err))}</p>`;
  }
}

/* ---------------------------------------------------------------- history */

function renderHistory() {
  const el = document.getElementById('history-list');
  if (!state.shots.length) {
    el.innerHTML = '<div class="empty"><span class="big">🏌️</span>No shots yet.<br>Describe a shot on the New Shot tab and it will show up here.</div>';
    return;
  }
  el.innerHTML = '';
  state.shots.forEach(shot => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const when = new Date(shot.date).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    item.innerHTML = `
      <div class="info">
        <div class="summary">${esc(shotSummary(shot))}</div>
        <div class="when">${esc(when)}</div>
      </div>
      <button class="delete-btn" aria-label="Delete shot">✕</button>`;
    item.querySelector('.info').addEventListener('click', () => showDiagnosis(shot));
    item.querySelector('.delete-btn').addEventListener('click', () => {
      state.shots = state.shots.filter(s => s.id !== shot.id);
      saveShots();
      renderHistory();
    });
    el.appendChild(item);
  });
}

/* ----------------------------------------------------------------- trends */

function computeTrends(recent) {
  const counts = new Map();
  const bump = (key, label, advice) => {
    const cur = counts.get(key) || { label, advice, count: 0 };
    cur.count += 1;
    counts.set(key, cur);
  };

  for (const shot of recent) {
    if (shot.contact !== 'flush') {
      bump('contact.' + shot.contact, labelFor(CONTACTS, shot.contact),
        "Strike quality is your priority — curvature fixes don't stick until contact is consistent. Spend range time on strike drills (towel, tee-gate, brush-the-grass) before anything else.");
    }
    if (shot.curve === 'slice') {
      bump('curve.slice', 'Big slice',
        'A recurring slice responds fastest to grip and path work: strengthen the lead-hand grip and groove an in-to-out path with the headcover gate drill.');
    } else if (shot.curve === 'hook') {
      bump('curve.hook', 'Big hook',
        'A recurring hook usually means overactive hands or an overly strong grip. Work on keeping your body rotating through impact — feet-together and hold-the-finish drills.');
    }
    if (shot.startLine !== 'straight' && shot.curve === 'straight' && shot.contact === 'flush') {
      bump('start.' + shot.startLine, 'Straight miss ' + shot.startLine,
        'Straight shots that miss the target are often aim, ball position, or alignment — bring alignment sticks to every range session before changing your swing.');
    }
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}

function renderTrends() {
  const el = document.getElementById('trends-content');
  const recent = state.shots.slice(0, 50);

  if (recent.length < 3) {
    el.innerHTML = '<div class="empty"><span class="big">📊</span>Not enough shots yet.<br>Log a few more and this tab will show your most common miss and what to practice.</div>';
    return;
  }

  const patterns = computeTrends(recent);
  const flush = recent.filter(s => s.contact === 'flush' && s.curve === 'straight' && s.startLine === 'straight').length;

  const parts = [];
  parts.push(`<div class="card"><h3>Last ${recent.length} shots</h3>
    <div class="stat-row"><span class="good">✓ Flush and on target</span><span class="count">${flush}</span></div></div>`);

  if (patterns.length) {
    const top = patterns[0];
    parts.push(`<div class="card"><h3>Practice priority</h3>
      <p><strong>${esc(top.label)} — ${top.count}x</strong></p>
      <p class="hint">${esc(top.advice)}</p></div>`);
  }
  if (patterns.length > 1) {
    parts.push(`<div class="card"><h3>Other recurring misses</h3>${
      patterns.slice(1).map(p =>
        `<div class="stat-row"><span>${esc(p.label)}</span><span class="count">${p.count}x</span></div>`
      ).join('')
    }</div>`);
  }

  el.innerHTML = parts.join('');
}

/* --------------------------------------------------------------- settings */

const handednessSel = document.getElementById('handedness');
const apiKeyInput = document.getElementById('api-key');
handednessSel.value = state.settings.handedness;
apiKeyInput.value = state.settings.apiKey;

handednessSel.addEventListener('change', e => {
  state.settings.handedness = e.target.value;
  saveSettings();
});
apiKeyInput.addEventListener('input', e => {
  state.settings.apiKey = e.target.value.trim();
  saveSettings();
});

/* ------------------------------------------------------------------- init */

renderNewShotForm();
showTab('new');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
}
