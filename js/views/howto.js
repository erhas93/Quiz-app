// Kurzanleitung „So läuft's“: aus Modus, Raumart und Optionen zusammengestellt.
// Beim Spielstart als eigene Phase (alle drücken „Verstanden“), im Spiel über „?“ als Blatt von unten.
import { esc, activePlayers, moderatorOf, isFree, hostUid, isDuel, isHints, isSingle, betsOn, BET_MAX, BET_WIN, DUEL_MAX, qCount, PICK_SEC } from "../model.js";
import { ICON } from "./common.js";

const nameOf = (room, uid) => esc(room?.players?.[uid]?.name || "?");

// Liste der Regeln: { t: Text, k: gehört zur Kurzfassung }
export function howToItems(room) {
  const st = room?.settings || {};
  const free = isFree(room), single = isSingle(room);
  const n = activePlayers(room).length;
  const mod = moderatorOf(room)?.name ? esc(moderatorOf(room).name) : "Der Moderator";
  const host = nameOf(room, hostUid(room));
  const items = [];
  const add = (t, k = false) => items.push({ t, k });

  if (isDuel(room)) {
    add(`<b>Startfrage:</b> Alle antworten. Wer richtig liegt, wählt zuerst – bei mehreren der Schnellste, sonst entscheidet das Los.`, true);
    add(`<b>Danach wählt ihr ${n > 2 ? "reihum" : "abwechselnd"}</b> ein Feld: leicht 1, mittel 2, schwer 3 Punkte.`, true);
    add(`<b>Wer wählt, hat Vorrang.</b> Liegt er falsch, bekommen ${n > 2 ? "alle anderen Richtigen" : "der Gegner, wenn er richtig liegt,"} die Punkte.`, true);
    add(`Alle antworten bei jeder Frage gleichzeitig. Bei Schätzfragen liegt richtig, wer am nächsten dran ist.`);
    if (st.pickTimer) add(`Zum Wählen hast du ${PICK_SEC} Sekunden, sonst wird ein Feld ausgelost.`);
    add(`Die Punkteleiste zeigt, wie viel noch auf dem Brett liegt – und wann jemand nicht mehr einzuholen ist.`);
  } else if (isHints(room)) {
    add(`<b>Zu jeder Frage gibt es bis zu 3 Hinweise.</b> Tippen kannst du jederzeit – auch ganz ohne Hinweis.`, true);
    add(`<b>Je früher richtig, desto mehr Punkte:</b> 4 – 3 – 2 – 1.`, true);
    if (free) add(`<b>Ohne Moderator:</b> Ein neuer Hinweis kommt, wenn alle, die noch nicht getippt haben, 💡 drücken.`, true);
    else add(`<b>${mod} deckt die Hinweise auf.</b>`, true);
    add(`Ältere Hinweise holst du über die Reiter 1 · 2 · 3 zurück.`);
    add(`Aufgelöst wird erst, wenn alle getippt haben.`);
  } else {
    add(`<b>${qCount(room)} Fragen, alle antworten gleichzeitig.</b> Jede richtige Antwort bringt 1 Punkt.`, true);
    if (n > 1) add(`Bei Schätzfragen bekommt den Punkt, wer am nächsten dran ist.`);
    if (betsOn(room)) add(`<b>🎯 Sicher-Einsatz (${BET_MAX}× pro Partie):</b> vor dem Einloggen setzen – richtig +${BET_WIN}, falsch −${BET_WIN} statt der normalen Punkte. Bei Schätzfragen gibt es +${BET_WIN} nur für einen Volltreffer.`, true);
    if (!single) add(`<b>50:50-Joker:</b> einmal pro Partie, streicht zwei falsche Antworten.`);
    if ((st.timerMode || "none") !== "none") add(`<b>Antwort-Timer:</b> ${st.timerSec || 30} Sekunden pro Frage.`, true);
  }
  // Wer steuert?
  if (single) add(`<b>Nur ein Gerät:</b> ${mod} tippt eure Antworten ein – sagt sie einfach an.`, true);
  else if (free && n > 1) add(`<b>${host} steuert:</b> zeigt die Antworten, löst auf und schaltet weiter. Freitext bewertet ihr gegenseitig.`, true);
  else if (!free) add(`<b>${mod} moderiert</b>, bewertet Freitext und schaltet weiter${isDuel(room) ? " – nach jeder Wahl gibt er die Frage frei" : ""}.`, true);
  add(`Unter jeder Frage kannst du sie bewerten: zu leicht · passt · zu schwer · Fehler · unverständlich.`);
  add(`Nach dem Auflösen gibt's oben in der Frage ${ICON.bulb(13)} Fakten zum Nachlesen.`);
  return items;
}

const MODE_NAME = room => isDuel(room) ? "Kategorie-Duell" : isHints(room) ? "Hinweis-Modus" : "Klassisch";
const comboKey = room => {
  const st = room?.settings || {};
  return ["howto", MODE_NAME(room), isFree(room) ? "free" : isSingle(room) ? "single" : "mod", betsOn(room) ? "bet" : "", st.timerMode || "none", st.pickTimer ? "pt" : ""].join(":");
};
export const seenCombo = room => { try { return !!localStorage.getItem(comboKey(room)); } catch { return false; } };
export const markCombo = room => { try { localStorage.setItem(comboKey(room), "1"); } catch {} };

function listHtml(items, compact) {
  const list = compact ? items.filter(i => i.k) : items;
  return `<ul class="howto-list">${list.map((i, k) => `<li class="an-ain" style="animation-delay:${80 + k * 60}ms">${i.t}</li>`).join("")}</ul>`;
}

// Startphase: ganzer Bildschirm, jeder bestätigt; Moderator/Host kann vorher starten
export function introView(s, me) {
  const room = s.room, g = room.game || {};
  const ps = activePlayers(room).filter(p => !p.local);
  const ok = ps.filter(p => room.players?.[p.uid]?.introOk === (g.startedAt || 0));
  const isMod = me.role === "moderator";
  const steers = isMod || (isFree(room) && hostUid(room) === s.uid && me.role === "player");
  const mineOk = room.players?.[s.uid]?.introOk === (g.startedAt || 0);
  const compact = seenCombo(room) && !s.local.howtoFull;
  const btn = me.role === "player" && !mineOk ? `<button class="btn btn-primary" data-act="ackIntro">Verstanden</button>` : "";
  const startBtn = steers ? `<button class="btn ${btn ? "btn-ghost" : "btn-primary"}" data-act="endIntro">${ok.length >= ps.length ? "Los geht's" : `Starten (${ok.length}/${ps.length})`}</button>` : "";
  const note = !ps.length ? "" : ok.length >= ps.length ? "Alle bereit – gleich geht's los" : `${ok.length} von ${ps.length} haben gelesen${mineOk ? " · du bist bereit ✓" : ""}`;
  return `<div class="screen intro">
    <div class="body">
      <div class="intro-head an-qin"><div class="intro-kicker">Gleich geht's los</div><h1 class="intro-h">So läuft's: ${MODE_NAME(room)}</h1>
        <div class="muted small">${esc(room.settings?.packName || "")}</div></div>
      <div class="card howto an-up">${listHtml(howToItems(room), compact)}
        ${compact ? `<button class="btn-text small" data-act="howtoFull">Alle Regeln anzeigen</button>` : ""}</div>
      <div class="spacer"></div>
    </div>
    <div class="actions fixed"><div class="foot-note ok">${note}</div><div class="fslot"><div class="actions-row">${startBtn}${btn}</div></div></div>
  </div>`;
}

// Im Spiel: Blatt von unten über „?“
export function howtoSheet(s) {
  const room = s.room;
  if (!room) return "";
  return `<div class="fact-bg in" data-act="howtoBg"><div class="fact-sheet" role="dialog" aria-label="So läuft's">
    <div class="sheet-grip"></div>
    <div class="fact-head"><div class="fact-h">So läuft's · ${MODE_NAME(room)}</div><button class="btn btn-ghost btn-sm" data-act="howto">Schließen</button></div>
    <div class="fact-scroll">${listHtml(howToItems(room), false)}</div>
  </div></div>`;
}
