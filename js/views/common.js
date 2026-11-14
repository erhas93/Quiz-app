// Gemeinsame Bausteine der Ansichten
import { esc, activePlayers, spectatorsOf, scoreOf, answersFor, qCount, isOpenType, timerLeft, speedLead, fmtMs, jokerOf } from "../model.js";

export const L = i => String.fromCharCode(65 + i);

const CAT_COLORS = ["#2A9D8F", "#E9C46A", "#F4A261", "#E76F51", "#4f86c6", "#9b59b6", "#27ae60", "#e91e8c", "#16a085", "#d35400"];
export function catBadge(cat) {
  if (!cat) return "";
  let h = 0; for (const ch of cat) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = CAT_COLORS[h % CAT_COLORS.length];
  return `<span class="q-cat" style="background:${c}1a;border:1px solid ${c}55;color:${c}">${esc(cat)}</span>`;
}

export function questionBox(q) {
  const tag = q.type === "estimate" ? `<div class="type-tag" style="margin-top:10px">Schätzfrage</div>`
    : q.type === "open" ? `<div class="type-tag" style="margin-top:10px">Freitextfrage</div>` : "";
  return `<div class="q-box">${catBadge(q.cat)}<div class="q-text">${esc(q.q)}</div>${tag}</div>`;
}

export function factBox(q) {
  const fact = q?.fact || q?.erklaerung;
  if (!fact) return "";
  return `<div class="fact-box"><div class="label" style="color:rgba(233,196,106,.85);margin-bottom:6px">Hintergrund</div><div class="fact-text">${esc(fact)}</div></div>`;
}

// Kopfzeile im Spiel: Rolle, Fragennummer, Punkte aller Spieler, Fortschritt
// Timerzeile: Zahl + Balken werden zwischen den Renders per requestAnimationFrame aktualisiert (ids tnum/tbar)
function timerRow(room, isMod) {
  const mode = room.settings?.timerMode || "none";
  if (mode === "none") return "";
  const g = room.game || {};
  const sec = room.settings?.timerSec || 30;
  const left = timerLeft(room, Date.now());
  const pct = Math.max(0, Math.min(100, left / sec * 100));
  const t = g.timer || {};
  let btns = "";
  if (isMod && mode === "manual" && g.phase === "answering") {
    if (t.running) btns = `<button class="btn btn-danger btn-sm" data-act="timerPause">Pause</button>`;
    else btns = `<button class="btn btn-primary btn-sm" data-act="timerStart">${t.pauseLeft != null ? "Weiter" : "Start"}</button>`;
    if (t.running || t.pauseLeft != null) btns += `<button class="btn btn-ghost btn-sm" data-act="timerReset">Reset</button>`;
  }
  const active = g.phase === "answering";
  return `<div class="timer-row${active ? "" : " off"}">
    <span class="t-num" id="tnum">${Math.ceil(left)}s</span>
    <div class="t-track"><div class="t-fill" id="tbar" style="width:${pct}%"></div></div>
    ${btns ? `<span class="t-btns">${btns}</span>` : ""}</div>`;
}

export function gameHeader(room, uid, roleLabel, isMod) {
  const g = room.game || {};
  const total = qCount(room);
  const qi = g.qIndex ?? 0;
  const answers = answersFor(room, qi);
  const chips = activePlayers(room).map(p => {
    let state = "";
    if (g.phase === "answering" || g.phase === "locked") state = answers[p.uid] ? `<span class="chip-state ok">✓</span>` : `<span class="chip-state">…</span>`;
    if (jokerOf(room, p.uid)?.q === qi && (g.phase === "answering" || g.phase === "locked")) state = `<span class="chip-state" style="color:var(--c3)">50:50</span>` + state;
    return `<div class="chip${p.uid === uid ? " me" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span>
      <span class="chip-name">${esc(p.name)}</span>${state}
      <span class="chip-pts">${scoreOf(room, p.uid)}</span></div>`;
  }).join("");
  const pct = total ? ((qi + (g.phase === "revealed" ? 1 : 0)) / total * 100) : 0;
  const sl = speedLead(room);
  const lead = sl ? `<div class="speed-lead">⚡ <b>${esc(sl.leader.name)}</b> ist im Schnitt am schnellsten · Δ ${fmtMs(sl.delta)}</div>` : "";
  return `<div class="g-hdr">
    <div class="hdr-r1"><div class="hdr-badge${isMod ? " mod" : ""}">${esc(roleLabel)}</div>
      <div class="hdr-qnum">${spectatorsOf(room).length ? `<span title="Zuschauer">👁 ${spectatorsOf(room).length}</span> · ` : ""}Frage ${qi + 1} / ${total}</div></div>
    <div class="chips">${chips}</div>
    ${lead}
    <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%"></div></div>
    ${timerRow(room, isMod)}
  </div>`;
}

export function playerList(room, uid, { showReady = true } = {}) {
  const items = Object.entries(room.players || {}).length ? null : `<div class="muted small">Noch niemand da.</div>`;
  if (items) return items;
  const pres = room.presence || {};
  const all = Object.entries(room.players).map(([id, p]) => ({ uid: id, ...p, online: !!pres[id]?.online }))
    .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  return `<div class="plist">${all.map(p => `
    <div class="pitem${p.uid === uid ? " me" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span>
      <span class="pitem-name">${esc(p.name)}${p.uid === uid ? " (du)" : ""}</span>
      ${p.role === "moderator" ? `<span class="tag mod">Moderator</span>` : p.role === "spectator" ? `<span class="tag">Zuschauer</span>`
        : showReady ? `<span class="tag${p.ready ? " ok" : ""}">${p.ready ? "Bereit ✓" : "Wartet"}</span>` : ""}
    </div>`).join("")}</div>`;
}

export const shortName = n => esc(String(n || "").slice(0, 6));

export function formatValue(q, v) {
  if (v == null) return "";
  if (!isOpenType(q)) return esc(q.a?.[v] ?? v);
  if (q.type === "estimate" && typeof v === "number") return v.toLocaleString("de-DE");
  return esc(v);
}
