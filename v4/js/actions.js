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
export async function createRoom(name) {
  name = (name || "").trim() || "Moderator";
  rememberName(name);
  const now = serverNow();
  try {
    const res = await runTransaction(roomRef(), cur => {
      const st = cur?.meta?.status;
      if (st === "lobby" || st === "running") return; // abbrechen: Partie existiert
      return {
        meta: { status: "lobby", mode: "moderated", hostUid: uid(), createdAt: now, updatedAt: now },
        settings: { packId: null, packName: null, timerMode: "none", timerSec: 30, maxPlayers: MAX_PLAYERS },
        players: { [uid()]: { name, role: "moderator", seat: 0, joinedAt: now } }
      };
    });
    DBG.log("createRoom", { committed: res.committed });
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
      game: { qIndex: 0, phase: "answering", phaseAt: now, questionStartAt: now },
      answers: null, judgments: null, results: null,
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

export const lockAnswers = qi => transition(["answering"], qi, { phase: "locked" }, "gesperrt");
export const showAnswers = qi => transition(["answering", "locked"], qi, { phase: "shown" }, "gezeigt");

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
  return transition(["revealed"], qi, { phase: "answering", qIndex: qi + 1, questionStartAt: now }, "nächste Frage");
}

async function finishGame(qi) {
  const ok = await transition(["revealed"], qi, { phase: "finished" }, "beendet");
  if (!ok) return false;
  const room = store.room;
  try {
    await update(roomRef("meta"), { status: "finished", finishedAt: serverNow(), updatedAt: serverNow() });
    // Kurzfassung für die Statistik
    const rk = ranking(room);
    const gameId = `${ROOM_ID}_${room.meta?.createdAt || Date.now()}`;
    await set(ref(db, `history/${gameId}`), {
      at: serverNow(), packId: room.settings?.packId || null, packName: room.settings?.packName || null,
      players: rk.map(p => ({ name: p.name, score: p.score, correct: p.correct, avgMs: p.avgMs ? Math.round(p.avgMs) : null })),
      moderator: moderatorOf(room)?.name || null, questions: qCount(room)
    });
  } catch (e) { fail("Abschluss nicht vollständig gespeichert", e); }
  return true;
}

// Neue Runde mit denselben Leuten
export async function newRound() {
  const patch = {
    "meta/status": "lobby", "meta/updatedAt": serverNow(), "meta/startedAt": null, "meta/finishedAt": null,
    game: null, questions: null, answers: null, judgments: null, results: null
  };
  for (const p of activePlayers(store.room)) patch[`players/${p.uid}/ready`] = false;
  try { await update(roomRef(), patch); DBG.log("newRound"); } catch (e) { fail("Neue Runde fehlgeschlagen", e); }
}

export async function judge(qi, playerUid, correct) {
  try {
    await set(roomRef(`judgments/${qi}/${playerUid}`), { v: correct ? "correct" : "wrong", by: uid() });
    DBG.log("judge", { qi, correct });
  } catch (e) { fail("Bewertung nicht gespeichert", e); }
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

// ── Verwaltung ─────────────────────────────────────────────────────────────
export async function resetRoom() {
  try { await remove(roomRef()); await remove(ref(db, `roomIndex/${ROOM_ID}`)); DBG.log("resetRoom"); }
  catch (e) { fail("Zurücksetzen fehlgeschlagen", e); }
}

// Kleine Übersicht für den Startbildschirm, vom Moderator gepflegt
let lastIndex = "";
export function syncIndex(room) {
  const s = summary(room);
  const key = JSON.stringify(s);
  if (key === lastIndex) return;
  lastIndex = key;
  set(ref(db, `roomIndex/${ROOM_ID}`), { ...s, updatedAt: serverTimestamp() }).catch(() => {});
}
