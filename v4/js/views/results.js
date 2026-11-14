// Ergebnis: Rangliste (bzw. Einzelspieler-Statistik) und Zeittabelle pro Frage
import { esc, ranking, questionsOf, answerOf, resultFor, fmtMs } from "../model.js";

export function resultsView(s, me) {
  const room = s.room;
  const rk = ranking(room);
  const qs = questionsOf(room);
  const isMod = me.role === "moderator";
  const solo = rk.length === 1;

  let head;
  if (solo) {
    const p = rk[0];
    const quote = qs.length ? Math.round(p.correct / qs.length * 100) : 0;
    head = `<div class="card" style="text-align:center">
      <div class="label">Einzelspiel · ${esc(room.settings?.packName || "")}</div>
      <h1 style="margin:4px 0 14px">${esc(p.name)}</h1>
      <div class="stats">
        <div class="stat"><div class="stat-v">${p.score}</div><div class="stat-l">Punkte</div></div>
        <div class="stat"><div class="stat-v">${quote}%</div><div class="stat-l">Trefferquote</div></div>
        <div class="stat"><div class="stat-v">${fmtMs(p.avgMs)}</div><div class="stat-l">Ø Antwortzeit</div></div>
      </div></div>`;
  } else {
    const winners = rk.filter(p => p.rank === 1);
    const title = winners.length > 1 ? `Unentschieden: ${winners.map(p => esc(p.name)).join(" & ")}` : `${esc(winners[0]?.name || "–")} gewinnt!`;
    head = `<div class="card" style="text-align:center">
      <div class="label">Ergebnis · ${esc(room.settings?.packName || "")}</div>
      <h1 style="margin:4px 0 14px">${title}</h1>
      <div style="display:flex;flex-direction:column;gap:8px;text-align:left">
      ${rk.map(p => `<div class="rank${p.rank === 1 ? " first" : ""}">
        <span class="rank-pos">${p.rank}</span>
        <span class="rank-name">${esc(p.name)}${p.uid === s.uid ? " (du)" : ""}<div class="muted small">${p.correct}/${qs.length} richtig · Ø ${fmtMs(p.avgMs)}</div></span>
        <span class="rank-pts">${p.score}${p.uid === room.bonus?.uid ? `<div class="muted small" style="text-align:right">inkl. Bonus</div>` : ""}</span></div>`).join("")}
      </div></div>`;
  }

  // Zeittabelle
  const table = `<div class="card"><div class="label">Antwortzeiten pro Frage</div>
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

  // Bonuspunkt (z. B. für Geschwindigkeit), vom Moderator vergeben
  const bonusUid = room.bonus?.uid || null;
  const bonus = isMod ? `<div class="card"><div class="label">Bonuspunkt vergeben</div>
      <div class="pills">${rk.map(p => `<button class="pill${p.uid === bonusUid ? " on" : ""}" data-act="bonus" data-arg="${p.uid}">${esc(p.name)}${p.uid === bonusUid ? " +1 ✓" : ""}</button>`).join("")}
      <button class="pill${!bonusUid ? " on" : ""}" data-act="bonus" data-arg="">Keiner</button></div></div>`
    : bonusUid ? `<div class="status-bar">Bonuspunkt für ${esc(room.players?.[bonusUid]?.name || "–")}</div>` : "";

  const actions = isMod
    ? `<button class="btn btn-primary btn-full btn-lg" data-act="newRound">Neue Runde mit denselben Spielern</button>
       <button class="btn btn-danger btn-full" data-act="closeRoom">Partie beenden</button>`
    : `<div class="status-bar">Der Moderator kann eine neue Runde starten.</div>
       <button class="btn btn-ghost btn-full" data-act="dismiss">Zurück zum Start</button>`;

  return `<div class="page">${head}${bonus}${table}${actions}</div>`;
}
