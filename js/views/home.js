// Startbildschirm: zeigt immer zuerst den Zustand des Raums
import { esc, summary, ranking, moderatorAway } from "../model.js";
import { topBar, slots, spectatorLine } from "./common.js";

export function homeView(s, now = Date.now()) {
  const room = s.room;
  const sm = summary(room);
  const away = moderatorAway(room, now);
  const nameInput = `<label class="label" for="in-name">Dein Name</label><input class="inp" id="in-name" data-input="name" maxlength="20" placeholder="Name eingeben" value="${esc(s.local.name)}">`;
  const takeover = away ? `<button class="btn btn-gold" data-act="takeover">Moderation übernehmen</button>` : "";
  let card = "", actions = "";

  if (sm.status === "lobby") {
    const mod = sm.moderator;
    card = `<div class="card">
        <span class="label">Lobby offen</span>
        <div class="status-big">${mod ? `${esc(mod)} moderiert` : "Noch kein Moderator"}</div>
        ${sm.packName ? `<div class="muted small">Fragenpaket: ${esc(sm.packName)}</div>` : ""}
        ${slots(room, s.uid)}${spectatorLine(room)}
        ${away ? `<div class="notice warn">${esc(mod)} ist seit über einer Minute offline.</div>` : ""}</div>
      <div class="card">${nameInput}</div>`;
    actions = `<button class="btn btn-primary" data-act="joinPlayer">Als Spieler beitreten</button>
      ${mod ? takeover : `<button class="btn btn-gold" data-act="joinModerator">Als Moderator übernehmen</button>`}
      <button class="btn btn-text" data-act="watch">Nur zuschauen</button>`;
  } else if (sm.status === "running") {
    const names = sm.playerNames.length ? sm.playerNames.map(esc).join(" vs. ") : "–";
    card = `<div class="card">
        <span class="label">Partie läuft</span>
        <div class="status-big">${names}</div>
        <div class="muted small">Frage ${(sm.qIndex ?? 0) + 1} von ${sm.qCount || "–"}${sm.packName ? ` · ${esc(sm.packName)}` : ""}${sm.moderator ? ` · Moderation: ${esc(sm.moderator)}` : ""}</div>
        ${away ? `<div class="notice warn">${esc(sm.moderator)} ist seit über einer Minute offline.</div>` : ""}</div>
      <div class="card">${nameInput}</div>`;
    actions = `<button class="btn btn-primary" data-act="watch">Zuschauen</button>${takeover}`;
  } else {
    let last = "";
    if (sm.status === "abandoned") last = `<div class="muted small">Die letzte Partie wurde abgebrochen, weil länger niemand online war.</div>`;
    if (sm.status === "finished") {
      const rk = ranking(room);
      const top = rk.filter(p => p.rank === 1).map(p => esc(p.name)).join(" & ");
      last = `<div class="muted small">Letzte Partie${sm.packName ? ` (${esc(sm.packName)})` : ""}: ${rk.length > 1 ? `gewonnen von ${top}` : rk.length ? `${esc(rk[0].name)} mit ${rk[0].score} Punkten` : "beendet"}</div>`;
    }
    card = `<div class="card"><span class="label">Status</span><div class="status-big">Keine Partie aktiv</div>${last}</div>
      <div class="card">${nameInput}</div>`;
    actions = `<button class="btn btn-gold" data-act="createRoom">Neue Partie als Moderator</button>`;
  }

  return `<div class="screen">
    ${topBar("Quiz App", "", { connected: s.connected })}
    <div class="body center">${card}</div>
    <div class="actions">${actions}</div>
  </div>`;
}
