// Kurzanleitung „So läuft's“: aus Modus, Raumart und Optionen zusammengestellt.
// Beim Spielstart als eigene Phase (alle drücken „Verstanden“), im Spiel über „?“ als Blatt von unten.
import { esc, activePlayers, moderatorOf, isFree, hostUid, isDuel, isHints, isSingle, betsOn, BET_MAX, BET_WIN, DUEL_MAX, qCount, PICK_SEC } from "../model.js";

const nameOf = (room, uid) => esc(room?.players?.[uid]?.name || "?");

// Liste der Regeln: { t: Text, k: gehört zur Kurzfassung }
export function howToItems(room) {
  const st = room?.settings || {};
  const free = isFree(room), single = isSingle(room);
  const n = activePlayers(room).length, solo = free && n === 1;
  const mod = moderatorOf(room)?.name ? esc(moderatorOf(room).name) : "Der Moderator";
  const host = nameOf(room, hostUid(room));
  const items = [];
  const add = (t, k = false, intro = false) => items.push({ t, k, intro });
  const nQ = qCount(room) || 15;   // in der Vorbereitung sind die Fragen noch nicht geladen
  const joker = () => add(free
    ? `<b>50:50-Joker:</b> einmal pro Partie bei Multiple Choice – vor dem Einloggen auf „50:50“ tippen, dann verschwinden zwei falsche Antworten.`
    : `<b>50:50-Joker:</b> einmal pro Spieler und Partie bei Multiple Choice – ${mod} setzt ihn auf Zuruf ein.`);
  const timer = () => {
    const tm = st.timerMode || "none";
    if (tm === "none") return;
    add(`<b>Antwort-Timer:</b> ${st.timerSec || 30} Sekunden pro Frage${tm === "manual" ? `, ${mod} startet ihn bei Bedarf` : ", er startet von selbst"}. Wer bis dahin nicht eingeloggt hat, geht leer aus.`, true);
  };

  if (isDuel(room)) {
    add(`<b>Startfrage:</b> Alle antworten. Wer richtig liegt, wählt zuerst${single ? " – bei mehreren entscheidet das Los." : " – bei mehreren der Schnellste, liegen alle falsch, entscheidet das Los."}`, true);
    add(`<b>Danach wählt ihr ${n > 2 ? "reihum" : "abwechselnd"}</b> ein Feld auf dem Brett: leicht 1, mittel 2, schwer 3 Punkte.`, true);
    add(`<b>Wer wählt, hat Vorrang.</b> ${n > 2 ? "Liegt er falsch, bekommen alle anderen, die richtig liegen, die Punkte." : "Liegt er falsch, bekommt der Gegner die Punkte – wenn er richtig liegt."}`, true);
    add(`Geantwortet wird immer von allen gleichzeitig. Bei Schätzfragen liegt richtig, wer am nächsten dran ist.`);
    add(`Vor dem Start markiert jeder seine Lieblingskategorien ★ – das bringt keine Punkte, zeigt aber, wo jeder stark sein will.`);
    if (st.pickTimer) add(`<b>Wahl-Timer:</b> Zum Wählen hast du ${PICK_SEC} Sekunden, sonst wird ein Feld ausgelost.`);
    joker();
    timer();
    add(`Die Punkteleiste zeigt, wie viel noch auf dem Brett liegt – und wann jemand nicht mehr einzuholen ist.`);
  } else if (isHints(room)) {
    add(`<b>Zu jeder Frage gibt es bis zu 3 Hinweise.</b> Tippen kannst du jederzeit – auch schon vor dem ersten Hinweis.`, true);
    add(`<b>Je früher richtig, desto mehr Punkte:</b> ohne Hinweis 4, nach dem 1. Hinweis 3, nach dem 2. Hinweis 2, nach dem 3. Hinweis 1. Falsch gibt 0.`, true);
    if (free) add(`<b>Neuer Hinweis:</b> Er kommt, sobald alle, die noch nicht getippt haben, auf 💡 getippt haben.`, true);
    else add(`<b>${mod} deckt die Hinweise auf.</b>`, true);
    add(`Frühere Hinweise holst du über die Reiter 1 · 2 · 3 zurück.`);
    add(`Aufgelöst wird erst, wenn alle getippt haben.`);
  } else if (solo) {
    add(`<b>${nQ} Fragen, jede richtige Antwort bringt 1 Punkt.</b> Die App wertet selbst aus.`, true);
    add(`Schätzfragen zählen innerhalb einer Toleranz (Jahreszahlen ±2, sonst etwa ±10 %). Liegt die App bei Freitext daneben, korrigierst du mit „Doch richtig“.`);
    if (betsOn(room)) add(`<b>🎯 Sicher-Einsatz (${BET_MAX}× pro Partie):</b> vor dem Einloggen setzen – richtig +${BET_WIN}, falsch −${BET_WIN} statt der normalen Punkte.`, true);
    joker();
    timer();
  } else {
    add(`<b>${nQ} Fragen, alle antworten gleichzeitig.</b> Jede richtige Antwort bringt 1 Punkt.`, true);
    add(`Bei Schätzfragen bekommt den Punkt, wer am nächsten dran ist.`);
    if (betsOn(room)) add(`<b>🎯 Sicher-Einsatz (${BET_MAX}× pro Partie):</b> Wer sich sicher ist, setzt vor dem Einloggen – richtig +${BET_WIN}, falsch −${BET_WIN} statt der normalen Punkte. Bei Schätzfragen gibt es +${BET_WIN} nur für einen Volltreffer, sonst zählt die normale Regel.`, true);
    joker();
    timer();
  }
  // Wer steuert?
  if (single) add(`<b>Nur ein Gerät:</b> ${mod} tippt eure Antworten ein – sagt sie einfach an.`, true);
  else if (free && n > 1) add(`<b>${host} steuert:</b> zeigt die Antworten, löst auf und schaltet weiter. Freitext bewertet ihr gegenseitig – jeder bekommt eine Antwort eines anderen zugeteilt.`, true);
  else if (!free) add(`<b>${mod} moderiert:</b> bewertet Freitext und schaltet weiter${isDuel(room) ? " – nach jeder Wahl gibt er die Frage frei" : ""}.`, true);
  add(`Unter jeder Frage ${single ? `kann ${mod} sie` : "kannst du sie"} bewerten: zu leicht · passt · zu schwer · Fehler · unverständlich.`);
  add(`Nach dem Auflösen leuchtet oben in der Frage „Fakten“ auf – dort steht Hintergrundwissen zur Frage.`);
  add(`Diese Anleitung findest du im Spiel jederzeit oben unter <b>?</b>.`, false, true);
  return items;
}

const MODE_NAME = room => isDuel(room) ? "Kategorie-Duell" : isHints(room) ? "Hinweis-Modus" : "Klassisch";
const comboKey = room => {
  const st = room?.settings || {};
  return ["howto", MODE_NAME(room), isFree(room) ? "free" : isSingle(room) ? "single" : "mod", betsOn(room) ? "bet" : "", st.timerMode || "none", st.pickTimer ? "pt" : ""].join(":");
};
export const seenCombo = room => { try { return !!localStorage.getItem(comboKey(room)); } catch { return false; } };
export const markCombo = room => { try { localStorage.setItem(comboKey(room), "1"); } catch {} };

function listHtml(items, compact, intro = false) {
  const list = (compact ? items.filter(i => i.k) : items).filter(i => intro || !i.intro);
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
      <div class="card howto an-up">${listHtml(howToItems(room), compact, true)}
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
