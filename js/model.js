// Reine Funktionen: alles, was angezeigt wird, wird hieraus aus dem Raumzustand berechnet.
// Keine Firebase-Abhängigkeit, damit es sich isoliert testen lässt.

export const PHASES = ["answering", "locked", "shown", "revealed"];
export const MAX_PLAYERS = 4;

const vals = o => (o ? Object.values(o).filter(v => v != null) : []);

export function playersOf(room) {
  const pres = room?.presence || {};
  return Object.entries(room?.players || {})
    .map(([uid, p]) => ({ uid, ...p, online: !!pres[uid]?.online, lastSeen: pres[uid]?.lastSeen || null }))
    .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || (a.joinedAt || 0) - (b.joinedAt || 0));
}
export const activePlayers = room => playersOf(room).filter(p => p.role === "player");
export const spectatorsOf = room => playersOf(room).filter(p => p.role === "spectator");

// Zeitgrenzen
export const ABANDON_MS = 10 * 60 * 1000;   // alle offline → Partie gilt als abgebrochen
export const MOD_AWAY_MS = 60 * 1000;       // Moderator offline → Übernahme möglich

// Letzte bekannte Aktivität im Raum
export function lastActivity(room) {
  let t = Math.max(room?.meta?.updatedAt || 0, room?.meta?.createdAt || 0, room?.game?.phaseAt || 0);
  for (const p of Object.values(room?.presence || {})) if (p?.lastSeen) t = Math.max(t, p.lastSeen);
  return t;
}
export const anyoneOnline = room => Object.values(room?.presence || {}).some(p => p?.online);

// Laufende oder offene Partie, in der seit ABANDON_MS niemand mehr online war
export function isStale(room, now) {
  const st = room?.meta?.status;
  if (st !== "lobby" && st !== "running") return false;
  return !anyoneOnline(room) && now - lastActivity(room) > ABANDON_MS;
}

// Moderator ist eingetragen, aber länger offline
export function moderatorAway(room, now) {
  const m = moderatorOf(room);
  if (!m || m.online) return false;
  const since = m.lastSeen || lastActivity(room);
  return now - since > MOD_AWAY_MS;
}
export const moderatorOf = room => playersOf(room).find(p => p.role === "moderator") || null;
export const meIn = (room, uid) => (uid && room?.players?.[uid]) ? { uid, ...room.players[uid] } : null;

export const questionsOf = room => vals(room?.questions);
export const qCount = room => questionsOf(room).length;
export function currentQuestion(room) {
  const qi = room?.game?.qIndex ?? 0;
  return room?.questions?.[qi] || null;
}
export const isOpenType = q => q && (q.type === "estimate" || q.type === "open");

export const answersFor = (room, qi) => room?.answers?.[qi] || {};
export const answerOf = (room, qi, uid) => answersFor(room, qi)[uid] || null;
export const judgmentOf = (room, qi, uid) => room?.judgments?.[qi]?.[uid]?.v || null;

export function allAnswered(room) {
  const qi = room?.game?.qIndex ?? 0;
  const ps = activePlayers(room);
  return ps.length > 0 && ps.every(p => answersFor(room, qi)[p.uid]);
}
export function answeredCount(room) {
  const qi = room?.game?.qIndex ?? 0;
  return activePlayers(room).filter(p => answersFor(room, qi)[p.uid]).length;
}

// Richtig/falsch für eine Antwort: MC automatisch, Schätzen/Freitext über Bewertung
export function isCorrect(room, qi, uid) {
  const q = room?.questions?.[qi];
  const a = answerOf(room, qi, uid);
  if (!q || !a) return false;
  if (isOpenType(q)) return judgmentOf(room, qi, uid) === "correct";
  return a.value === q.r;
}

// Ergebnis einer Frage, wie es beim Auflösen gespeichert wird
export function computeResult(room, qi) {
  const points = {};
  let fastestUid = null, fastestMs = Infinity;
  for (const p of activePlayers(room)) {
    const ok = isCorrect(room, qi, p.uid);
    points[p.uid] = ok ? 1 : 0;
    const a = answerOf(room, qi, p.uid);
    if (ok && a && typeof a.ms === "number" && a.ms < fastestMs) { fastestMs = a.ms; fastestUid = p.uid; }
  }
  return { points, fastestUid };
}

export const resultFor = (room, qi) => room?.results?.[qi] || null;

export function scoreOf(room, uid) {
  let s = 0;
  for (const r of vals(room?.results)) s += r?.points?.[uid] || 0;
  if (room?.bonus?.uid === uid) s += 1;
  return s;
}

// 50:50-Joker: einmal pro Partie und Spieler, vom Moderator vergeben
export const jokerOf = (room, uid) => room?.jokers?.[uid] || null;
export function hiddenFor(room, qi, uid) {
  const j = jokerOf(room, uid);
  return j && j.q === qi ? vals(j.hidden) : [];
}

// Timer: verbleibende Sekunden oder null (kein Timer)
export function timerLeft(room, now) {
  const mode = room?.settings?.timerMode || "none";
  if (mode === "none") return null;
  const sec = room?.settings?.timerSec || 30;
  const t = room?.game?.timer || {};
  if (t.running && t.startAt) return Math.max(0, sec - (now - t.startAt) / 1000);
  if (t.pauseLeft != null) return Math.max(0, t.pauseLeft);
  return sec;
}

// Geschwindigkeitsführung: Ø-Antwortzeit über alle bisherigen Antworten
export function speedLead(room) {
  const list = activePlayers(room).map(p => {
    const ts = [];
    for (const a of vals(room?.answers)) if (a?.[p.uid] && typeof a[p.uid].ms === "number") ts.push(a[p.uid].ms);
    return { p, n: ts.length, avg: ts.length ? ts.reduce((x, y) => x + y, 0) / ts.length : null };
  }).filter(x => x.avg != null).sort((a, b) => a.avg - b.avg);
  if (list.length < 2) return null;
  return { leader: list[0].p, delta: list[1].avg - list[0].avg };
}

// Unbewertete Schätz-/Freitextantworten der aktuellen Frage
export function unjudgedCount(room) {
  const qi = room?.game?.qIndex ?? 0;
  const q = room?.questions?.[qi];
  if (!isOpenType(q)) return 0;
  return activePlayers(room).filter(p => answerOf(room, qi, p.uid) && !judgmentOf(room, qi, p.uid)).length;
}

// Rangliste mit Gleichständen
export function ranking(room) {
  const list = activePlayers(room).map(p => {
    const times = [];
    let correct = 0;
    questionsOf(room).forEach((_, qi) => {
      const a = answerOf(room, qi, p.uid);
      if (a && typeof a.ms === "number") times.push(a.ms);
      if (resultFor(room, qi)?.points?.[p.uid]) correct++;
    });
    const avgMs = times.length ? times.reduce((x, y) => x + y, 0) / times.length : null;
    return { ...p, score: scoreOf(room, p.uid), correct, answered: times.length, avgMs };
  });
  list.sort((a, b) => b.score - a.score || (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity));
  let rank = 0, prev = null;
  list.forEach((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; } p.rank = rank; });
  return list;
}

// Kurzfassung für Startbildschirm und roomIndex
export function summary(room) {
  const status = room?.meta?.status || "none";
  const ps = activePlayers(room);
  return {
    status,
    packName: room?.settings?.packName || null,
    playerNames: ps.map(p => p.name),
    moderator: moderatorOf(room)?.name || null,
    qIndex: room?.game?.qIndex ?? null,
    qCount: qCount(room) || null,
    phase: room?.game?.phase || null
  };
}

// Zeitformat M:SS.t (wie in v3)
export function fmtMs(ms) {
  if (ms == null || isNaN(ms)) return "–";
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
