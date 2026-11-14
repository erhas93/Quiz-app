// Startbildschirm: zeigt immer zuerst den Zustand des Raums
import { esc, summary, ranking } from "../model.js";
import { playerList } from "./common.js";

export function homeView(s) {
  const room = s.room;
  const sm = summary(room);
  const nameInput = `<input class="inp" id="in-name" data-input="name" maxlength="20" placeholder="Dein Name" value="${esc(s.local.name)}">`;
  let body = "";

  if (sm.status === "lobby") {
    const mod = sm.moderator;
    body = `
      <div class="card">
        <div class="label">Lobby offen</div>
        <div class="status-big">${mod ? `${esc(mod)} moderiert` : "Noch kein Moderator"}${sm.packName ? ` · ${esc(sm.packName)}` : ""}</div>
        <div style="margin-top:12px">${playerList(room, s.uid)}</div>
      </div>
      <div class="card" style="display:flex;flex-direction:column;gap:10px">
        ${nameInput}
        <button class="btn btn-primary btn-full btn-lg" data-act="joinPlayer">Als Spieler beitreten</button>
        ${mod ? "" : `<button class="btn btn-gold btn-full" data-act="joinModerator">Als Moderator übernehmen</button>`}
      </div>`;
  } else if (sm.status === "running") {
    const names = sm.playerNames.length ? sm.playerNames.map(esc).join(" vs. ") : "–";
    body = `
      <div class="card">
        <div class="label">Partie läuft</div>
        <div class="status-big">${names}</div>
        <div class="muted" style="margin-top:6px">Frage ${(sm.qIndex ?? 0) + 1} / ${sm.qCount || "–"}${sm.packName ? ` · ${esc(sm.packName)}` : ""}${sm.moderator ? ` · Moderation: ${esc(sm.moderator)}` : ""}</div>
      </div>
      <div class="status-bar">Zuschauen kommt in der nächsten Ausbaustufe. Bis dahin: warten, bis die Partie vorbei ist.</div>`;
  } else {
    let last = "";
    if (sm.status === "finished") {
      const rk = ranking(room);
      const top = rk.filter(p => p.rank === 1).map(p => esc(p.name)).join(" & ");
      last = `<div class="muted small" style="margin-top:6px">Letzte Partie${sm.packName ? ` (${esc(sm.packName)})` : ""}: ${rk.length > 1 ? `gewonnen von ${top}` : rk.length ? `${esc(rk[0].name)} mit ${rk[0].score} Punkten` : "beendet"}</div>`;
    }
    body = `
      <div class="card">
        <div class="label">Status</div>
        <div class="status-big">Keine Partie aktiv</div>${last}
      </div>
      <div class="card" style="display:flex;flex-direction:column;gap:10px">
        ${nameInput}
        <button class="btn btn-gold btn-full btn-lg" data-act="createRoom">Neue Partie als Moderator</button>
      </div>`;
  }

  return `<div class="page center">
    <div style="text-align:center;margin-bottom:6px"><h1>Quiz App</h1></div>
    ${body}
  </div>`;
}
