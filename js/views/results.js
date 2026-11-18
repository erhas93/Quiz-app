// Ergebnis: Rangliste (bzw. Einzelspieler-Statistik), Bonus, Zeittabelle pro Frage
import { ROOM_ID } from "../firebase.js";
import { esc, ranking, questionsOf, answerOf, resultFor, fmtMs, isFree, hostUid, isDuel, activePlayers, isFavFor } from "../model.js";
import { topBar } from "./common.js";
import { boardHtml, categoryTable } from "./duel.js";
import { ownerSteersBotMod } from "../bots.js";

// Lieblingsthema im normalen Spiel aufdecken
function favNote(room, uid) {
  if (isDuel(room)) return "";
  const v = isFavFor(room, 0, uid);
  return v === true ? " · ★ Lieblingsthema" : "";
}

export function resultsView(s, me) {
  const room = s.room;
  const rk = ranking(room);
  const qs = questionsOf(room);
  const isMod = me.role === "moderator";
  const controls = isMod || (isFree(room) && hostUid(room) === s.uid) || ownerSteersBotMod(room, s.uid);  // ohne Moderator: der Host; Testraum: Besitzer für den Bot
  const solo = rk.length === 1;
  const pack = esc(room.settings?.packName || "");

  let head;
  if (solo) {
    const p = rk[0];
    const quote = qs.length ? Math.round(p.correct / qs.length * 100) : 0;
    head = `<div class="card winner"><span class="label">Einzelspiel</span><h1>${esc(p.name)}</h1>
      <div class="stats">
        <div class="stat"><div class="stat-v">${p.score}</div><div class="stat-l">Punkte</div></div>
        <div class="stat"><div class="stat-v">${quote}%</div><div class="stat-l">Trefferquote</div></div>
        <div class="stat"><div class="stat-v">${fmtMs(p.avgMs)}</div><div class="stat-l">Ø Antwortzeit</div></div>
      </div></div>`;
  } else {
    const winners = rk.filter(p => p.rank === 1);
    const title = winners.length > 1 ? `Unentschieden!` : `${esc(winners[0]?.name || "–")} gewinnt!`;
    head = `<div class="card"><div class="winner" style="padding:4px 0 2px"><h1>${title}</h1></div>
      ${rk.map(p => `<div class="rank${p.rank === 1 ? " first" : ""}${p.uid === s.uid ? " me" : ""}">
        <span class="rank-pos">${p.rank}</span>
        <span class="rank-name">${esc(p.name)}${p.uid === s.uid ? " (du)" : ""}<div class="rank-sub">${p.correct}/${qs.length} richtig · Ø ${fmtMs(p.avgMs)}${p.uid === room.bonus?.uid ? " · +1 Bonus" : ""}${favNote(room, p.uid)}</div></span>
        <span class="rank-pts">${p.score}</span></div>`).join("")}</div>`;
  }

  const bonusUid = room.bonus?.uid || null;
  const bonus = isMod && rk.length && !isDuel(room) ? `<div class="card"><span class="label">Bonuspunkt</span>
      <div class="pills">${rk.map(p => `<button class="pill${p.uid === bonusUid ? " on" : ""}" data-act="bonus" data-arg="${p.uid}">${esc(p.name)}${p.uid === bonusUid ? " +1" : ""}</button>`).join("")}
      <button class="pill${!bonusUid ? " on" : ""}" data-act="bonus" data-arg="">Keiner</button></div></div>` : "";

  const table = `<div class="card"><span class="label">Antwortzeiten pro Frage</span>
    <table class="ttable"><thead><tr><th>#</th>${rk.map(p => `<th>${esc(p.name.slice(0, 8))}</th>`).join("")}</tr></thead>
    <tbody>${qs.map((_, qi) => {
      const r = resultFor(room, qi);
      return `<tr><td class="muted">${qi + 1}</td>${rk.map(p => {
        const a = answerOf(room, qi, p.uid);
        const ok = r?.points?.[p.uid];
        const fast = r?.fastestUid === p.uid && rk.length > 1;
        return `<td class="${ok ? "ok" : "no"}${fast ? " fast" : ""}">${a ? fmtMs(a.ms) : "–"} ${ok ? "✓" : "✗"}${fast ? "⚡" : ""}</td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;

  const duelCards = isDuel(room) ? `<div class="card"><span class="label">Spielbrett · ★ Lieblingskategorien</span>${boardHtml(room, null, { showFavs: activePlayers(room).map(p => p.uid) })}</div>
    <div class="card"><span class="label">Bilanz pro Kategorie</span>${categoryTable(room)}</div>` : "";

  const actions = controls
    ? `<button class="btn btn-primary" data-act="newRound">Neue Runde, gleiche Spieler</button>
       <button class="btn btn-text danger" data-act="closeRoom">Raum auflösen</button>`
    : `<div class="foot-note">${isFree(room) ? "Der Host" : "Der Moderator"} kann eine neue Runde starten.</div>
       <button class="btn btn-ghost" data-act="dismiss">Zurück zum Start</button>`;

  return `<div class="screen">
    ${topBar("Ergebnis", `Raum ${esc(ROOM_ID)}${pack ? ` · ${pack}` : ""}`, { connected: s.connected })}
    <div class="body">${head}${bonus}${duelCards || table}</div>
    <div class="actions">${actions}</div>
  </div>`;
}
