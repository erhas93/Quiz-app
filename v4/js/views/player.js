// Spieleransicht während der Partie
import { esc, activePlayers, answersFor, answerOf, answeredCount, isOpenType, judgmentOf, resultFor } from "../model.js";
import { gameHeader, questionBox, factBox, L, shortName, formatValue } from "./common.js";

export function playerGameView(s, me) {
  const room = s.room;
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const q = room.questions?.[qi];
  if (!q) return `<div class="page center"><div class="spin"></div><p class="muted" style="text-align:center">Partie startet …</p></div>`;

  const phase = g.phase;
  const mine = answerOf(room, qi, s.uid);
  const total = activePlayers(room).length;
  const done = answeredCount(room);
  const pending = s.local.pending?.qi === qi ? s.local.pending.value : null;
  const showOthers = phase === "shown" || phase === "revealed";
  const revealed = phase === "revealed";
  const answers = answersFor(room, qi);
  const players = activePlayers(room);

  // Statuszeile
  let status, statusCls = "";
  if (phase === "answering" && !mine) status = total > 1 ? `Frage läuft · ${done}/${total} eingeloggt` : "Frage läuft";
  else if (phase === "answering" || phase === "locked") { status = total > 1 && done < total ? `Eingeloggt ✓ · warte auf die anderen (${done}/${total})` : "Eingeloggt ✓ · warte auf die Auflösung"; statusCls = "ok"; }
  else if (phase === "shown") status = isOpenType(q) ? "Antworten werden bewertet …" : "Alle Antworten sind sichtbar";
  else if (revealed) {
    const pts = resultFor(room, qi)?.points?.[s.uid];
    status = pts ? "Richtig! +1 Punkt" : (mine ? "Leider falsch" : "Keine Antwort abgegeben");
    statusCls = pts ? "ok" : "";
  }

  let body = `<div class="status-bar ${statusCls}">${status}</div>${questionBox(q)}`;
  let actions = "";

  if (!isOpenType(q)) {
    // Multiple Choice
    const canPick = phase === "answering" && !mine;
    body += `<div class="answers">${q.a.map((txt, i) => {
      const cls = ["ans"];
      if (!canPick) cls.push("disabled");
      if (revealed) {
        if (i === q.r) cls.push("correct");
        else if (mine?.value === i) cls.push("wrong");
        else cls.push("faded");
      } else if (mine?.value === i || pending === i) cls.push("pending");
      let mk = "";
      if (showOthers) {
        const who = players.filter(p => answers[p.uid]?.value === i);
        if (who.length) mk = `<span class="mkrs">${who.map(p => `<span class="mkr${p.uid === s.uid ? " me" : ""}">${shortName(p.name)}</span>`).join("")}</span>`;
      }
      const letter = revealed && i === q.r ? "✓" : L(i);
      return `<button class="${cls.join(" ")}" ${canPick ? `data-act="pick" data-arg="${i}"` : "disabled"}>
        <span class="ans-l">${letter}</span><span class="ans-txt">${esc(txt)}</span>${mk}</button>`;
    }).join("")}</div>`;
    if (canPick) actions = `<button class="btn btn-blue btn-full btn-lg" data-act="commitPick" ${pending === null ? "disabled" : ""}>Einloggen ✓</button>`;
  } else {
    // Schätzen / Freitext
    if (phase === "answering" && !mine) {
      const draft = s.local.draft?.qi === qi ? s.local.draft.value : "";
      body += `<input class="inp ans-input" id="in-answer" data-input="draft" ${q.type === "estimate" ? 'inputmode="decimal"' : ""}
        placeholder="${q.type === "estimate" ? "Deine Schätzung" : "Deine Antwort"}" value="${esc(draft)}" autocomplete="off">`;
      actions = `<button class="btn btn-blue btn-full btn-lg" data-act="commitDraft" ${draft.trim() ? "" : "disabled"}>Einloggen ✓</button>`;
    } else if (mine && !showOthers) {
      body += `<div class="submitted">Deine Antwort: ${formatValue(q, mine.value)}</div>`;
    }
    if (showOthers) {
      if (revealed && q.answer != null) body += `<div class="hint"><strong>Richtige Antwort:</strong> ${formatValue(q, q.answer)}</div>`;
      body += players.map(p => {
        const a = answers[p.uid];
        const j = revealed ? judgmentOf(room, qi, p.uid) : null;
        return `<div class="pans ${j || ""}">
          <div class="pans-name"><span>${esc(p.name)}${p.uid === s.uid ? " (du)" : ""}</span><span>${j === "correct" ? "✓ richtig" : j === "wrong" ? "✗ falsch" : ""}</span></div>
          ${a ? `<div class="pans-val">${formatValue(q, a.value)}</div>` : `<div class="pans-none">Keine Antwort</div>`}</div>`;
      }).join("");
    }
  }

  if (revealed) body += factBox(q);

  return `<div class="game">
    ${gameHeader(room, s.uid, me.name, false)}
    <div class="g-body">${body}</div>
    ${actions ? `<div class="g-actions">${actions}</div>` : ""}
  </div>`;
}
