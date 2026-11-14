// Spieler- und Zuschaueransicht während der Partie
import { esc, activePlayers, answersFor, answerOf, answeredCount, isOpenType, judgmentOf, resultFor, moderatorOf, moderatorAway, hiddenFor } from "../model.js";
import { gameHeader, questionCard, factCard, L, shortName, formatValue, resultBanner, standing, ICON } from "./common.js";

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
    if (canPick) actions = `<button class="btn btn-blue" data-act="commitPick" ${pending === null ? "disabled" : ""}>Einloggen</button>`;
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
      if (revealed && q.answer != null) body += `<div class="solution"><b>Richtig:</b> ${formatValue(q, q.answer)}</div>`;
      body += players.map(p => {
        const a = answers[p.uid];
        const j = revealed ? judgmentOf(room, qi, p.uid) : null;
        return `<div class="prow ${j || ""}"><span class="prow-name">${esc(p.name)}${p.uid === s.uid ? " (du)" : ""}</span>
          ${a ? `<span class="prow-val">${formatValue(q, a.value)}</span>` : `<span class="prow-val none">keine Antwort</span>`}
          ${j ? `<span class="chip-st ${j === "correct" ? "ok" : ""}" style="${j === "wrong" ? "color:var(--c5)" : ""}">${j === "correct" ? ICON.check(18) : ICON.x(18)}</span>` : ""}</div>`;
      }).join("");
    }
  }

  if (revealed) body += factCard(q, factOpen);

  // Hinweiszeile über dem Knopf
  if (spectator) note = phase === "answering" || phase === "locked" ? `${done} von ${total} eingeloggt` : phase === "shown" ? "Antworten werden gezeigt" : "";
  else if (phase === "answering" && !mine) {
    const others = players.filter(p => p.uid !== s.uid && answers[p.uid]).map(p => esc(p.name));
    note = others.length ? `${others.join(", ")} ${others.length === 1 ? "hat" : "haben"} eingeloggt` : (total > 1 ? "Noch niemand eingeloggt" : "");
  } else if (phase === "locked" && !mine) note = "Zeit abgelaufen – keine Antwort";
  else if (phase === "answering" || phase === "locked") { note = done < total ? `Eingeloggt ✓ · warte auf die anderen (${done}/${total})` : "Eingeloggt ✓ · gleich wird aufgelöst"; noteCls = "ok"; }
  else if (phase === "shown") note = isOpenType(q) ? "Der Moderator bewertet die Antworten …" : "Gleich wird aufgelöst …";
  else if (revealed) note = "Warte auf die nächste Frage …";

  if (spectator) {
    actions = (moderatorAway(room, Date.now()) ? `<button class="btn btn-gold" data-act="takeover">Moderation übernehmen</button>` : "")
      + `<button class="btn btn-text" data-act="leave">Zuschauen beenden</button>`;
  }

  return `<div class="screen">
    ${gameHeader(s, spectator ? "spec" : "player")}
    <div class="body">${body}<div class="spacer"></div></div>
    <div class="actions"><div class="foot-note ${noteCls}">${note}</div>${actions}</div>
  </div>`;
}
