// Alle Schreibvorgänge. Phasenwechsel laufen als Transaktion mit Prüfung von Phase und Frage,
// damit doppelte Klicks oder zwei Geräte gleichzeitig nichts kaputt machen.
import { db, ref, roomRef, roomPath, ROOM_ID, set, update, remove, runTransaction, serverNow, serverTimestamp } from "./firebase.js";
import { store, rerender } from "./store.js";
import { DBG } from "./debug.js";
import { loadPack } from "./packs.js";
import { MAX_PLAYERS, activePlayers, computeResult, qCount, summary, moderatorOf, ranking, isDuel, duelOf, pickOf, isStartQ, opponentOf, playOrder, freeCells, questionKey, statCorrect, isFavFor, answerOf } from "./model.js";

const uid = () => store.uid;

function fail(msg, e) {
  DBG.log("Fehler: " + msg, e?.message || e);
  store.local.error = msg + (e?.message ? ` (${e.message})` : "");
  rerender();
  return false;
}

function rememberName(name) {
  try { localStorage.setItem("quiz.v4.name", name); } catch {}
  store.local.name = name;
}

// ── Raum ───────────────────────────────────────────────────────────────────
// mode "moderated": man wird Moderator; mode "players": man spielt selbst mit und steuert als Host
export async function createRoom(name, mode = "moderated") {
  name = (name || "").trim() || (mode === "players" ? "Spieler 1" : "Moderator");
  rememberName(name);
  const now = serverNow();
  const me = mode === "players"
    ? { name, role: "player", seat: 1, ready: true, joinedAt: now }
    : { name, role: "moderator", seat: 0, joinedAt: now };
  try {
    const res = await runTransaction(roomRef(), cur => {
      const st = cur?.meta?.status;
      if (st === "lobby" || st === "running") return; // abbrechen: Partie existiert
      return {
        meta: { status: "lobby", mode, hostUid: uid(), createdAt: now, updatedAt: now },
        settings: { packId: null, packName: null, timerMode: "none", timerSec: 30, maxPlayers: MAX_PLAYERS },
        players: { [uid()]: me }
      };
    });
    DBG.log("createRoom", { committed: res.committed, mode });
    if (!res.committed) return fail("Es läuft bereits eine Partie");
    return true;
  } catch (e) { return fail("Raum konnte nicht angelegt werden", e); }
}

export async function joinAsPlayer(name) {
  name = (name || "").trim();
  if (!name) return fail("Bitte einen Namen eingeben");
  rememberName(name);
  if (store.room?.meta?.status !== "lobby") return fail("Mitspielen geht nur in der Lobby");
  const now = serverNow();
  try {
    const res = await runTransaction(roomRef("players"), cur => {
      cur = cur || {};
      const mine = cur[uid()];
      if (mine && mine.role === "player") { mine.name = name; return cur; }
      if (mine && mine.role === "moderator") return; // Moderator spielt nicht mit
      const list = Object.values(cur);
      if (list.filter(p => p.role === "player").length >= MAX_PLAYERS) return;
      const seat = Math.max(0, ...list.filter(p => p.role !== "spectator").map(p => p.seat || 0)) + 1;
      cur[uid()] = { name, role: "player", seat, ready: false, joinedAt: mine?.joinedAt || now };
      return cur;
    });
    DBG.log("joinAsPlayer", { committed: res.committed });
    if (!res.committed) return fail(`Die Lobby ist voll (max. ${MAX_PLAYERS} Spieler)`);
    return true;
  } catch (e) { return fail("Beitreten fehlgeschlagen", e); }
}

export async function joinAsSpectator(name) {
  name = (name || "").trim() || "Gast";
  rememberName(name);
  const st = store.room?.meta?.status;
  if (st !== "lobby" && st !== "running" && st !== "finished") return fail("Es gibt gerade nichts zum Zuschauen");
  const now = serverNow();
  try {
    const res = await runTransaction(roomRef("players"), cur => {
      cur = cur || {};
      if (cur[uid()]) return cur; // schon dabei, Rolle bleibt
      cur[uid()] = { name, role: "spectator", seat: 100, joinedAt: now };
      return cur;
    });
    DBG.log("joinAsSpectator", { committed: res.committed });
    return res.committed;
  } catch (e) { return fail("Zuschauen fehlgeschlagen", e); }
}

// takeover=true: ein länger offline gewesener Moderator wird zum Zuschauer, man selbst übernimmt
export async function joinAsModerator(name, takeover = false) {
  name = (name || "").trim() || "Moderator";
  rememberName(name);
  const now = serverNow();
  try {
    const res = await runTransaction(roomRef("players"), cur => {
      cur = cur || {};
      const mod = Object.entries(cur).find(([, p]) => p.role === "moderator");
      if (mod && mod[0] !== uid()) {
        if (!takeover) return; // es gibt schon einen
        cur[mod[0]] = { ...mod[1], role: "spectator", seat: 100 };
      }
      if (cur[uid()]?.role === "player" && store.room?.meta?.status === "running") return; // Spieler mitten in der Partie nicht umwandeln
      cur[uid()] = { ...(cur[uid()] || {}), name, role: "moderator", seat: 0, joinedAt: cur[uid()]?.joinedAt || now };
      return cur;
    });
    if (!res.committed) return fail(takeover ? "Übernahme nicht möglich" : "Es gibt bereits einen Moderator");
    await update(roomRef("meta"), { hostUid: uid(), updatedAt: serverNow() });
    DBG.log("joinAsModerator", { takeover });
    return true;
  } catch (e) { return fail("Übernehmen fehlgeschlagen", e); }
}

// Partie, in der seit langem niemand online war, als abgebrochen markieren
export async function markAbandoned() {
  try {
    const res = await runTransaction(roomRef("meta"), m => {
      if (!m || (m.status !== "lobby" && m.status !== "running")) return;
      return { ...m, status: "abandoned", abandonedAt: serverNow(), prevStatus: m.status };
    });
    DBG.log("markAbandoned", { committed: res.committed });
    if (res.committed) await update(ref(db, `roomIndex/${ROOM_ID}`), { status: "abandoned", updatedAt: serverTimestamp() });
  } catch (e) { DBG.log("markAbandoned-Fehler", e.message); }
}

export async function leaveRoom() {
  try {
    await update(roomRef(), { [`players/${uid()}`]: null, [`presence/${uid()}`]: null });
    DBG.log("leaveRoom");
  } catch (e) { fail("Verlassen fehlgeschlagen", e); }
}

export async function setName(name) {
  name = (name || "").trim();
  if (!name || !store.room?.players?.[uid()]) return;
  rememberName(name);
  try { await update(roomRef(`players/${uid()}`), { name }); } catch (e) { fail("Name nicht gespeichert", e); }
}

export async function setReady(ready) {
  try { await update(roomRef(`players/${uid()}`), { ready: !!ready }); DBG.log("setReady", ready); }
  catch (e) { fail("Bereit-Status nicht gespeichert", e); }
}

export async function choosePack(pack) {
  try { await update(roomRef("settings"), { packId: pack.id, packName: pack.name, packMode: pack.mode || null }); DBG.log("choosePack", pack.id); }
  catch (e) { fail("Pack nicht gespeichert", e); }
}

// Spielmodus: "classic" oder "duel"; ein Pack, das nicht zum Modus passt, wird abgewählt
export async function setGameMode(mode) {
  const st = store.room?.settings || {};
  const patch = { game: mode };
  const packIsDuel = st.packMode === "duel";
  if (st.packId && packIsDuel !== (mode === "duel")) Object.assign(patch, { packId: null, packName: null, packMode: null });
  try { await update(roomRef("settings"), patch); DBG.log("setGameMode", mode); } catch (e) { fail("Modus nicht gespeichert", e); }
}
export async function setPickTimer(on) {
  try { await update(roomRef("settings"), { pickTimer: !!on }); DBG.log("setPickTimer", on); } catch (e) { fail("Wähl-Timer nicht gespeichert", e); }
}

// Lieblingsthema: normales Spiel ja/nein fürs gewählte Pack; Duell: Lieblingskategorien auf dem Brett
export async function setFav(fav) {
  try { await update(roomRef(`players/${uid()}`), { fav: !!fav, favPack: store.room?.settings?.packId || null }); DBG.log("setFav", fav); }
  catch (e) { fail("Lieblingsthema nicht gespeichert", e); }
}
export async function toggleFavCat(ci) {
  const cur = !!store.room?.players?.[uid()]?.favCats?.["c" + ci];
  try { await set(roomRef(`players/${uid()}/favCats/c${ci}`), cur ? null : true); } catch (e) { fail("Auswahl nicht gespeichert", e); }
}
export async function confirmFavs(done = true) {
  try { await update(roomRef(`players/${uid()}`), { favDone: !!done }); DBG.log("confirmFavs", done); } catch (e) { fail("Bestätigung nicht gespeichert", e); }
}

// ── Spielablauf (nur Moderator) ───────────────────────────────────────────
export async function startGame() {
  const room = store.room;
  const packId = room?.settings?.packId;
  if (!packId) return fail("Bitte zuerst ein Fragenpaket wählen");
  if (!activePlayers(room).length) return fail("Es ist noch kein Spieler beigetreten");
  const duel = isDuel(room);
  if (duel && activePlayers(room).length !== 2) return fail("Das Kategorie-Duell braucht genau 2 Spieler");
  let pack;
  try { pack = await loadPack(packId); } catch (e) { return fail("Pack konnte nicht geladen werden", e); }
  if (duel !== (pack.mode === "duel")) return fail(duel ? "Bitte ein Duell-Pack wählen" : "Duell-Packs gehen nur im Kategorie-Duell");
  const questions = pack.questions.map(q => JSON.parse(JSON.stringify(q)));
  try {
    // 1. Fragen und Startzustand schreiben (noch in der Lobby, für andere unsichtbar)
    const now = serverNow();
    const game = duel
      ? { qIndex: -1, phase: "board", phaseAt: now, duel: { turn: 0 } }   // erst das Brett zeigen, Kategorien vorstellen
      : { qIndex: 0, phase: "answering", phaseAt: now, questionStartAt: now, timer: freshTimer(room, now) };
    const reset = {};
    for (const p of activePlayers(room)) Object.assign(reset, { [`players/${p.uid}/favCats`]: null, [`players/${p.uid}/favDone`]: null, [`players/${p.uid}/pick`]: null });
    await update(roomRef(), {
      ...reset,
      questions,
      game, feedback: null,
      answers: null, judgments: null, results: null, jokers: null, bonus: null, next: null,
      "settings/packName": pack.name
    });
    // 2. Lobby → läuft, nur wenn noch Lobby
    const res = await runTransaction(roomRef("meta"), m => {
      if (!m || m.status !== "lobby") return;
      return { ...m, status: "running", startedAt: now, updatedAt: now };
    });
    DBG.log("startGame", { committed: res.committed, fragen: questions.length });
    return res.committed;
  } catch (e) { return fail("Start fehlgeschlagen", e); }
}

// Timer zu Beginn einer Frage: bei "auto" läuft er sofort, sonst steht er
function freshTimer(room, now) {
  return room?.settings?.timerMode === "auto" ? { running: true, startAt: now } : { running: false };
}

async function transition(fromPhases, expectedQ, patch, label) {
  try {
    const res = await runTransaction(roomRef("game"), g => {
      if (!g || g.qIndex !== expectedQ || !fromPhases.includes(g.phase)) return;
      return { ...g, ...patch, phaseAt: serverNow() };
    });
    DBG.log(`Phase: ${label}`, { committed: res.committed, q: expectedQ });
    return res.committed;
  } catch (e) { return fail(`Phasenwechsel (${label}) fehlgeschlagen`, e); }
}

const STOPPED = { running: false, pauseLeft: 0 };
export const lockAnswers = qi => transition(["answering"], qi, { phase: "locked", timer: STOPPED }, "gesperrt");
export const showAnswers = qi => transition(["answering", "locked"], qi, { phase: "shown", timer: STOPPED }, "gezeigt");
export const timerExpired = qi => transition(["answering"], qi, { phase: "locked", timer: STOPPED }, "Zeit abgelaufen");

export async function reveal(qi) {
  const room = store.room;
  if (room?.game?.phase !== "shown" || room.game.qIndex !== qi) return false;
  try {
    // Ergebnis zuerst schreiben (idempotent), dann Phase wechseln
    await set(roomRef(`results/${qi}`), { ...computeResult(room, qi), revealedAt: serverNow() });
  } catch (e) { return fail("Ergebnis nicht gespeichert", e); }
  const ok = await transition(["shown"], qi, { phase: "revealed" }, "aufgelöst");
  if (ok) recordStats(room, qi);
  return ok;
}

// ── Statistik pro Frage (für die Einstufung neuer Packs) ───────────────────
// questionStats/{packId}/{key}: n, right, ms, msN, noAns, fav/favRight, nofav/nofavRight, fb{...}
function statRef(room, qi) {
  const q = room?.questions?.[qi], pack = room?.settings?.packId;
  return q && pack ? ref(db, `questionStats/${pack}/${questionKey(q)}`) : null;
}
async function recordStats(room, qi) {
  const r = statRef(room, qi);
  if (!r) return;
  const q = room.questions[qi];
  const rows = activePlayers(room).map(p => {
    const a = answerOf(room, qi, p.uid);
    return { a, ok: statCorrect(room, qi, p.uid), fav: isFavFor(room, qi, p.uid) };
  });
  try {
    await runTransaction(r, cur => {
      const c = cur || { q: String(q.q).slice(0, 90), type: q.type || "mc", cat: q.cat || null, diff: q.diff || null };
      for (const x of rows) {
        c.n = (c.n || 0) + 1;
        if (x.ok) c.right = (c.right || 0) + 1;
        if (!x.a) c.noAns = (c.noAns || 0) + 1;
        if (x.a && typeof x.a.ms === "number") { c.ms = (c.ms || 0) + x.a.ms; c.msN = (c.msN || 0) + 1; }
        if (x.fav === true) { c.fav = (c.fav || 0) + 1; if (x.ok) c.favRight = (c.favRight || 0) + 1; }
        if (x.fav === false) { c.nofav = (c.nofav || 0) + 1; if (x.ok) c.nofavRight = (c.nofavRight || 0) + 1; }
      }
      c.mode = room.settings?.game || "classic";
      c.last = serverNow();
      return c;
    });
    DBG.log("Statistik", { qi, n: rows.length });
  } catch (e) { DBG.log("Statistik-Fehler", e.message); }
}

// Feedback des Moderators: zu leicht / passt / zu schwer / fehlerhaft (umentscheiden möglich)
export async function giveFeedback(kind) {
  const room = store.room, qi = room?.game?.qIndex;
  const r = statRef(room, qi);
  if (!r) return;
  const prev = room.feedback?.[qi] || null;
  const next = prev === kind ? null : kind;
  try {
    await set(roomRef(`feedback/${qi}`), next);
    await runTransaction(r, cur => {
      const c = cur || {};
      c.fb = c.fb || {};
      if (prev) c.fb[prev] = Math.max(0, (c.fb[prev] || 0) - 1);
      if (next) c.fb[next] = (c.fb[next] || 0) + 1;
      return c;
    });
    DBG.log("Feedback", { qi, kind: next });
  } catch (e) { fail("Feedback nicht gespeichert", e); }
}

export async function nextQuestion(qi) {
  const room = store.room;
  const total = qCount(room);
  if (isDuel(room)) {
    if (playOrder(room).length >= total) return finishGame(qi);
    const r = room.results?.[qi];
    const picker = isStartQ(room, qi) ? r?.startWinner : opponentOf(room, pickOf(room, qi)?.by);
    if (!picker) return fail("Unklar, wer als Nächstes wählt");
    try {
      const res = await runTransaction(roomRef("game"), g => {
        if (!g || g.qIndex !== qi || g.phase !== "revealed") return;
        return { ...g, phase: "board", phaseAt: serverNow(), timer: null, duel: { ...(g.duel || {}), picker } };
      });
      DBG.log("Phase: zurück zum Brett", { committed: res.committed, picker });
      return res.committed;
    } catch (e) { return fail("Zurück zum Brett fehlgeschlagen", e); }
  }
  if (qi + 1 >= total) return finishGame(qi);
  const now = serverNow();
  return transition(["revealed"], qi, { phase: "answering", qIndex: qi + 1, questionStartAt: now, timer: freshTimer(room, now) }, "nächste Frage");
}

async function finishGame(qi) {
  const ok = await transition(["revealed"], qi, { phase: "finished" }, "beendet");
  if (!ok) return false;
  const room = store.room;
  try {
    await update(roomRef("meta"), { status: "finished", finishedAt: serverNow(), updatedAt: serverNow() });
    await writeHistory(store.room);
  } catch (e) { fail("Abschluss nicht vollständig gespeichert", e); }
  return true;
}

// Kurzfassung für die Statistik (wird bei Bonus-Änderung neu geschrieben)
async function writeHistory(room) {
  const rk = ranking(room);
  const gameId = `${ROOM_ID}_${room.meta?.createdAt || 0}_${room.meta?.startedAt || 0}`;
  await set(ref(db, `history/${gameId}`), {
    at: room.meta?.finishedAt || serverNow(), packId: room.settings?.packId || null, packName: room.settings?.packName || null, game: room.settings?.game || "classic",
    players: rk.map(p => ({ name: p.name, score: p.score, correct: p.correct, avgMs: p.avgMs ? Math.round(p.avgMs) : null })),
    moderator: moderatorOf(room)?.name || null, questions: qCount(room), bonus: room.bonus?.uid ? (room.players?.[room.bonus.uid]?.name || null) : null
  });
}

// Neue Runde mit denselben Leuten
export async function newRound() {
  const patch = {
    "meta/status": "lobby", "meta/updatedAt": serverNow(), "meta/startedAt": null, "meta/finishedAt": null,
    game: null, questions: null, answers: null, judgments: null, results: null, jokers: null, bonus: null, next: null, feedback: null
  };
  for (const p of activePlayers(store.room)) Object.assign(patch, {
    [`players/${p.uid}/ready`]: p.uid === store.room?.meta?.hostUid && store.room?.meta?.mode === "players",
    [`players/${p.uid}/favCats`]: null, [`players/${p.uid}/favDone`]: null, [`players/${p.uid}/pick`]: null
  });
  try { await update(roomRef(), patch); DBG.log("newRound"); } catch (e) { fail("Neue Runde fehlgeschlagen", e); }
}

export async function judge(qi, playerUid, correct) {
  try {
    await set(roomRef(`judgments/${qi}/${playerUid}`), { v: correct ? "correct" : "wrong", by: uid() });
    DBG.log("judge", { qi, correct });
  } catch (e) { fail("Bewertung nicht gespeichert", e); }
}

// ── Kategorie-Duell ────────────────────────────────────────────────────────
// Startfrage auslosen: Feld wird sofort festgelegt, alle Geräte spielen dieselbe Animation bis drawAt + DRAW_MS
export async function duelDraw() {
  const room = store.room;
  const cells = freeCells(room);
  if (!cells.length) return false;
  const cell = cells[Math.floor(Math.random() * cells.length)];
  try {
    const res = await runTransaction(roomRef("game"), g => {
      if (!g || g.phase !== "board" || g.duel?.startQ != null) return;
      return { ...g, phase: "drawing", phaseAt: serverNow(), duel: { ...(g.duel || {}), startQ: cell, drawAt: serverNow() } };
    });
    DBG.log("Startfrage ausgelost", { committed: res.committed, cell });
    return res.committed;
  } catch (e) { return fail("Auslosen fehlgeschlagen", e); }
}
export async function duelDrawDone() {
  const room = store.room;
  try {
    const res = await runTransaction(roomRef("game"), g => {
      if (!g || g.phase !== "drawing" || g.duel?.startQ == null) return;
      const now = serverNow();
      return { ...g, phase: "answering", qIndex: g.duel.startQ, phaseAt: now, questionStartAt: now, timer: freshTimer(room, now) };
    });
    DBG.log("Startfrage beginnt", { committed: res.committed });
  } catch (e) { fail("Start der Frage fehlgeschlagen", e); }
}
// Feld wählen (Moderator bzw. Host schreibt den Spielzustand); by = Wähler
export async function pickCell(cell, by) {
  const room = store.room;
  try {
    const res = await runTransaction(roomRef("game"), g => {
      const d = g?.duel;
      if (!g || g.phase !== "board" || d?.startQ == null || d.picker !== by) return;
      if (cell === d.startQ || d.picks?.["q" + cell] || !room.questions?.[cell]) return;
      const now = serverNow(), turn = (d.turn || 0) + 1;
      return { ...g, phase: "answering", qIndex: cell, phaseAt: now, questionStartAt: now, timer: freshTimer(room, now),
        duel: { ...d, turn, picks: { ...(d.picks || {}), ["q" + cell]: { by, turn } } } };
    });
    DBG.log("Feld gewählt", { committed: res.committed, cell });
    return res.committed;
  } catch (e) { return fail("Wählen fehlgeschlagen", e); }
}
// Spieler ohne Schreibrecht auf den Spielzustand: Wunsch ablegen, Moderator/Host übernimmt ihn
export async function requestPick(cell) {
  const turn = duelOf(store.room).turn || 0;
  try { await set(roomRef(`players/${uid()}/pick`), { turn, cell }); DBG.log("requestPick", { turn, cell }); }
  catch (e) { fail("Wahl nicht gespeichert", e); }
}

// ── Pack-Vorlieben (für alle Partien gleich) ───────────────────────────────
export async function setPackPref(packId, key, value) {
  try { await set(ref(db, `packPrefs/${packId}/${key}`), value ? true : null); DBG.log("packPref", { packId, key, value }); }
  catch (e) { fail("Einstellung nicht gespeichert", e); }
}

// ── Timer, Joker, Bonus (Moderator) ────────────────────────────────────────
export async function setTimer(mode, sec) {
  const patch = {};
  if (mode) patch.timerMode = mode;
  if (sec) patch.timerSec = Math.min(300, Math.max(5, Math.round(sec)));
  try { await update(roomRef("settings"), patch); DBG.log("setTimer", patch); } catch (e) { fail("Timer nicht gespeichert", e); }
}

async function timerTx(fn, label) {
  try {
    const res = await runTransaction(roomRef("game"), g => {
      if (!g || g.phase !== "answering") return;
      const t = fn(g.timer || {}, store.room?.settings?.timerSec || 30, serverNow());
      if (!t) return;
      return { ...g, timer: t };
    });
    DBG.log(`Timer: ${label}`, { committed: res.committed });
  } catch (e) { fail("Timer-Aktion fehlgeschlagen", e); }
}
export const timerStart = () => timerTx((t, sec, now) => t.running ? null
  : { running: true, startAt: t.pauseLeft != null ? now - (sec - t.pauseLeft) * 1000 : now }, "Start");
export const timerPause = () => timerTx((t, sec, now) => !t.running ? null
  : { running: false, pauseLeft: Math.max(0, sec - (now - t.startAt) / 1000) }, "Pause");
export const timerReset = () => timerTx(() => ({ running: false }), "Reset");

// Ohne Moderator setzt jeder seinen 50:50-Joker selbst ein
export const useJoker = () => grantJoker(uid());

export async function grantJoker(playerUid) {
  const room = store.room;
  const g = room?.game;
  const q = room?.questions?.[g?.qIndex];
  if (!g || g.phase !== "answering" || !q || q.type === "estimate" || q.type === "open") return fail("Joker nur bei offener Multiple-Choice-Frage");
  if (room.answers?.[g.qIndex]?.[playerUid]) return fail("Der Spieler hat schon eingeloggt");
  const wrongs = q.a.map((_, i) => i).filter(i => i !== q.r);
  for (let i = wrongs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [wrongs[i], wrongs[j]] = [wrongs[j], wrongs[i]]; }
  try {
    const res = await runTransaction(roomRef(`jokers/${playerUid}`), cur => cur ? undefined : { q: g.qIndex, hidden: wrongs.slice(0, 2).sort() });
    DBG.log("grantJoker", { committed: res.committed });
    if (!res.committed) fail("Joker wurde schon verbraucht");
  } catch (e) { fail("Joker nicht vergeben", e); }
}

export async function setBonus(playerUid) {
  try {
    await set(roomRef("bonus"), playerUid ? { uid: playerUid } : null);
    DBG.log("setBonus", playerUid);
    // Store ist nach set() lokal aktualisiert → Statistik mit Bonus neu schreiben
    setTimeout(() => writeHistory(store.room).catch(() => {}), 300);
  } catch (e) { fail("Bonus nicht gespeichert", e); }
}

// ── Antworten (Spieler) ────────────────────────────────────────────────────
export async function submitAnswer(qi, value) {
  const g = store.room?.game;
  if (!g || g.phase !== "answering" || g.qIndex !== qi) return fail("Die Frage ist nicht mehr offen");
  const now = serverNow();
  const ms = Math.max(0, Math.round(now - (g.questionStartAt || now)));
  try {
    const res = await runTransaction(roomRef(`answers/${qi}/${uid()}`), cur => {
      if (cur) return; // bereits eingeloggt
      return { value, at: now, ms };
    });
    DBG.log("submitAnswer", { qi, committed: res.committed, ms });
    return res.committed;
  } catch (e) { return fail("Antwort nicht gespeichert", e); }
}

// ── Ohne Moderator ─────────────────────────────────────────────────────────
// Einzelspiel: automatische Bewertung (by "auto"), nach dem Auflösen von Hand korrigierbar
export async function autoJudgeAnswer(qi, playerUid, correct) {
  try { await set(roomRef(`judgments/${qi}/${playerUid}`), { v: correct ? "correct" : "wrong", by: "auto" }); DBG.log("autoJudge", { qi, correct }); }
  catch (e) { fail("Bewertung nicht gespeichert", e); }
}
export async function overrideJudgment(qi, playerUid, correct) {
  const room = JSON.parse(JSON.stringify(store.room || {}));
  room.judgments = room.judgments || {};
  room.judgments[qi] = { ...(room.judgments[qi] || {}), [playerUid]: { v: correct ? "correct" : "wrong", by: uid() } };
  const res = computeResult(room, qi);
  try {
    await update(roomRef(), { [`judgments/${qi}/${playerUid}`]: room.judgments[qi][playerUid], [`results/${qi}/points`]: res.points, [`results/${qi}/ok`]: res.ok, [`results/${qi}/fastestUid`]: res.fastestUid });
    DBG.log("overrideJudgment", { qi, correct });
  } catch (e) { fail("Korrektur nicht gespeichert", e); }
}

// Nach dem Auflösen bestätigt jeder Spieler "Weiter"; der Host schaltet, wenn alle online-Spieler bereit sind
export async function markNext(qi) {
  try { await set(roomRef(`next/${qi}/${uid()}`), true); DBG.log("markNext", qi); }
  catch (e) { fail("Weiter nicht gespeichert", e); }
}

// Host-Übergabe, wenn der bisherige Host länger offline ist (nur wenn er noch Host ist)
export async function claimHost(oldHost) {
  try {
    const res = await runTransaction(roomRef("meta"), m => {
      if (!m || m.hostUid !== oldHost) return;
      return { ...m, hostUid: uid(), updatedAt: serverNow() };
    });
    DBG.log("claimHost", { committed: res.committed });
  } catch (e) { DBG.log("claimHost-Fehler", e.message); }
}

// ── Verwaltung ─────────────────────────────────────────────────────────────
export async function resetRoom() {
  try { await remove(roomRef()); await remove(ref(db, `roomIndex/${ROOM_ID}`)); DBG.log("resetRoom"); }
  catch (e) { fail("Zurücksetzen fehlgeschlagen", e); }
}

// Kleine Übersicht für die Raumliste, vom Moderator bzw. Host gepflegt
let lastIndex = "";
export function syncIndex(room) {
  if (!ROOM_ID || !room?.meta) return;
  const s = summary(room);
  const key = JSON.stringify(s);
  if (key === lastIndex) return;
  lastIndex = key;
  set(ref(db, `roomIndex/${ROOM_ID}`), { ...s, updatedAt: serverTimestamp() }).catch(() => {});
}

// Alte Räume aufräumen (ohne Server-Funktionen): beendete/abgebrochene nach 1 Tag löschen.
// Offene Räume ohne Aktivität seit 7 Tagen erst als abgebrochen markieren (das dürfen laut Regeln alle),
// gelöscht werden sie dann beim nächsten Aufräumen. Jeder Raum einzeln, damit ein verweigerter Schritt nicht alles blockiert.
let cleaned = false;
export function cleanupRooms(rooms) {
  if (cleaned || !rooms) return;
  cleaned = true;
  const now = serverNow(), DAY = 864e5;
  for (const [id, r] of Object.entries(rooms)) {
    const age = now - (r?.updatedAt || 0);
    const done = r?.status === "finished" || r?.status === "abandoned" || r?.status === "none";
    if (done && age > DAY) {
      remove(ref(db, `rooms/${id}`)).then(() => remove(ref(db, `roomIndex/${id}`)))
        .then(() => DBG.log("Alter Raum gelöscht", id)).catch(e => DBG.log("Aufräumen verweigert", { id, e: e.message }));
    } else if (!done && age > 7 * DAY) {
      update(ref(db, `rooms/${id}/meta`), { status: "abandoned", abandonedAt: now })
        .then(() => update(ref(db, `roomIndex/${id}`), { status: "abandoned", updatedAt: now })).catch(() => {});
    }
  }
}
