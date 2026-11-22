// Alle Schreibvorgänge. Phasenwechsel laufen als Transaktion mit Prüfung von Phase und Frage,
// damit doppelte Klicks oder zwei Geräte gleichzeitig nichts kaputt machen.
import { db, ref, roomRef, roomPath, ROOM_ID, set, update, remove, runTransaction, serverNow, serverTimestamp } from "./firebase.js";
import { store, rerender } from "./store.js";
import { DBG } from "./debug.js";
import { loadPack } from "./packs.js";
import { autoJudge, jokerOf, isHints, MAX_PLAYERS, activePlayers, computeResult, qCount, summary, moderatorOf, ranking, isDuel, duelOf, pickOf, isStartQ, opponentOf, nextPicker, DUEL_MAX, playOrder, freeCells, questionKey, statCorrect, isFavFor, answerOf, betsOn, betsLeft, isYearQ } from "./model.js";

// Alle Aktionen hängen an einem Kontext (Identität, Datenbank, Raum). Die App nutzt den Hauptkontext,
// die Test-Bots je einen eigenen mit eigener Anmeldung – so laufen sie über exakt dieselben Wege.
export function createActions(ctx) {
  const uid = () => ctx.uid();
  const fail = (msg, e) => ctx.fail(msg, e);
  const rememberName = name => ctx.remember?.(name);

  // ── Raum ───────────────────────────────────────────────────────────────────
  // mode "moderated": man wird Moderator; mode "players": man spielt selbst mit und steuert als Host
  async function createRoom(name, mode = "moderated", extraMeta = null) {
    if (mode === "single") { mode = "moderated"; extraMeta = { ...(extraMeta || {}), single: true }; }
    name = (name || "").trim() || (mode === "players" ? "Spieler 1" : "Moderator");
    rememberName(name);
    const now = serverNow();
    const me = mode === "players"
      ? { name, role: "player", seat: 1, ready: true, joinedAt: now }
      : { name, role: "moderator", seat: 0, joinedAt: now };
    try {
      const res = await runTransaction(ctx.roomRef(), cur => {
        const st = cur?.meta?.status;
        if (st === "lobby" || st === "running") return; // abbrechen: Partie existiert
        return {
          meta: { status: "lobby", mode, hostUid: uid(), createdAt: now, updatedAt: now, ...(extraMeta || {}) },
          settings: { packId: null, packName: null, timerMode: "none", timerSec: 30, maxPlayers: MAX_PLAYERS },
          players: { [uid()]: me }
        };
      });
      DBG.log("createRoom", { committed: res.committed, mode });
      if (!res.committed) return fail("Es läuft bereits eine Partie");
      return true;
    } catch (e) { return fail("Raum konnte nicht angelegt werden", e); }
  }

  async function joinAsPlayer(name) {
    name = (name || "").trim();
    if (!name) return fail("Bitte einen Namen eingeben");
    rememberName(name);
    if (ctx.room()?.meta?.status !== "lobby") return fail("Mitspielen geht nur in der Lobby");
    const now = serverNow();
    try {
      const res = await runTransaction(ctx.roomRef("players"), cur => {
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

  async function joinAsSpectator(name) {
    name = (name || "").trim() || "Gast";
    rememberName(name);
    const st = ctx.room()?.meta?.status;
    if (st !== "lobby" && st !== "running" && st !== "finished") return fail("Es gibt gerade nichts zum Zuschauen");
    const now = serverNow();
    try {
      const res = await runTransaction(ctx.roomRef("players"), cur => {
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
  async function joinAsModerator(name, takeover = false) {
    name = (name || "").trim() || "Moderator";
    rememberName(name);
    const now = serverNow();
    try {
      const res = await runTransaction(ctx.roomRef("players"), cur => {
        cur = cur || {};
        const mod = Object.entries(cur).find(([, p]) => p.role === "moderator");
        if (mod && mod[0] !== uid()) {
          if (!takeover) return; // es gibt schon einen
          cur[mod[0]] = { ...mod[1], role: "spectator", seat: 100 };
        }
        if (cur[uid()]?.role === "player" && ctx.room()?.meta?.status === "running") return; // Spieler mitten in der Partie nicht umwandeln
        cur[uid()] = { ...(cur[uid()] || {}), name, role: "moderator", seat: 0, joinedAt: cur[uid()]?.joinedAt || now };
        return cur;
      });
      if (!res.committed) return fail(takeover ? "Übernahme nicht möglich" : "Es gibt bereits einen Moderator");
      await update(ctx.roomRef("meta"), { hostUid: uid(), updatedAt: serverNow() });
      DBG.log("joinAsModerator", { takeover });
      return true;
    } catch (e) { return fail("Übernehmen fehlgeschlagen", e); }
  }

  // Partie, in der seit langem niemand online war, als abgebrochen markieren
  async function markAbandoned() {
    try {
      const res = await runTransaction(ctx.roomRef("meta"), m => {
        if (!m || (m.status !== "lobby" && m.status !== "running")) return;
        return { ...m, status: "abandoned", abandonedAt: serverNow(), prevStatus: m.status };
      });
      DBG.log("markAbandoned", { committed: res.committed });
      if (res.committed) await update(ctx.ref(`roomIndex/${ctx.roomId}`), { status: "abandoned", updatedAt: serverTimestamp() });
    } catch (e) { DBG.log("markAbandoned-Fehler", e.message); }
  }

  async function leaveRoom() {
    try {
      await update(ctx.roomRef(), { [`players/${uid()}`]: null, [`presence/${uid()}`]: null });
      DBG.log("leaveRoom");
    } catch (e) { fail("Verlassen fehlgeschlagen", e); }
  }

  async function setName(name) {
    name = (name || "").trim();
    if (!name || !ctx.room()?.players?.[uid()]) return;
    rememberName(name);
    try { await update(ctx.roomRef(`players/${uid()}`), { name }); } catch (e) { fail("Name nicht gespeichert", e); }
  }

  // App-Version des Geräts im Raum vermerken (zeigt gemischte Versionen an)
  async function setVersion(v) {
    try { await update(ctx.roomRef(`players/${uid()}`), { v }); } catch (e) { DBG.log("setVersion-Fehler", e.message); }
  }
  async function setReady(ready) {
    try { await update(ctx.roomRef(`players/${uid()}`), { ready: !!ready }); DBG.log("setReady", ready); }
    catch (e) { fail("Bereit-Status nicht gespeichert", e); }
  }

  async function choosePack(pack) {
    try { await update(ctx.roomRef("settings"), { packId: pack.id, packName: pack.name, packMode: pack.mode || null, packHints: !!pack.hints }); DBG.log("choosePack", pack.id); }
    catch (e) { fail("Pack nicht gespeichert", e); }
  }

  // Spielmodus: "classic" oder "duel"; ein Pack, das nicht zum Modus passt, wird abgewählt
  async function setGameMode(mode) {
    const st = ctx.room()?.settings || {};
    const patch = { game: mode };
    const want = mode === "duel" ? "duel" : mode === "hints" ? "hints" : null;
    const keep = (st.packMode || null) === want || (mode === "hints" && !st.packMode && st.packHints) || (mode === "classic" && st.packMode === "hints");
    if (st.packId && !keep) Object.assign(patch, { packId: null, packName: null, packMode: null, packHints: null });
    if (mode === "hints") patch.timerMode = "none";   // Tempo bestimmt der Moderator über die Hinweise
    try { await update(ctx.roomRef("settings"), patch); DBG.log("setGameMode", mode); } catch (e) { fail("Modus nicht gespeichert", e); }
  }
  async function setDuelRule(rule) {
    try { await update(ctx.roomRef("settings"), { duelRule: rule === "all" ? "all" : "picker" }); DBG.log("setDuelRule", rule); } catch (e) { fail("Regel nicht gespeichert", e); }
  }
  // Nur ein Gerät: Spieler als Namen anlegen/entfernen, Antworten für sie eintragen
  async function addLocalPlayer(name) {
    name = (name || "").trim().slice(0, 24);
    if (!name) return fail("Bitte einen Namen eingeben");
    const now = serverNow();
    try {
      const res = await runTransaction(ctx.roomRef("players"), cur => {
        cur = cur || {};
        const list = Object.values(cur);
        if (list.filter(p => p.role === "player").length >= MAX_PLAYERS) return;
        if (list.some(p => p.role === "player" && p.name.toLowerCase() === name.toLowerCase())) return;
        const seat = Math.max(0, ...list.filter(p => p.role !== "spectator").map(p => p.seat || 0)) + 1;
        cur["l" + now.toString(36) + Math.random().toString(36).slice(2, 6)] = { name, role: "player", seat, ready: true, local: true, favDone: true, joinedAt: now };
        return cur;
      });
      DBG.log("addLocalPlayer", { committed: res.committed });
      if (!res.committed) return fail(`Name schon vergeben oder Raum voll (max. ${MAX_PLAYERS})`);
      return true;
    } catch (e) { return fail("Spieler nicht angelegt", e); }
  }
  async function removeLocalPlayer(pid) {
    if (!ctx.room()?.players?.[pid]?.local) return;
    try { await set(ctx.roomRef(`players/${pid}`), null); } catch (e) { fail("Spieler nicht entfernt", e); }
  }
  async function modAnswer(qi, pid, value, bet = false) {
    const room = ctx.room(), g = room?.game;
    if (!g || g.qIndex !== qi || !["answering", "locked"].includes(g.phase)) return fail("Die Frage ist nicht mehr offen");
    if (!room.players?.[pid]?.local) return;
    const prev = room.answers?.[qi]?.[pid];
    const now = serverNow();
    const a = { value, at: prev?.at || now };   // ohne ms: beim Eintippen gibt es keine Antwortzeit
    if (g.hint != null) a.h = prev && typeof prev.h === "number" ? prev.h : (g.hint || 0);
    if (bet && betsOn(room) && (prev?.b || betsLeft(room, pid) > 0)) a.b = true;
    try { await set(ctx.roomRef(`answers/${qi}/${pid}`), a); DBG.log("modAnswer", { qi, pid }); return true; }
    catch (e) { return fail("Antwort nicht gespeichert", e); }
  }
  async function setBets(on) {
    try { await update(ctx.roomRef("settings"), { bets: !!on }); DBG.log("setBets", on); } catch (e) { fail("Einstellung nicht gespeichert", e); }
  }
  async function setPickTimer(on) {
    try { await update(ctx.roomRef("settings"), { pickTimer: !!on }); DBG.log("setPickTimer", on); } catch (e) { fail("Wähl-Timer nicht gespeichert", e); }
  }

  // Lieblingsthema: normales Spiel ja/nein fürs gewählte Pack; Duell: Lieblingskategorien auf dem Brett
  async function setFav(fav) {
    try { await update(ctx.roomRef(`players/${uid()}`), { fav: !!fav, favPack: ctx.room()?.settings?.packId || null }); DBG.log("setFav", fav); }
    catch (e) { fail("Lieblingsthema nicht gespeichert", e); }
  }
  async function toggleFavCat(ci) {
    const cur = !!ctx.room()?.players?.[uid()]?.favCats?.["c" + ci];
    try { await set(ctx.roomRef(`players/${uid()}/favCats/c${ci}`), cur ? null : true); } catch (e) { fail("Auswahl nicht gespeichert", e); }
  }
  async function confirmFavs(done = true) {
    try { await update(ctx.roomRef(`players/${uid()}`), { favDone: !!done }); DBG.log("confirmFavs", done); } catch (e) { fail("Bestätigung nicht gespeichert", e); }
  }

  // ── Spielablauf (nur Moderator) ───────────────────────────────────────────
  async function startGame() {
    const room = ctx.room();
    const packId = room?.settings?.packId;
    if (!packId) return fail("Bitte zuerst ein Fragenpaket wählen");
    if (!activePlayers(room).length) return fail("Es ist noch kein Spieler beigetreten");
    const duel = isDuel(room);
    if (duel && (activePlayers(room).length < 2 || activePlayers(room).length > DUEL_MAX)) return fail(`Das Kategorie-Duell braucht 2 bis ${DUEL_MAX} Spieler`);
    let pack;
    try { pack = await loadPack(packId); } catch (e) { return fail("Pack konnte nicht geladen werden", e); }
    const hints = isHints(room);
    const want = duel ? "duel" : hints ? "hints" : null;
    const hintsOk = hints && !pack.mode && pack.questions.every(q => Array.isArray(q.hints) && q.hints.length === 3);
    if ((pack.mode || null) !== want && !hintsOk) return fail(duel ? "Bitte ein Duell-Pack wählen" : hints ? "Bitte ein Hinweis-Pack wählen" : "Dieses Pack gehört zu einem anderen Spielmodus");
    const questions = pack.questions.map(q => JSON.parse(JSON.stringify(q)));
    try {
      // 1. Fragen und Startzustand schreiben (noch in der Lobby, für andere unsichtbar)
      const now = serverNow();
      const game = duel
        ? { qIndex: -1, phase: "board", phaseAt: now, duel: { turn: 0 } }   // erst das Brett zeigen, Kategorien vorstellen
        : { qIndex: 0, phase: "answering", phaseAt: now, questionStartAt: now, timer: freshTimer(room, now), ...(hints ? { hint: 0, hintAt: now } : {}) };
      game.startedAt = now;
      // Kurzanleitung: erst wenn alle „Verstanden“ gedrückt haben (oder Moderator/Host überspringt), läuft die erste Frage
      if (!room.meta?.test) game.intro = true;
      const reset = {};
      for (const p of activePlayers(room)) Object.assign(reset, { [`players/${p.uid}/favCats`]: null, [`players/${p.uid}/favDone`]: p.local ? true : null, [`players/${p.uid}/pick`]: null });
    for (const u of Object.keys(room.players || {})) reset[`players/${u}/unclear`] = null;
      await update(ctx.roomRef(), {
        ...reset,
        questions,
        game, feedback: null,
        answers: null, judgments: null, results: null, jokers: null, bonus: null, next: null,
        "settings/packName": pack.name
      });
      // 2. Lobby → läuft, nur wenn noch Lobby
      const res = await runTransaction(ctx.roomRef("meta"), m => {
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
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || g.qIndex !== expectedQ || !fromPhases.includes(g.phase)) return;
        return { ...g, ...patch, phaseAt: serverNow() };
      });
      DBG.log(`Phase: ${label}`, { committed: res.committed, q: expectedQ });
      return res.committed;
    } catch (e) { return fail(`Phasenwechsel (${label}) fehlgeschlagen`, e); }
  }

  const STOPPED = { running: false, pauseLeft: 0 };
  const lockAnswers = qi => transition(["answering"], qi, { phase: "locked", timer: STOPPED }, "gesperrt");
  const showAnswers = qi => transition(["answering", "locked"], qi, { phase: "shown", timer: STOPPED }, "gezeigt");
  const timerExpired = qi => transition(["answering"], qi, { phase: "locked", timer: STOPPED }, "Zeit abgelaufen");

  async function reveal(qi) {
    const room = ctx.room();
    if (room?.game?.phase !== "shown" || room.game.qIndex !== qi) return false;
    try {
      // Ergebnis zuerst schreiben (idempotent), dann Phase wechseln
      await set(ctx.roomRef(`results/${qi}`), { ...computeResult(room, qi), revealedAt: serverNow() });
    } catch (e) { return fail("Ergebnis nicht gespeichert", e); }
    const ok = await transition(["shown"], qi, { phase: "revealed" }, "aufgelöst");
    if (ok) recordStats(room, qi);
    return ok;
  }

  // ── Statistik pro Frage (für die Einstufung neuer Packs) ───────────────────
  // questionStats/{packId}/{key}: n, right, ms, msN, noAns, fav/favRight, nofav/nofavRight, fb{...}
  function statRef(room, qi) {
    const q = room?.questions?.[qi], pack = room?.settings?.packId;
    return q && pack ? ctx.ref(`questionStats/${pack}/${questionKey(q, room?.settings?.packMode === "hints")}`) : null;
  }
  // Erfasst je Frage nur Zähler (wenige hundert Byte pro Frage, wächst nicht mit der Zahl der Partien – außer
  // den gekappten Listen falscher Freitext-Antworten). Keine Antwortzeiten.
  //   n/right/noAns, fav/favRight, nofav/nofavRight, h<k>/h<k>r (Hinweisstand), joker,
  //   pick.a0–a3 (gewählte Antwort bei MC), wrong{Text: Anzahl} (Freitext, max. 25 verschiedene),
  //   modFix (Moderator weicht von der Automatik ab), altCand{Text} (vom Moderator als richtig gewertet),
  //   err.m3…p3 (Schätzfehler-Bereiche in %), yerr (Jahreszahlen in Jahren), bet/betRight (Sicher-Einsatz), picked/turnSum (Duell: wann das Feld gewählt wurde)
  async function recordStats(room, qi) {
    if (room?.meta?.test) return;   // Testräume verfälschen die Statistik nicht
    const r = statRef(room, qi);
    if (!r) return;
    const q = room.questions[qi];
    const rows = activePlayers(room).map(p => {
      const a = answerOf(room, qi, p.uid);
      const j = room.judgments?.[qi]?.[p.uid]?.v;
      return { a, ok: statCorrect(room, qi, p.uid), fav: isFavFor(room, qi, p.uid), j: j == null ? null : j === "correct", joker: jokerOf(room, p.uid)?.q === qi };
    });
    const pick = pickOf(room, qi);
    const key = t => String(t).toLowerCase().trim().replace(/[.#$/\[\]]/g, "_").replace(/\s+/g, " ").slice(0, 40) || "_";
    const bucket = (v, t) => {
      if (!t) return null;
      const e = (v - t) / Math.abs(t);
      return e < -0.5 ? "m3" : e < -0.2 ? "m2" : e < -0.05 ? "m1" : e <= 0.05 ? "z" : e <= 0.2 ? "p1" : e <= 0.5 ? "p2" : "p3";
    };
    const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
    try {
      await runTransaction(r, cur => {
        const c = cur || {};
        Object.assign(c, { q: String(q.q).slice(0, 90), type: q.type || "mc", cat: q.cat || null, diff: q.diff || null });
        for (const x of rows) {
          inc(c, "n");
          if (x.ok) inc(c, "right");
          if (!x.a) inc(c, "noAns");
          if (x.fav === true) { inc(c, "fav"); if (x.ok) inc(c, "favRight"); }
          if (x.fav === false) { inc(c, "nofav"); if (x.ok) inc(c, "nofavRight"); }
          if (x.a && typeof x.a.h === "number") { inc(c, "h" + x.a.h); if (x.ok) inc(c, "h" + x.a.h + "r"); }
          if (x.joker) inc(c, "joker");
          if (!x.a) continue;
          if (!q.type || q.type === "mc") inc(c.pick = c.pick || {}, "a" + x.a.value);
          if (x.a.b) { inc(c, "bet"); if (x.ok) inc(c, "betRight"); }
          // Schätzfehler: bei Jahreszahlen in Jahren (yerr: z genau, 1 ≤ 2 J., 2 ≤ 10 J., 3 darüber), sonst in Prozent (err)
          if (q.type === "estimate" && isYearQ(q)) {
            const d = Number(x.a.value) - Number(q.answer), ad = Math.abs(d);
            if (isFinite(d)) inc(c.yerr = c.yerr || {}, d === 0 ? "z" : (d < 0 ? "m" : "p") + (ad <= 2 ? 1 : ad <= 10 ? 2 : 3));
          } else if (q.type === "estimate") { const b = bucket(Number(x.a.value), Number(q.answer)); if (b) inc(c.err = c.err || {}, b); }
          if (q.type === "open") {
            const auto = autoJudge(q, x.a.value);
            if (x.j != null && x.j !== auto) { inc(c, "modFix"); if (x.j) inc(c.altCand = c.altCand || {}, key(x.a.value)); }
            if (!x.ok) {
              c.wrong = c.wrong || {};
              const k = key(x.a.value);
              if (c.wrong[k] || Object.keys(c.wrong).length < 25) inc(c.wrong, k);
            }
          }
        }
        if (pick) { inc(c, "picked"); c.turnSum = (c.turnSum || 0) + (pick.turn || 0); }
        c.mode = room.settings?.game || "classic";
        c.last = serverNow();
        return c;
      });
      DBG.log("Statistik", { qi, n: rows.length });
    } catch (e) { DBG.log("Statistik-Fehler", e.message); }
  }

  // „Unverständlich“: Spieler oder Moderator markieren die laufende Frage (umschaltbar), sofort gezählt
  async function toggleUnclear(qi) {
    const room = ctx.room();
    const on = !!room?.players?.[uid()]?.unclear?.["q" + qi];
    try {
      await set(ctx.roomRef(`players/${uid()}/unclear/q${qi}`), on ? null : true);
      const r = room?.meta?.test ? null : statRef(room, qi);
      if (r) await runTransaction(r, cur => { const c = cur || { q: String(room.questions[qi]?.q || "").slice(0, 90) }; c.unclear = Math.max(0, (c.unclear || 0) + (on ? -1 : 1)); return c; });
      DBG.log("Unverständlich", { qi, on: !on });
    } catch (e) { fail("Markierung nicht gespeichert", e); }
  }

  // Feedback des Moderators: zu leicht / passt / zu schwer / fehlerhaft (umentscheiden möglich)
  // Moderator: room.feedback/{qi} → Statistik „fb“; Spieler: players/{uid}/fb/q{qi} → Statistik „pfb“
  async function giveFeedback(kind) {
    const room = ctx.room(), qi = room?.game?.qIndex;
    if (!room || qi == null) return;
    const isMod = room.players?.[uid()]?.role === "moderator";
    const prev = (isMod ? room.feedback?.[qi] : room.players?.[uid()]?.fb?.["q" + qi]) || null;
    const next = prev === kind ? null : kind;
    const r = room.meta?.test ? null : statRef(room, qi);
    const field = isMod ? "fb" : "pfb";
    try {
      await set(ctx.roomRef(isMod ? `feedback/${qi}` : `players/${uid()}/fb/q${qi}`), next);
      if (r) await runTransaction(r, cur => {
        const c = cur || { q: String(room.questions[qi]?.q || "").slice(0, 90) };
        c[field] = c[field] || {};
        if (prev) c[field][prev] = Math.max(0, (c[field][prev] || 0) - 1);
        if (next) c[field][next] = (c[field][next] || 0) + 1;
        return c;
      });
      DBG.log("Feedback", { qi, kind: next });
    } catch (e) { fail("Feedback nicht gespeichert", e); }
  }

  async function nextQuestion(qi) {
    const room = ctx.room();
    const total = qCount(room);
    if (isDuel(room)) {
      if (playOrder(room).length >= total) return finishGame(qi);
      const r = room.results?.[qi];
      const picker = isStartQ(room, qi) ? r?.startWinner : nextPicker(room, pickOf(room, qi)?.by);
      if (!picker) return fail("Unklar, wer als Nächstes wählt");
      try {
        const res = await runTransaction(ctx.roomRef("game"), g => {
          if (!g || g.qIndex !== qi || g.phase !== "revealed") return;
          return { ...g, phase: "board", phaseAt: serverNow(), timer: null, duel: { ...(g.duel || {}), picker } };
        });
        DBG.log("Phase: zurück zum Brett", { committed: res.committed, picker });
        return res.committed;
      } catch (e) { return fail("Zurück zum Brett fehlgeschlagen", e); }
    }
    if (qi + 1 >= total) return finishGame(qi);
    const now = serverNow();
    return transition(["revealed"], qi, { phase: "answering", qIndex: qi + 1, questionStartAt: now, timer: freshTimer(room, now), ...(isHints(room) ? { hint: 0, hintAt: now } : {}) }, "nächste Frage");
  }

  async function finishGame(qi) {
    const ok = await transition(["revealed"], qi, { phase: "finished" }, "beendet");
    if (!ok) return false;
    const room = ctx.room();
    try {
      await update(ctx.roomRef("meta"), { status: "finished", finishedAt: serverNow(), updatedAt: serverNow() });
      await writeHistory(ctx.room());
    } catch (e) { fail("Abschluss nicht vollständig gespeichert", e); }
    return true;
  }

  // Kurzfassung für die Statistik (wird bei Bonus-Änderung neu geschrieben)
  async function writeHistory(room) {
    if (room?.meta?.test) return;   // Testpartien nicht in die Historie
    const rk = ranking(room);
    const gameId = `${ctx.roomId}_${room.meta?.createdAt || 0}_${room.meta?.startedAt || 0}`;
    await set(ctx.ref(`history/${gameId}`), {
      at: room.meta?.finishedAt || serverNow(), packId: room.settings?.packId || null, packName: room.settings?.packName || null, game: room.settings?.game || "classic",
      players: rk.map(p => ({ name: p.name, score: p.score, correct: p.correct, avgMs: p.avgMs ? Math.round(p.avgMs) : null })),
      moderator: moderatorOf(room)?.name || null, questions: qCount(room), bonus: room.bonus?.uid ? (room.players?.[room.bonus.uid]?.name || null) : null
    });
  }

  // Neue Runde mit denselben Leuten
  async function newRound() {
    const patch = {
      "meta/status": "lobby", "meta/updatedAt": serverNow(), "meta/startedAt": null, "meta/finishedAt": null,
      game: null, questions: null, answers: null, judgments: null, results: null, jokers: null, bonus: null, next: null, feedback: null
    };
    for (const p of activePlayers(ctx.room())) Object.assign(patch, {
      [`players/${p.uid}/ready`]: p.uid === ctx.room()?.meta?.hostUid && ctx.room()?.meta?.mode === "players",
      [`players/${p.uid}/favCats`]: null, [`players/${p.uid}/favDone`]: p.local ? true : null, [`players/${p.uid}/pick`]: null
    });
    for (const u of Object.keys(ctx.room()?.players || {})) patch[`players/${u}/unclear`] = null;
    try { await update(ctx.roomRef(), patch); DBG.log("newRound"); } catch (e) { fail("Neue Runde fehlgeschlagen", e); }
  }

  async function judge(qi, playerUid, correct) {
    try {
      await set(ctx.roomRef(`judgments/${qi}/${playerUid}`), { v: correct ? "correct" : "wrong", by: uid() });
      DBG.log("judge", { qi, correct });
    } catch (e) { fail("Bewertung nicht gespeichert", e); }
  }

  // ── Kategorie-Duell ────────────────────────────────────────────────────────
  // Startfrage auslosen: Feld wird sofort festgelegt, alle Geräte spielen dieselbe Animation bis drawAt + DRAW_MS
  async function duelDraw() {
    const room = ctx.room();
    const cells = freeCells(room);
    if (!cells.length) return false;
    const cell = cells[Math.floor(Math.random() * cells.length)];
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || g.phase !== "board" || g.duel?.startQ != null) return;
        return { ...g, phase: "drawing", phaseAt: serverNow(), duel: { ...(g.duel || {}), startQ: cell, drawAt: serverNow() } };
      });
      DBG.log("Startfrage ausgelost", { committed: res.committed, cell });
      return res.committed;
    } catch (e) { return fail("Auslosen fehlgeschlagen", e); }
  }
  async function duelDrawDone() {
    const room = ctx.room();
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || g.phase !== "drawing" || g.duel?.startQ == null) return;
        const now = serverNow();
        return { ...g, phase: "answering", qIndex: g.duel.startQ, phaseAt: now, questionStartAt: now, timer: freshTimer(room, now) };
      });
      DBG.log("Startfrage beginnt", { committed: res.committed });
    } catch (e) { fail("Start der Frage fehlgeschlagen", e); }
  }
  // Feld wählen (Moderator bzw. Host schreibt den Spielzustand); by = Wähler
  async function pickCell(cell, by) {
    const room = ctx.room();
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        const d = g?.duel;
        if (!g || g.phase !== "board" || d?.startQ == null || d.picker !== by) return;
        if (cell === d.startQ || d.picks?.["q" + cell] || !room.questions?.[cell]) return;
        const now = serverNow(), turn = (d.turn || 0) + 1;
        // erst kurz „gewählt“ zeigen, damit alle sehen, welches Feld es wurde
        return { ...g, phase: "picked", qIndex: cell, phaseAt: now, timer: null,
          duel: { ...d, turn, picks: { ...(d.picks || {}), ["q" + cell]: { by, turn } } } };
      });
      DBG.log("Feld gewählt", { committed: res.committed, cell });
      return res.committed;
    } catch (e) { return fail("Wählen fehlgeschlagen", e); }
  }
  // Nach der kurzen Pause: gewähltes Feld → Frage
  // Hinweis-Modus: nächsten Hinweis einblenden (nur Moderator; vor dem Zeigen der Antworten)
  async function nextHint(qi) {
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || g.qIndex !== qi || g.phase !== "answering" || (g.hint || 0) >= 3) return;
        return { ...g, hint: (g.hint || 0) + 1, hintAt: serverNow() };
      });
      DBG.log("Hinweis eingeblendet", { committed: res.committed, qi });
      return res.committed;
    } catch (e) { return fail("Hinweis nicht eingeblendet", e); }
  }
  async function ackIntro() {
    const g = ctx.room()?.game;
    if (!g?.intro) return;
    try { await set(ctx.roomRef(`players/${uid()}/introOk`), g.startedAt || 0); DBG.log("ackIntro"); } catch (e) { fail("Nicht gespeichert", e); }
  }
  async function endIntro() {
    const room = ctx.room();
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || !g.intro) return;
        const now = serverNow();
        const n = { ...g, intro: null };
        // Die erste Frage beginnt erst jetzt (Timer und Antwortzeiten zählen ab hier)
        if (g.phase === "answering") Object.assign(n, { phaseAt: now, questionStartAt: now, timer: freshTimer(room, now), ...(g.hint != null ? { hintAt: now } : {}) });
        return n;
      });
      DBG.log("Kurzanleitung beendet", { committed: res.committed });
    } catch (e) { fail("Start fehlgeschlagen", e); }
  }
  async function requestHint() {
    const g = ctx.room()?.game;
    if (!g || g.phase !== "answering") return;
    const mine = ctx.room()?.players?.[uid()]?.hintReq;
    const same = mine && mine.qi === g.qIndex && mine.lvl === (g.hint || 0) && mine.s === (g.startedAt || 0);
    try { await set(ctx.roomRef(`players/${uid()}/hintReq`), same ? null : { qi: g.qIndex, lvl: g.hint || 0, s: g.startedAt || 0 }); DBG.log("requestHint", !same); }
    catch (e) { fail("Anfrage nicht gespeichert", e); }
  }
  async function duelPickedDone() {
    const room = ctx.room();
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || g.phase !== "picked") return;
        const now = serverNow();
        return { ...g, phase: "answering", phaseAt: now, questionStartAt: now, timer: freshTimer(room, now) };
      });
      DBG.log("Frage beginnt", { committed: res.committed });
    } catch (e) { fail("Start der Frage fehlgeschlagen", e); }
  }
  // Spieler ohne Schreibrecht auf den Spielzustand: Wunsch ablegen, Moderator/Host übernimmt ihn
  async function requestPick(cell) {
    const turn = duelOf(ctx.room()).turn || 0;
    try { await set(ctx.roomRef(`players/${uid()}/pick`), { turn, cell }); DBG.log("requestPick", { turn, cell }); }
    catch (e) { fail("Wahl nicht gespeichert", e); }
  }

  // ── Pack-Vorlieben (für alle Partien gleich) ───────────────────────────────
  async function setPackPref(packId, key, value) {
    try { await set(ctx.ref(`packPrefs/${packId}/${key}`), value ? true : null); DBG.log("packPref", { packId, key, value }); }
    catch (e) { fail("Einstellung nicht gespeichert", e); }
  }

  // ── Timer, Joker, Bonus (Moderator) ────────────────────────────────────────
  async function setTimer(mode, sec) {
    const patch = {};
    if (mode) patch.timerMode = mode;
    if (sec) patch.timerSec = Math.min(300, Math.max(5, Math.round(sec)));
    try { await update(ctx.roomRef("settings"), patch); DBG.log("setTimer", patch); } catch (e) { fail("Timer nicht gespeichert", e); }
  }

  async function timerTx(fn, label) {
    try {
      const res = await runTransaction(ctx.roomRef("game"), g => {
        if (!g || g.phase !== "answering") return;
        const t = fn(g.timer || {}, ctx.room()?.settings?.timerSec || 30, serverNow());
        if (!t) return;
        return { ...g, timer: t };
      });
      DBG.log(`Timer: ${label}`, { committed: res.committed });
    } catch (e) { fail("Timer-Aktion fehlgeschlagen", e); }
  }
  const timerStart = () => timerTx((t, sec, now) => t.running ? null
    : { running: true, startAt: t.pauseLeft != null ? now - (sec - t.pauseLeft) * 1000 : now }, "Start");
  const timerPause = () => timerTx((t, sec, now) => !t.running ? null
    : { running: false, pauseLeft: Math.max(0, sec - (now - t.startAt) / 1000) }, "Pause");
  const timerReset = () => timerTx(() => ({ running: false }), "Reset");

  // Ohne Moderator setzt jeder seinen 50:50-Joker selbst ein
  const useJoker = () => grantJoker(uid());

  async function grantJoker(playerUid) {
    const room = ctx.room();
    const g = room?.game;
    const q = room?.questions?.[g?.qIndex];
    if (!g || g.phase !== "answering" || !q || q.type === "estimate" || q.type === "open") return fail("Joker nur bei offener Multiple-Choice-Frage");
    if (room.answers?.[g.qIndex]?.[playerUid]) return fail("Der Spieler hat schon eingeloggt");
    const wrongs = q.a.map((_, i) => i).filter(i => i !== q.r);
    for (let i = wrongs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [wrongs[i], wrongs[j]] = [wrongs[j], wrongs[i]]; }
    try {
      const res = await runTransaction(ctx.roomRef(`jokers/${playerUid}`), cur => cur ? undefined : { q: g.qIndex, hidden: wrongs.slice(0, 2).sort() });
      DBG.log("grantJoker", { committed: res.committed });
      if (!res.committed) fail("Joker wurde schon verbraucht");
    } catch (e) { fail("Joker nicht vergeben", e); }
  }

  async function setBonus(playerUid) {
    try {
      await set(ctx.roomRef("bonus"), playerUid ? { uid: playerUid } : null);
      DBG.log("setBonus", playerUid);
      // Store ist nach set() lokal aktualisiert → Statistik mit Bonus neu schreiben
      setTimeout(() => writeHistory(ctx.room()).catch(() => {}), 300);
    } catch (e) { fail("Bonus nicht gespeichert", e); }
  }

  // ── Antworten (Spieler) ────────────────────────────────────────────────────
  async function submitAnswer(qi, value, bet = false) {
    const g = ctx.room()?.game;
    const useBet = bet && betsOn(ctx.room()) && betsLeft(ctx.room(), uid()) > 0;
    if (!g || g.phase !== "answering" || g.qIndex !== qi) return fail("Die Frage ist nicht mehr offen");
    const now = serverNow();
    const ms = Math.max(0, Math.round(now - (g.questionStartAt || now)));
    try {
      const res = await runTransaction(ctx.roomRef(`answers/${qi}/${uid()}`), cur => {
        if (cur) return; // bereits eingeloggt
        const a = g.hint != null ? { value, at: now, ms, h: g.hint || 0 } : { value, at: now, ms };
        if (useBet) a.b = true;
        return a;
      });
      DBG.log("submitAnswer", { qi, committed: res.committed, ms });
      return res.committed;
    } catch (e) { return fail("Antwort nicht gespeichert", e); }
  }

  // ── Ohne Moderator ─────────────────────────────────────────────────────────
  // Einzelspiel: automatische Bewertung (by "auto"), nach dem Auflösen von Hand korrigierbar
  async function autoJudgeAnswer(qi, playerUid, correct) {
    try { await set(ctx.roomRef(`judgments/${qi}/${playerUid}`), { v: correct ? "correct" : "wrong", by: "auto" }); DBG.log("autoJudge", { qi, correct }); }
    catch (e) { fail("Bewertung nicht gespeichert", e); }
  }
  async function overrideJudgment(qi, playerUid, correct) {
    const room = JSON.parse(JSON.stringify(ctx.room() || {}));
    room.judgments = room.judgments || {};
    room.judgments[qi] = { ...(room.judgments[qi] || {}), [playerUid]: { v: correct ? "correct" : "wrong", by: uid() } };
    const res = computeResult(room, qi);
    try {
      await update(ctx.roomRef(), { [`judgments/${qi}/${playerUid}`]: room.judgments[qi][playerUid], [`results/${qi}/points`]: res.points, [`results/${qi}/ok`]: res.ok, [`results/${qi}/fastestUid`]: res.fastestUid });
      DBG.log("overrideJudgment", { qi, correct });
    } catch (e) { fail("Korrektur nicht gespeichert", e); }
  }

  // Nach dem Auflösen bestätigt jeder Spieler "Weiter"; der Host schaltet, wenn alle online-Spieler bereit sind
  async function markNext(qi) {
    try { await set(ctx.roomRef(`next/${qi}/${uid()}`), true); DBG.log("markNext", qi); }
    catch (e) { fail("Weiter nicht gespeichert", e); }
  }

  // Host-Übergabe, wenn der bisherige Host länger offline ist (nur wenn er noch Host ist)
  async function claimHost(oldHost) {
    try {
      const res = await runTransaction(ctx.roomRef("meta"), m => {
        if (!m || m.hostUid !== oldHost) return;
        return { ...m, hostUid: uid(), updatedAt: serverNow() };
      });
      DBG.log("claimHost", { committed: res.committed });
    } catch (e) { DBG.log("claimHost-Fehler", e.message); }
  }

  // ── Verwaltung ─────────────────────────────────────────────────────────────
  async function resetRoom() {
    try { await remove(ctx.roomRef()); await remove(ctx.ref(`roomIndex/${ctx.roomId}`)); DBG.log("resetRoom"); }
    catch (e) { fail("Zurücksetzen fehlgeschlagen", e); }
  }

  // Kleine Übersicht für die Raumliste, vom Moderator bzw. Host gepflegt
  let lastIndex = "";
  function syncIndex(room) {
    if (!ctx.roomId || !room?.meta) return;
    const s = summary(room);
    const key = JSON.stringify(s);
    if (key === lastIndex) return;
    lastIndex = key;
    set(ctx.ref(`roomIndex/${ctx.roomId}`), { ...s, updatedAt: serverTimestamp() }).catch(() => {});
  }

  // Alte Räume aufräumen (ohne Server-Funktionen): beendete/abgebrochene nach 1 Tag löschen.
  // Offene Räume ohne Aktivität seit 7 Tagen erst als abgebrochen markieren (das dürfen laut Regeln alle),
  // gelöscht werden sie dann beim nächsten Aufräumen. Jeder Raum einzeln, damit ein verweigerter Schritt nicht alles blockiert.
  let cleaned = false;
  function cleanupRooms(rooms) {
    if (cleaned || !rooms) return;
    cleaned = true;
    const now = serverNow(), DAY = 864e5;
    for (const [id, r] of Object.entries(rooms)) {
      const age = now - (r?.updatedAt || 0);
      const done = r?.status === "finished" || r?.status === "abandoned" || r?.status === "none";
      if (done && age > DAY) {
        remove(ctx.ref(`rooms/${id}`)).then(() => remove(ctx.ref(`roomIndex/${id}`)))
          .then(() => DBG.log("Alter Raum gelöscht", id)).catch(e => DBG.log("Aufräumen verweigert", { id, e: e.message }));
      } else if (!done && age > 7 * DAY) {
        update(ctx.ref(`rooms/${id}/meta`), { status: "abandoned", abandonedAt: now })
          .then(() => update(ctx.ref(`roomIndex/${id}`), { status: "abandoned", updatedAt: now })).catch(() => {});
      }
    }
  }

  return { ackIntro, endIntro, requestHint, addLocalPlayer, removeLocalPlayer, modAnswer, setBets, toggleUnclear, nextHint, setDuelRule, setVersion, duelPickedDone, createRoom, joinAsPlayer, joinAsSpectator, joinAsModerator, markAbandoned, leaveRoom, setName, setReady, choosePack, setGameMode, setPickTimer, setFav, toggleFavCat, confirmFavs, startGame, reveal, giveFeedback, nextQuestion, newRound, judge, duelDraw, duelDrawDone, pickCell, requestPick, setPackPref, setTimer, grantJoker, setBonus, submitAnswer, autoJudgeAnswer, overrideJudgment, markNext, claimHost, resetRoom, syncIndex, cleanupRooms, lockAnswers, showAnswers, timerExpired, timerStart, timerPause, timerReset, useJoker };
}

const main = createActions({
  uid: () => store.uid,
  room: () => store.room,
  roomId: ROOM_ID,
  roomRef,
  ref: p => ref(db, p),
  fail(msg, e) {
    DBG.log("Fehler: " + msg, e?.message || e);
    store.local.error = msg + (e?.message ? ` (${e.message})` : "");
    rerender();
    return false;
  },
  remember(name) {
    try { localStorage.setItem("quiz.v4.name", name); } catch {}
    store.local.name = name;
  }
});
export const { ackIntro, endIntro, requestHint, addLocalPlayer, removeLocalPlayer, modAnswer, setBets, toggleUnclear, nextHint, setDuelRule, setVersion, duelPickedDone, createRoom, joinAsPlayer, joinAsSpectator, joinAsModerator, markAbandoned, leaveRoom, setName, setReady, choosePack, setGameMode, setPickTimer, setFav, toggleFavCat, confirmFavs, startGame, reveal, giveFeedback, nextQuestion, newRound, judge, duelDraw, duelDrawDone, pickCell, requestPick, setPackPref, setTimer, grantJoker, setBonus, submitAnswer, autoJudgeAnswer, overrideJudgment, markNext, claimHost, resetRoom, syncIndex, cleanupRooms, lockAnswers, showAnswers, timerExpired, timerStart, timerPause, timerReset, useJoker } = main;
