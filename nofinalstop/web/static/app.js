/* NO FINAL STOP — browser client. Vanilla JS; the server owns all game logic. */
"use strict";

let view = null;
const ui = {
  tab: "inventory",
  expanded: new Set(),
  armedExit: null,
  partySize: 4,
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
  if (view.phase === "title") renderTitle();
  else if (view.phase === "chargen") renderChargen();
  else if (view.phase === "ending") renderEnding();
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
  app.innerHTML = `
    ${topbarHTML(st)}
    <div class="play-grid">
      <section class="paper">
        <div id="log"></div>
        ${st.observer_tint ? `<div class="tint-note">(${esc(st.observer)}: ${esc(st.observer_tint)})</div>` : ""}
        <div id="stage"></div>
      </section>
      <aside class="rail" id="rail"></aside>
    </div>`;
  renderLog();
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

function renderLog() {
  const el = $("#log");
  el.innerHTML = (view.log || []).map((e) => {
    const k = e.kind || "text";
    if (k === "arrive") return `<div class="ev ev-arrive">${esc(e.text)}</div>`;
    return `<div class="ev ev-${esc(k)}">${esc(e.text)}</div>`;
  }).join("");
  el.scrollTop = el.scrollHeight;
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

/* ------------------------------ rail ------------------------------- */
function renderRail() {
  const rail = $("#rail");
  const cards = (view.party || []).map((c) => partyCardHTML(c)).join("");
  rail.innerHTML = `
    ${cards}
    <div class="tabbox">
      <div class="tabs">
        ${["inventory", "evidence", "journal", "bonds"].map((t) =>
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
  } else {
    el.innerHTML = (view.relationships || []).map((r) =>
      `<div class="rel-line"><b>${esc(r.a)}</b> &amp; <b>${esc(r.b)}</b> — ${esc(r.kind)}<br>
       <span class="rel-meter">trust ${"●".repeat(r.trust)}${"○".repeat(5 - r.trust)}
       &nbsp; strain ${"●".repeat(r.strain)}${"○".repeat(5 - r.strain)}</span></div>`).join("") ||
      '<em style="color:var(--smoke)">Strangers, so far.</em>';
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
})();
