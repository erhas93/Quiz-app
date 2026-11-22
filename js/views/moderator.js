// Moderatoransicht während der Partie
import { isSingle, betsOn, betsLeft, hiddenFor, fmtNum, isYearQ, esc, activePlayers, answersFor, answeredCount, isOpenType, judgmentOf, unjudgedCount, qCount, fmtMs, verdictOf, estimateByDistance, isDuel, playOrder, isHints, hintLevel, hintPoints, HINT_MAX } from "../model.js";
import { unclearBtn, hintsBlock, gameHeader, questionCard, factPanel, L, shortName, formatValue, standing, ICON } from "./common.js";
import { an, animKey, hk } from "./anim.js";
import { duelStakeLine, duelOutcome } from "./duel.js";

// Nur ein Gerät: der Moderator trägt für jeden Spieler die Antwort ein (änderbar, bis die Antworten gezeigt werden)
function entryCard(s, room, q, qi) {
  const ans = answersFor(room, qi);
  const bets = betsOn(room);
  const rows = activePlayers(room).map(p => {
    const a = ans[p.uid];
    const bOn = a ? !!a.b : !!s.local.modBet?.[qi + ":" + p.uid];
    const left = betsLeft(room, p.uid);
    const betBtn = bets && (bOn || left > 0) ? `<button class="ent-bet${bOn ? " on" : ""}" data-act="modBet" data-arg="${p.uid}" aria-pressed="${bOn}" aria-label="Sicher-Einsatz für ${esc(p.name)}">🎯<small>${bOn ? "" : left}</small></button>` : "";
    let input;
    if (!isOpenType(q)) {
      const hid = hiddenFor(room, qi, p.uid);
      input = `<div class="ent-mc">${q.a.map((_, i) => hid.includes(i) ? `<button class="ent-l gone" disabled>${L(i)}</button>`
        : `<button class="ent-l${a?.value === i ? " on" : ""}" data-act="modPick" data-arg="${p.uid}" data-val="${i}" aria-label="${esc(p.name)}: ${L(i)}">${L(i)}</button>`).join("")}</div>`;
    } else {
      const key = qi + ":" + p.uid, d = s.local.modDraft?.[key];
      const saved = a ? (q.type === "estimate" && typeof a.value === "number" ? fmtNum(q, a.value) : String(a.value)) : "";
      const val = d ?? saved;
      const dirty = d != null && d !== saved;
      input = `<div class="ent-open"><input class="ent-in" id="ent-${esc(p.uid)}" data-input="modAns" data-arg="${esc(p.uid)}" value="${esc(val)}" ${q.type === "estimate" ? 'inputmode="decimal"' : ""} placeholder="${q.type === "estimate" ? "Schätzung" : "Antwort"}" autocomplete="off">
        <button class="ent-ok${a && !dirty ? " on" : ""}" data-act="modAns" data-arg="${esc(p.uid)}" ${val.trim() ? "" : "disabled"} aria-label="Antwort von ${esc(p.name)} speichern">${a && !dirty ? ICON.check(18) : "OK"}</button></div>`;
    }
    return `<div class="ent-row${a ? " done" : ""}"><span class="ent-name">${esc(p.name)}</span>${input}${betBtn}</div>`;
  }).join("");
  return `<div class="card ent an-up"${an(animKey(room) + ":ent", 200)}><span class="label">Antworten eintragen</span>${rows}</div>`;
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
  const K = animKey(room);
  let body = "";
  // Feste Reihenfolge wie beim Spieler; das Duell-Ergebnis steht unten in der Hinweiszeile
  if (duel) body += duelStakeLine(room, qi, null);
  body += questionCard(q, { room, factOn: phase === "shown" || revealed });
  body += hintsBlock(room, q, { all: true, local: s.local });
  body += unclearBtn(room, qi, s.uid);

  const entry = isSingle(room) && (phase === "answering" || phase === "locked");
  if (entry && !isOpenType(q)) body += entryCard(s, room, q, qi);
  if (!isOpenType(q)) {
    // Markierungen zeigen live, wer was gewählt hat
    body += `<div class="answers">${q.a.map((txt, i) => {
      const who = players.filter(p => answers[p.uid]?.value === i);
      const cls = ["ans", i === q.r ? "correct" : who.length ? "wrong" : "", "an-ain"];
      const mk = who.length ? `<span class="mkrs">${who.map(p => `<span class="mkr an-chk"${an(K + ":mk:" + p.uid)}>${shortName(p.name)}${revealed && answers[p.uid]?.b ? " 🎯" : ""}</span>`).join("")}</span>` : "";
      return `<button class="${cls.join(" ")}"${an(K + ":a" + i, 120 + i * 60)} disabled><span class="ans-l">${i === q.r ? ICON.check(18) : L(i)}</span><span class="ans-txt">${esc(txt)}</span>${mk}</button>`;
    }).join("")}</div>`;
  } else {
    // Lösung, bei Schätzfragen mit Abständen
    let sol = `<b>Richtig:</b> ${q.answer != null ? formatValue(q, q.answer) : "–"}`;
    if (q.type === "estimate" && q.answer != null) {
      const correct = parseFloat(q.answer);
      const diffs = players.map(p => { const v = answers[p.uid]?.value; return { p, d: typeof v === "number" ? Math.abs(v - correct) : null }; })
        .filter(x => x.d != null).sort((a, b) => a.d - b.d);
      if (diffs.length > 1) sol += `<div class="small">Am nächsten: <b>${diffs.filter(x => x.d === diffs[0].d).map(x => esc(x.p.name)).join(" & ")}</b> (Abstand ${diffs[0].d.toLocaleString("de-DE")}${isYearQ(q) ? " Jahre" : ""})</div>`;
    }
    body += `<div class="solution an-ain"${an(K + ":sol", 120)}>${sol}</div>`;
    if (entry) body += entryCard(s, room, q, qi);
    else body += players.map((p, pi) => {
      const a = answers[p.uid];
      const byDist = estimateByDistance(room, q);   // ab 2 Spielern gewinnt bei Schätzfragen der Nächste – nichts zu bewerten
      const j = byDist ? (phase === "shown" || revealed ? verdictOf(room, qi, p.uid) : null) : judgmentOf(room, qi, p.uid);
      const canJudge = a && phase === "shown" && !byDist;
      let meta = a && typeof a.ms === "number" ? fmtMs(a.ms) : "";
      if (q.type === "estimate" && a && typeof a.value === "number" && q.answer != null) meta = `Δ ${Math.abs(a.value - parseFloat(q.answer)).toLocaleString("de-DE")}`;
      return `<div class="prow ${j || ""} an-ain"${an(K + ":row:" + p.uid, 180 + pi * 60)}><span class="prow-name">${esc(p.name)}${revealed && a?.b ? " 🎯" : ""}</span>
        ${a ? `<span class="prow-val">${phase === "answering" && !isHints(room) ? "eingeloggt ✓" : formatValue(q, a.value)}</span>` : `<span class="prow-val none">${phase === "answering" ? "denkt nach …" : "keine Antwort"}</span>`}
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
    const o = duel ? duelOutcome(room, qi, null) : null;
    note = o ? [o.big, o.sub].filter(Boolean).join(" · ") : standing(room, null);
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

  // Feedback-Zeile unten im Inhalt (nicht im Fußbereich, der hat eine feste Höhe)
  return `<div class="screen">
    ${gameHeader(s, "mod")}
    <div class="body">${body}<div class="spacer"></div></div>
    <div class="actions fixed"><div class="foot-note an-note"${an(K + ":n:" + hk(note))}>${note}</div><div class="fslot"><div class="actions-row an-up"${an(K + ":slot:" + phase)}>${timerBtns}${action}</div></div></div>
    ${fact}
  </div>`;
}
