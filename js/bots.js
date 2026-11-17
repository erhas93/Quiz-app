// Testmodus: simulierte Mitspieler (Bots). Jeder Bot hat eine eigene Firebase-Anmeldung und nutzt dieselben
// Aktionen wie ein echtes Gerät. Die Bots laufen nur im Browser des Besitzers des Testraums.
import { createBotIdentity, ref, roomPath, set, onValue, onDisconnect, serverTimestamp, serverNow, ROOM_ID } from "./firebase.js";
import { store } from "./store.js";
import { createActions } from "./actions.js";
import * as A from "./actions.js";
import { DBG } from "./debug.js";
import { activePlayers, answerOf, judgmentOf, judgeTargetsOf, nextOf, allAnswered, unjudgedCount, timerLeft, autoJudge,
  isFree, isDuel, duelOf, freeCells, duelBoard, favDone, PICK_SEC, DRAW_MS, PICKED_MS } from "./model.js";

const BOT_NAMES = ["Bot Alex", "Bot Kim", "Bot Sam"];
const ACC = { low: 0.4, mid: 0.65, high: 0.85 };
const SPEED = { fast: 0.35, normal: 1 };

export const testOf = room => room?.meta?.test || null;
export const isTestOwner = (room, uid) => !!uid && testOf(room)?.owner === uid;
// Szenario „Ich spiele“: der Besitzer stellt in der Lobby für den Bot-Moderator ein
export const ownerSteersBotMod = (room, uid) => testOf(room)?.scenario === "botmod" && isTestOwner(room, uid);

const bots = new Map();   // key → Bot
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

function getBot(key, name, role) {
  if (bots.has(key)) return bots.get(key);
  const b = { key, name, role, uid: null, A: null, once: new Set(), busy: new Set(), presKey: null };
  bots.set(key, b);
  createBotIdentity(key).then(id => {
    b.uid = id.uid; b.db = id.db;
    // Wichtig: Der Bot muss den Raum über seine eigene Verbindung beobachten. Sonst kennt sein lokaler
    // Zwischenspeicher den Raum nicht, Transaktionen starten mit „leer“ und brechen ab (Start, Phasenwechsel …).
    if (ROOM_ID) onValue(ref(id.db, roomPath()), () => { if (!b.synced) { b.synced = true; tick(); } });
    b.A = createActions({
      uid: () => b.uid,
      room: () => store.room,
      roomId: ROOM_ID,
      roomRef: p => ref(id.db, roomPath(p)),
      ref: p => ref(id.db, p),
      fail: (m, e) => { DBG.log(`${name}: ${m}`, e?.message || e); return false; }
    });
    tick();
  }).catch(e => { DBG.log("Bot-Anmeldung fehlgeschlagen", e.message); store.local.error = "Bots konnten sich nicht anmelden: " + e.message; bots.delete(key); });
  return b;
}
const ready = key => bots.get(key)?.A ? bots.get(key) : null;

// Aktionen für die Lobby-Steuerung im Szenario „Ich spiele“ (laufen über den Bot-Moderator)
export function botModActions() {
  const b = ready("mod");
  return ownerSteersBotMod(store.room, store.uid) && b?.synced ? b.A : null;
}

// Einmal pro Schlüssel, optional verzögert
function once(b, key, ms, fn) {
  if (b.once.has(key)) return;
  b.once.add(key);
  setTimeout(() => { Promise.resolve().then(fn).catch(e => DBG.log(`${b.name}: Fehler`, e.message)); }, Math.max(0, ms));
}
// Wiederholbar, aber nie zweimal gleichzeitig (z. B. „bereit“ nach jeder neuen Runde)
function busy(b, key, ms, fn) {
  if (b.busy.has(key)) return;
  b.busy.add(key);
  setTimeout(async () => { try { await fn(); } catch (e) { DBG.log(`${b.name}: Fehler`, e.message); } setTimeout(() => b.busy.delete(key), 1500); }, Math.max(0, ms));
}

// ── Testraum anlegen ───────────────────────────────────────────────────────
export async function createTestRoom(cfg, name) {
  const test = { owner: store.uid, scenario: cfg.scenario, bots: cfg.bots, acc: cfg.acc, speed: cfg.speed };
  if (cfg.scenario === "mod") return A.createRoom(name, "moderated", { test });
  if (cfg.scenario === "free") return A.createRoom(name, "players", { test });
  const m = getBot("mod", "Bot-Moderator", "moderator");
  for (let i = 0; i < 60 && !(m.A && m.synced); i++) await new Promise(r => setTimeout(r, 150));
  if (!m.A || !m.synced) return false;
  return m.A.createRoom("Bot-Moderator", "moderated", { test });
}

// ── Takt: nach jedem Render und alle 400 ms ─────────────────────────────────
export function tick() {
  const room = store.room, t = testOf(room);
  if (!ROOM_ID || !t || !isTestOwner(room, store.uid)) return;
  const st = room.meta?.status;
  if (st !== "lobby" && st !== "running") return;
  const want = [];
  if (t.scenario === "botmod") want.push(["mod", "Bot-Moderator", "moderator"]);
  for (let i = 0; i < Math.min(3, t.bots || 1); i++) want.push([`p${i + 1}`, BOT_NAMES[i], "player"]);
  for (const [k, n, r] of want) {
    const b = getBot(k, n, r);
    if (!b.A || !b.synced) continue;
    presence(b, room);
    try { r === "moderator" ? stepMod(b, room, t) : stepPlayer(b, room, t, want.findIndex(w => w[0] === k)); }
    catch (e) { DBG.log(`${n}: Fehler im Ablauf`, e.message); }
  }
  // „Ich spiele“: Besitzer tritt dem vom Bot angelegten Raum bei
  if (t.scenario === "botmod" && st === "lobby" && !joining) {
    const me = room.players?.[store.uid];
    if (!me || (me.role === "player" && !me.ready)) {
      joining = true;
      (me ? A.setReady(true) : A.joinAsPlayer(store.local.name || "Ich").then(() => A.setReady(true)))
        .finally(() => setTimeout(() => { joining = false; }, 2000));
    }
  }
}
let joining = false;
let timer = null;
export function startBotClock() { if (!timer) timer = setInterval(tick, 400); }

function presence(b, room) {
  if (!room.players?.[b.uid] || b.presBusy) return;
  const key = `${room.meta?.createdAt}`;
  if (b.presKey === key && room.presence?.[b.uid]?.online) return;
  b.presKey = key; b.presBusy = true;
  const r = ref(b.db, roomPath(`presence/${b.uid}`));
  onDisconnect(r).set({ online: false, lastSeen: serverTimestamp() })
    .then(() => set(r, { online: true, lastSeen: serverTimestamp() }))
    .catch(e => DBG.log(`${b.name}: Präsenz-Fehler`, e.message))
    .finally(() => { b.presBusy = false; });
}

// ── Bot als Spieler ────────────────────────────────────────────────────────
function stepPlayer(b, room, t, idx) {
  const me = room.players?.[b.uid];
  const st = room.meta.status;
  const sp = SPEED[t.speed] || 1;
  const base = `${room.meta.createdAt}:${room.meta.startedAt || 0}`;
  if (st === "lobby") {
    if (!me) return busy(b, "join", 500 + idx * 450, () => b.A.joinAsPlayer(b.name));
    if (me.role !== "player") return;
    if (!me.ready) busy(b, "ready", rnd(400, 1200) * sp + 300, () => b.A.setReady(true));
    const packId = room.settings?.packId;
    if (packId && !isDuel(room) && me.favPack !== packId) busy(b, "fav", rnd(500, 1500), () => b.A.setFav(Math.random() < 0.3));
    return;
  }
  if (!me || me.role !== "player") return;
  const g = room.game || {};
  const qi = g.qIndex;
  const q = room.questions?.[qi];
  const d = duelOf(room);

  // Duell: Lieblingskategorien, dann Felder wählen
  if (isDuel(room) && g.phase === "board" && d.startQ == null && !favDone(room, b.uid)) {
    return once(b, `favs:${base}`, rnd(1200, 3000) * sp, async () => {
      const n = duelBoard(room).length;
      const k = Math.floor(Math.random() * 3);
      const cats = [...Array(n).keys()].sort(() => Math.random() - 0.5).slice(0, k);
      for (const c of cats) await b.A.toggleFavCat(c);
      await b.A.confirmFavs(true);
    });
  }
  if (isDuel(room) && g.phase === "board" && d.startQ != null && d.picker === b.uid) {
    const req = me.pick;
    if (!req || req.turn !== (d.turn || 0))
      once(b, `pick:${base}:${d.turn || 0}`, rnd(1500, 3500) * sp, () => {
        const cells = freeCells(store.room);
        if (cells.length) return b.A.requestPick(pick(cells));
      });
    return;
  }
  if (g.phase === "answering" && q && !answerOf(room, qi, b.uid)) {
    let ms = rnd(2000, 9000) * sp;
    const left = timerLeft(room, serverNow());
    if (left != null) ms = Math.min(ms, Math.max(500, left * 1000 * 0.8));
    return once(b, `ans:${base}:${qi}`, ms, () => b.A.submitAnswer(qi, botAnswer(q, t)));
  }
  // Ohne Moderator: Freitext im Ring bewerten, dann „Weiter“
  if (isFree(room) && g.phase === "shown" && q?.type === "open") {
    for (const p of judgeTargetsOf(room, b.uid)) {
      if (judgmentOf(room, qi, p.uid)) continue;
      const a = answerOf(room, qi, p.uid);
      if (a) once(b, `judge:${base}:${qi}:${p.uid}`, rnd(1000, 2500) * sp, () => b.A.judge(qi, p.uid, autoJudge(q, a.value)));
    }
  }
  if (isFree(room) && g.phase === "revealed" && !nextOf(room, qi)[b.uid])
    once(b, `next:${base}:${qi}`, rnd(1800, 3500) * sp, () => b.A.markNext(qi));
}

// Antwort mit einstellbarer Trefferquote (leichte Fragen öfter richtig, schwere seltener)
function botAnswer(q, t) {
  let p = ACC[t.acc] ?? 0.65;
  if (q.diff === 1) p += 0.15;
  if (q.diff === 3) p -= 0.2;
  const ok = Math.random() < Math.max(0.05, Math.min(0.97, p));
  if (!q.type || q.type === "mc") {
    if (ok) return q.r;
    return pick([0, 1, 2, 3].filter(i => i !== q.r && i < (q.a?.length || 4)));
  }
  if (q.type === "estimate") {
    const v = Number(q.answer);
    const sign = Math.random() < 0.5 ? -1 : 1;
    if (Number.isInteger(v) && v >= 1000 && v <= 2100) return ok ? v + Math.round(rnd(-1, 1)) : v + sign * Math.round(rnd(6, 60));
    const f = ok ? rnd(-0.06, 0.06) : sign * rnd(0.25, 0.7);
    const x = v * (1 + f);
    return Number.isInteger(v) ? Math.max(0, Math.round(x)) : Math.round(x * 100) / 100;
  }
  return ok ? q.answer : pick(["Keine Ahnung", "Weiß ich nicht", "Hmm …"]);
}

// ── Bot als Moderator ──────────────────────────────────────────────────────
function stepMod(b, room, t) {
  if (room.meta.status !== "running") return;
  const sp = SPEED[t.speed] || 1;
  const g = room.game || {};
  const qi = g.qIndex;
  const q = room.questions?.[qi];
  const base = `${room.meta.createdAt}:${room.meta.startedAt || 0}`;
  const now = serverNow();
  const d = duelOf(room);

  if (isDuel(room) && g.phase === "board" && d.startQ == null) {
    const waiting = activePlayers(room).filter(p => p.online && !favDone(room, p.uid));
    if (!waiting.length) once(b, `draw:${base}`, 2500 * sp, () => b.A.duelDraw());
    return;
  }
  if (g.phase === "drawing" && d.drawAt) {
    if (now >= d.drawAt + DRAW_MS) once(b, `drawn:${d.drawAt}`, 0, () => b.A.duelDrawDone());
    return;
  }
  if (g.phase === "picked") {
    if (now - (g.phaseAt || now) >= PICKED_MS) once(b, `picked:${base}:${d.turn || 0}`, 0, () => b.A.duelPickedDone());
    return;
  }
  if (isDuel(room) && g.phase === "board") {
    const req = room.players?.[d.picker]?.pick;
    if (req && req.turn === (d.turn || 0)) once(b, `apply:${base}:${d.turn || 0}`, 300, () => b.A.pickCell(req.cell, d.picker));
    else if (room.settings?.pickTimer && now - (g.phaseAt || now) >= PICK_SEC * 1000)
      once(b, `pexp:${base}:${d.turn || 0}`, 0, () => { const c = freeCells(store.room); if (c.length) return b.A.pickCell(pick(c), d.picker); });
    return;
  }
  const key = `${base}:${qi}`;
  if (g.phase === "answering") {
    const mode = room.settings?.timerMode || "none";
    if (mode === "manual" && !g.timer?.running && !g.timer?.pauseLeft) once(b, `tstart:${key}`, 1200 * sp, () => b.A.timerStart());
    const left = timerLeft(room, now);
    if (left != null && left <= 0 && g.timer?.running) once(b, `texp:${key}`, 0, () => b.A.timerExpired(qi));
    if (allAnswered(room, true)) once(b, `lock:${key}`, 900, () => b.A.lockAnswers(qi));
    return;
  }
  if (g.phase === "locked") return once(b, `show:${key}`, 1200 * sp, () => b.A.showAnswers(qi));
  if (g.phase === "shown") {
    if (q?.type === "open") {
      for (const p of activePlayers(room)) {
        const a = answerOf(room, qi, p.uid);
        if (a && !judgmentOf(room, qi, p.uid)) once(b, `judge:${key}:${p.uid}`, 1500 * sp, () => b.A.judge(qi, p.uid, autoJudge(q, a.value)));
      }
    }
    if (unjudgedCount(room) === 0) once(b, `reveal:${key}`, 2500 * sp, () => b.A.reveal(qi));
    return;
  }
  if (g.phase === "revealed") once(b, `next:${key}`, 6000 * sp, () => b.A.nextQuestion(qi));
}
