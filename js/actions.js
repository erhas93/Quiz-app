// Alle Schreibvorgänge. Phasenwechsel laufen als Transaktion mit Prüfung von Phase und Frage,
// damit doppelte Klicks oder zwei Geräte gleichzeitig nichts kaputt machen.
import { db, ref, roomRef, roomPath, ROOM_ID, set, update, remove, runTransaction, serverNow, serverTimestamp } from "./firebase.js";
import { store, rerender } from "./store.js";
import { DBG } from "./debug.js";
import { loadPack } from "./packs.js";
import { MAX_PLAYERS, activePlayers, computeResult, qCount, summary, moderatorOf, ranking } from "./model.js";

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
  try { await update(roomRef("settings"), { packId: pack.id, packName: pack.name }); DBG.log("choosePack", pack.id); }
  catch (e) { fail("Pack nicht gespeichert", e); }
}

// ── Spielablauf (nur Moderator) ───────────────────────────────────────────
export async function startGame() {
  const room = store.room;
  const packId = room?.settings?.packId;
  if (!packId) return fail("Bitte zuerst ein Fragenpaket wählen");
  if (!activePlayers(room).length) return fail("Es ist noch kein Spieler beigetreten");
  let pack;
  try { pack = await loadPack(packId); } catch (e) { return fail("Pack konnte nicht geladen werden", e); }
  const questions = pack.questions.map(q => JSON.parse(JSON.stringify(q)));
  try {
    // 1. Fragen und Startzustand schreiben (noch in der Lobby, für andere unsichtbar)
    const now = serverNow();
    await update(roomRef(), {
      questions,
      game: { qIndex: 0, phase: "answering", phaseAt: now, questionStartAt: now, timer: freshTimer(room, now) },
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
  return transition(["shown"], qi, { phase: "revealed" }, "aufgelöst");
}

export async function nextQuestion(qi) {
  const room = store.room;
  const total = qCount(room);
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
    at: room.meta?.finishedAt || serverNow(), packId: room.settings?.packId || null, packName: room.settings?.packName || null,
    players: rk.map(p => ({ name: p.name, score: p.score, correct: p.correct, avgMs: p.avgMs ? Math.round(p.avgMs) : null })),
    moderator: moderatorOf(room)?.name || null, questions: qCount(room), bonus: room.bonus?.uid ? (room.players?.[room.bonus.uid]?.name || null) : null
  });
}

// Neue Runde mit denselben Leuten
export async function newRound() {
  const patch = {
    "meta/status": "lobby", "meta/updatedAt": serverNow(), "meta/startedAt": null, "meta/finishedAt": null,
    game: null, questions: null, answers: null, judgments: null, results: null, jokers: null, bonus: null, next: null
  };
  for (const p of activePlayers(store.room)) patch[`players/${p.uid}/ready`] = p.uid === store.room?.meta?.hostUid && store.room?.meta?.mode === "players";
  try { await update(roomRef(), patch); DBG.log("newRound"); } catch (e) { fail("Neue Runde fehlgeschlagen", e); }
}

export async function judge(qi, playerUid, correct) {
  try {
    await set(roomRef(`judgments/${qi}/${playerUid}`), { v: correct ? "correct" : "wrong", by: uid() });
    DBG.log("judge", { qi, correct });
  } catch (e) { fail("Bewertung nicht gespeichert", e); }
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

// Alte Räume aufräumen (ohne Server-Funktionen): beendete/abgebrochene nach 1 Tag, alles nach 7 Tagen
let cleaned = false;
export function cleanupRooms(rooms) {
  if (cleaned || !rooms) return;
  cleaned = true;
  const now = serverNow(), DAY = 864e5;
  const patch = {};
  for (const [id, r] of Object.entries(rooms)) {
    const age = now - (r?.updatedAt || 0);
    const done = r?.status === "finished" || r?.status === "abandoned" || r?.status === "none";
    if ((done && age > DAY) || age > 7 * DAY) { patch[`rooms/${id}`] = null; patch[`roomIndex/${id}`] = null; }
  }
  if (Object.keys(patch).length) update(ref(db), patch).then(() => DBG.log("Alte Räume aufgeräumt", Object.keys(patch).length / 2)).catch(() => {});
}
