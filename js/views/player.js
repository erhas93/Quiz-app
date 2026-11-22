// Spieler- und Zuschaueransicht während der Partie
import { hintLevel, HINT_MAX, hintReqOf, hintWaiting, betsOn, betsLeft, unjudgedCount, esc, activePlayers, answersFor, answerOf, answeredCount, isOpenType, judgmentOf, resultFor, moderatorOf, moderatorAway, hiddenFor, verdictOf, estimateByDistance, isFree, hostUid, judgeOf, jokerOf, nextOf, waitingForNext, qCount, isDuel, playOrder, isHints, hintPoints } from "../model.js";
import { duelStakeLine, duelOutcome } from "./duel.js";
import { unclearBtn, hintsBlock, gameHeader, questionCard, factPanel, L, shortName, formatValue, resultSlot, standing, ICON } from "./common.js";
import { an, animKey, hk } from "./anim.js";

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
  // Zuschauer sehen alles live, sobald jemand getippt hat
  const showOthers = phase === "shown" || phase === "revealed" || spectator;
  const revealed = phase === "revealed";
  const answers = answersFor(room, qi);
  const factOpen = s.local.factOpen === qi;
  const free = isFree(room);
  const iAmHost = free && hostUid(room) === s.uid;
  const online = uid => !!room.presence?.[uid]?.online;
  // Ohne Moderator: darf ich die Antwort von targetUid bewerten? (zugewiesen – oder als Host für einen offline-Bewerter)
  const solo = free && players.length === 1;
  // ohne Moderator steuert der Host per Knopf (Antworten zeigen, Auflösen, Weiter); im Einzelspiel läuft das automatisch
  const steerFree = iAmHost && !solo && !spectator;
  // Sicher-Einsatz: Knopf neben „Einloggen“, zeigt die verbleibenden Einsätze
  const betOn = !spectator && betsOn(room) && s.local.bet?.qi === qi;
  const left = betsOn(room) && !spectator ? betsLeft(room, s.uid) : 0;
  // Hinweis-Modus ohne Moderator: Hinweis anfordern (kommt, wenn alle Wartenden angefordert haben)
  const hintFree = isHints(room) && free && phase === "answering" && !mine && !spectator && hintLevel(room) < HINT_MAX;
  const reqOn = hintFree && hintReqOf(room, s.uid);
  const hintBtn = hintFree ? `<button class="btn-sq hreq${reqOn ? " on" : ""}" data-act="requestHint" aria-pressed="${reqOn}" aria-label="Nächsten Hinweis anfordern"><span class="bet-ico">💡</span><span class="bet-n">${reqOn ? "angefragt" : "Hinweis"}</span></button>` : "";
  const betBtn = left ? `<button class="btn-sq bet${betOn ? " on" : ""}" data-act="bet" aria-pressed="${betOn}" aria-label="Sicher-Einsatz setzen, noch ${left}"><span class="bet-ico">🎯</span><span class="bet-n">${betOn ? "gesetzt" : `${left}×`}</span></button>` : "";
  const hostName = esc(room.players?.[hostUid(room)]?.name || "Der Host");
  // „warte auf Chris“ statt Zähler, wenn nur noch einer fehlt
  const missing = players.filter(p => !answers[p.uid]);
  const urge = phase === "answering" && !mine && !spectator && total > 1 && done === total - 1;
  const waitTxt = missing.length === 1 ? `warte auf ${esc(missing[0].name)}` : `warte auf die anderen (${done}/${total})`;
  // Im Einzelspiel bewertet die App selbst – keine Bewerten-Knöpfe
  const canJudge = targetUid => free && !solo && !spectator && phase === "shown" && !!answers[targetUid] && !estimateByDistance(room, q)
    && (judgeOf(room, targetUid) === s.uid || (iAmHost && !online(judgeOf(room, targetUid))));

  let body = "", actions = "", note = "", noteCls = "";
  const K = animKey(room);
  const duel = isDuel(room);
  const mod = moderatorOf(room);

  // Feste Reihenfolge, nichts kommt beim Auflösen oberhalb dazu: (Einsatz) · Frage · (Hinweise) · Antworten
  if (duel) body += duelStakeLine(room, qi, spectator ? null : s.uid);
  body += questionCard(q, { room, factOn: revealed });
  body += hintsBlock(room, q, { local: s.local });
  if (!spectator) body += unclearBtn(room, qi, s.uid);

  // Ergebnis der Frage: im Fußbereich statt über der Frage
  let res = "";
  if (revealed && !spectator) {
    if (duel) {
      const o = duelOutcome(room, qi, s.uid);
      if (o) res = { kind: o.kind, big: o.big, sub: [o.sub, standing(room, s.uid)].filter(Boolean).join(" · ") };
    } else {
      const st = standing(room, s.uid);
      const pts = resultFor(room, qi)?.points?.[s.uid];
      const fast = resultFor(room, qi)?.fastestUid === s.uid && total > 1 && !isHints(room);
      const bet = !!resultFor(room, qi)?.bets?.[s.uid];
      res = pts > 0 ? { kind: "ok", big: `Richtig! +${pts}${bet ? " 🎯" : ""}`, sub: `${bet && pts < 2 ? "Einsatz: kein Volltreffer · " : ""}${st}${fast ? " · schnellste Antwort ⚡" : ""}` }
        : { kind: "no", big: mine ? `Leider falsch${pts < 0 ? ` · ${pts} 🎯` : ""}` : "Keine Antwort", sub: st };
    }
  }

  if (!isOpenType(q)) {
    // ── Multiple Choice ──
    const canPick = !spectator && phase === "answering" && !mine;
    const hidden = spectator || revealed ? [] : hiddenFor(room, qi, s.uid);
    if (hidden.length && !mine && phase === "answering") { note = "50:50-Joker: zwei falsche Antworten sind weg"; noteCls = "gold"; }
    body += `<div class="answers">${q.a.map((txt, i) => {
      if (hidden.includes(i)) return `<button class="ans gone" disabled><span class="ans-l">${L(i)}</span><span class="ans-txt">${esc(txt)}</span></button>`;
      // Jede Antwort behält Platz und Größe; beim Auflösen ändern sich nur Farbe und Effekt
      const cls = ["ans"];
      let a = an(K + ":a" + i, 120 + i * 60), ac = "an-ain";
      if (canPick) cls.push("pick");
      if (revealed) {
        cls.push(i === q.r ? "correct" : mine?.value === i ? "wrong" : "faded");
        ac = i === q.r ? "an-correct" : mine?.value === i ? "an-wrong" : "an-fade";
        a = an(K + ":r" + i, i === q.r ? 0 : 150);
      } else if (mine?.value === i) { cls.push("pending"); ac = "an-lock"; a = an(K + ":lock"); }
      else if (pending === i) { cls.push("pending"); ac = "an-pick"; a = an(K + ":p" + i + ":" + (s.local.pending?.t || 0)); }
      cls.push(ac);
      let mk = "";
      if (showOthers) {
        const who = players.filter(p => answers[p.uid]?.value === i);
        if (who.length) mk = `<span class="mkrs">${who.map((p, wi) => `<span class="mkr an-chk${p.uid === s.uid ? " me" : ""}"${an(K + ":mk:" + p.uid, wi * 80)}>${shortName(p.name)}${revealed && answers[p.uid]?.b ? " 🎯" : ""}</span>`).join("")}</span>`;
      }
      const letter = revealed && i === q.r ? ICON.check(18) : L(i);
      return `<button class="${cls.join(" ")}"${a} ${canPick ? `data-act="pick" data-arg="${i}"` : "disabled"}>
        <span class="ans-l">${letter}</span><span class="ans-txt">${esc(txt)}</span>${mk}</button>`;
    }).join("")}</div>`;
    if (canPick) {
      const jokerBtn = free && !isHints(room) && !jokerOf(room, s.uid) ? `<button class="btn-sq" data-act="useJoker" aria-label="50:50-Joker einsetzen" style="font-size:13px;font-weight:800;color:var(--c3)">50:50</button>` : "";
      actions = `<div class="actions-row">${jokerBtn}${hintBtn}${betBtn}<button class="btn btn-blue${urge ? " urge" : ""}" data-act="commitPick" ${pending === null ? "disabled" : ""}>Einloggen</button></div>`;
    }
  } else {
    // ── Schätzen / Freitext ──
    // Ein fester Platz: Eingabe → eigene Antwort → Lösung (dreht sich herein)
    const solVisible = (phase === "shown" || revealed) && (revealed || free) && q.answer != null;
    if (!spectator && phase === "answering" && !mine) {
      const draft = s.local.draft?.qi === qi ? s.local.draft.value : "";
      body += `<input class="ans-input an-ain"${an(K + ":in", 120)} id="in-answer" data-input="draft" ${q.type === "estimate" ? 'inputmode="decimal"' : ""} aria-label="Deine Antwort"
        placeholder="${q.type === "estimate" ? "Deine Schätzung" : "Deine Antwort"}" value="${esc(draft)}" autocomplete="off">`;
      actions = `<div class="actions-row">${hintBtn}${betBtn}<button class="btn btn-blue${urge ? " urge" : ""}" data-act="commitDraft" ${draft.trim() ? "" : "disabled"}>Einloggen</button></div>`;
    } else if (solVisible) {
      body += `<div class="solution box an-flip"${an(K + ":sol")}><span><b>Richtig:</b> ${formatValue(q, q.answer)}</span></div>`;
    } else if (mine) {
      body += `<div class="my-answer box an-lock"${an(K + ":lock")}>Deine Antwort: ${formatValue(q, mine.value)}</div>`;
    } else {
      body += `<div class="my-answer box idle an-ain"${an(K + ":in", 120)}>${spectator ? (showOthers ? "Lösung folgt …" : "Antworten werden gesammelt …") : phase === "locked" ? "Keine Antwort abgegeben" : "Lösung folgt …"}</div>`;
    }
    if (showOthers) {
      body += players.map((p, pi) => {
        const a = answers[p.uid];
        const j = revealed || (free && !estimateByDistance(room, q)) ? verdictOf(room, qi, p.uid) : null;
        const judgeBtns = canJudge(p.uid) ? `<button class="judge c${j === "correct" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="1" aria-label="${esc(p.name)} richtig">${ICON.check(20)}</button>
          <button class="judge w${j === "wrong" ? " on" : ""}" data-act="judge" data-arg="${p.uid}" data-val="0" aria-label="${esc(p.name)} falsch">${ICON.x(20)}</button>` : "";
        const mark = !judgeBtns && j ? `<span class="chip-st ${j === "correct" ? "ok" : ""}" style="${j === "wrong" ? "color:var(--c5)" : ""}">${j === "correct" ? ICON.check(18) : ICON.x(18)}</span>` : "";
        return `<div class="prow ${j || ""} an-ain"${an(K + ":row:" + p.uid, pi * 70)}><span class="prow-name">${esc(p.name)}${p.uid === s.uid ? " (du)" : ""}${revealed && a?.b ? " 🎯" : ""}</span>
          ${a ? `<span class="prow-val">${formatValue(q, a.value)}</span>` : `<span class="prow-val none">${phase === "answering" ? "denkt nach …" : "keine Antwort"}</span>`}${judgeBtns}${mark}</div>`;
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
  if (note) { /* 50:50-Hinweis hat Vorrang */ }
  else if (spectator) note = phase === "answering" || phase === "locked" ? `${done} von ${total} eingeloggt` : phase === "shown" ? "Antworten werden gezeigt" : "";
  else if (phase === "answering" && !mine && !spectator && total > 1 && done === total - 1) {
    // Letzter ohne Antwort: deutlicher Hinweis (Hinweiszeile + pulsierender Knopf)
    note = "⏳ Alle anderen sind fertig – alle warten auf dich!"; noteCls = "urgent";
  }
  else if (phase === "answering" && !mine) {
    const others = players.filter(p => p.uid !== s.uid && answers[p.uid]).map(p => esc(p.name));
    if (isHints(room)) {
      note = others.length ? `${others.join(", ")} ${others.length === 1 ? "hat" : "haben"} getippt` : "Noch niemand hat getippt";
    } else
    note = others.length ? `${others.join(", ")} ${others.length === 1 ? "hat" : "haben"} eingeloggt` : (total > 1 ? "Noch niemand eingeloggt" : "");
  } else if (phase === "locked" && !mine) note = "Zeit abgelaufen – keine Antwort";
  else if ((phase === "answering" || phase === "locked") && isHints(room)) {
    note = `Getippt bei ${hintPoints(mine?.h)} ${hintPoints(mine?.h) === 1 ? "Punkt" : "Punkten"} ✓ · ${done < total ? waitTxt : free ? "die Antworten erscheinen" : "der Moderator löst auf"}`; noteCls = "ok";
  }
  else if ((phase === "answering" || phase === "locked") && steerFree) {
    // Host: Sobald alle eingeloggt haben, erscheinen die Antworten von selbst; vorher kann er sie vorzeitig zeigen
    note = done < total ? `Eingeloggt ✓ · ${waitTxt}` : "Alle haben eingeloggt – die Antworten erscheinen"; noteCls = "ok";
    actions = done < total && !isHints(room) ? `<button class="btn btn-ghost" data-act="showAnswers">Antworten jetzt zeigen (${done}/${total})</button>` : "";
  }
  else if ((phase === "answering" || phase === "locked") && mine?.b && !steerFree) { note = `Eingeloggt mit 🎯 Einsatz · ${done < total ? waitTxt : free && !solo ? "die Antworten erscheinen" : "gleich wird aufgelöst"}`; noteCls = "ok"; }
  else if (phase === "answering" || phase === "locked") { note = done < total ? `Eingeloggt ✓ · ${waitTxt}` : free && !solo ? "Eingeloggt ✓ · die Antworten erscheinen" : "Eingeloggt ✓ · gleich wird aufgelöst"; noteCls = "ok"; }
  else if (phase === "shown" && solo && isOpenType(q)) note = "Wird automatisch bewertet …";
  else if (phase === "shown" && free && estimateByDistance(room, q)) {
    note = duel ? "Wer näher dran ist, liegt richtig …" : "Wer am nächsten dran ist, bekommt den Punkt …";
    if (steerFree) actions = `<button class="btn btn-primary" data-act="reveal">Auflösen</button>`;
  }
  else if (phase === "shown" && free && isOpenType(q)) {
    const mineToDo = players.filter(p => canJudge(p.uid) && !judgmentOf(room, qi, p.uid));
    const openJudges = [...new Set(players.filter(p => answers[p.uid] && !judgmentOf(room, qi, p.uid)).map(p => judgeOf(room, p.uid)))]
      .filter(u => u !== s.uid).map(u => esc(room.players?.[u]?.name || "?"));
    note = mineToDo.length ? `Bewerte ${mineToDo.map(p => p.uid === s.uid ? "deine eigene" : `${esc(p.name)}s`).join(" und ")} Antwort` : openJudges.length ? `Warte auf die Bewertung von ${openJudges.join(", ")} …` : steerFree ? "Alle Antworten sind bewertet" : `${hostName} löst gleich auf …`;
    noteCls = mineToDo.length ? "ok" : "";
    if (steerFree) actions = `<button class="btn btn-primary" data-act="reveal" ${unjudgedCount(room) ? "disabled" : ""}>Auflösen</button>`;
  }
  else if (phase === "shown" && steerFree) { note = "Alle sehen jetzt die Antworten"; actions = `<button class="btn btn-primary" data-act="reveal">Auflösen</button>`; }
  else if (phase === "shown" && free && !solo) note = `${hostName} löst gleich auf …`;
  else if (phase === "shown") note = q.type === "open" ? "Der Moderator bewertet die Antworten …" : q.type === "estimate" && total > 1 ? (duel ? "Wer näher dran ist, liegt richtig …" : "Wer am nächsten dran ist, bekommt den Punkt …") : "Gleich wird aufgelöst …";
  else if (revealed && free && !spectator) {
    // ohne Moderator schaltet einer weiter: der Host (fällt er aus, übernimmt automatisch der Nächste)
    const last = duel ? playOrder(room).length >= qCount(room) : qi + 1 >= qCount(room);
    const label = last ? "Zum Ergebnis" : duel ? "Zurück zum Brett" : "Nächste Frage";
    if (hostUid(room) === s.uid) actions = res ? `<button class="btn btn-primary btn-in" data-act="next">${last ? "Ergebnis" : duel ? "Zum Brett" : "Weiter"}</button>` : `<button class="btn btn-primary" data-act="next">${label}</button>`;
    else {
      const hn = esc(room.players?.[hostUid(room)]?.name || "Der Host");
      note = room.presence?.[hostUid(room)]?.online === false ? `${hn} ist gerade offline – die Steuerung geht gleich an den Nächsten` : `${hn} schaltet weiter`;
    }
  }
  else if (revealed) note = duel ? "Gleich geht es zurück zum Brett …" : "Warte auf die nächste Frage …";

  if (spectator) {
    actions = (moderatorAway(room, Date.now()) ? `<button class="btn btn-gold" data-act="takeover">Moderation übernehmen</button>` : "")
      + `<button class="btn btn-text" data-act="leave">Zuschauen beenden</button>`;
  }

  if (hintFree && !urge) {
    const w = hintWaiting(room), rq = w.filter(p => hintReqOf(room, p.uid)).length;
    note = rq ? `${rq} von ${w.length} wollen den nächsten Hinweis` : "Tippen oder 💡 nächsten Hinweis anfordern"; noteCls = rq ? "gold" : "";
  }
  if (spectator && revealed) note = duel ? (duelOutcome(room, qi, null)?.big || "Aufgelöst") : `Aufgelöst · ${standing(room, null)}`;
  // Moderator weg: Hinweis unten statt oben (sonst rutscht alles nach unten)
  if (mod && !mod.online) { note = `Moderator ${esc(mod.name)} ist offline – warte …`; noteCls = "warn"; }
  // Fußbereich mit fester Höhe: Hinweiszeile + ein Platz (Knopf ODER Ergebnis, beim Host mit Weiter-Knopf)
  const slot = res ? resultSlot(res.kind, res.big, res.sub, K + ":res", actions) : actions ? `<div class="slot-in an-up"${an(K + ":slot:" + phase + ":" + (mine ? 1 : 0))}>${actions}</div>` : "";
  return `<div class="screen">
    ${gameHeader(s, spectator ? "spec" : "player")}
    <div class="body">${body}<div class="spacer"></div></div>
    <div class="actions fixed"><div class="foot-note ${noteCls} an-note"${an(K + ":n:" + hk(note))}>${note}</div><div class="fslot${spectator ? " spec" : ""}">${slot}</div></div>
    ${fact}
  </div>`;
}
