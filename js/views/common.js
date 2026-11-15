// Gemeinsame Bausteine der Ansichten (Design A · Kompakt)
import { esc, activePlayers, spectatorsOf, scoreOf, answersFor, qCount, isOpenType, timerLeft, speedLead, fmtMs, jokerOf, resultFor, ranking } from "../model.js";

export const L = i => String.fromCharCode(65 + i);

// ── Symbole (Strich-SVG, erben die Textfarbe) ──
const svg = (d, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  dots: s => svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', s),
  check: s => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', s),
  x: s => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
  chev: s => svg('<path d="M9 6l6 6-6 6"/>', s),
  back: s => svg('<path d="M15 6l-6 6 6 6"/>', s),
  clock: s => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  share: s => svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>', s),
  eye: s => svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', s),
  play: s => svg('<path d="M7 5l12 7-12 7z"/>', s),
  pause: s => svg('<path d="M8 5v14M16 5v14"/>', s),
  reset: s => svg('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>', s),
  theme: s => svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>', s),
  full: s => svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', s),
  bug: s => svg('<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5l1.5 2M15 5l-1.5 2M3 13h4M17 13h4M4 19l3-2M20 19l-3-2"/>', s),
  trash: s => svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', s),
  bulb: s => svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>', s),
  search: s => svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', s)
};

// ── Kopfzeile außerhalb des Spiels ──
export function topBar(title, sub = "", { back = null, connected = true } = {}) {
  const left = back ? `<button class="icon-btn" data-act="${back}" aria-label="Zurück">${ICON.back()}</button>` : "";
  return `<div class="top">${left}
    <div class="top-main"><div class="top-title">${title}</div>${sub ? `<div class="top-sub">${sub}</div>` : ""}</div>
    ${menuBtn(connected)}</div>`;
}
export const menuBtn = (connected = true) =>
  `<button class="icon-btn" data-act="menu" aria-label="Menü">${ICON.dots()}${connected ? "" : '<span class="badge"></span>'}</button>`;

// ── Segmentierte Fragenleiste ──
// Spieler: eigene Ergebnisse grün/rot; Moderator/Zuschauer: alle richtig grün, keiner rot, gemischt gold
export function segBar(room, uid, own) {
  const total = qCount(room);
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const players = activePlayers(room);
  let html = "";
  for (let i = 0; i < total; i++) {
    const r = resultFor(room, i);
    let cls = "";
    if (r && (i < qi || (i === qi && g.phase === "revealed") || g.phase === "finished")) {
      if (own) cls = r.points?.[uid] ? "ok" : "no";
      else {
        const n = players.filter(p => r.points?.[p.uid]).length;
        cls = n === 0 ? "no" : n === players.length ? "ok" : "mix";
      }
    } else if (i === qi && g.phase !== "finished") cls = "cur";
    html += `<span class="seg ${cls}"></span>`;
  }
  return `<div class="segs" aria-label="Fortschritt: Frage ${qi + 1} von ${total}">${html}</div>`;
}

// ── Timer (Zahl/Balken werden per requestAnimationFrame aktualisiert: ids tchip/tnum/tbar) ──
function timerChip(room) {
  if ((room.settings?.timerMode || "none") === "none") return "";
  const left = timerLeft(room, Date.now());
  const off = room.game?.phase !== "answering";
  return `<div class="timer-chip${off ? " off" : ""}" id="tchip">${ICON.clock(18)}<span class="t-num" id="tnum">${Math.ceil(left)}s</span></div>`;
}
function timerBar(room) {
  if ((room.settings?.timerMode || "none") === "none") return "";
  const sec = room.settings?.timerSec || 30;
  const pct = Math.max(0, Math.min(100, timerLeft(room, Date.now()) / sec * 100));
  return `<div class="tbar"><div class="tbar-fill" id="tbar" style="width:${pct}%"></div></div>`;
}

// ── Kopf im Spiel: Frage x/y + Segmente, Timer, Rolle, Menü; darunter Spieler-Chips ──
export function gameHeader(s, mode) {
  const room = s.room, uid = s.uid;
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const specN = spectatorsOf(room).length;
  const role = mode === "mod" ? `<span class="role">Moderator</span>`
    : mode === "spec" ? `<span class="role spec">Zuschauer</span>` : "";
  const top = `<div class="top">
    <div class="top-main"><div class="top-title sm">Frage ${qi + 1} / ${qCount(room)}${specN ? ` <span class="muted small" style="font-weight:500">· ${ICON.eye(14)} ${specN}</span>` : ""}</div>${segBar(room, uid, mode === "player")}</div>
    ${timerChip(room)}${role}${menuBtn(s.connected)}</div>`;
  return top + timerBar(room) + (mode === "mod" ? modChips(room) : playerChips(room, uid));
}

function playerChips(room, uid) {
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const answers = answersFor(room, qi);
  const open = g.phase === "answering" || g.phase === "locked";
  const lead = speedLead(room)?.leader?.uid;
  return `<div class="chips">${activePlayers(room).map(p => {
    let st = "";
    if (open) st = answers[p.uid] ? `<span class="chip-st ok" aria-label="eingeloggt">${ICON.check(16)}</span>` : `<span class="chip-st">…</span>`;
    if (open && jokerOf(room, p.uid)?.q === qi) st = `<span class="chip-st gold">50:50</span>` + st;
    return `<div class="chip${p.uid === uid ? " me" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span>
      <span class="chip-name">${esc(p.name)}${lead === p.uid ? " ⚡" : ""}</span>${st}
      <span class="chip-pts">${scoreOf(room, p.uid)}</span></div>`;
  }).join("")}</div>`;
}

// Moderator: Zeit und Joker direkt in der Karte des Spielers
function modChips(room) {
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const q = room.questions?.[qi];
  const answers = answersFor(room, qi);
  const res = resultFor(room, qi);
  const mcOpen = q && !isOpenType(q) && g.phase === "answering";
  return `<div class="chips">${activePlayers(room).map(p => {
    const a = answers[p.uid];
    const j = jokerOf(room, p.uid);
    let sub = a ? `${fmtMs(a.ms)} ✓` : (g.phase === "answering" ? "denkt nach …" : "keine Antwort");
    if (a && res?.fastestUid === p.uid) sub = `${fmtMs(a.ms)} ⚡`;
    let jk = "";
    if (j && j.q === qi) jk = `<span class="chip-st gold">50:50 aktiv</span>`;
    else if (mcOpen && !j) jk = `<button class="mini-btn" data-act="joker" data-arg="${p.uid}" ${a ? "disabled" : ""} aria-label="50:50-Joker für ${esc(p.name)}">50:50</button>`;
    else if (mcOpen && j) jk = `<span class="chip-st">Joker weg</span>`;
    return `<div class="chip2">
      <div class="chip2-r"><span class="dot ${p.online ? "on" : "off"}"></span><span class="chip-name">${esc(p.name)}</span><span class="chip-pts">${scoreOf(room, p.uid)}</span></div>
      <div class="chip2-r"><span class="chip2-sub">${sub}</span>${jk}</div></div>`;
  }).join("")}</div>`;
}

// ── Frage, Hintergrund, Ergebnis ──
export function questionCard(q, compact = false) {
  const type = q.type === "estimate" ? `<span class="q-type">Schätzfrage</span>` : q.type === "open" ? `<span class="q-type">Freitext</span>` : "";
  const cat = q.cat || type ? `<div class="q-cat">${q.cat ? esc(q.cat) : ""}${type}</div>` : "";
  return `<div class="q-card${compact ? " compact" : ""}">${cat}<div class="q-text">${esc(q.q)}</div></div>`;
}

// Hintergrund: kleiner Reiter am rechten Rand; ein Tipp schiebt eine eigene Seite mit den Fakten herein,
// ein zweiter Tipp (oder die Zurück-Taste) schiebt sie wieder weg
export function factPanel(q, open, { title = "Hintergrund", animate = false } = {}) {
  const fact = q?.fact || q?.erklaerung;
  if (!fact) return "";
  const sol = q.type === "estimate" || q.type === "open" ? formatValue(q, q.answer) : esc(q.a?.[q.r] ?? "");
  const tab = `<button class="fact-tab${open ? " open" : ""}" data-act="toggleFact" aria-expanded="${open}" aria-label="${open ? "Hintergrund schließen" : "Hintergrund anzeigen"}">
      <span class="fact-tab-ico">${open ? ICON.chev(18) : ICON.bulb(18)}</span><span class="fact-tab-txt">${open ? "Zurück" : "Fakten"}</span></button>`;
  if (!open) return tab;
  return `<div class="fact-page${animate ? " in" : ""}" id="fact-page" role="dialog" aria-label="${esc(title)}">
      <div class="fact-page-inner">
        <div class="fact-h">${esc(title)}</div>
        <div class="fact-q">${esc(q.q)}</div>
        ${sol ? `<div class="fact-sol"><b>Richtig:</b> ${sol}</div>` : ""}
        <div class="fact-text">${esc(fact)}</div>
      </div>
    </div>${tab}`;
}

// Zwischenstand in einem Satz
export function standing(room, uid) {
  const rk = ranking(room);
  if (!rk.length) return "";
  if (rk.length === 1) { const p = rk[0]; return `${p.correct} von ${(room.game?.qIndex ?? 0) + 1} richtig`; }
  const top = rk[0], second = rk[1];
  if (top.score === second.score) {
    const tied = rk.filter(p => p.score === top.score);
    return tied.length === rk.length ? `Gleichstand ${top.score} : ${second.score}` : `Gleichstand vorne: ${tied.map(p => esc(p.name)).join(" & ")}`;
  }
  const pair = `${top.score} : ${second.score}`;
  return top.uid === uid ? `Du führst ${pair}` : `${esc(top.name)} führt ${pair}`;
}

export function resultBanner(kind, big, sub) {
  const ico = kind === "ok" ? ICON.check(20) : kind === "no" ? ICON.x(20) : "–";
  return `<div class="result ${kind}"><span class="result-ico">${ico}</span>
    <div style="flex:1;min-width:0"><div class="result-big">${big}</div>${sub ? `<div class="result-sub">${sub}</div>` : ""}</div></div>`;
}

// ── Lobby: Plätze 2×2 ──
export function slots(room, uid, max = 4) {
  const ps = activePlayers(room);
  let html = ps.map(p => `<div class="slot${p.ready ? " ready" : ""}${p.uid === uid ? " me" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span><span class="slot-name">${esc(p.name)}</span>
      <span class="slot-tag">${p.ready ? "Bereit ✓" : "wartet"}</span></div>`).join("");
  for (let i = ps.length; i < max; i++) html += `<div class="slot empty">frei</div>`;
  return `<div class="slots">${html}</div>`;
}
export function spectatorLine(room) {
  const sp = spectatorsOf(room);
  if (!sp.length) return "";
  return `<div class="meta-line">${ICON.eye(16)} ${sp.length === 1 ? "1 Zuschauer" : `${sp.length} Zuschauer`}: ${sp.map(p => esc(p.name)).join(", ")}</div>`;
}

export const shortName = n => esc(String(n || "").slice(0, 6));

export function formatValue(q, v) {
  if (v == null) return "";
  if (!isOpenType(q)) return esc(q.a?.[v] ?? v);
  if (q.type === "estimate" && typeof v === "number") return v.toLocaleString("de-DE");
  return esc(v);
}
