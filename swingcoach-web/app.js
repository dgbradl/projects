/* SwingCoach app shell: state, tabs, rendering, storage, optional AI coach. */

const STORAGE_SHOTS = 'swingcoach.shots';
const STORAGE_SETTINGS = 'swingcoach.settings';
const STORAGE_PENDING = 'swingcoach.pending';
const STORAGE_PROFILE = 'swingcoach.profile';
const STORAGE_PLAN = 'swingcoach.plan';

const state = {
  shot: newShot(),
  shots: loadJSON(STORAGE_SHOTS, []),
  settings: loadJSON(STORAGE_SETTINGS, { handedness: 'right' }),
  pending: loadJSON(STORAGE_PENDING, []),
  profile: loadJSON(STORAGE_PROFILE, { focuses: [] }),
  plan: loadJSON(STORAGE_PLAN, null),
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
function savePending() { localStorage.setItem(STORAGE_PENDING, JSON.stringify(state.pending)); }
function saveProfile() { localStorage.setItem(STORAGE_PROFILE, JSON.stringify(state.profile)); }
function savePlan() { localStorage.setItem(STORAGE_PLAN, JSON.stringify(state.plan)); }

/* ------------------------------------------------------------ fix tracking */

function activeFocus() {
  const focuses = state.profile.focuses || [];
  const last = focuses[focuses.length - 1];
  return last && !last.endedAt ? last : null;
}

function pastFocuses() {
  return (state.profile.focuses || []).filter(f => f.endedAt);
}

function profileChanged() {
  saveProfile();
  // Snapshots apply in queue order, so the last one wins server-side.
  queueOp({ op: 'profile', profile: JSON.parse(JSON.stringify(state.profile)) });
}

function startFocus(pattern, label) {
  const current = activeFocus();
  if (current) current.endedAt = new Date().toISOString();
  if (!state.profile.focuses) state.profile.focuses = [];
  state.profile.focuses.push({
    id: crypto.randomUUID(),
    pattern,
    label,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });
  profileChanged();
}

function stopFocus() {
  const current = activeFocus();
  if (!current) return;
  current.endedAt = new Date().toISOString();
  profileChanged();
}

/* -------------------------------------------------------------- API + sync
 *
 * Local-first: shots always save to localStorage immediately (so the app is
 * instant and works offline on the course), and every change is queued and
 * pushed to the server when there's a connection. On load / reconnect we pull
 * the server's copy so history follows you across devices.
 */

async function api(action, payload = {}) {
  const auth = getAuth(); // from auth.js
  const res = await fetch('api.php', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({ action, token: auth && auth.token }, payload)),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 401) {
    // Session rejected server-side — back to the sign-in gate.
    clearAuth();
    location.reload();
    throw new Error('Signed out');
  }
  if (!res.ok) throw new Error((json && json.error) || 'HTTP ' + res.status);
  if (auth) {
    // Mirror the server's sliding 30-day session renewal.
    auth.expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    if (json && typeof json.ai === 'boolean') auth.ai = json.ai;
    localStorage.setItem(STORAGE_AUTH, JSON.stringify(auth));
  }
  return json;
}

function queueOp(op) {
  state.pending.push(op);
  savePending();
  flushPending().then(() => {});
}

let flushing = false;
async function flushPending() {
  if (flushing || !getAuth() || !navigator.onLine) return;
  flushing = true;
  try {
    while (state.pending.length) {
      const op = state.pending[0];
      if (op.op === 'upsert') await api('upsert', { shot: op.shot });
      else if (op.op === 'profile') await api('profile', { profile: op.profile });
      else await api('delete', { id: op.id });
      state.pending.shift();
      savePending();
    }
  } catch {
    // Offline or server hiccup — ops stay queued and retry on reconnect.
  } finally {
    flushing = false;
  }
}

async function syncPull() {
  if (!getAuth() || !navigator.onLine) return;
  try {
    const res = await api('list');
    if (!res || !Array.isArray(res.shots)) return;
    // Profile: server copy wins unless a local change is still waiting to push.
    const pendingProfile = state.pending.some(op => op.op === 'profile');
    if (!pendingProfile && res.profile && Array.isArray(res.profile.focuses)) {
      state.profile = res.profile;
      saveProfile();
    }
    // Server copy is the base; local not-yet-pushed ops overlay it.
    let shots = res.shots;
    for (const op of state.pending) {
      if (op.op === 'upsert') {
        shots = shots.filter(s => s.id !== op.shot.id);
        shots.push(op.shot);
      } else {
        shots = shots.filter(s => s.id !== op.id);
      }
    }
    shots.sort((a, b) => new Date(b.date) - new Date(a.date));
    state.shots = shots;
    saveShots();
    renderHistory();
    renderTrends();
  } catch {
    // Cached local copy remains the working set.
  }
}

async function syncAll() {
  await flushPending();
  await syncPull();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* ------------------------------------------------------------------ tabs */

const TAB_TITLES = {
  new: 'Describe your shot',
  history: 'Shot history',
  trends: 'Practice',
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
  if (name === 'settings') renderAIStatus();
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
  queueOp({ op: 'upsert', shot: state.shot });
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
  // Fix tracking: offer to make this miss the current focus.
  const trackable = trackablePattern(shot);
  if (trackable) {
    const focus = activeFocus();
    if (focus && focus.pattern === trackable.pattern) {
      parts.push(`<div class="card"><h3>Fix tracking</h3><p class="hint">🎯 You're already tracking <strong>${esc(focus.label)}</strong> — this shot counts toward your progress chart on the Practice tab.</p></div>`);
    } else {
      const replaces = focus ? ` (replaces your current focus: ${esc(focus.label)})` : '';
      parts.push(`<div class="card"><h3>Fix tracking</h3><button class="link-btn" id="track-btn">🎯 Make "${esc(trackable.label)}" my focus</button><p class="hint">The app will measure how often this miss shows up before vs. after today, so you can see the fix working${replaces}.</p></div>`);
    }
  }

  if ((getAuth() || {}).ai) {
    parts.push(`<div class="card" id="ai-card"><h3>AI coach</h3><button class="link-btn" id="ai-btn">✨ Get personalized AI advice</button><div id="ai-result"></div></div>`);
  }

  document.getElementById('diagnosis-content').innerHTML = parts.join('');
  document.getElementById('diagnosis-overlay').classList.remove('hidden');

  const aiBtn = document.getElementById('ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', () => askAI(shot));

  const trackBtn = document.getElementById('track-btn');
  if (trackBtn) trackBtn.addEventListener('click', () => {
    startFocus(trackable.pattern, trackable.label);
    showDiagnosis(shot); // re-render to show the confirmation state
  });
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

  try {
    // The server holds the Anthropic key and makes the call — see api.php.
    const res = await api('ai', { shot, handedness: state.settings.handedness });
    const text = (res && res.advice) || '';
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

  // Shots within 3 hours of each other group into a session.
  for (const session of computeSessions(state.shots)) {
    const header = document.createElement('div');
    header.className = 'session-header';
    const day = new Date(session.end).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Date(session.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    header.innerHTML = `<span>${esc(day)} · ${esc(time)}</span>
      <span>${session.shots.length} shot${session.shots.length === 1 ? '' : 's'} · ${flushPct(session.shots)}% flush</span>`;
    el.appendChild(header);

    session.shots.forEach(shot => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const when = new Date(shot.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
        queueOp({ op: 'delete', id: shot.id });
        renderHistory();
      });
      el.appendChild(item);
    });
  }
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
  const patterns = computeTrends(recent);
  const focus = activeFocus();
  const sessions = computeSessions(state.shots);
  const parts = [];

  if (!state.shots.length && !focus) {
    el.innerHTML = '<div class="empty"><span class="big">🎯</span>Nothing to practice yet.<br>Log shots on the New Shot tab and this tab will tell you what to work on — and whether it\'s working.</div>';
    return;
  }

  /* --- Current focus --- */
  if (focus) {
    const st = focusStats(state.shots, focus);
    const since = new Date(focus.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
    let progress;
    if (st.afterCount >= 5 && st.beforeRate !== null) {
      const better = st.afterRate <= st.beforeRate;
      progress = `<p class="focus-numbers"><strong class="${better ? 'good' : 'bad'}">${st.beforeRate}% → ${st.afterRate}%</strong></p>
        <p class="hint">How often this miss shows up: before vs. since ${esc(since)} (${st.afterCount} shots since, ${st.beforeCount} before). ${better ? 'It\'s working — keep going.' : 'Not moving yet — that\'s normal early on; stick with the drills.'}</p>`;
    } else {
      progress = `<p class="hint">${st.afterCount} shot${st.afterCount === 1 ? '' : 's'} logged since ${esc(since)} — log about 5 more and your before/after numbers appear here.</p>`;
    }
    parts.push(`<div class="card"><h3>Current focus</h3>
      <p><strong>🎯 ${esc(focus.label)}</strong></p>${progress}
      <button class="link-btn" id="stop-focus-btn">Stop tracking</button></div>`);
  } else {
    const suggestion = patterns.length
      ? `<button class="link-btn" id="start-focus-btn">🎯 Make "${esc(patterns[0].label)}" my focus</button>`
      : '<p class="hint">Log a few shots and your most common miss will show up here, ready to track.</p>';
    parts.push(`<div class="card"><h3>Current focus</h3>
      <p class="hint">Pick one miss to fix. The app measures how often it shows up before vs. after, so you know if the fix is real.</p>${suggestion}</div>`);
  }

  /* --- Past fixes --- */
  const past = pastFocuses().slice(-3).reverse();
  if (past.length) {
    parts.push(`<div class="card"><h3>Past fixes</h3>${past.map(f => {
      const st = focusStats(state.shots, f);
      const result = (st.beforeRate !== null && st.afterRate !== null)
        ? `${st.beforeRate}% → ${st.afterRate}%`
        : 'not enough shots';
      return `<div class="stat-row"><span>${esc(f.label)}</span><span class="count">${esc(result)}</span></div>`;
    }).join('')}</div>`);
  }

  /* --- Progress chart --- */
  if (sessions.length >= 2) {
    parts.push(`<div class="card"><h3>Progress by session</h3>
      <canvas id="progress-chart"></canvas>
      <p class="hint"><span class="good">■</span> flush &amp; on target${focus ? ` &nbsp;&nbsp;<span class="bad">●</span> ${esc(focus.label)}` : ''}</p></div>`);
  } else if (state.shots.length) {
    parts.push(`<div class="card"><h3>Progress by session</h3>
      <p class="hint">Charts appear once you have two or more sessions. Shots more than 3 hours apart start a new session automatically.</p></div>`);
  }

  /* --- Range plan --- */
  if (state.plan && Array.isArray(state.plan.items)) {
    const doneCount = state.plan.items.filter(i => i.done).length;
    parts.push(`<div class="card"><h3>Range plan — ${esc(state.plan.title)}</h3>${
      state.plan.items.map((item, i) => `
        <div class="plan-item${item.done ? ' done' : ''}" data-plan-index="${i}">
          <span class="plan-check">${item.done ? '☑' : '☐'}</span>
          <div><strong>${esc(item.name)}</strong> — ${esc(item.dose)}
            <p class="drill-how">${esc(item.howTo)}</p></div>
        </div>`).join('')
    }${doneCount === state.plan.items.length ? '<p class="good"><strong>Plan complete — nice work! 🎉</strong></p>' : ''}
      <button class="link-btn" id="new-plan-btn">New plan</button></div>`);
  } else {
    parts.push(`<div class="card"><h3>Range plan</h3>
      <p class="hint">A drill prescription for your ${focus ? 'current focus' : 'most common miss'}, sized for one bucket of balls. Tap items to check them off at the range.</p>
      <button class="link-btn" id="new-plan-btn">Generate plan</button></div>`);
  }

  /* --- Trend stats --- */
  if (recent.length >= 3) {
    const flush = recent.filter(isFlushStraight).length;
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
  }

  el.innerHTML = parts.join('');

  /* --- wire up --- */
  const stopBtn = document.getElementById('stop-focus-btn');
  if (stopBtn) stopBtn.addEventListener('click', () => { stopFocus(); renderTrends(); });

  const startBtn = document.getElementById('start-focus-btn');
  if (startBtn) startBtn.addEventListener('click', () => {
    startFocus(patterns[0].id, patterns[0].label);
    renderTrends();
  });

  const planBtn = document.getElementById('new-plan-btn');
  if (planBtn) planBtn.addEventListener('click', () => {
    const pattern = (activeFocus() || {}).pattern || (patterns[0] || {}).id || 'maintenance';
    state.plan = generatePlan(pattern);
    savePlan();
    renderTrends();
  });

  el.querySelectorAll('.plan-item').forEach(div => {
    div.addEventListener('click', () => {
      const i = Number(div.dataset.planIndex);
      state.plan.items[i].done = !state.plan.items[i].done;
      savePlan();
      renderTrends();
    });
  });

  const canvas = document.getElementById('progress-chart');
  if (canvas) drawProgressChart(canvas, sessionSeries(sessions, focus ? focus.pattern : null));
}

/* Hand-drawn canvas chart: green bars = flush rate per session; red line =
 * the tracked miss's rate per session (when a focus is active). */
function drawProgressChart(canvas, series) {
  if (!series.length) return;
  const styles = getComputedStyle(document.documentElement);
  const color = name => styles.getPropertyValue(name).trim();
  const accent = color('--accent') || '#1c8f4a';
  const danger = color('--danger') || '#c23a2f';
  const muted = color('--muted') || '#888888';
  const border = color('--border') || '#cccccc';

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = 190;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 32, padR = 6, padT = 10, padB = 22;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;
  const y = pct => padT + h * (1 - pct / 100);

  ctx.font = '10px -apple-system, sans-serif';
  ctx.lineWidth = 1;
  for (const g of [0, 50, 100]) {
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(padL, y(g));
    ctx.lineTo(padL + w, y(g));
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.fillText(g + '%', padL - 5, y(g) + 3);
  }

  const slot = w / series.length;
  const barW = Math.min(26, slot * 0.5);
  series.forEach((s, i) => {
    const cx = padL + slot * i + slot / 2;
    ctx.fillStyle = accent;
    ctx.fillRect(cx - barW / 2, y(s.flushPct), barW, y(0) - y(s.flushPct));
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText(s.label, cx, cssH - 7);
  });

  if (series.some(s => s.focusPct !== null)) {
    ctx.strokeStyle = danger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((s, i) => {
      const cx = padL + slot * i + slot / 2;
      if (i === 0) ctx.moveTo(cx, y(s.focusPct));
      else ctx.lineTo(cx, y(s.focusPct));
    });
    ctx.stroke();
    ctx.fillStyle = danger;
    series.forEach((s, i) => {
      const cx = padL + slot * i + slot / 2;
      ctx.beginPath();
      ctx.arc(cx, y(s.focusPct), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/* --------------------------------------------------------------- settings */

const handednessSel = document.getElementById('handedness');
handednessSel.value = state.settings.handedness;

handednessSel.addEventListener('change', e => {
  state.settings.handedness = e.target.value;
  saveSettings();
});

function renderAIStatus() {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent = (getAuth() || {}).ai
    ? "Enabled — each diagnosis gets a 'Get personalized AI advice' button. The API key lives on the server."
    : 'Not configured. Add an Anthropic API key to config.php on the server to enable the AI coach.';
}

/* ------------------------------------------------------------------- init */

renderNewShotForm();
showTab('new');

// Called by auth.js after a fresh sign-in; also run now for stored sessions.
window.onSignedIn = () => { syncAll(); };
if (getAuth()) syncAll();
window.addEventListener('online', () => { syncAll(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
}
