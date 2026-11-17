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

// onlineOnly: ohne Moderator wartet niemand auf Spieler, die gerade offline sind
export function allAnswered(room, onlineOnly = false) {
  const qi = room?.game?.qIndex ?? 0;
  const ps = activePlayers(room).filter(p => !onlineOnly || p.online);
  return ps.length > 0 && ps.every(p => answersFor(room, qi)[p.uid]);
}
export function answeredCount(room) {
  const qi = room?.game?.qIndex ?? 0;
  return activePlayers(room).filter(p => answersFor(room, qi)[p.uid]).length;
}

// Richtig/falsch für eine Antwort: MC automatisch, Schätzen/Freitext über Bewertung
// Schätzfragen ab 2 Spielern: wer am nächsten dran ist, bekommt den Punkt (bei Gleichstand alle Nächsten).
// Allein gilt die Toleranzregel (autoJudge), solange niemand von Hand bewertet hat.
export const estimateByDistance = (room, q) => q?.type === "estimate" && activePlayers(room).length >= 2;
export function closestUids(room, qi) {
  const q = room?.questions?.[qi];
  const target = Number(q?.answer);
  const diffs = activePlayers(room).map(p => {
    const v = answerOf(room, qi, p.uid)?.value;
    return typeof v === "number" && isFinite(target) ? { uid: p.uid, d: Math.abs(v - target) } : null;
  }).filter(Boolean);
  if (!diffs.length) return [];
  const min = Math.min(...diffs.map(x => x.d));
  return diffs.filter(x => x.d - min < 1e-9).map(x => x.uid);
}
// Urteil für die Anzeige: "correct" | "wrong" | null (noch offen)
export function verdictOf(room, qi, uid) {
  const q = room?.questions?.[qi];
  if (!answerOf(room, qi, uid)) return null;
  if (estimateByDistance(room, q)) return closestUids(room, qi).includes(uid) ? "correct" : "wrong";
  return judgmentOf(room, qi, uid);
}

export function isCorrect(room, qi, uid) {
  const q = room?.questions?.[qi];
  const a = answerOf(room, qi, uid);
  if (!q || !a) return false;
  if (estimateByDistance(room, q)) return closestUids(room, qi).includes(uid);
  if (isOpenType(q)) {
    const j = judgmentOf(room, qi, uid);
    if (!j && q.type === "estimate") return autoJudge(q, a.value);   // Einzelspiel ohne Bewertung: Toleranz
    return j === "correct";
  }
  return a.value === q.r;
}

// Ergebnis einer Frage, wie es beim Auflösen gespeichert wird
// ok: wer richtig lag; points: wer Punkte bekommt (im Duell: Wähler, sonst klaut der Gegner)
export function computeResult(room, qi) {
  const points = {}, ok = {};
  let fastestUid = null, fastestMs = Infinity;
  for (const p of activePlayers(room)) {
    const c = isCorrect(room, qi, p.uid);
    ok[p.uid] = c;
    points[p.uid] = c ? 1 : 0;
    const a = answerOf(room, qi, p.uid);
    if (c && a && typeof a.ms === "number" && a.ms < fastestMs) { fastestMs = a.ms; fastestUid = p.uid; }
  }
  if (!isDuel(room)) return { points, ok, fastestUid };
  const pts = pointsOf(room.questions?.[qi]);
  const uids = activePlayers(room).map(p => p.uid);
  for (const u of uids) points[u] = 0;
  if (isStartQ(room, qi)) {
    for (const u of uids) if (ok[u]) points[u] = pts;
    return { points, ok, fastestUid, startWinner: startWinner(points, fastestUid, uids) };
  }
  const by = pickOf(room, qi)?.by;
  const opp = uids.find(u => u !== by);
  let stolen = false;
  if (by && ok[by]) points[by] = pts;
  else if (opp && ok[opp]) { points[opp] = pts; stolen = true; }
  return { points, ok, fastestUid, by: by || null, stolen };
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
  if (!isOpenType(q) || q.type === "estimate") return 0;   // Schätzfragen werden automatisch gewertet
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
      const r = resultFor(room, qi);
      if (r && (r.ok ? r.ok[p.uid] : r.points?.[p.uid])) correct++;
    });
    const avgMs = times.length ? times.reduce((x, y) => x + y, 0) / times.length : null;
    return { ...p, score: scoreOf(room, p.uid), correct, answered: times.length, avgMs };
  });
  list.sort((a, b) => b.score - a.score || (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity));
  let rank = 0, prev = null;
  list.forEach((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; } p.rank = rank; });
  return list;
}

// ── Modus ohne Moderator ────────────────────────────────────────────────────
export const isFree = room => room?.meta?.mode === "players";
export const hostUid = room => room?.meta?.hostUid || null;
export const HOST_AWAY_MS = 15 * 1000;     // Host offline → nächster Spieler übernimmt die Steuerung

// Wer bewertet wen (Freitext/Schätzen): ringförmig, jeder bewertet seinen Vorgänger; allein bewertet man sich selbst
export function judgeOf(room, targetUid) {
  const ps = activePlayers(room);
  const i = ps.findIndex(p => p.uid === targetUid);
  if (i < 0 || !ps.length) return null;
  return ps[(i + 1) % ps.length].uid;
}
export const judgeTargetsOf = (room, uid) => activePlayers(room).filter(p => judgeOf(room, p.uid) === uid);

// "Weiter" nach dem Auflösen: alle online-Spieler müssen bestätigen
export const nextOf = (room, qi) => room?.next?.[qi] || {};
export function waitingForNext(room, qi) {
  const n = nextOf(room, qi);
  return activePlayers(room).filter(p => p.online && !n[p.uid]);
}

// Host offline? Dann übernimmt der erste online-Spieler nach Sitzreihenfolge
export function hostSuccessor(room, now) {
  const h = hostUid(room);
  const pres = room?.presence?.[h];
  const hostIsPlayer = activePlayers(room).some(p => p.uid === h);
  const away = !hostIsPlayer || (!pres?.online && now - (pres?.lastSeen || lastActivity(room)) > HOST_AWAY_MS);
  if (!away) return null;
  return activePlayers(room).find(p => p.online)?.uid || null;
}

// Kurzfassung für Startbildschirm und roomIndex
export function summary(room) {
  const status = room?.meta?.status || "none";
  const ps = activePlayers(room);
  return {
    status,
    mode: room?.meta?.mode || "moderated",
    test: room?.meta?.test ? true : null,
    packName: room?.settings?.packName || null,
    playerNames: ps.map(p => p.name),
    moderator: moderatorOf(room)?.name || null,
    qIndex: room?.game?.qIndex ?? null,
    qCount: qCount(room) || null,
    game: room?.settings?.game || "classic",
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

// ── Automatische Bewertung (Einzelspiel ohne Moderator) ────────────────────
// Schätzfragen: Jahreszahlen ±2 Jahre, sonst ±10 % (mindestens ±1); ein Pack kann mit "tol" eine eigene Toleranz setzen.
// Freitext: Groß/Klein, Akzente, Artikel und Klammerzusätze egal, kleine Tippfehler erlaubt,
// Teilantworten zählen, wenn sie den Kern (letztes Wort, z. B. Nachname) treffen; "alt" kann Alternativen auflisten.
const ARTICLES = new Set(["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "the", "a", "an"]);
export function normAnswer(s) {
  return String(s ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter((w, i, all) => w && !(i === 0 && all.length > 1 && ARTICLES.has(w))).join(" ");
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const close = (a, b) => lev(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : Math.max(a.length, b.length) >= 4 ? 1 : 0);

export function autoJudge(q, value) {
  if (!q || value == null || value === "") return false;
  if (q.type === "estimate") {
    const target = Number(q.answer), v = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!isFinite(target) || !isFinite(v)) return false;
    const isYear = Number.isInteger(target) && target >= 1000 && target <= 2100;
    const tol = typeof q.tol === "number" ? q.tol : isYear ? 2 : Math.max(1, Math.abs(target) * 0.1);
    return Math.abs(v - target) <= tol;
  }
  const user = normAnswer(value);
  if (!user) return false;
  const sols = [q.answer, ...(Array.isArray(q.alt) ? q.alt : [])].map(normAnswer).filter(Boolean);
  for (const sol of sols) {
    if (close(user, sol)) return true;
    // Teilantwort: jedes eingegebene Wort passt zu einem Wort der Lösung, und das letzte Lösungswort ist getroffen
    const ut = user.split(" "), st = sol.split(" ");
    if (st.length > 1 && ut.every(u => st.some(w => close(u, w))) && ut.some(u => close(u, st[st.length - 1]) && u.length >= 4)) return true;
  }
  return false;
}
export const isSoloFree = room => isFree(room) && activePlayers(room).length === 1;

// ── Kategorie-Duell ────────────────────────────────────────────────────────
// Brett: Kategorien in Reihenfolge des ersten Auftretens, je Kategorie die Fragen der Stufen 1–3.
// game.duel = { startQ, drawAt, picker, turn, picks: { "q<qi>": { by, turn } } }
// (Schlüssel mit Buchstaben, sonst macht Firebase aus Zahlen-Schlüsseln Arrays)
export const isDuel = room => room?.settings?.game === "duel";
export const DUEL_TURNS = 14;
export const PICK_SEC = 20;
export const DRAW_MS = 3600;   // Dauer der Auslos-Animation
export const PICKED_MS = 2500; // Pause nach dem Wählen, bevor die Frage erscheint
export const DIFF_LABEL = { 1: "leicht", 2: "mittel", 3: "schwer" };
export const pointsOf = q => (q?.diff >= 1 && q?.diff <= 3 ? q.diff : 1);

export function duelBoard(room) {
  const qs = room?.questions || [];
  const cats = [];
  const cells = {};
  qs.forEach((q, qi) => {
    if (!q) return;
    const c = q.cat || "?";
    if (!cells[c]) { cells[c] = {}; cats.push(c); }
    cells[c][q.diff || 1] = qi;
  });
  return cats.map(cat => ({ cat, cells: [1, 2, 3].map(d => cells[cat][d] ?? null) }));
}
export const duelOf = room => room?.game?.duel || {};
export const isStartQ = (room, qi) => duelOf(room).startQ != null && duelOf(room).startQ === qi;
export const pickOf = (room, qi) => duelOf(room).picks?.["q" + qi] || null;
export const isPlayed = (room, qi) => isStartQ(room, qi) || !!pickOf(room, qi);
export function playOrder(room) {
  const d = duelOf(room);
  const list = d.startQ != null ? [d.startQ] : [];
  return list.concat(Object.entries(d.picks || {}).filter(([, v]) => v).sort((a, b) => a[1].turn - b[1].turn).map(([k]) => Number(k.slice(1))));
}
export const freeCells = room => (room?.questions || []).map((_, qi) => qi).filter(qi => !isPlayed(room, qi));
export const opponentOf = (room, uid) => activePlayers(room).find(p => p.uid !== uid)?.uid || null;
// Lieblingskategorien eines Spielers (Indizes ins Brett)
export const favCatsOf = (room, uid) => Object.entries(room?.players?.[uid]?.favCats || {}).filter(([, v]) => v).map(([k]) => Number(k.slice(1)));
export const favDone = (room, uid) => !!room?.players?.[uid]?.favDone;

// Wer gewinnt die Startfrage? Beide richtig → schneller; einer richtig → der; keiner → Los
export function startWinner(points, fastestUid, players) {
  const right = players.filter(u => points[u] > 0);
  if (right.length === 1) return right[0];
  if (right.length > 1) return fastestUid && right.includes(fastestUid) ? fastestUid : right[0];
  return players[Math.floor(Math.random() * players.length)] || null;
}

// ── Lieblingsthema (alle Modi) ─────────────────────────────────────────────
// true/false oder null (nicht angegeben)
export function isFavFor(room, qi, uid) {
  const p = room?.players?.[uid];
  if (!p) return null;
  if (isDuel(room)) {
    if (!p.favDone) return null;
    const ci = duelBoard(room).findIndex(r => r.cells.includes(qi));
    return ci >= 0 && !!p.favCats?.["c" + ci];
  }
  if (p.favPack !== room?.settings?.packId || typeof p.fav !== "boolean") return null;
  return p.fav;
}

// ── Statistik ──────────────────────────────────────────────────────────────
// Feste Kennung je Frage aus dem Fragetext (FNV-1a), damit Werte auch bei geänderter Reihenfolge passen
export function questionKey(q) {
  let h = 0x811c9dc5;
  const s = String(q?.q || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return "q" + h.toString(36);
}
// Richtig im Sinne der Schwierigkeit: Schätzfragen immer mit der Toleranzregel (unabhängig vom Abstand zum Gegner)
export function statCorrect(room, qi, uid) {
  const q = room?.questions?.[qi];
  const a = answerOf(room, qi, uid);
  if (!q || !a) return false;
  if (q.type === "estimate") return autoJudge(q, a.value);
  return isCorrect(room, qi, uid);
}
