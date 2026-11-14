// Gemeinsame Bausteine der Ansichten
import { esc, activePlayers, scoreOf, answersFor, qCount, isOpenType } from "../model.js";

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
export function gameHeader(room, uid, roleLabel, isMod) {
  const g = room.game || {};
  const total = qCount(room);
  const qi = g.qIndex ?? 0;
  const answers = answersFor(room, qi);
  const chips = activePlayers(room).map(p => {
    let state = "";
    if (g.phase === "answering" || g.phase === "locked") state = answers[p.uid] ? `<span class="chip-state ok">✓</span>` : `<span class="chip-state">…</span>`;
    return `<div class="chip${p.uid === uid ? " me" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span>
      <span class="chip-name">${esc(p.name)}</span>${state}
      <span class="chip-pts">${scoreOf(room, p.uid)}</span></div>`;
  }).join("");
  const pct = total ? ((qi + (g.phase === "revealed" ? 1 : 0)) / total * 100) : 0;
  return `<div class="g-hdr">
    <div class="hdr-r1"><div class="hdr-badge${isMod ? " mod" : ""}">${esc(roleLabel)}</div>
      <div class="hdr-qnum">Frage ${qi + 1} / ${total}</div></div>
    <div class="chips">${chips}</div>
    <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%"></div></div>
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
      ${p.role === "moderator" ? `<span class="tag mod">Moderator</span>`
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
