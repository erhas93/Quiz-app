// Spieler- und Zuschaueransicht während der Partie
import { esc, activePlayers, answersFor, answerOf, answeredCount, isOpenType, judgmentOf, resultFor, moderatorOf, moderatorAway, hiddenFor, isFree, hostUid, judgeOf, jokerOf, nextOf, waitingForNext, qCount } from "../model.js";
import { gameHeader, questionCard, factPanel, L, shortName, formatValue, resultBanner, standing, ICON } from "./common.js";

export function playerGameView(s, me) {
  const room = s.room;
  const g = room.game || {};
  const qi = g.qIndex ?? 0;
  const q = room.questions?.[qi];
  if (!q) return `<div class="screen"><div class="body center"><div class="spin"></div><p class="muted" style="text-align:center">Partie startet …</p></div></div>`;

  const phase = g.phase;
  const spectator = me.role === "spectator";
  const mine = spectator ? null : answerOf(room, qi, s.uid);
  const players = activePlayers(room);
  const total = players.length;
  const done = answeredCount(room);
  const pending = s.local.pending?.qi === qi ? s.local.pending.value : null;
  const showOthers = phase === "shown" || phase === "revealed";
  const revealed = phase === "revealed";
  const answers = answersFor(room, qi);
  const factOpen = s.local.factOpen === qi;
  const free = isFree(room);
  const iAmHost = free && hostUid(room) === s.uid;
  const online = uid => !!room.presence?.[uid]?.online;
  // Ohne Moderator: darf ich die Antwort von targetUid bewerten? (zugewiesen – oder als Host für einen offline-Bewerter)
  const solo = free && players.length === 1;
  // Im Einzelspiel bewertet die App selbst – keine Bewerten-Knöpfe
  const canJudge = targetUid => free && !solo && !spectator && phase === "shown" && !!answers[targetUid]
    && (judgeOf(room, targetUid) === s.uid || (iAmHost && !online(judgeOf(room, targetUid))));

  let body = "", actions = "", note = "", noteCls = "";

  const mod = moderatorOf(room);
  if (mod && !mod.online) body += `<div class="notice warn">Moderator ${esc(mod.name)} ist offline – warte …</div>`;

  // Ergebnis der Frage zuerst (nur nach dem Auflösen)
  if (revealed) {
    const st = standing(room, s.uid);
    if (spectator) body += resultBanner("neutral", "Aufgelöst", st);
    else {
      const pts = resultFor(room, qi)?.points?.[s.uid];
      const fast = resultFor(room, qi)?.fastestUid === s.uid && total > 1;
      body += pts ? resultBanner("ok", "Richtig! +1", `${st}${fast ? " · schnellste Antwort ⚡" : ""}`)
        : resultBanner("no", mine ? "Leider falsch" : "Keine Antwort", st);
    }
  }

  body += questionCard(q, revealed);

  if (!isOpenType(q)) {
    // ── Multiple Choice ──
    const canPick = !spectator && phase === "answering" && !mine;
    const hidden = spectator || revealed ? [] : hiddenFor(room, qi, s.uid);
    if (hidden.length && !mine && phase === "answering") body += `<div class="notice gold">50:50-Joker: zwei falsche Antworten sind weg</div>`;
    body += `<div class="answers">${q.a.map((txt, i) => {
      if (hidden.includes(i)) return `<button class="ans gone" disabled><span class="ans-l">${L(i)}</span><span class="ans-txt">${esc(txt)}</span></button>`;
      const cls = ["ans"];
      if (canPick) cls.push("pick");
      if (revealed) cls.push(i === q.r ? "correct" : mine?.value === i ? "wrong" : "faded");
      else if (mine?.value === i || pending === i) cls.push("pending");
      let mk = "";
      if (showOthers) {
        const who = players.filter(p => answers[p.uid]?.value === i);
        if (who.length) mk = `<span class="mkrs">${who.map(p => `<span class="mkr${p.uid === s.uid ? " me" : ""}">${shortName(p.name)}</span>`).join("")}</span>`;
      }
      const letter = revealed && i === q.r ? ICON.check(18) : L(i);
      return `<button class="${cls.join(" ")}" ${canPick ? `data-act="pick" data-arg="${i}"` : "disabled"}>
        <span class="ans-l">${letter}</span><span class="ans-txt">${esc(txt)}</span>${mk}</button>`;
    }).join("")}</div>`;
    if (canPick) {
      const jokerBtn = free && !jokerOf(room, s.uid) ? `<button class="btn-sq" data-act="useJoker" aria-label="50:50-Joker einsetzen" style="font-size:13px;font-weight:800;color:var(--c3)">50:50</button>` : "";
      actions = `<div class="actions-row">${jokerBtn}<button class="btn btn-blue" data-act="commitPick" ${pending === null ? "disabled" : ""}>Einloggen</button></div>`;
    }
  } else {
    // ── Schätzen / Freitext ──
    if (!spectator && phase === "answering" && !mine) {
      const draft = s.local.draft?.qi === qi ? s.local.draft.value : "";
      body += `<input class="ans-input" id="in-answer" data-input="draft" ${q.type === "estimate" ? 'inputmode="decimal"' : ""} aria-label="Deine Antwort"
        placeholder="${q.type === "estimate" ? "Deine Schätzung" : "Deine Antwort"}" value="${esc(draft)}" autocomplete="off">`;
      actions = `<button class="btn btn-blue" data-act="commitDraft" ${draft.trim() ? "" : "disabled"}>Einloggen</button>`;
    } else if (mine && !showOthers) {
      body += `<div class="my-answer">Deine Antwort: ${formatValue(q, mine.value)}</div>`;
    }
    if (showOthers) {
      if ((revealed || free) && q.answer != null) body += `<div class="solution"><b>Richtig:</b> ${formatValue(q, q.answer)}</div>`;
      body += players.map(p => {
        const a = answers[p.uid];
        const j = revealed || free ? judgmentOf(room, qi, p.uid) : null;
        const judgeBtns = canJudge(p.uid) ? `<button class="judge c${j === "correct" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="1" aria-label="${esc(p.name)} richtig">${ICON.check(20)}</button>
          <button class="judge w${j === "wrong" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="0" aria-label="${esc(p.name)} falsch">${ICON.x(20)}</button>` : "";
        const mark = !judgeBtns && j ? `<span class="chip-st ${j === "correct" ? "ok" : ""}" style="${j === "wrong" ? "color:var(--c5)" : ""}">${j === "correct" ? ICON.check(18) : ICON.x(18)}</span>` : "";
        return `<div class="prow ${j || ""}"><span class="prow-name">${esc(p.name)}${p.uid === s.uid ? " (du)" : ""}</span>
          ${a ? `<span class="prow-val">${formatValue(q, a.value)}</span>` : `<span class="prow-val none">keine Antwort</span>`}${judgeBtns}${mark}</div>`;
      }).join("");
      // Einzelspiel: automatische Bewertung lässt sich nach dem Auflösen korrigieren
      if (solo && revealed && answers[s.uid]) {
        const ok = judgmentOf(room, qi, s.uid) === "correct";
        const auto = room.judgments?.[qi]?.[s.uid]?.by === "auto";
        body += `<div class="meta-line" style="justify-content:space-between"><span>${auto ? "Automatisch bewertet" : "Von dir korrigiert"}</span>
          <button class="btn btn-ghost btn-sm" data-act="override" data-val="${ok ? 0 : 1}">${ok ? "Doch falsch" : "Doch richtig"}</button></div>`;
      }
    }
  }

  const fact = revealed ? factPanel(q, factOpen, { animate: s.local.factAnim }) : "";

  // Hinweiszeile über dem Knopf
  if (spectator) note = phase === "answering" || phase === "locked" ? `${done} von ${total} eingeloggt` : phase === "shown" ? "Antworten werden gezeigt" : "";
  else if (phase === "answering" && !mine) {
    const others = players.filter(p => p.uid !== s.uid && answers[p.uid]).map(p => esc(p.name));
    note = others.length ? `${others.join(", ")} ${others.length === 1 ? "hat" : "haben"} eingeloggt` : (total > 1 ? "Noch niemand eingeloggt" : "");
  } else if (phase === "locked" && !mine) note = "Zeit abgelaufen – keine Antwort";
  else if (phase === "answering" || phase === "locked") { note = done < total ? `Eingeloggt ✓ · warte auf die anderen (${done}/${total})` : "Eingeloggt ✓ · gleich wird aufgelöst"; noteCls = "ok"; }
  else if (phase === "shown" && solo && isOpenType(q)) note = "Wird automatisch bewertet …";
  else if (phase === "shown" && free && isOpenType(q)) {
    const mineToDo = players.filter(p => canJudge(p.uid) && !judgmentOf(room, qi, p.uid));
    const openJudges = [...new Set(players.filter(p => answers[p.uid] && !judgmentOf(room, qi, p.uid)).map(p => judgeOf(room, p.uid)))]
      .filter(u => u !== s.uid).map(u => esc(room.players?.[u]?.name || "?"));
    note = mineToDo.length ? `Bewerte ${mineToDo.map(p => p.uid === s.uid ? "deine eigene" : `${esc(p.name)}s`).join(" und ")} Antwort` : openJudges.length ? `Warte auf die Bewertung von ${openJudges.join(", ")} …` : "Gleich wird aufgelöst …";
    noteCls = mineToDo.length ? "ok" : "";
  }
  else if (phase === "shown") note = isOpenType(q) ? "Der Moderator bewertet die Antworten …" : "Gleich wird aufgelöst …";
  else if (revealed && free && !spectator) {
    const done = !!nextOf(room, qi)[s.uid];
    const wait = waitingForNext(room, qi).filter(p => p.uid !== s.uid).map(p => esc(p.name));
    const last = qi + 1 >= qCount(room);
    if (!done) actions = `<button class="btn btn-primary" data-act="markNext">${last ? "Zum Ergebnis" : "Weiter"}</button>`;
    note = done ? (wait.length ? `Bereit ✓ · warte auf ${wait.join(", ")}` : "Bereit ✓") : (wait.length < players.filter(p => p.online).length - 1 ? "Die anderen warten auf dich" : "");
    noteCls = done ? "ok" : "";
  }
  else if (revealed) note = free ? "Warte auf die nächste Frage …" : "Warte auf die nächste Frage …";

  if (spectator) {
    actions = (moderatorAway(room, Date.now()) ? `<button class="btn btn-gold" data-act="takeover">Moderation übernehmen</button>` : "")
      + `<button class="btn btn-text" data-act="leave">Zuschauen beenden</button>`;
  }

  return `<div class="screen">
    ${gameHeader(s, spectator ? "spec" : "player")}
    <div class="body">${body}<div class="spacer"></div></div>
    <div class="actions"><div class="foot-note ${noteCls}">${note}</div>${actions}</div>
    ${fact}
  </div>`;
}
