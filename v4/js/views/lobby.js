// Lobby für Moderator und Spieler
import { esc, activePlayers } from "../model.js";
import { playerList } from "./common.js";

export function modLobbyView(s) {
  const room = s.room;
  const players = activePlayers(room);
  const ready = players.filter(p => p.ready).length;
  const packs = s.local.packs;
  const sel = room.settings?.packId;

  let packHtml;
  if (packs === null) packHtml = `<div class="spin"></div>`;
  else if (packs.error) packHtml = `<div class="muted">${esc(packs.error)}</div>`;
  else packHtml = `<div class="pack-grid">${packs.map(p => `
      <button class="pack${p.id === sel ? " on" : ""}" data-act="choosePack" data-arg="${esc(p.id)}">
        <span>${esc(p.emoji)}</span><span class="pack-name">${esc(p.name)}</span>
        <span class="muted small">${p.count} Fragen</span></button>`).join("")}</div>`;

  let startLabel, startDisabled = false;
  if (!players.length) { startLabel = "Warte auf Spieler …"; startDisabled = true; }
  else if (!sel) { startLabel = "Erst Fragenpaket wählen"; startDisabled = true; }
  else if (players.length === 1) startLabel = ready ? "Einzelspiel starten" : "Einzelspiel trotzdem starten";
  else startLabel = ready === players.length ? "Quiz starten" : `Trotzdem starten (${ready}/${players.length} bereit)`;

  return `<div class="page">
    <h2>Moderator · Lobby</h2>
    <div class="card">
      <div class="label">Teilnehmer</div>
      ${playerList(room, s.uid)}
      <div class="muted small" style="margin-top:10px">Spieler öffnen die App und tippen auf „Als Spieler beitreten“. 1 bis 4 Spieler.</div>
    </div>
    <div class="card"><div class="label">Fragenpaket</div>${packHtml}</div>
    ${timerCard(room)}
    <button class="btn btn-primary btn-full btn-lg" data-act="startGame" ${startDisabled ? "disabled" : ""}>${startLabel}</button>
    <button class="btn btn-danger btn-full" data-act="closeRoom">Partie auflösen</button>
  </div>`;
}

export function playerLobbyView(s, me) {
  const room = s.room;
  return `<div class="page">
    <h2>Lobby</h2>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="label" style="margin-bottom:0">Dein Name</div>
      <input class="inp" id="in-lobbyname" data-input="name" data-commit="setName" maxlength="20" value="${esc(me.name)}">
      <button class="btn btn-full btn-lg ${me.ready ? "btn-primary" : "btn-ghost"}" data-act="toggleReady">${me.ready ? "Bereit ✓" : "Bereit?"}</button>
    </div>
    <div class="card">
      <div class="label">Teilnehmer</div>
      ${playerList(room, s.uid)}
      <div class="muted small" style="margin-top:10px">${room.settings?.packName ? `Fragenpaket: ${esc(room.settings.packName)}` : "Der Moderator wählt noch das Fragenpaket."}</div>
    </div>
    <button class="btn btn-ghost btn-full" data-act="leave">Lobby verlassen</button>
  </div>`;
}

export function spectatorLobbyView(s, me) {
  const room = s.room;
  const full = activePlayers(room).length >= 4;
  return `<div class="page">
    <h2>Lobby · Zuschauer</h2>
    <div class="card">
      <div class="label">Teilnehmer</div>
      ${playerList(room, s.uid)}
      <div class="muted small" style="margin-top:10px">${room.settings?.packName ? `Fragenpaket: ${esc(room.settings.packName)}` : "Der Moderator wählt noch das Fragenpaket."}</div>
    </div>
    ${full ? `<div class="status-bar">Die Lobby ist voll.</div>` : `<button class="btn btn-primary btn-full btn-lg" data-act="joinPlayer">Doch mitspielen</button>`}
    <button class="btn btn-ghost btn-full" data-act="leave">Zuschauen beenden</button>
  </div>`;
}

function timerCard(room) {
  const mode = room.settings?.timerMode || "none";
  const sec = room.settings?.timerSec || 30;
  const modes = [["none", "Kein Timer"], ["auto", "Auto"], ["manual", "Manuell"]];
  const presets = [10, 20, 30, 45, 60];
  return `<div class="card"><div class="label">Timer</div>
    <div class="seg">${modes.map(([m, l]) => `<button class="seg-btn${m === mode ? " on" : ""}" data-act="timerMode" data-arg="${m}">${l}</button>`).join("")}</div>
    ${mode === "none" ? "" : `<div class="pills" style="margin-top:10px">${presets.map(p => `<button class="pill${p === sec ? " on" : ""}" data-act="timerSec" data-arg="${p}">${p} s</button>`).join("")}
      <input class="inp pill-inp" id="in-timersec" type="number" min="5" max="300" inputmode="numeric" placeholder="eigene" data-commit="timerSec" value="${presets.includes(sec) ? "" : sec}"></div>
      <div class="muted small" style="margin-top:8px">${mode === "auto" ? "Startet bei jeder Frage automatisch." : "Du startest, pausierst und setzt den Timer pro Frage selbst."} Läuft er ab, wird die Frage gesperrt.</div>`}
  </div>`;
}
