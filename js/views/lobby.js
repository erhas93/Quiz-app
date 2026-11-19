// Lobby für Moderator, Spieler und Zuschauer – alles auf einem Bildschirm
import { esc, activePlayers, moderatorOf, MAX_PLAYERS, isFree, hostUid, isDuel, PICK_SEC, duelRule, isHints } from "../model.js";
import { ROOM_ID } from "../firebase.js";
import { topBar, slots, spectatorLine, ICON } from "./common.js";
import { playStats, packLine } from "./packs.js";

const code = () => `Raum <span class="code-badge">${esc(ROOM_ID)}</span>`;
const playersCard = (room, uid, right = "") => `<div class="card">
    <div class="card-h"><span class="label">Spieler · ${activePlayers(room).length} von ${MAX_PLAYERS}</span>${right}</div>
    ${slots(room, uid, MAX_PLAYERS)}${spectatorLine(room)}</div>`;

// Moderator-Lobby; ohne Moderator sieht der Host (selbst Spieler) dieselbe Steuerung
// Lieblingsthema fürs gewählte Pack (normales Spiel); im Duell kommt die Frage auf dem Brett
function favCard(room, uid) {
  const p = room.players?.[uid];
  if (!p || p.role !== "player" || isDuel(room) || !room.settings?.packId) return "";
  const v = p.favPack === room.settings.packId && typeof p.fav === "boolean" ? p.fav : null;
  return `<div class="card"><div class="card-h"><span class="label">Ist das eins deiner Lieblingsthemen?</span>${v == null ? `<span class="muted small">für die Statistik</span>` : ""}</div>
    <div class="seg3"><button class="${v === true ? "on" : ""}" data-act="fav" data-arg="1">Ja</button><button class="${v === false ? "on" : ""}" data-act="fav" data-arg="0">Nein</button></div></div>`;
}

// Spielmodus: Auswahl + immer genau eine kurze Beschreibung (feste Höhe), Optionen stehen getrennt darunter
const MODES = [
  ["classic", "Klassisch", "Alle beantworten dieselben 15 Fragen gleichzeitig. Jede richtige Antwort bringt 1 Punkt."],
  ["duel", "Duell", "Zu zweit abwechselnd Felder wählen: 5 Kategorien, 3 Stufen, 1–3 Punkte je Feld."],
  ["hints", "Hinweise", "Bis zu 3 Hinweise je Frage. Wer früher richtig tippt, bekommt mehr: 4–3–2–1 Punkte."]
];
function modeCard(room) {
  const free = isFree(room);
  const g = isDuel(room) ? "duel" : isHints(room) ? "hints" : "classic";
  const n = activePlayers(room).length;
  const warn = g === "duel" && n !== 2 ? "braucht genau 2 Spieler" : free ? "Hinweise nur mit Moderator" : "";
  return `<div class="card"><div class="card-h"><span class="label">Spielmodus</span>${warn ? `<span class="muted small">${warn}</span>` : ""}</div>
    <div class="seg3">${MODES.map(([k, l]) => `<button class="${g === k ? "on" : ""}" data-act="gameMode" data-arg="${k}" ${k === "hints" && free ? "disabled" : ""}>${l}</button>`).join("")}</div>
    <div class="mode-desc">${MODES.find(m => m[0] === g)[2]}</div></div>`;
}

// Optionen des gewählten Modus – immer an derselben Stelle, im selben Zeilenformat
function optionsCard(room, free) {
  const g = isDuel(room) ? "duel" : isHints(room) ? "hints" : "classic";
  const rows = [];
  if (g === "duel") {
    const all = duelRule(room) === "all";
    rows.push(`<div class="opt"><span class="opt-l">Punkte</span><div class="seg3"><button class="${all ? "" : "on"}" data-act="duelRule" data-arg="picker">Wähler hat Vorrang</button><button class="${all ? "on" : ""}" data-act="duelRule" data-arg="all">Jeder Richtige</button></div>
      <span class="opt-h">${all ? "Jeder Richtige bekommt die Punkte des Feldes." : "Liegt der Wähler falsch, kann der Gegner die Punkte klauen."}</span></div>`);
    rows.push(`<div class="opt"><button class="toggle-row" data-act="pickTimer" aria-pressed="${!!room.settings?.pickTimer}"><span class="opt-l">Wähl-Timer (${PICK_SEC} s)</span><span class="switch${room.settings?.pickTimer ? " on" : ""}"></span></button></div>`);
  }
  if (g !== "hints") rows.push(timerRow(room, free));
  else rows.push(`<div class="opt"><span class="opt-h">Keine weiteren Optionen – das Tempo bestimmst du über die Hinweise.</span></div>`);
  return `<div class="card"><span class="label">Optionen</span>${rows.join("")}</div>`;
}

export function modLobbyView(s) {
  const room = s.room;
  const duel = isDuel(room);
  const free = isFree(room);
  const players = activePlayers(room);
  const ready = players.filter(p => p.ready).length;
  const packs = s.local.packs;
  const sel = room.settings?.packId;
  const cur = Array.isArray(packs) ? packs.find(p => p.id === sel) : null;

  const pack = sel
    ? `<button class="pack-row sel" data-act="openPicker">
        <span class="pack-ico">${esc(cur?.emoji || "❓")}</span>
        <span class="pack-txt"><span class="pack-name">${esc(room.settings?.packName || sel)}</span>
          <span class="pack-sub">${cur ? `${cur.count} Fragen · ${packLine(cur, playStats(s.history))}` : "Ändern"}</span></span>${ICON.chev(20)}</button>`
    : `<button class="pack-row" data-act="openPicker"><span class="pack-ico">?</span><span class="pack-txt"><span class="pack-name">${duel ? "Duell-Pack wählen" : isHints(room) ? "Hinweis-Pack wählen" : "Fragenpaket wählen"}</span><span class="pack-sub">${Array.isArray(packs) ? `${packs.filter(p => (p.mode || null) === (duel ? "duel" : isHints(room) ? "hints" : null) || (isHints(room) && p.hints)).length} Packs verfügbar` : "lädt …"}</span></span>${ICON.chev(20)}</button>`;

  let startLabel, startDisabled = false;
  if (!players.length) { startLabel = "Warte auf Spieler …"; startDisabled = true; }
  else if (!sel) { startLabel = "Erst Fragenpaket wählen"; startDisabled = true; }
  else if (duel && players.length !== 2) { startLabel = players.length < 2 ? "Duell: warte auf 2. Spieler" : "Duell geht nur zu zweit"; startDisabled = true; }
  else if (duel) startLabel = ready === players.length || free ? "Duell starten" : `Duell trotzdem starten (${ready}/2 bereit)`;
  else if (players.length === 1) startLabel = ready || free ? "Einzelspiel starten" : "Einzelspiel trotzdem starten";
  else startLabel = ready === players.length ? "Quiz starten" : `Trotzdem starten (${ready}/${players.length} bereit)`;

  const invite = `<button class="btn btn-ghost btn-sm" data-act="invite">${ICON.share(16)} Einladen</button>`;
  return `<div class="screen">
    ${topBar(code(), `Vorbereitung · ${free ? "ohne Moderator, du steuerst" : `${esc(moderatorOf(room)?.name || "Du")} moderiert`}`, { back: "overview", connected: s.connected })}
    <div class="body">
      ${playersCard(room, s.uid, invite)}
      ${modeCard(room)}
      <div class="card"><span class="label">Fragenpaket</span>${pack}</div>
      ${favCard(room, s.uid)}
      ${optionsCard(room, free)}
      <div class="spacer"></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-act="startGame" ${startDisabled ? "disabled" : ""}>${startLabel}</button>
      <button class="btn btn-text danger" data-act="closeRoom">Raum auflösen</button>
    </div>
  </div>`;
}

export function playerLobbyView(s, me) {
  const room = s.room;
  const free = isFree(room);
  const host = room.players?.[hostUid(room)]?.name;
  const sub = free ? `ohne Moderator${host ? ` · ${esc(host)} steuert` : ""}` : `${esc(moderatorOf(room)?.name || "Noch kein Moderator")}${moderatorOf(room) ? " moderiert" : ""}`;
  return `<div class="screen">
    ${topBar(code(), `Vorbereitung · ${sub}`, { back: "overview", connected: s.connected })}
    <div class="body">
      <div class="card"><label class="label" for="in-lobbyname">Dein Name</label>
        <input class="inp" id="in-lobbyname" data-input="name" data-commit="setName" maxlength="20" value="${esc(me.name)}"></div>
      ${playersCard(room, s.uid)}
      <div class="card"><span class="label">${isHints(room) ? "Hinweis-Modus · 4 – 3 – 2 – 1 Punkte" : isDuel(room) ? `Kategorie-Duell · ${duelRule(room) === "all" ? "jeder Richtige punktet" : "Wähler hat Vorrang"}` : "Fragenpaket"}</span>
        <div class="status-big" style="font-size:16px">${room.settings?.packName ? esc(room.settings.packName) : `<span class="muted" style="font-weight:500">${isFree(room) ? "Der Host" : "Der Moderator"} wählt noch …</span>`}</div></div>
      ${favCard(room, s.uid)}
      <div class="spacer"></div>
    </div>
    <div class="actions">
      <button class="btn ${me.ready ? "btn-primary" : "btn-ghost"}" data-act="toggleReady">${me.ready ? `${ICON.check(20)} Bereit` : "Ich bin bereit"}</button>
      <button class="btn btn-text" data-act="leave">Raum verlassen</button>
    </div>
  </div>`;
}

export function spectatorLobbyView(s) {
  const room = s.room;
  const full = activePlayers(room).length >= MAX_PLAYERS;
  return `<div class="screen">
    ${topBar(code(), "Vorbereitung · du schaust zu", { back: "overview", connected: s.connected })}
    <div class="body">
      ${playersCard(room, s.uid)}
      <div class="card"><span class="label">Fragenpaket</span>
        <div class="status-big" style="font-size:16px">${room.settings?.packName ? esc(room.settings.packName) : `<span class="muted" style="font-weight:500">${isFree(room) ? "Der Host" : "Der Moderator"} wählt noch …</span>`}</div></div>
      <div class="spacer"></div>
    </div>
    <div class="actions">
      ${full ? `<div class="foot-note">Alle Spielerplätze sind belegt.</div>` : `<button class="btn btn-primary" data-act="joinPlayer">Doch mitspielen</button>`}
      <button class="btn btn-text" data-act="leave">Zuschauen beenden</button>
    </div>
  </div>`;
}

function timerRow(room, free = false) {
  const mode = room.settings?.timerMode || "none";
  const sec = room.settings?.timerSec || 30;
  // Ohne Moderator gibt es niemanden, der einen manuellen Timer bedient
  const modes = free ? [["none", "Aus"], ["auto", "Auto"]] : [["none", "Aus"], ["auto", "Auto"], ["manual", "Manuell"]];
  const presets = [10, 20, 30, 45, 60];
  return `<div class="opt"><span class="opt-l">Antwort-Timer</span>
    <div class="seg3">${modes.map(([m, l]) => `<button class="${m === mode ? "on" : ""}" data-act="timerMode" data-arg="${m}">${l}</button>`).join("")}</div>
    ${mode === "none" ? "" : `<div class="pills">${presets.map(p => `<button class="pill${p === sec ? " on" : ""}" data-act="timerSec" data-arg="${p}">${p} s</button>`).join("")}
      <input class="pill-inp" id="in-timersec" type="number" min="5" max="300" inputmode="numeric" placeholder="eigene" aria-label="Eigene Sekunden" data-commit="timerSec" value="${presets.includes(sec) ? "" : sec}"></div>
      <span class="opt-h">${mode === "auto" ? "Startet bei jeder Frage von selbst." : "Du startest ihn bei jeder Frage."}</span>`}</div>`;
}
