// Moderatoransicht während der Partie
import { esc, activePlayers, answersFor, answeredCount, isOpenType, judgmentOf, unjudgedCount, qCount, fmtMs, resultFor } from "../model.js";
import { gameHeader, questionBox, factBox, L, shortName, formatValue } from "./common.js";

export function modGameView(s, me) {
  const room = s.room;
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const q = room.questions?.[qi];
  if (!q) return `<div class="page center"><div class="spin"></div></div>`;

  const phase = g.phase;
  const players = activePlayers(room);
  const answers = answersFor(room, qi);
  const done = answeredCount(room);
  const total = players.length;
  const revealed = phase === "revealed";
  const res = resultFor(room, qi);

  let body = questionBox(q);

  if (!isOpenType(q)) {
    body += `<div class="answers">${q.a.map((txt, i) => {
      const who = players.filter(p => answers[p.uid]?.value === i);
      const cls = ["ans", "disabled"];
      if (i === q.r) cls.push("correct"); else if (who.length) cls.push("wrong");
      const mk = who.length ? `<span class="mkrs">${who.map(p => `<span class="mkr">${shortName(p.name)}</span>`).join("")}</span>` : "";
      return `<div class="${cls.join(" ")}"><span class="ans-l">${i === q.r ? "✓" : L(i)}</span><span class="ans-txt">${esc(txt)}</span>${mk}</div>`;
    }).join("")}</div>`;
  } else {
    // Erwartete Antwort und ggf. Abstände bei Schätzfragen
    let hint = `<strong>Richtige Antwort:</strong> ${q.answer != null ? formatValue(q, q.answer) : "–"}`;
    if (q.type === "estimate" && q.answer != null) {
      const correct = parseFloat(q.answer);
      const diffs = players.map(p => {
        const v = answers[p.uid]?.value;
        return { p, d: typeof v === "number" ? Math.abs(v - correct) : null };
      }).filter(x => x.d != null).sort((a, b) => a.d - b.d);
      if (diffs.length) {
        hint += `<br>${diffs.map(x => `${esc(x.p.name)}: Abstand ${x.d.toLocaleString("de-DE")}`).join("<br>")}`;
        if (diffs.length > 1) {
          const best = diffs.filter(x => x.d === diffs[0].d).map(x => esc(x.p.name)).join(" & ");
          hint += `<br><strong>Am nächsten: ${best}</strong>`;
        }
      }
    }
    body += `<div class="hint">${hint}</div>`;
    body += players.map(p => {
      const a = answers[p.uid];
      const j = judgmentOf(room, qi, p.uid);
      const canJudge = a && phase === "shown";
      return `<div class="pans ${j || ""}">
        <div class="pans-name"><span>${esc(p.name)}</span><span>${a ? fmtMs(a.ms) : ""}</span></div>
        ${a ? `<div class="pans-val">${formatValue(q, a.value)}</div>` : `<div class="pans-none">${phase === "answering" ? "Noch keine Antwort" : "Keine Antwort"}</div>`}
        ${canJudge ? `<div class="judge-row">
          <button class="judge-btn judge-c${j === "correct" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="1">Richtig ✓</button>
          <button class="judge-btn judge-w${j === "wrong" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="0">Falsch ✗</button>
        </div>` : ""}</div>`;
    }).join("");
  }

  // Antwortzeiten
  const timed = players.filter(p => answers[p.uid]);
  if (timed.length) {
    const fastest = timed.reduce((a, b) => (answers[a.uid].ms <= answers[b.uid].ms ? a : b));
    body += `<div class="speed"><div class="label" style="margin-bottom:2px">Antwortzeiten</div>
      ${timed.sort((a, b) => answers[a.uid].ms - answers[b.uid].ms).map(p => `<div class="row"><span>${esc(p.name)}${res?.fastestUid === p.uid ? " ⚡" : ""}</span><b>${fmtMs(answers[p.uid].ms)}</b></div>`).join("")}
      ${timed.length > 1 && !revealed ? `<div class="muted small">Am schnellsten: ${esc(fastest.name)}</div>` : ""}
    </div>`;
  }

  if (phase === "shown" || revealed) body += factBox(q);

  // Aktionsknopf
  let action;
  if (phase === "answering") action = `<button class="btn btn-ghost btn-full btn-lg" data-act="showAnswers">Antworten zeigen${total > 1 || done < total ? ` (${done}/${total} eingeloggt)` : ""}</button>`;
  else if (phase === "locked") action = `<button class="btn btn-primary btn-full btn-lg" data-act="showAnswers">Antworten zeigen</button>`;
  else if (phase === "shown") {
    const open = unjudgedCount(room);
    action = `<button class="btn btn-gold btn-full btn-lg" data-act="reveal">Auflösen${open ? ` (${open} unbewertet = falsch)` : ""}</button>`;
  } else if (revealed) {
    const last = qi + 1 >= qCount(room);
    action = `<button class="btn btn-primary btn-full btn-lg" data-act="next">${last ? "Zum Ergebnis" : "Nächste Frage"}</button>`;
  }

  return `<div class="game">
    ${gameHeader(room, s.uid, "Moderator", true)}
    <div class="g-body">${body}</div>
    <div class="g-actions">${action || ""}</div>
  </div>`;
}
