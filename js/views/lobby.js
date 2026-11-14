// Lobby für Moderator, Spieler und Zuschauer – alles auf einem Bildschirm
import { esc, activePlayers, moderatorOf, MAX_PLAYERS } from "../model.js";
import { topBar, slots, spectatorLine, ICON } from "./common.js";
import { playStats, packLine } from "./packs.js";

const playersCard = (room, uid, right = "") => `<div class="card">
    <div class="card-h"><span class="label">Spieler · ${activePlayers(room).length} von ${MAX_PLAYERS}</span>${right}</div>
    ${slots(room, uid, MAX_PLAYERS)}${spectatorLine(room)}</div>`;

export function modLobbyView(s) {
  const room = s.room;
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
    : `<button class="pack-row" data-act="openPicker"><span class="pack-ico">?</span><span class="pack-txt"><span class="pack-name">Fragenpaket wählen</span><span class="pack-sub">${Array.isArray(packs) ? `${packs.length} Packs verfügbar` : "lädt …"}</span></span>${ICON.chev(20)}</button>`;

  let startLabel, startDisabled = false;
  if (!players.length) { startLabel = "Warte auf Spieler …"; startDisabled = true; }
  else if (!sel) { startLabel = "Erst Fragenpaket wählen"; startDisabled = true; }
  else if (players.length === 1) startLabel = ready ? "Einzelspiel starten" : "Einzelspiel trotzdem starten";
  else startLabel = ready === players.length ? "Quiz starten" : `Trotzdem starten (${ready}/${players.length} bereit)`;

  const invite = `<button class="btn btn-ghost btn-sm" data-act="invite">${ICON.share(16)} Einladen</button>`;
  return `<div class="screen">
    ${topBar("Lobby", `${esc(moderatorOf(room)?.name || "Du")} moderiert`, { connected: s.connected })}
    <div class="body">
      ${playersCard(room, s.uid, invite)}
      <div class="card"><span class="label">Fragenpaket</span>${pack}</div>
      ${timerCard(room)}
      <div class="spacer"></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-act="startGame" ${startDisabled ? "disabled" : ""}>${startLabel}</button>
      <button class="btn btn-text danger" data-act="closeRoom">Partie auflösen</button>
    </div>
  </div>`;
}

export function playerLobbyView(s, me) {
  const room = s.room;
  return `<div class="screen">
    ${topBar("Lobby", `${esc(moderatorOf(room)?.name || "Noch kein Moderator")}${moderatorOf(room) ? " moderiert" : ""}`, { connected: s.connected })}
    <div class="body">
      <div class="card"><label class="label" for="in-lobbyname">Dein Name</label>
        <input class="inp" id="in-lobbyname" data-input="name" data-commit="setName" maxlength="20" value="${esc(me.name)}"></div>
      ${playersCard(room, s.uid)}
      <div class="card"><span class="label">Fragenpaket</span>
        <div class="status-big" style="font-size:16px">${room.settings?.packName ? esc(room.settings.packName) : `<span class="muted" style="font-weight:500">Der Moderator wählt noch …</span>`}</div></div>
      <div class="spacer"></div>
    </div>
    <div class="actions">
      <button class="btn ${me.ready ? "btn-primary" : "btn-ghost"}" data-act="toggleReady">${me.ready ? `${ICON.check(20)} Bereit` : "Ich bin bereit"}</button>
      <button class="btn btn-text" data-act="leave">Lobby verlassen</button>
    </div>
  </div>`;
}

export function spectatorLobbyView(s) {
  const room = s.room;
  const full = activePlayers(room).length >= MAX_PLAYERS;
  return `<div class="screen">
    ${topBar("Lobby", "Du schaust zu", { connected: s.connected })}
    <div class="body">
      ${playersCard(room, s.uid)}
      <div class="card"><span class="label">Fragenpaket</span>
        <div class="status-big" style="font-size:16px">${room.settings?.packName ? esc(room.settings.packName) : `<span class="muted" style="font-weight:500">Der Moderator wählt noch …</span>`}</div></div>
      <div class="spacer"></div>
    </div>
    <div class="actions">
      ${full ? `<div class="foot-note">Die Lobby ist voll.</div>` : `<button class="btn btn-primary" data-act="joinPlayer">Doch mitspielen</button>`}
      <button class="btn btn-text" data-act="leave">Zuschauen beenden</button>
    </div>
  </div>`;
}

function timerCard(room) {
  const mode = room.settings?.timerMode || "none";
  const sec = room.settings?.timerSec || 30;
  const modes = [["none", "Aus"], ["auto", "Auto"], ["manual", "Manuell"]];
  const presets = [10, 20, 30, 45, 60];
  return `<div class="card"><div class="card-h"><span class="label">Timer</span>${mode === "none" ? "" : `<span class="muted small">${mode === "auto" ? "startet je Frage von selbst" : "du startest pro Frage"}</span>`}</div>
    <div class="seg3">${modes.map(([m, l]) => `<button class="${m === mode ? "on" : ""}" data-act="timerMode" data-arg="${m}">${l}</button>`).join("")}</div>
    ${mode === "none" ? "" : `<div class="pills">${presets.map(p => `<button class="pill${p === sec ? " on" : ""}" data-act="timerSec" data-arg="${p}">${p} s</button>`).join("")}
      <input class="pill-inp" id="in-timersec" type="number" min="5" max="300" inputmode="numeric" placeholder="eigene" aria-label="Eigene Sekunden" data-commit="timerSec" value="${presets.includes(sec) ? "" : sec}"></div>`}
  </div>`;
}
