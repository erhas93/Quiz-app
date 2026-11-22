// Gemeinsame Bausteine der Ansichten (Design A · Kompakt)
import { serverNow } from "../firebase.js";
import { an, animKey } from "./anim.js";
import { isHints, hintLevel, hintPoints, HINT_MAX, esc, activePlayers, spectatorsOf, scoreOf, answersFor, qCount, isOpenType, timerLeft, speedLead, fmtMs, jokerOf, resultFor, ranking, isDuel, playOrder, isStartQ, pickOf, DUEL_TURNS, DIFF_LABEL, pointsOf, fmtNum, isYearQ } from "../model.js";

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
  if (isDuel(room)) return duelSegBar(room, uid, own);
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

// Duell: Segmente in Spielreihenfolge (Startfrage + 14 Züge); Farbe = wer die Punkte bekam
function duelSegBar(room, uid, own) {
  const order = playOrder(room), total = qCount(room), g = room.game || {};
  let html = "";
  for (let k = 0; k < total; k++) {
    const qi = order[k];
    const r = qi != null ? resultFor(room, qi) : null;
    let cls = "";
    if (r && !(qi === g.qIndex && g.phase !== "revealed" && g.phase !== "finished" && g.phase !== "board")) {
      const winners = Object.entries(r.points || {}).filter(([, v]) => v > 0).map(([u]) => u);
      if (own) cls = r.points?.[uid] ? "ok" : winners.length ? "no" : "";
      else cls = !winners.length ? "no" : winners.length > 1 ? "mix" : "ok";
      if (!cls) cls = "none";
    } else if (qi != null && qi === g.qIndex) cls = "cur";
    html += `<span class="seg ${cls}"></span>`;
  }
  return `<div class="segs" aria-label="Duell: ${order.length} von ${total} Feldern gespielt">${html}</div>`;
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
    <div class="top-main"><div class="top-title sm">${isDuel(room) ? (isStartQ(room, qi) ? "Startfrage" : `Zug ${pickOf(room, qi)?.turn || "?"} / ${DUEL_TURNS}`) : `Frage ${qi + 1} / ${qCount(room)}`}${specN ? ` <span class="muted small" style="font-weight:500">· ${ICON.eye(14)} ${specN}</span>` : ""}</div>${segBar(room, uid, mode === "player")}</div>
    ${timerChip(room)}${role}${menuBtn(s.connected)}</div>`;
  return top + timerBar(room) + (mode === "mod" ? modChips(room) : playerChips(room, uid)) + (isHints(room) ? hintRace(room) : "");
}

// Hinweis-Modus: Füllstand je Spieler, gemessen an der Höchstpunktzahl (4 je Frage). Zählt nur aufgelöste Fragen.
export function hintRace(room) {
  const ps = activePlayers(room);
  if (ps.length < 2) return "";
  const per = HINT_MAX + 1, n = qCount(room);
  const total = n * per;
  const done = Array.from({ length: n }, (_, qi) => resultFor(room, qi)).filter(Boolean).length;
  const left = (n - done) * per;
  const sc = ps.map(p => ({ p, v: scoreOf(room, p.uid) }));
  const sorted = [...sc].sort((a, b) => b.v - a.v);
  const lead = sorted[0].v - sorted[1].v;
  const leader = lead > 0 ? sorted[0].p : null;
  let txt = `Noch ${left} von ${total} Punkten zu holen${leader ? ` · ${esc(leader.name)} führt mit ${lead}` : ""}`;
  if (leader && lead > left) txt = `<b>${esc(leader.name)}</b> ist nicht mehr einzuholen`;
  else if (!left) txt = leader ? `${esc(leader.name)} gewinnt` : "Gleichstand";
  const row = ({ p, v }, i) => `<div class="race-row hr${i}"><span class="race-name">${esc(p.name)}</span><span class="race-track"><i data-bar="hr.${p.uid}" style="width:${Math.min(100, v / total * 100)}%"></i></span></div>`;
  return `<div class="race hint-race">${sc.map(row).join("")}<div class="race-txt">${txt}</div></div>`;
}

function playerChips(room, uid) {
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const answers = answersFor(room, qi);
  const open = g.phase === "answering" || g.phase === "locked";
  const lead = isHints(room) ? null : speedLead(room)?.leader?.uid;
  const K = animKey(room);
  return `<div class="chips">${activePlayers(room).map((p, pi) => {
    let st = "";
    // Hinweis-Modus: nur „getippt“ – bei wie vielen Punkten, sehen die Mitspieler nicht
    if (open) st = answers[p.uid] ? (isHints(room) ? `<span class="chip-st tip an-chk"${an(K + ":chk:" + p.uid)}>getippt</span>` : `<span class="chip-st ok an-chk" aria-label="eingeloggt"${an(K + ":chk:" + p.uid)}>${ICON.check(16)}</span>`) : `<span class="chip-st">…</span>`;
    if (open && jokerOf(room, p.uid)?.q === qi) st = `<span class="chip-st gold">50:50</span>` + st;
    const side = isDuel(room) ? ["pa", "pb"][pi] || "" : "";
    return `<div class="chip ${side}${p.uid === uid ? " me" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span>
      <span class="chip-name">${esc(p.name)}${lead === p.uid ? " ⚡" : ""}</span>${st}
      ${ptsHtml(room, p.uid)}</div>`;
  }).join("")}</div>`;
}

// Moderator: Zeit und Joker direkt in der Karte des Spielers
function modChips(room) {
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const q = room.questions?.[qi];
  const answers = answersFor(room, qi);
  const res = resultFor(room, qi);
  const mcOpen = q && !isOpenType(q) && g.phase === "answering" && !isHints(room);
  return `<div class="chips">${activePlayers(room).map((p, pi) => {
    const a = answers[p.uid];
    const j = jokerOf(room, p.uid);
    const side = isDuel(room) ? ["pa", "pb"][pi] || "" : "";
    let sub = a ? (isHints(room) ? `getippt · ${hintPoints(a.h)} P` : (typeof a.ms === "number" ? `${fmtMs(a.ms)} ✓` : "eingetragen ✓")) : (g.phase === "answering" ? "denkt nach …" : "keine Antwort");
    if (a && !isHints(room) && res?.fastestUid === p.uid) sub = `${fmtMs(a.ms)} ⚡`;
    let jk = "";
    if (j && j.q === qi) jk = `<span class="chip-st gold">50:50 aktiv</span>`;
    else if (mcOpen && !j) jk = `<button class="mini-btn" data-act="joker" data-arg="${p.uid}" ${a ? "disabled" : ""} aria-label="50:50-Joker für ${esc(p.name)}">50:50</button>`;
    else if (mcOpen && j) jk = `<span class="chip-st">Joker weg</span>`;
    return `<div class="chip2 ${side}">
      <div class="chip2-r"><span class="dot ${p.online ? "on" : "off"}"></span><span class="chip-name">${esc(p.name)}</span>${ptsHtml(room, p.uid)}</div>
      <div class="chip2-r"><span class="chip2-sub${a ? " an-chk" : ""}"${a ? an(animKey(room) + ":chk:" + p.uid) : ""}>${sub}</span>${jk}</div></div>`;
  }).join("")}</div>`;
}

// Punktzahl in der Spielerkarte: zählt nach dem Auflösen hoch, darüber steigt kurz „+N“ auf
function ptsHtml(room, uid) {
  const g = room.game || {}, qi = g.qIndex ?? 0;
  const K = animKey(room);
  const got = g.phase === "revealed" ? resultFor(room, qi)?.points?.[uid] || 0 : 0;
  const fl = got ? `<span class="pts-float an-float${got < 0 ? " neg" : ""}"${an(K + ":fl:" + uid, 250)}>${got > 0 ? "+" : "−"}${Math.abs(got)}</span>` : "";
  return `<span class="chip-pts${got > 0 ? " an-pts" : got < 0 ? " an-pts neg" : ""}"${got ? an(K + ":pp:" + uid, 250) : ""} data-cnt="${room.meta?.createdAt || 0}.${room.game?.startedAt || 0}.${uid}">${scoreOf(room, uid)}</span>${fl}`;
}

// ── Frage, Hintergrund, Ergebnis ──
// Die Karte hat oben rechts von Anfang an den Fakten-Knopf (blass, solange es noch nichts zu lesen gibt),
// damit beim Auflösen nichts verrutscht. factState: "off" | "on" | null (kein Fakt vorhanden)
export function questionCard(q, { room = null, factOn = false } = {}) {
  let type = q.type === "estimate" ? `<span class="q-type">Schätzfrage</span>` : q.type === "open" ? `<span class="q-type">Freitext</span>` : "";
  if (q.diff) type += `<span class="q-type diff d${q.diff}">${DIFF_LABEL[q.diff] || ""} · ${pointsOf(q)} P</span>`;
  const hasFact = !!(q.fact || q.erklaerung);
  const K = room ? animKey(room) : "x";
  const fb = hasFact ? `<button class="q-fact${factOn ? " on an-bulb" : ""}"${factOn ? an(K + ":bulb", 500) + ` data-act="toggleFact" aria-label="Fakten zur Frage anzeigen"` : ` disabled aria-label="Fakten erst nach dem Auflösen"`}>${ICON.bulb(16)}<span>Fakten</span></button>` : "";
  const cat = q.cat || type || fb ? `<div class="q-cat"><span class="q-cat-l">${q.cat ? esc(q.cat) : ""}${type}</span>${fb}</div>` : "";
  return `<div class="q-card an-qin"${an(K + ":q")}>${cat}<div class="q-text">${esc(q.q)}</div></div>`;
}

// „Unverständlich“-Knopf unter der Frage (Spieler und Moderator), zeigt auch, wie viele markiert haben
// Bewertung der Frage direkt unter der Karte – für Spieler und Moderator, jederzeit:
// zu leicht · passt · zu schwer · Fehler (eine Wahl, umentscheidbar) und „unverständlich“ (eigener Schalter)
export const FB = [["easy", "zu leicht"], ["ok", "passt"], ["hard", "zu schwer"], ["bad", "Fehler"]];
export function unclearBtn(room, qi, uid) {
  if (qi == null || qi < 0 || !room.questions?.[qi]) return "";
  const me = room.players?.[uid];
  const isMod = me?.role === "moderator";
  const cur = isMod ? room.feedback?.[qi] || null : me?.fb?.["q" + qi] || null;
  const mine = !!me?.unclear?.["q" + qi];
  const n = Object.values(room.players || {}).filter(p => p?.unclear?.["q" + qi]).length;
  const others = n - (mine ? 1 : 0);
  return `<div class="qfb">${FB.map(([k, l]) => `<button class="fb${cur === k ? " on" : ""}${k === "bad" ? " bad" : ""}" data-act="feedback" data-arg="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}<button class="fb unc${mine ? " on" : ""}" data-act="unclear" aria-pressed="${mine}">${mine ? "✓ " : ""}unverständlich${others ? ` · ${others}` : ""}</button></div>`;
}

// Hinweis-Modus: eingeblendete Hinweise (Moderator sieht alle vorab, abgedunkelt) und aktuelle Punktzahl
export function hintsBlock(room, q, { all = false } = {}) {
  if (!isHints(room) || !Array.isArray(q?.hints)) return "";
  const n = hintLevel(room), phase = room.game?.phase;
  const over = phase === "shown" || phase === "revealed";
  const fresh = serverNow() - (room.game?.hintAt || 0) < 1500;   // nur kurz nach dem Einblenden animieren
  const items = q.hints.slice(0, HINT_MAX).map((h, i) => {
    if (i < n || over) return `<div class="hint${i === n - 1 && !over && fresh ? " new" : ""}${i >= n ? " late" : ""}"><span class="hint-n">${i + 1}</span><span class="hint-t">${esc(h)}</span></div>`;
    if (all) return `<div class="hint ahead"><span class="hint-n">${i + 1}</span><span class="hint-t">${esc(h)}</span></div>`;
    return `<div class="hint hidden"><span class="hint-n">${i + 1}</span><span class="hint-t">Hinweis ${i + 1} · noch verdeckt</span></div>`;
  }).join("");
  const pts = hintPoints(n);
  // Kopfzeile bleibt immer stehen, nur der Text wechselt
  const head = `<div class="hint-pts">${phase === "answering" ? `Wer jetzt richtig tippt: <b>${pts} ${pts === 1 ? "Punkt" : "Punkte"}</b>` : "Alle Hinweise aufgedeckt"}</div>`;
  return `<div class="hints">${head}${items}</div>`;
}

// Hintergrund: Blatt von unten über dem Spielbildschirm. Öffnen über den Fakten-Knopf in der Fragekarte,
// schließen über „Schließen“, einen Tipp daneben oder die Zurück-Taste
export function factPanel(q, open, { title = "Hintergrund", animate = false } = {}) {
  const fact = q?.fact || q?.erklaerung;
  if (!fact || !open) return "";
  const sol = q.type === "estimate" || q.type === "open" ? formatValue(q, q.answer) : esc(q.a?.[q.r] ?? "");
  return `<div class="fact-bg${animate ? " in" : ""}" id="fact-page" data-act="factBg"><div class="fact-sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      <div class="fact-head"><div class="fact-h">${ICON.bulb(16)} ${esc(title)}</div><button class="btn btn-ghost btn-sm" data-act="toggleFact">Schließen</button></div>
      <div class="fact-scroll">
        <div class="fact-q">${esc(q.q)}</div>
        ${sol ? `<div class="fact-sol"><b>Richtig:</b> ${sol}</div>` : ""}
        <div class="fact-text">${esc(fact)}</div>
      </div>
    </div></div>`;
}

// Ergebnis im festen Fußbereich: eine Zeile so hoch wie ein Knopf, optional mit Knopf rechts (Host)
export function resultSlot(kind, big, sub, key, btn = "") {
  const ico = kind === "ok" ? ICON.check(18) : kind === "no" ? ICON.x(18) : "–";
  return `<div class="result slim ${kind} an-res"${an(key)}><span class="result-ico">${ico}</span>
    <div class="result-tx"><div class="result-big">${big}</div>${sub ? `<div class="result-sub">${sub}</div>` : ""}</div>${btn}</div>`;
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
  if (q.type === "estimate" && typeof v === "number") return fmtNum(q, v);
  return esc(v);
}
