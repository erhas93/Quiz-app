// Raumübersicht (Startseite ohne ?room): offene Räume, Beitreten per Code, neue Partie
import { VERSION } from "../version.js";
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
    const st = r.status === "lobby" ? (r.game === "duel" ? "Vorbereitung · Duell" : "Vorbereitung") : r.game === "duel" ? "Kategorie-Duell läuft" : `läuft · Frage ${(r.qIndex ?? 0) + 1}/${r.qCount || "–"}`;
    const mode = r.mode === "players" ? "ohne Moderator" : r.moderator ? `Moderation: ${esc(r.moderator)}` : "mit Moderator";
    return `<button class="room-row" data-act="openRoom" data-arg="${esc(r.id)}">
      <span class="room-code">${esc(r.id.slice(0, 4))}</span>
      <span class="pack-txt"><span class="pack-name">${r.test ? `<span class="test-tag">Test</span> ` : ""}${st}${r.packName ? ` · ${esc(r.packName)}` : ""}</span>
        <span class="pack-sub">${who} · ${mode}</span></span>${ICON.chev(20)}</button>`;
  }).join("") : `<div class="muted small" style="padding:6px 2px">Gerade ist kein Raum offen. Eröffne unten einen neuen Raum.</div>`;

  return `<div class="screen">
    ${topBar("Quiz App", `Raumübersicht · ${VERSION}`, { connected: s.connected })}
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
      <button class="btn btn-primary" data-act="newRoom" data-arg="players">Neuer Raum ohne Moderator</button>
      <button class="btn btn-gold" data-act="newRoom" data-arg="moderated">Neuer Raum mit Moderator</button>
      <button class="btn btn-text" data-act="testSetup">${ICON.bug(16)} Testraum mit Bots</button>
    </div>
  </div>`;
}

// Testraum: Szenario, Anzahl Bots, Trefferquote, Tempo
export const TEST_SCENARIOS = [
  ["mod", "Ich moderiere", "Bots spielen"],
  ["botmod", "Ich spiele", "Ein Bot moderiert, Bots als Gegner"],
  ["free", "Ohne Moderator", "Ich steuere und spiele gegen Bots"]
];
export function testSetupView(s) {
  const t = s.local.testSetup;
  const seg = (act, cur, opts) => `<div class="seg3">${opts.map(([v, l]) => `<button class="${String(cur) === String(v) ? "on" : ""}" data-act="${act}" data-arg="${v}">${l}</button>`).join("")}</div>`;
  return `<div class="screen">
    ${topBar("Testraum", "mit simulierten Mitspielern", { back: "closeTestSetup", connected: s.connected })}
    <div class="body">
      <div class="card"><span class="label">Szenario</span>
        ${TEST_SCENARIOS.map(([v, l, sub]) => `<button class="pack-row${t.scenario === v ? " sel" : ""}" data-act="testScenario" data-arg="${v}"><span class="pack-txt"><span class="pack-name">${l}</span><span class="pack-sub">${sub}</span></span>${t.scenario === v ? ICON.check(20) : ""}</button>`).join("")}</div>
      <div class="card"><span class="label">${t.scenario === "mod" ? "Bot-Spieler" : "Bot-Gegner"}</span>${seg("testBots", t.bots, [[1, "1"], [2, "2"], [3, "3"]])}</div>
      <div class="card"><span class="label">Trefferquote der Bots</span>${seg("testAcc", t.acc, [["low", "schwach"], ["mid", "mittel"], ["high", "stark"]])}</div>
      <div class="card"><span class="label">Tempo der Bots</span>${seg("testSpeed", t.speed, [["fast", "schnell"], ["normal", "normal"]])}</div>
      <div class="muted small" style="padding:0 4px">Fürs Kategorie-Duell 1 Bot wählen. Testräume zählen nicht für Statistik und Spielhistorie. Die Bots spielen nur, solange die App bei dir offen ist.</div>
      <div class="spacer"></div>
    </div>
    <div class="actions"><button class="btn btn-primary" data-act="testStart">Testraum starten</button></div>
  </div>`;
}
