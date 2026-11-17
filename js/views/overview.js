// Raumübersicht (Startseite ohne ?room): offene Räume, Beitreten per Code, neue Partie
import { esc } from "../model.js";
import { topBar, ICON } from "./common.js";

const VISIBLE_MS = 30 * 60 * 1000; // Räume ohne Änderung seit 30 min gelten als verwaist und werden nicht gezeigt

export function openRooms(rooms, now) {
  return Object.entries(rooms || {})
    .map(([id, r]) => ({ id, ...r }))
    .filter(r => (r.status === "lobby" || r.status === "running") && now - (r.updatedAt || 0) < VISIBLE_MS)
    .sort((a, b) => (a.status === "lobby" ? 0 : 1) - (b.status === "lobby" ? 0 : 1) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function overviewView(s, now) {
  const list = openRooms(s.rooms, now);
  const rows = list.length ? list.map(r => {
    const names = (r.playerNames || []).map(esc);
    const who = names.length ? names.join(r.status === "running" ? " vs. " : ", ") : "noch keine Spieler";
    const st = r.status === "lobby" ? (r.game === "duel" ? "Lobby offen · Duell" : "Lobby offen") : r.game === "duel" ? "Kategorie-Duell läuft" : `läuft · Frage ${(r.qIndex ?? 0) + 1}/${r.qCount || "–"}`;
    const mode = r.mode === "players" ? "ohne Moderator" : r.moderator ? `Moderation: ${esc(r.moderator)}` : "mit Moderator";
    return `<button class="room-row" data-act="openRoom" data-arg="${esc(r.id)}">
      <span class="room-code">${esc(r.id.slice(0, 4))}</span>
      <span class="pack-txt"><span class="pack-name">${st}${r.packName ? ` · ${esc(r.packName)}` : ""}</span>
        <span class="pack-sub">${who} · ${mode}</span></span>${ICON.chev(20)}</button>`;
  }).join("") : `<div class="muted small" style="padding:6px 2px">Gerade ist kein Raum offen. Leg unten eine neue Partie an.</div>`;

  return `<div class="screen">
    ${topBar("Quiz App", "Räume", { connected: s.connected })}
    <div class="body">
      <div class="card"><label class="label" for="in-name">Dein Name</label>
        <input class="inp" id="in-name" data-input="name" maxlength="20" placeholder="Name eingeben" value="${esc(s.local.name)}"></div>
      <div class="card"><span class="label">Offene Räume</span>${rows}</div>
      <div class="card"><label class="label" for="in-code">Raumcode</label>
        <div class="actions-row"><input class="inp code-inp" id="in-code" data-input="code" maxlength="8" placeholder="z. B. KRTW" autocomplete="off" autocapitalize="characters" value="${esc(s.local.code || "")}">
        <button class="btn btn-ghost" style="width:auto" data-act="joinCode">Öffnen</button></div></div>
      <div class="spacer"></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-act="newRoom" data-arg="players">Neue Partie ohne Moderator</button>
      <button class="btn btn-gold" data-act="newRoom" data-arg="moderated">Neue Partie mit Moderator</button>
    </div>
  </div>`;
}
