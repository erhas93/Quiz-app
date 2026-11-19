// Moderatoransicht während der Partie
import { esc, activePlayers, answersFor, answeredCount, isOpenType, judgmentOf, unjudgedCount, qCount, fmtMs, verdictOf, estimateByDistance, isDuel, playOrder, isHints, hintLevel, hintPoints, HINT_MAX } from "../model.js";
import { unclearBtn, hintsBlock, gameHeader, questionCard, factPanel, L, shortName, formatValue, standing, ICON, resultBanner } from "./common.js";
import { duelStakeLine, duelOutcome } from "./duel.js";

// Feedback zur Schwierigkeit (nur Moderator, nach dem Auflösen) – fließt in die Statistik
const FB = [["easy", "zu leicht"], ["ok", "passt"], ["hard", "zu schwer"], ["bad", "Fehler"]];
function feedbackRow(room, qi) {
  const cur = room.feedback?.[qi] || null;
  return `<div class="fb-row"><span class="fb-l">Feedback</span>${FB.map(([k, l]) => `<button class="fb${cur === k ? " on" : ""}${k === "bad" ? " bad" : ""}" data-act="feedback" data-arg="${k}">${l}</button>`).join("")}</div>`;
}

export function modGameView(s, me) {
  const room = s.room;
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const q = room.questions?.[qi];
  if (!q) return `<div class="screen"><div class="body center"><div class="spin"></div></div></div>`;

  const phase = g.phase;
  const players = activePlayers(room);
  const answers = answersFor(room, qi);
  const done = answeredCount(room);
  const total = players.length;
  const revealed = phase === "revealed";
  const factOpen = s.local.factOpen === qi;

  const duel = isDuel(room);
  let body = "";
  if (duel && !revealed) body += duelStakeLine(room, qi, null);
  if (duel && revealed) { const o = duelOutcome(room, qi, null); if (o) body += resultBanner(o.kind === "neutral" ? "neutral" : o.kind, o.big, o.sub); }
  body += questionCard(q);
  body += hintsBlock(room, q, { all: true });
  body += unclearBtn(room, qi, s.uid);

  if (!isOpenType(q)) {
    // Markierungen zeigen live, wer was gewählt hat
    body += `<div class="answers">${q.a.map((txt, i) => {
      const who = players.filter(p => answers[p.uid]?.value === i);
      const cls = ["ans", i === q.r ? "correct" : who.length ? "wrong" : ""];
      const mk = who.length ? `<span class="mkrs">${who.map(p => `<span class="mkr">${shortName(p.name)}</span>`).join("")}</span>` : "";
      return `<button class="${cls.join(" ")}" disabled><span class="ans-l">${i === q.r ? ICON.check(18) : L(i)}</span><span class="ans-txt">${esc(txt)}</span>${mk}</button>`;
    }).join("")}</div>`;
  } else {
    // Lösung, bei Schätzfragen mit Abständen
    let sol = `<b>Richtig:</b> ${q.answer != null ? formatValue(q, q.answer) : "–"}`;
    if (q.type === "estimate" && q.answer != null) {
      const correct = parseFloat(q.answer);
      const diffs = players.map(p => { const v = answers[p.uid]?.value; return { p, d: typeof v === "number" ? Math.abs(v - correct) : null }; })
        .filter(x => x.d != null).sort((a, b) => a.d - b.d);
      if (diffs.length > 1) sol += `<div class="small">Am nächsten: <b>${diffs.filter(x => x.d === diffs[0].d).map(x => esc(x.p.name)).join(" & ")}</b> (Abstand ${diffs[0].d.toLocaleString("de-DE")})</div>`;
    }
    body += `<div class="solution">${sol}</div>`;
    body += players.map(p => {
      const a = answers[p.uid];
      const byDist = estimateByDistance(room, q);   // ab 2 Spielern gewinnt bei Schätzfragen der Nächste – nichts zu bewerten
      const j = byDist ? (phase === "shown" || revealed ? verdictOf(room, qi, p.uid) : null) : judgmentOf(room, qi, p.uid);
      const canJudge = a && phase === "shown" && !byDist;
      let meta = a ? fmtMs(a.ms) : "";
      if (q.type === "estimate" && a && typeof a.value === "number" && q.answer != null) meta = `Δ ${Math.abs(a.value - parseFloat(q.answer)).toLocaleString("de-DE")}`;
      return `<div class="prow ${j || ""}"><span class="prow-name">${esc(p.name)}</span>
        ${a ? `<span class="prow-val">${phase === "answering" ? "eingeloggt ✓" : formatValue(q, a.value)}</span>` : `<span class="prow-val none">${phase === "answering" ? "denkt nach …" : "keine Antwort"}</span>`}
        ${canJudge ? `<button class="judge c${j === "correct" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="1" aria-label="${esc(p.name)} richtig">${ICON.check(20)}</button>
          <button class="judge w${j === "wrong" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="0" aria-label="${esc(p.name)} falsch">${ICON.x(20)}</button>` : `<span class="prow-meta">${phase === "answering" ? "" : meta}</span>`}</div>`;
    }).join("");
  }

  const fact = phase === "shown" || revealed ? factPanel(q, factOpen, { title: "Hintergrund · zum Vorlesen", animate: s.local.factAnim }) : "";

  // Hinweiszeile + Aktionsknopf (+ Timer-Steuerung bei manuellem Timer)
  let note = "", action = "";
  if (phase === "answering" && isHints(room)) {
    // Hinweis-Modus: Moderator blendet Hinweise ein; zeigen erst, wenn alle getippt haben
    const n = hintLevel(room), all = done >= total && total > 0;
    note = `${done} von ${total} getippt · ${n ? `Hinweis ${n} von ${HINT_MAX}` : "noch kein Hinweis"}${all && n < HINT_MAX ? " · du kannst die übrigen Hinweise noch aufdecken" : ""}`;
    action = (n < HINT_MAX ? `<button class="btn ${all ? "btn-ghost" : "btn-gold"}" data-act="nextHint">Hinweis ${n + 1}</button>` : "")
      + `<button class="btn ${all ? "btn-primary" : "btn-ghost"}" data-act="showAnswers" ${all ? "" : "disabled"}>${all ? "Antworten zeigen" : "Warte auf Tipps"}</button>`;
  }
  else if (phase === "answering") { note = total ? `${done} von ${total} eingeloggt` : ""; action = `<button class="btn btn-ghost" data-act="showAnswers">Antworten zeigen</button>`; }
  else if (phase === "locked") { note = "Alle eingeloggt"; action = `<button class="btn btn-primary" data-act="showAnswers">Antworten zeigen</button>`; }
  else if (phase === "shown") {
    const open = unjudgedCount(room);
    note = open ? `${open} noch nicht bewertet – zählt sonst als falsch` : "";
    action = `<button class="btn btn-gold" data-act="reveal">Auflösen</button>`;
  } else if (revealed) {
    note = standing(room, null);
    const last = duel ? playOrder(room).length >= qCount(room) : qi + 1 >= qCount(room);
    action = `<button class="btn btn-primary" data-act="next">${last ? "Zum Ergebnis" : duel ? "Zurück zum Brett" : "Nächste Frage"}</button>`;
  }
  let timerBtns = "";
  if (room.settings?.timerMode === "manual" && phase === "answering") {
    const t = g.timer || {};
    timerBtns = t.running ? `<button class="btn-sq" data-act="timerPause" aria-label="Timer anhalten">${ICON.pause()}</button>`
      : `<button class="btn-sq" data-act="timerStart" aria-label="Timer starten">${ICON.play()}</button>`
        + (t.pauseLeft != null ? `<button class="btn-sq" data-act="timerReset" aria-label="Timer zurücksetzen">${ICON.reset()}</button>` : "");
  }

  return `<div class="screen">
    ${gameHeader(s, "mod")}
    <div class="body">${body}<div class="spacer"></div></div>
    <div class="actions">${revealed && !room.meta?.test ? feedbackRow(room, qi) : ""}<div class="foot-note">${note}</div><div class="actions-row">${timerBtns}${action}</div></div>
    ${fact}
  </div>`;
}
