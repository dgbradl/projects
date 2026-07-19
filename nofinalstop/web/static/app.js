/* NO FINAL STOP — browser client. Vanilla JS; the server owns all game logic. */
"use strict";

let view = null;
const ui = {
  tab: "inventory",
  expanded: new Set(),
  armedExit: null,
  partySize: 4,
  carriage: null,     // which carriage the play shell was built for
  lastLogLen: 0,      // how much of the server log has been consumed
  currentPage: null,  // the entries shown on the current "page" of narrative
};

const $ = (sel, el) => (el || document).querySelector(sel);
const app = $("#app");
const modalRoot = $("#modal-root");

function esc(s) {
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function post(cmd, extra) {
  try {
    const res = await fetch("/api/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ cmd }, extra || {})),
    });
    view = await res.json();
  } catch (e) {
    toast("The connection to the train was lost. Is the server still running?");
    return;
  }
  if (view.error) toast(view.error);
  render();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3400);
}

/* ============================== render ============================== */

function render() {
  ui.armedExit = null;
  if (!view) return;
  if (view.phase === "title") { ui.carriage = null; renderTitle(); }
  else if (view.phase === "chargen") { ui.carriage = null; renderChargen(); }
  else if (view.phase === "ending") { ui.carriage = null; renderEnding(); }
  else renderPlay();
  renderModal();
}

/* ------------------------------ title ------------------------------ */
function renderTitle() {
  app.innerHTML = `
  <div class="title-plate">
    <div class="d-title">the company regrets that this service does not stop</div>
    <h1 class="masthead">No Final Stop</h1>
    <hr class="masthead-rule">
    <p class="title-sub">A party of strangers. A train that cannot stop.<br>
    A darkness eating its way forward, carriage by carriage.</p>
    <div class="title-terminus">TERMINUS</div>
    <div class="title-actions">
      <button class="plate-btn" id="btn-quick">Board the Train — a party is generated</button>
      <button class="plate-btn" id="btn-guided">Assemble Your Party — guided creation</button>
      ${view.has_save ? '<button class="plate-btn" id="btn-continue">Continue — the train remembers</button>' : ""}
    </div>
    <div class="title-row">
      <label for="size-sel">Souls boarding together:</label>
      <select id="size-sel">
        <option value="3">three</option>
        <option value="4" selected>four (recommended)</option>
        <option value="5">five</option>
      </select>
    </div>
  </div>`;
  $("#size-sel").value = String(ui.partySize);
  $("#size-sel").onchange = (e) => { ui.partySize = parseInt(e.target.value, 10); };
  $("#btn-quick").onclick = () => post("new_quick", { size: ui.partySize });
  $("#btn-guided").onclick = () => post("new_guided");
  const cont = $("#btn-continue");
  if (cont) cont.onclick = () => post("continue");
}

/* ------------------------------ chargen ---------------------------- */
function renderChargen() {
  const cg = view.chargen || {};
  if (cg.size == null) {
    app.innerHTML = `
    <div class="dossier">
      <div class="d-head"><span class="d-title">Passenger Manifest — New Entries</span></div>
      <p>How many souls board together?</p>
      <div class="d-controls">
        <button class="plate-btn" data-n="3">Three</button>
        <button class="plate-btn" data-n="4">Four (recommended)</button>
        <button class="plate-btn" data-n="5">Five</button>
      </div>
    </div>`;
    app.querySelectorAll("[data-n]").forEach((b) => {
      b.onclick = () => post("chargen_size", { size: parseInt(b.dataset.n, 10) });
    });
    return;
  }
  const c = cg.candidate;
  const profOpts = cg.professions
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const skills = Object.entries(c.skills).map(([k, v]) => `${esc(k)} ${v}`).join(", ");
  const attrs = Object.entries(c.attrs)
    .map(([k, v]) => `<span><b>${v}</b> ${esc(k)}</span>`).join("");
  app.innerHTML = `
  <div class="dossier">
    <div class="d-head">
      <span class="d-title">Passenger Manifest</span>
      <span class="d-progress">traveler ${cg.index + 1} of ${cg.size}</span>
    </div>
    <h2 class="c-name">${esc(c.name)}</h2>
    <p class="c-sub">${esc(c.profession)}, ${c.age}, ${esc(c.pronouns)} — from ${esc(c.background)}<br>
      <em>${esc(c.appearance)}</em></p>
    <div class="d-grid">
      <div><span class="k">Attributes</span><div class="attr-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px 12px">${attrs}</div></div>
      <div><span class="k">Skills</span><div>${skills}</div></div>
      <div><span class="k">Traits</span><div>${esc(c.trait_positive)} / ${esc(c.trait_difficult)}</div></div>
      <div><span class="k">Fear</span><div>${esc(c.fear)}</div></div>
      <div><span class="k">Secret</span><div>${esc(c.secret)}</div></div>
      <div><span class="k">Carried aboard</span><div>${esc(c.personal_item)}</div></div>
    </div>
    <span class="k" style="font-variant:small-caps;letter-spacing:.1em;color:var(--ink-soft);font-size:12.5px">Fragmented memory</span>
    ${c.memories.map((m) => `<p class="d-mem">— ${esc(m.text)}</p>`).join("")}
    <div class="d-controls">
      <button class="plate-btn" id="cg-accept">Accept</button>
      <button class="plate-btn" id="cg-reroll">Reroll</button>
      <select id="cg-prof"><option value="">— choose profession —</option>${profOpts}</select>
      <input id="cg-name" placeholder="rename them…" maxlength="40">
      <button class="plate-btn" id="cg-setname">Set</button>
    </div>
    ${cg.accepted.length ? `<div class="d-accepted">Already aboard: ${cg.accepted.map((a) => `${esc(a.name)} (${esc(a.profession)})`).join(", ")}</div>` : ""}
  </div>`;
  $("#cg-accept").onclick = () => post("chargen_accept");
  $("#cg-reroll").onclick = () => post("chargen_reroll");
  $("#cg-prof").onchange = (e) => { if (e.target.value) post("chargen_profession", { profession: e.target.value }); };
  $("#cg-setname").onclick = () => {
    const name = $("#cg-name").value.trim();
    if (name) post("chargen_rename", { name });
  };
}

/* ------------------------------ play ------------------------------- */
function renderPlay() {
  const st = view.status;
  // Build the layout shell only when entering play or changing carriage —
  // rebuilding everything per click made all log entries re-animate at once
  // and snapped the scroll, which felt like the page "popping".
  const newShell = ui.carriage !== st.carriage || !$("#log");
  if (newShell) {
    app.innerHTML = `
      <div id="topbar-slot"></div>
      <div id="objective-slot"></div>
      <div id="scene-slot"></div>
      <div class="play-grid">
        <section class="paper">
          <div id="log"></div>
          <div id="tint" class="tint-note" hidden></div>
          <div id="stage"></div>
        </section>
        <aside class="rail" id="rail"></aside>
      </div>`;
    ui.carriage = st.carriage;
    ui.lastLogLen = 0;
  }
  $("#topbar-slot").innerHTML = topbarHTML(st);
  $("#objective-slot").innerHTML = st.objective
    ? `<div class="objective-bar"><span class="ob-tag">the way forward</span> ${esc(st.objective)}</div>`
    : "";
  const tint = $("#tint");
  if (st.observer_tint) {
    tint.hidden = false;
    tint.textContent = `(${st.observer}: ${st.observer_tint})`;
  } else {
    tint.hidden = true;
  }
  renderPage(newShell);
  renderScene();
  renderStage();
  renderRail();
}

function topbarHTML(st) {
  const cars = [];
  for (let i = 0; i <= st.max_index; i++) {
    let cls = "car";
    if (i <= st.blackout_index) cls += " eaten";
    if (i === st.index) cls += " current";
    cars.push(`<span class="${cls}" title="carriage ${i}"></span>`);
  }
  const close = st.blackout_distance <= 1;
  const label = st.blackout_distance <= 0
    ? "THE BLACKOUT IS HERE"
    : `the blackout is ${st.blackout_distance} car${st.blackout_distance === 1 ? "" : "s"} behind`;
  return `
  <header class="topbar">
    <span class="car-name">${esc(st.carriage)}</span>
    <span class="clock">t + ${st.time_in_carriage} min &nbsp;·&nbsp; ${st.total_time} min aboard</span>
    <span class="trainline">${cars.join("")}<span class="engine-glyph">▶</span></span>
    <span class="blackout-label${close ? " close" : ""}">${label}</span>
  </header>`;
}

function evHTML(e, old, delayMs) {
  const k = e.kind || "text";
  const cls = `ev ev-${esc(k)}${old ? " old" : ""}`;
  const style = delayMs ? ` style="animation-delay:${delayMs}ms"` : "";
  if (k === "arrive") return `<div class="${cls} ev-arrive"${style}>${esc(e.text)}</div>`;
  return `<div class="${cls}"${style}>${esc(e.text)}</div>`;
}

function renderPage(rebuilt) {
  // The narrative pane is a book page, not a feed: each turn's events REPLACE
  // the page, so nothing accumulates and nothing needs scrolling. The full
  // record lives in the History tab.
  const el = $("#log");
  const log = view.log || [];
  if (log.length < ui.lastLogLen) {          // a new game shrank the log
    ui.lastLogLen = 0;
    ui.currentPage = null;
  }
  const lastArrive = () => {
    let s = 0;
    for (let i = 0; i < log.length; i++) if (log[i].kind === "arrive") s = i;
    return s;
  };
  const booting = ui.lastLogLen === 0 && log.length > 0;
  const fresh = log.slice(ui.lastLogLen);
  ui.lastLogLen = log.length;
  if (booting) {
    // first render (new game, browser reload, continue): show the current
    // carriage's page, not the whole history — unless the log IS short
    ui.currentPage = log.length <= 8 ? log : log.slice(lastArrive());
  } else if (fresh.length) {
    ui.currentPage = fresh;
  } else if (!ui.currentPage || rebuilt) {
    ui.currentPage = log.slice(lastArrive());
  } else {
    return; // page unchanged — leave the DOM alone
  }
  el.innerHTML = ui.currentPage
    .map((e, i) => evHTML(e, false, Math.min(i * 70, 490))).join("");
  el.scrollTop = 0;   // a fresh page reads from the top
}

function renderStage() {
  const el = $("#stage");
  if (view.node_detail) {
    const nd = view.node_detail;
    el.innerHTML = `
    <div class="node-detail">
      <button class="nd-close" id="nd-close">step back ↩</button>
      <div class="nd-name">${esc(nd.name)}</div>
      <div class="nd-desc">${esc(nd.description)}</div>
      <div class="ticket-row">
        ${nd.actions.map((a) => ticketHTML(a)).join("") ||
          '<em style="color:var(--ink-soft)">There is nothing more to be done here.</em>'}
      </div>
    </div>`;
    $("#nd-close").onclick = () => post("close_node");
    el.querySelectorAll("[data-action]").forEach((b) => {
      b.onclick = () => post("act", { node: nd.id, action: b.dataset.action });
    });
    el.scrollTop = 0;
    return;
  }
  el.innerHTML = `
    <div class="stage-title">Points of interest</div>
    <div class="node-grid">
      ${(view.nodes || []).map((n) =>
        `<button class="node-btn" data-node="${esc(n.id)}">${esc(n.name)}` +
        (n.actions ? `<span class="n-count">${n.actions}</span>` : "") + `</button>`).join("") ||
        '<em style="color:var(--ink-soft)">Nothing here invites attention. Only the doors remain.</em>'}
    </div>
    <div class="exit-row">
      ${(view.exits || []).map((x) => exitHTML(x)).join("")}
    </div>`;
  el.querySelectorAll("[data-node]").forEach((b) => {
    b.onclick = () => post("inspect", { node: b.dataset.node });
  });
  el.querySelectorAll("[data-exit]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.exit;
      const x = view.exits.find((e) => e.id === id);
      if (!x.open) { post("exit", { exit: id }); return; }
      if (ui.armedExit === id) { ui.armedExit = null; post("exit", { exit: id }); return; }
      ui.armedExit = id;
      renderStage();
    };
  });
}

function ticketHTML(a) {
  const check = a.check
    ? `<span class="t-check">${esc(a.check.attr)}${a.check.skill ? " + " + esc(a.check.skill) : ""} · ${esc(a.check.dc)}</span>`
    : "";
  if (!a.met) {
    return `<div class="ticket unmet"><span class="t-label">${esc(a.label)}
      <span class="t-note">${esc(a.note)}</span></span>
      <span class="t-meta">· ${a.time}m${check}</span></div>`;
  }
  return `<button class="ticket" data-action="${esc(a.id)}">
    <span class="t-label">${esc(a.label)}</span>
    <span class="t-meta">· ${a.time}m${check}</span></button>`;
}

function exitHTML(x) {
  const armed = ui.armedExit === x.id;
  if (!x.open) {
    return `<button class="exit-btn locked" data-exit="${esc(x.id)}">
      <span class="arrow">⚿</span> ${esc(x.label)} <span class="lock-tag">locked</span></button>`;
  }
  return `<button class="exit-btn${armed ? " armed" : ""}" data-exit="${esc(x.id)}">
    <span class="arrow">➤</span> ${esc(x.label)}
    ${armed ? '<span class="armed-tag">anything abandoned belongs to the train — go?</span>' : ""}</button>`;
}

/* ------------------------------ scene ------------------------------ */
/* A procedural etched side-view of the carriage: walls, windows with the
   night rushing past, lamps, per-carriage props from data, the party as
   silhouette figures, node markers, doors — and the Blackout pouring in. */

const SCENE_W = 1400, SCENE_H = 190, FLOOR = 168;
const INK = "#d9cba9", DIMINK = "#8a7a5c", PANEL = "#241c12", DARK = "#0b0806";

function fig(x, opts) {
  // an etched silhouette passenger, ~46px tall, feet on FLOOR
  const o = opts || {};
  const s = o.small ? 0.72 : (o.tall ? 1.08 : 1);
  const y = FLOOR, ink = o.dusty ? DIMINK : INK;
  const seatDrop = o.seated ? 12 : 0;
  const hy = y - 42 * s + seatDrop;   // head center
  let hat = "";
  if (o.hat === "brim") hat = `<rect x="${x - 9 * s}" y="${hy - 8 * s}" width="${18 * s}" height="2.4" fill="${ink}"/><rect x="${x - 5 * s}" y="${hy - 14 * s}" width="${10 * s}" height="7 " fill="${ink}"/>`;
  else if (o.hat === "cap") hat = `<path d="M ${x - 6 * s} ${hy - 6 * s} a ${6 * s} ${6 * s} 0 0 1 ${12 * s} 0 l 3 0 l 0 2 l -15 0 z" fill="${ink}"/>`;
  else if (o.hat === "top") hat = `<rect x="${x - 8 * s}" y="${hy - 7 * s}" width="${16 * s}" height="2.4" fill="${ink}"/><rect x="${x - 5.5 * s}" y="${hy - 18 * s}" width="${11 * s}" height="11" fill="${ink}"/>`;
  const legs = o.seated
    ? `<path d="M ${x - 5} ${y - 14} l 8 0 l 2 7 l 0 7" stroke="${ink}" stroke-width="3" fill="none"/>`
    : `<line x1="${x - 3.5}" y1="${y - 16}" x2="${x - 4}" y2="${y}" stroke="${ink}" stroke-width="3.4"/>
       <line x1="${x + 3.5}" y1="${y - 16}" x2="${x + 4}" y2="${y}" stroke="${ink}" stroke-width="3.4"/>`;
  return `
    <circle cx="${x}" cy="${hy}" r="${5.6 * s}" fill="${ink}"/>
    <path d="M ${x - 7 * s} ${hy + 7 * s} L ${x + 7 * s} ${hy + 7 * s} L ${x + 5.5 * s} ${y - 15 + seatDrop} L ${x - 5.5 * s} ${y - 15 + seatDrop} Z" fill="${ink}"/>
    ${legs}${hat}`;
}

const HAT_FOR = {
  detective: "brim", journalist: "brim", drifter: "brim", hunter: "brim",
  railway_worker: "cap", mechanic: "cap", soldier: "cap", factory_worker: "cap", criminal: "cap",
  socialite: "top", lawyer: "top", professor: "top", undertaker: "top",
};

const PROPS = {
  seats: (x) => `<g class="prop"><rect x="${x - 34}" y="${FLOOR - 34}" width="30" height="34" rx="2" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x + 4}" y="${FLOOR - 34}" width="30" height="34" rx="2" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 34}" y="${FLOOR - 46}" width="8" height="14" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x + 26}" y="${FLOOR - 46}" width="8" height="14" fill="${PANEL}" stroke="${DIMINK}"/></g>`,
  luggage: (x) => `<g class="prop"><rect x="${x - 26}" y="${FLOOR - 22}" width="52" height="22" rx="2" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 20}" y="${FLOOR - 44}" width="40" height="20" rx="2" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 13}" y="${FLOOR - 62}" width="26" height="16" rx="2" fill="${PANEL}" stroke="${DIMINK}"/><line x1="${x - 20}" y1="${FLOOR - 34}" x2="${x + 20}" y2="${FLOOR - 34}" stroke="${DIMINK}"/></g>`,
  crate: (x) => `<g class="prop"><rect x="${x - 20}" y="${FLOOR - 34}" width="40" height="34" fill="${PANEL}" stroke="${DIMINK}"/><line x1="${x - 20}" y1="${FLOOR - 34}" x2="${x + 20}" y2="${FLOOR}" stroke="${DIMINK}"/><line x1="${x + 20}" y1="${FLOOR - 34}" x2="${x - 20}" y2="${FLOOR}" stroke="${DIMINK}"/></g>`,
  table: (x) => `<g class="prop"><rect x="${x - 30}" y="${FLOOR - 32}" width="60" height="5" fill="#cfc3a5"/><line x1="${x - 24}" y1="${FLOOR - 27}" x2="${x - 24}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="3"/><line x1="${x + 24}" y1="${FLOOR - 27}" x2="${x + 24}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="3"/><circle cx="${x - 12}" cy="${FLOOR - 35}" r="2.5" fill="${DIMINK}"/><circle cx="${x + 10}" cy="${FLOOR - 35}" r="2.5" fill="${DIMINK}"/><path d="M ${x - 2} ${FLOOR - 44} l 2 -5 l 2 5 z" fill="${DIMINK}"/></g>`,
  table_small: (x) => `<g class="prop"><rect x="${x - 14}" y="${FLOOR - 28}" width="28" height="4" fill="${PANEL}" stroke="${DIMINK}"/><line x1="${x}" y1="${FLOOR - 24}" x2="${x}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="3"/></g>`,
  chair: (x) => `<g class="prop"><path d="M ${x - 20} ${FLOOR} l 0 -30 q 0 -8 8 -8 l 24 0 q 8 0 8 8 l 0 30" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 16}" y="${FLOOR - 26}" width="32" height="12" rx="4" fill="#1d1610" stroke="${DIMINK}"/></g>`,
  pews: (x) => `<g class="prop"><rect x="${x - 32}" y="${FLOOR - 26}" width="64" height="5" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 32}" y="${FLOOR - 44}" width="6" height="44" fill="${PANEL}" stroke="${DIMINK}"/><line x1="${x - 20}" y1="${FLOOR - 21}" x2="${x - 20}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="2.5"/><line x1="${x + 24}" y1="${FLOOR - 21}" x2="${x + 24}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="2.5"/></g>`,
  altar: (x) => `<g class="prop"><rect x="${x - 26}" y="${FLOOR - 48}" width="52" height="48" fill="${PANEL}" stroke="${INK}"/><rect x="${x - 32}" y="${FLOOR - 54}" width="64" height="7" fill="${PANEL}" stroke="${INK}"/><circle cx="${x}" cy="${FLOOR - 26}" r="8" fill="none" stroke="${DIMINK}"/><rect x="${x - 2.4}" y="${FLOOR - 32}" width="4.8" height="12" fill="${DIMINK}"/></g>`,
  candles: (x) => `<g class="prop">${[-12, 0, 12].map((dx, i) => `<line x1="${x + dx}" y1="${FLOOR}" x2="${x + dx}" y2="${FLOOR - 22 - i * 4}" stroke="${INK}" stroke-width="2.5"/><circle class="flame" cx="${x + dx}" cy="${FLOOR - 27 - i * 4}" r="3" fill="#e8c56a"/>`).join("")}</g>`,
  beds: (x) => `<g class="prop"><rect x="${x - 30}" y="${FLOOR - 24}" width="60" height="10" fill="#cfc3a5" stroke="${DIMINK}"/><path d="M ${x - 30} ${FLOOR - 24} q 8 -10 16 -2" fill="none" stroke="${DIMINK}"/><line x1="${x - 28}" y1="${FLOOR - 14}" x2="${x - 28}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="3"/><line x1="${x + 28}" y1="${FLOOR - 14}" x2="${x + 28}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="3"/><rect x="${x - 30}" y="${FLOOR - 40}" width="4" height="26" fill="${DIMINK}"/><ellipse cx="${x - 14}" cy="${FLOOR - 26}" rx="6" ry="4" fill="${INK}"/></g>`,
  cabinet: (x) => `<g class="prop"><rect x="${x - 18}" y="${FLOOR - 66}" width="36" height="66" fill="${PANEL}" stroke="${DIMINK}"/><line x1="${x}" y1="${FLOOR - 66}" x2="${x}" y2="${FLOOR}" stroke="${DIMINK}"/><line x1="${x - 18}" y1="${FLOOR - 44}" x2="${x + 18}" y2="${FLOOR - 44}" stroke="${DIMINK}"/><line x1="${x - 18}" y1="${FLOOR - 22}" x2="${x + 18}" y2="${FLOOR - 22}" stroke="${DIMINK}"/></g>`,
  screen: (x) => `<g class="prop"><path d="M ${x - 24} ${FLOOR} l 4 -52 l 13 3 l 0 49 z" fill="#cfc3a5" stroke="${DIMINK}"/><path d="M ${x - 7} ${FLOOR} l 0 -49 l 13 -3 l 4 52 z" fill="#c4b795" stroke="${DIMINK}"/></g>`,
  mirrors: (x) => `<g class="prop"><rect x="${x - 14}" y="${FLOOR - 80}" width="28" height="80" fill="#151a17" stroke="${DIMINK}"/><line x1="${x - 8}" y1="${FLOOR - 74}" x2="${x + 6}" y2="${FLOOR - 30}" stroke="#3d4a42" stroke-width="2"/><line x1="${x - 2}" y1="${FLOOR - 76}" x2="${x + 9}" y2="${FLOOR - 44}" stroke="#2c3630"/></g>`,
  basins: (x) => `<g class="prop"><path d="M ${x - 26} ${FLOOR - 34} l 52 0 l -6 10 l -40 0 z" fill="#cfc3a5" stroke="${DIMINK}"/><line x1="${x}" y1="${FLOOR - 24}" x2="${x}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="4"/></g>`,
  pigeonholes: (x) => { let cells = ""; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cells += `<rect x="${x - 28 + c * 14}" y="${FLOOR - 78 + r * 16}" width="14" height="16" fill="none" stroke="${DIMINK}"/>`; return `<g class="prop"><rect x="${x - 28}" y="${FLOOR - 78}" width="56" height="64" fill="${PANEL}"/>${cells}<rect x="${x - 30}" y="${FLOOR - 14}" width="60" height="14" fill="${PANEL}" stroke="${DIMINK}"/></g>`; },
  desk: (x) => `<g class="prop"><rect x="${x - 28}" y="${FLOOR - 34}" width="56" height="6" fill="${PANEL}" stroke="${INK}"/><rect x="${x - 24}" y="${FLOOR - 28}" width="12" height="28" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x + 12}" y="${FLOOR - 28}" width="12" height="28" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 8}" y="${FLOOR - 42}" width="16" height="8" fill="none" stroke="${DIMINK}"/></g>`,
  sacks: (x) => `<g class="prop sway"><line x1="${x - 10}" y1="${FLOOR - 118}" x2="${x - 8}" y2="${FLOOR - 92}" stroke="${DIMINK}"/><path d="M ${x - 16} ${FLOOR - 92} q 8 -8 16 0 q 6 22 -8 26 q -14 -4 -8 -26" fill="${PANEL}" stroke="${DIMINK}"/><line x1="${x + 12}" y1="${FLOOR - 118}" x2="${x + 13}" y2="${FLOOR - 98}" stroke="${DIMINK}"/><path d="M ${x + 6} ${FLOOR - 98} q 7 -7 14 0 q 5 18 -7 22 q -12 -4 -7 -22" fill="${PANEL}" stroke="${DIMINK}"/></g>`,
  press: (x) => `<g class="prop"><rect x="${x - 12}" y="${FLOOR - 30}" width="24" height="30" fill="${PANEL}" stroke="${INK}"/><rect x="${x - 16}" y="${FLOOR - 40}" width="32" height="10" fill="${PANEL}" stroke="${INK}"/><line x1="${x + 14}" y1="${FLOOR - 46}" x2="${x + 22}" y2="${FLOOR - 58}" stroke="${INK}" stroke-width="3"/></g>`,
  compartments: (x) => { let doors = ""; for (let i = 0; i < 6; i++) { const dx = x - 210 + i * 84; doors += `<rect x="${dx}" y="${FLOOR - 88}" width="56" height="88" fill="${PANEL}" stroke="${DIMINK}"/><circle cx="${dx + 46}" cy="${FLOOR - 42}" r="2.5" fill="${INK}"/><text x="${dx + 28}" y="${FLOOR - 70}" text-anchor="middle" font-size="11" fill="${DIMINK}">${i + 1 === 5 ? 7 : i + 1}</text>`; } return `<g class="prop">${doors}</g>`; },
  lectern: (x) => `<g class="prop"><path d="M ${x - 10} ${FLOOR} l 3 -34 l 14 0 l 3 34 z" fill="${PANEL}" stroke="${DIMINK}"/><rect x="${x - 14}" y="${FLOOR - 44}" width="38" height="10" fill="${PANEL}" stroke="${INK}" transform="rotate(-8 ${x} ${FLOOR - 39})"/></g>`,
  maps: (x) => `<g class="prop"><rect x="${x - 26}" y="${FLOOR - 96}" width="52" height="38" fill="${PANEL}" stroke="${DIMINK}"/><path d="M ${x - 20} ${FLOOR - 66} q 12 -18 24 -8 q 10 8 16 -6" fill="none" stroke="${DIMINK}"/><circle cx="${x + 6}" cy="${FLOOR - 76}" r="2" fill="${INK}"/></g>`,
  boiler: (x) => `<g class="prop"><ellipse cx="${x}" cy="${FLOOR - 46}" rx="66" ry="46" fill="${PANEL}" stroke="${INK}" stroke-width="2"/><ellipse class="breathe" cx="${x}" cy="${FLOOR - 46}" rx="52" ry="34" fill="none" stroke="${DIMINK}"/><path d="M ${x + 40} ${FLOOR - 80} q 30 -14 60 -8 M ${x + 46} ${FLOOR - 60} q 36 -4 66 6" fill="none" stroke="${DIMINK}" stroke-width="4"/><line x1="${x - 66}" y1="${FLOOR}" x2="${x + 66}" y2="${FLOOR}" stroke="${INK}"/></g>`,
  gauges: (x) => `<g class="prop"><rect x="${x - 30}" y="${FLOOR - 92}" width="60" height="52" fill="${PANEL}" stroke="${INK}"/>${[-16, 0, 16].map((dx) => `<circle cx="${x + dx}" cy="${FLOOR - 76}" r="6" fill="none" stroke="${DIMINK}"/><line x1="${x + dx}" y1="${FLOOR - 76}" x2="${x + dx + 4}" y2="${FLOOR - 80}" stroke="${INK}"/>`).join("")}<rect x="${x - 24}" y="${FLOOR - 58}" width="48" height="12" fill="none" stroke="${DIMINK}"/><line x1="${x}" y1="${FLOOR - 40}" x2="${x}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="4"/></g>`,
  bulkhead: (x) => `<g class="prop"><rect x="${x - 40}" y="18" width="80" height="${FLOOR - 18}" fill="#060404" stroke="${INK}" stroke-width="2"/>${[0, 1, 2, 3].map((i) => `<circle cx="${x - 30}" cy="${34 + i * 36}" r="2.6" fill="${DIMINK}"/><circle cx="${x + 30}" cy="${34 + i * 36}" r="2.6" fill="${DIMINK}"/>`).join("")}<rect x="${x - 16}" y="${FLOOR - 84}" width="32" height="10" fill="none" stroke="${DIMINK}"/><rect x="${x - 12}" y="${FLOOR - 62}" width="24" height="5" fill="${DIMINK}"/></g>`,
  notice: (x) => `<g class="prop"><rect x="${x - 12}" y="${FLOOR - 104}" width="24" height="30" fill="#cfc3a5" stroke="${DIMINK}"/><line x1="${x - 7}" y1="${FLOOR - 96}" x2="${x + 7}" y2="${FLOOR - 96}" stroke="${DIMINK}"/><line x1="${x - 7}" y1="${FLOOR - 90}" x2="${x + 7}" y2="${FLOOR - 90}" stroke="${DIMINK}"/><line x1="${x - 7}" y1="${FLOOR - 84}" x2="${x + 4}" y2="${FLOOR - 84}" stroke="${DIMINK}"/></g>`,
  trio: (x) => `<g class="prop">${fig(x - 16, { hat: "none" })}${fig(x + 8, { hat: "none" })}<path d="M ${x - 22} ${FLOOR - 30} q -8 10 0 20" fill="none" stroke="${INK}" stroke-width="2"/></g>`,
  npc: null, // handled specially (interactive-ish figure from data)
};

function renderScene() {
  const slot = $("#scene-slot");
  if (!slot) return;
  const st = view.status;
  const scene = view.scene || {};
  const parts = [];

  // shell: wall panelling, floor, ceiling
  parts.push(`<rect x="0" y="0" width="${SCENE_W}" height="${SCENE_H}" fill="#1a140e"/>`);
  parts.push(`<rect x="0" y="${FLOOR}" width="${SCENE_W}" height="${SCENE_H - FLOOR}" fill="#120d08"/>`);
  parts.push(`<line x1="0" y1="${FLOOR}" x2="${SCENE_W}" y2="${FLOOR}" stroke="${DIMINK}" stroke-width="1.5"/>`);
  parts.push(`<rect x="0" y="0" width="${SCENE_W}" height="14" fill="#0f0b07"/>`);
  parts.push(`<line x1="0" y1="14" x2="${SCENE_W}" y2="14" stroke="${DIMINK}"/>`);
  for (let wx = 90; wx < SCENE_W - 60; wx += 130) {
    // windows with the night streaking past — the train is always moving
    parts.push(`<rect x="${wx}" y="30" width="64" height="52" rx="6" fill="${DARK}" stroke="${DIMINK}"/>
      <g clip-path="inset(0)"><line class="streak s1" x1="${wx + 6}" y1="46" x2="${wx + 26}" y2="46" stroke="#3a332a" stroke-width="2"/>
      <line class="streak s2" x1="${wx + 20}" y1="62" x2="${wx + 44}" y2="62" stroke="#2c261f" stroke-width="2"/></g>`);
  }
  for (const lx of [280, 700, 1120]) {  // hanging lamps
    parts.push(`<g class="lamp-swing" style="transform-origin:${lx}px 14px">
      <line x1="${lx}" y1="14" x2="${lx}" y2="34" stroke="${DIMINK}"/>
      <path d="M ${lx - 10} 34 l 20 0 l -5 10 l -10 0 z" fill="${PANEL}" stroke="${INK}"/>
      <circle class="lampglow" cx="${lx}" cy="47" r="26" fill="#e8c56a" opacity="0.08"/>
      <circle cx="${lx}" cy="46" r="4" fill="#e8c56a" opacity="0.85"/></g>`);
  }

  // props from carriage data
  for (const p of scene.props || []) {
    const x = (p.x || 0.5) * SCENE_W;
    if (p.type === "npc") {
      parts.push(`<g class="npc">${fig(x, p)}</g>`);
    } else if (PROPS[p.type]) {
      parts.push(PROPS[p.type](x));
    }
  }

  // the party, clustered mid-car; click a figure to switch observer
  const living = (view.party || []).filter((c) => c.alive);
  living.forEach((c, i) => {
    const x = SCENE_W * 0.47 + (i - (living.length - 1) / 2) * 40;
    const hurt = c.health / c.max_health <= 0.4;
    const shaky = c.composure <= 3;
    const cls = ["pcfig", c.active ? "obs" : "", shaky ? "tremble" : ""].join(" ");
    const tilt = hurt ? `transform="rotate(6 ${x} ${FLOOR})"` : "";
    parts.push(`<g class="${cls}" data-char="${esc(c.id)}" ${tilt}>
      <title>${esc(c.name)} — ${esc(c.profession)}${c.active ? " (observer)" : " — look through their eyes"}</title>
      ${c.active ? `<ellipse cx="${x}" cy="${FLOOR + 6}" rx="24" ry="5" fill="#e8c56a" opacity="0.18"/>` : ""}
      ${fig(x, { hat: HAT_FOR[c.profession_id] || "none" })}
      ${c.active ? `<text x="${x}" y="${SCENE_H - 4}" text-anchor="middle" font-size="11" fill="#b08d3e" letter-spacing="2">${esc(c.name.split(" ")[0].toUpperCase())}</text>` : ""}
    </g>`);
  });

  // node markers
  const nodePos = scene.nodes || {};
  (view.nodes || []).forEach((n, i) => {
    const x = (nodePos[n.id] !== undefined ? nodePos[n.id] : 0.2 + i * 0.15) * SCENE_W;
    const open = view.node_detail && view.node_detail.id === n.id;
    parts.push(`<g class="marker ${open ? "open" : ""}" data-node="${esc(n.id)}">
      <title>${esc(n.name)}</title>
      <circle cx="${x}" cy="${FLOOR + 11}" r="8" fill="#171008" stroke="#b08d3e"/>
      <path d="M ${x} ${FLOOR + 6.5} l 4.5 4.5 l -4.5 4.5 l -4.5 -4.5 z" fill="#b08d3e"/>
    </g>`);
  });

  // doors: rear (left, into the dark) and forward exits (right)
  parts.push(`<rect x="4" y="26" width="34" height="${FLOOR - 26}" fill="#0a0705" stroke="${DIMINK}"/>
    <circle cx="32" cy="100" r="2.5" fill="${DIMINK}"/>`);
  (view.exits || []).forEach((x_, i) => {
    const dx = SCENE_W - 42 - i * 46;
    const armed = ui.armedExit === x_.id;
    parts.push(`<g class="door ${x_.open ? "open" : "locked"} ${armed ? "armed" : ""}" data-exit="${esc(x_.id)}">
      <title>${esc(x_.label)}${x_.open ? (armed ? " — click again to go" : "") : " (locked)"}</title>
      <rect x="${dx}" y="26" width="36" height="${FLOOR - 26}" fill="${x_.open ? "#1d150c" : "#0a0705"}" stroke="${x_.open ? "#b08d3e" : DIMINK}" stroke-width="${armed ? 2.5 : 1.4}"/>
      <circle cx="${dx + 6}" cy="100" r="2.5" fill="${x_.open ? "#b08d3e" : DIMINK}"/>
      ${x_.open ? `<path d="M ${dx + 12} 92 l 12 8 l -12 8 z" fill="#b08d3e" opacity="0.9"/>`
                : `<g><rect x="${dx + 12}" y="92" width="12" height="10" fill="none" stroke="${DIMINK}" stroke-width="2"/><path d="M ${dx + 15} 92 v -4 a 3 3 0 0 1 6 0 v 4" fill="none" stroke="${DIMINK}" stroke-width="2"/></g>`}
    </g>`);
  });

  // the Blackout pours in from the rear as it closes
  const d = st.blackout_distance;
  if (d <= 2) {
    const reach = d <= 0 ? 420 : d === 1 ? 210 : 90;
    parts.push(`<g class="veil"><rect x="0" y="0" width="${reach}" height="${SCENE_H}" fill="url(#veilgrad)"/>
      <path class="tendril" d="M ${reach - 40} 20 q 40 30 10 70 q -25 45 30 70" fill="none" stroke="#000" stroke-width="7" opacity="0.75"/>
      <path class="tendril t2" d="M ${reach - 15} 0 q 25 60 -12 110 q -18 40 22 80" fill="none" stroke="#000" stroke-width="5" opacity="0.6"/></g>`);
  }

  slot.innerHTML = `
  <div class="scene-band">
    <svg viewBox="0 0 ${SCENE_W} ${SCENE_H}" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="The interior of ${esc(st.carriage)}">
      <defs><linearGradient id="veilgrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000"/><stop offset="0.75" stop-color="#000" stop-opacity="0.85"/>
        <stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
      ${parts.join("\n")}
    </svg>
  </div>`;
  slot.querySelectorAll(".pcfig").forEach((g) => {
    g.addEventListener("click", () => post("observer", { char: g.dataset.char }));
  });
  slot.querySelectorAll(".marker").forEach((g) => {
    g.addEventListener("click", () => post("inspect", { node: g.dataset.node }));
  });
  slot.querySelectorAll(".door").forEach((g) => {
    g.addEventListener("click", () => {
      const id = g.dataset.exit;
      const x_ = view.exits.find((e) => e.id === id);
      if (!x_.open) { post("exit", { exit: id }); return; }
      if (ui.armedExit === id) { ui.armedExit = null; post("exit", { exit: id }); return; }
      ui.armedExit = id;
      renderScene();
      renderStage();
    });
  });
}

/* ------------------------------ rail ------------------------------- */
function renderRail() {
  const rail = $("#rail");
  const cards = (view.party || []).map((c) => partyCardHTML(c)).join("");
  rail.innerHTML = `
    <div class="party-list">${cards}</div>
    <div class="tabbox">
      <div class="tabs">
        ${["inventory", "evidence", "journal", "bonds", "history"].map((t) =>
          `<button data-tab="${t}" class="${ui.tab === t ? "on" : ""}">${t}</button>`).join("")}
      </div>
      <div class="tab-body" id="tab-body"></div>
    </div>
    <div class="save-row">
      <button id="btn-save">Save</button>
      <button id="btn-menu">Leave the aisle (menu)</button>
    </div>`;
  rail.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => { ui.tab = b.dataset.tab; renderRail(); };
  });
  renderTab();
  rail.querySelectorAll(".party-card").forEach((card) => {
    card.onclick = (ev) => {
      if (ev.target.closest(".observe-btn")) return;
      const id = card.dataset.char;
      if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id);
      renderRail();
    };
  });
  rail.querySelectorAll(".observe-btn").forEach((b) => {
    b.onclick = () => post("observer", { char: b.dataset.char });
  });
  $("#btn-save").onclick = () => post("save");
  $("#btn-menu").onclick = () => post("title");
}

function partyCardHTML(c) {
  const expanded = ui.expanded.has(c.id);
  const cls = ["party-card", c.active ? "observer" : "", c.alive ? "" : "dead",
               expanded ? "expanded" : ""].join(" ");
  const chips = [
    ...c.conditions.map((x) => `<span class="chip cond">${esc(x)}</span>`),
    ...c.scars.map((x) => `<span class="chip scar">‡ ${esc(x)}</span>`),
  ].join("");
  const attrs = Object.entries(c.attrs || {})
    .map(([k, v]) => `<span><b>${v}</b> ${esc(k.slice(0, 4))}</span>`).join("");
  const skills = Object.entries(c.skills || {}).map(([k, v]) => `${esc(k)} ${v}`).join(", ");
  const mems = (c.memories || []).map((m) => `<div class="pc-line mem">— ${esc(m.text)}</div>`).join("");
  return `
  <div class="${cls}" data-char="${esc(c.id)}">
    <div class="pc-head">
      <span class="pc-name">${esc(c.name)}</span>
      <span class="pc-prof">${esc(c.profession)}</span>
      ${c.alive ? (c.active ? '<span class="pc-obs-tag">observer</span>' : "")
                : `<span class="pc-fate">✝ ${esc(c.fate || "dead")}</span>`}
    </div>
    <div class="bar-row"><div class="bar hp"><i style="width:${(100 * c.health) / c.max_health}%"></i></div>
      <span class="bar-num">${c.health}/${c.max_health}</span></div>
    <div class="bar-row"><div class="bar comp"><i style="width:${(100 * c.composure) / c.max_composure}%"></i></div>
      <span class="bar-num">${c.composure}/${c.max_composure}</span></div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    <div class="pc-body">
      <div class="pc-line">${c.age}, ${esc(c.pronouns)} — from ${esc(c.background)}</div>
      <div class="attr-grid">${attrs}</div>
      <div class="pc-line"><b>Skills:</b> ${skills}</div>
      <div class="pc-line"><b>Traits:</b> ${esc(c.trait_positive)} / ${esc(c.trait_difficult)}</div>
      <div class="pc-line"><b>Fear:</b> ${esc(c.fear)}</div>
      <div class="pc-line secret"><b>Secret:</b> ${esc(c.secret)}</div>
      ${mems}
      ${c.alive && !c.active ? `<button class="observe-btn" data-char="${esc(c.id)}">Look through their eyes</button>` : ""}
    </div>
  </div>`;
}

function renderTab() {
  const el = $("#tab-body");
  if (ui.tab === "inventory") {
    const res = Object.entries(view.resources || {})
      .map(([k, v]) => `<span class="res-chip">${esc(k)} <b>${v}</b></span>`).join("");
    el.innerHTML = `<div class="res-row">${res}</div>` +
      ((view.inventory || []).map((i) =>
        `<div class="inv-item"><b>${esc(i.name)}</b>${i.count > 1 ? " ×" + i.count : ""}
         <div class="i-desc">${esc(i.desc)}</div></div>`).join("") ||
        '<em style="color:var(--smoke)">Empty pockets, empty hands.</em>');
  } else if (ui.tab === "evidence") {
    el.innerHTML = (view.evidence || []).map((e) =>
      `<div class="evi-card"><div class="e-cat">${esc(e.category)}</div>
       <div class="e-title">${esc(e.title)}</div>
       <div class="e-text">${esc(e.text)}</div></div>`).join("") ||
      '<em style="color:var(--smoke)">Nothing pinned yet. The train is still all questions.</em>';
  } else if (ui.tab === "journal") {
    const rules = (view.rules || []).map((r) => `<div class="rule-line">${esc(r)}</div>`).join("");
    const jr = (view.journal || []).map((j) => `<div class="jr-line">${esc(j)}</div>`).join("");
    el.innerHTML = (rules ? `<div style="margin-bottom:10px">${rules}</div>` : "") + jr ||
      '<em style="color:var(--smoke)">The journal is blank. So far.</em>';
  } else if (ui.tab === "bonds") {
    el.innerHTML = (view.relationships || []).map((r) =>
      `<div class="rel-line"><b>${esc(r.a)}</b> &amp; <b>${esc(r.b)}</b> — ${esc(r.kind)}<br>
       <span class="rel-meter">trust ${"●".repeat(r.trust)}${"○".repeat(5 - r.trust)}
       &nbsp; strain ${"●".repeat(r.strain)}${"○".repeat(5 - r.strain)}</span></div>`).join("") ||
      '<em style="color:var(--smoke)">Strangers, so far.</em>';
  } else {
    // history — the complete narrative record of the run
    el.innerHTML = (view.log || []).map((e) =>
      `<div class="hist-ev k-${esc(e.kind || "text")}">${esc(e.text)}</div>`).join("") ||
      '<em style="color:var(--smoke)">The journey has not begun.</em>';
    el.scrollTop = el.scrollHeight;
  }
}

/* ------------------------------ pending modal ----------------------- */
function renderModal() {
  if (!view.pending) { modalRoot.innerHTML = ""; return; }
  const p = view.pending;
  modalRoot.innerHTML = `
  <div class="scrim">
    <div class="modal-card">
      <div class="m-prompt">${esc(p.prompt)}</div>
      <div class="m-choices">
        ${p.candidates.map((c) =>
          `<button class="plate-btn" data-char="${esc(c.id)}">${esc(c.name)}
           &nbsp;·&nbsp; ${c.health}/${c.max_health} hp, ${c.composure}/${c.max_composure} comp</button>`).join("")}
      </div>
      ${p.optional ? '<div class="m-skip"><button id="m-skip">No one. Step back.</button></div>' : ""}
    </div>
  </div>`;
  modalRoot.querySelectorAll("[data-char]").forEach((b) => {
    b.onclick = () => post("choose", { char: b.dataset.char });
  });
  const skip = $("#m-skip");
  if (skip) skip.onclick = () => post("choose", { char: "__skip__" });
}

/* ------------------------------ ending ------------------------------ */
function renderEnding() {
  const e = view.ending;
  if (!e) { renderPlay(); return; }
  app.innerHTML = `
  <div class="ending-plate${e.victory ? "" : " defeat"}">
    <div class="ending-name">${esc(e.name)}</div>
    <div class="ending-text">${esc(e.text)}</div>
    <div class="epi-head">Epilogue</div>
    ${e.epilogue.map((p) =>
      `<div class="epi-line${p.alive ? "" : " dead"}">${esc(p.name)} — ${esc(p.fate)}.
       ${p.scars.length ? `<span class="e-scars">Scars carried: ${esc(p.scars.join(", "))}.</span>` : ""}</div>`).join("")}
    ${e.truth ? `<div class="truth"><b>${esc(e.mystery)}.</b> ${esc(e.truth)}</div>`
              : `<div class="truth">Mystery of this run: <b>${esc(e.mystery)}</b>. Its truth stays aboard.</div>`}
    <div class="end-stats">evidence ${e.stats.evidence} · rules ${e.stats.rules} ·
      carriages ${e.stats.carriages} · ${e.stats.minutes} minutes aboard</div>
    <div class="end-actions">
      <button class="plate-btn" id="btn-again">Wake in the rear carriage again</button>
    </div>
  </div>`;
  $("#btn-again").onclick = () => post("title");
}

/* ------------------------------ dev reload -------------------------- */
function devWatch() {
  let baseline = null, offline = false, reloading = false;
  const timer = setInterval(async () => {
    if (reloading) return;
    let status;
    try {
      const r = await fetch("/api/devstatus", { cache: "no-store" });
      status = await r.json();
    } catch (e) {
      offline = true;   // server restarting — keep polling until it returns
      return;
    }
    if (!status.dev) { clearInterval(timer); return; }
    const key = JSON.stringify([status.token, status.gen, status.assets]);
    if (baseline === null && !offline) { baseline = key; return; }
    if (key !== baseline || offline) {
      reloading = true;
      toast("The train has been rebuilt. Reboarding…");
      setTimeout(() => location.reload(), 500);
    }
  }, 1500);
}

/* ------------------------------ boot ------------------------------- */
(async function boot() {
  try {
    const res = await fetch("/api/view");
    view = await res.json();
  } catch (e) {
    app.innerHTML = "<p style='padding:40px;text-align:center'>The train could not be reached.</p>";
    return;
  }
  render();
  devWatch();
})();
