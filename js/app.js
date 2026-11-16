// Einstieg: Identität, Abo auf den Raum, Rendern, Ereignisse
import { initIdentity, ROOM_ID, CREATE_MODE, serverNow, goRoom, goOverview, newRoomCode, normCode, clearCreateParam } from "./firebase.js";
import { store, subscribe, onRender, rerender, setLocal, subscribePackData } from "./store.js";
import { syncPresence, watchVisibility } from "./presence.js";
import { DBG } from "./debug.js";
import * as A from "./actions.js";
import { loadPackList } from "./packs.js";
import { meIn, allAnswered, resultFor, esc, isStale, moderatorAway, timerLeft, isFree, hostUid, hostSuccessor, unjudgedCount, waitingForNext, nextOf, isOpenType, activePlayers, isSoloFree, autoJudge, answerOf, judgmentOf } from "./model.js";
import { overviewView } from "./views/overview.js";
import { ICON } from "./views/common.js";
import { vibrate, keepAwake, share, initNative, isApp, setBarStyle } from "./native.js";
import { homeView } from "./views/home.js";
import { modLobbyView, playerLobbyView, spectatorLobbyView } from "./views/lobby.js";
import { playerGameView } from "./views/player.js";
import { modGameView } from "./views/moderator.js";
import { resultsView } from "./views/results.js";
import { packPickerView } from "./views/packs.js";

export const VERSION = "v4.6.1";
const $ = id => document.getElementById(id);

// ── Welche Ansicht? Nur aus dem Zustand abgeleitet ─────────────────────────
function pickView(s) {
  if (!s.loaded) return { key: "loading", html: `<div class="screen"><div class="body center"><div class="spin"></div></div></div>` };
  if (!ROOM_ID) return { key: "overview", html: overviewView(s, serverNow()) };
  const room = s.room;
  const status = room?.meta?.status || "none";
  const me = meIn(room, s.uid);
  const dismissed = s.local.dismissed && s.local.dismissed === `${room?.meta?.createdAt}:${room?.meta?.finishedAt}`;
  if (!me || status === "none" || status === "abandoned" || (status === "finished" && dismissed)) return { key: "home", html: homeView(s, serverNow()) };
  const steers = me.role === "moderator" || (isFree(room) && hostUid(room) === s.uid && me.role === "player");
  if (status === "lobby") {
    if (steers) return s.local.picker ? { key: "modLobby", html: packPickerView(s) } : { key: "modLobby", html: modLobbyView(s, me) };
    if (me.role === "spectator") return { key: "specLobby", html: spectatorLobbyView(s, me) };
    return { key: "plLobby", html: playerLobbyView(s, me) };
  }
  if (status === "running") return me.role === "moderator" ? { key: "modGame", html: modGameView(s, me) } : { key: "plGame", html: playerGameView(s, me) };
  if (status === "finished") return { key: "results", html: resultsView(s, me) };
  return { key: "home", html: homeView(s, serverNow()) };
}

let lastView = "", lastHtml = "";
function render(s) {
  // Fokus und Cursor eines Eingabefelds über das Neuzeichnen retten
  const ae = document.activeElement;
  const focus = ae && ae.id && ae.tagName === "INPUT" ? { id: ae.id, start: ae.selectionStart, end: ae.selectionEnd, value: ae.value } : null;
  const scroller = document.querySelector("#app .body");
  const scrollTop = scroller?.scrollTop || 0;

  const v = pickView(s);
  const html = banners(s) + v.html + (s.local.menu ? menuSheet(s) : "");
  // Unverändertes HTML nicht neu setzen: sonst gehen Taps verloren, die genau während eines Updates passieren
  if (html === lastHtml) { afterRender(s, v.key); return; }
  lastHtml = html;
  $("app").innerHTML = html;
  if (s.local.factAnim) { s.local.factAnim = false; lastHtml = ""; }

  if (v.key === lastView) { const sc = document.querySelector("#app .body"); if (sc) sc.scrollTop = scrollTop; }
  if (v.key !== lastView) DBG.log("Ansicht", v.key);
  lastView = v.key;
  if (focus) { const el = $(focus.id); if (el) { el.value = focus.value; el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch {} } }

  afterRender(s, v.key);
}

function banners(s) {
  let h = "";
  if (s.loaded && !s.connected) h += `<div class="banner warn">Verbindung getrennt – verbinde neu …</div>`;
  if (s.local.error) h += `<div class="banner err"><span>${esc(s.local.error)}</span><button data-act="clearError">OK</button></div>`;
  return h;
}

// Menü als Blatt von unten: Design, Vollbild, Debug, Raum zurücksetzen
function menuSheet(s) {
  const light = document.documentElement.getAttribute("data-theme") === "light";
  return `<div class="sheet-bg" data-act="closeMenu"><div class="sheet" role="dialog" aria-label="Menü">
    <div class="sheet-grip"></div>
    <button class="sheet-item" data-act="theme">${ICON.theme()}${light ? "Dunkles Design" : "Helles Design"}</button>
    <button class="sheet-item browser-only" data-act="fullscreen">${ICON.full()}Vollbild</button>
    <button class="sheet-item" data-act="debug">${ICON.bug()}Debug-Log</button>
    ${ROOM_ID ? `<button class="sheet-item" data-act="overview">${ICON.back()}Zur Raumübersicht</button>
    <button class="sheet-item danger" data-act="resetAll">${ICON.trash()}Raum zurücksetzen</button>` : ""}
    <div class="sheet-info"><span class="dot ${s.connected ? "on" : "off"}"></span>${s.connected ? "Verbunden" : "Keine Verbindung"} · ${ROOM_ID ? `Raum ${esc(ROOM_ID)}` : "Übersicht"} · ${VERSION}</div>
  </div></div>`;
}

let revealVibed = null;
let lockRequested = null, abandonChecked = null, createDone = false;
const once = new Set();   // Automatik-Schritte nur einmal je Schlüssel auslösen
function doOnce(key, fn, delay = 0) {
  if (once.has(key)) return;
  once.add(key);
  delay ? setTimeout(fn, delay) : fn();
}
function afterRender(s, key) {
  syncPresence(s);
  keepAwake(key === "modGame" || key === "plGame");
  if (!ROOM_ID) { if (s.loaded) A.cleanupRooms(s.rooms); return; }
  const room = s.room;
  const g = room?.game;
  const now = serverNow();
  const me = meIn(room, s.uid);

  // Neue Partie aus der Übersicht: Raum anlegen, sobald er geladen ist
  if (CREATE_MODE && s.loaded && !createDone) {
    createDone = true;
    clearCreateParam();
    const st = room?.meta?.status;
    if (st !== "lobby" && st !== "running") A.createRoom(s.local.name, CREATE_MODE);
  }
  // Verlassene Partie (alle seit 10 min offline) als abgebrochen markieren – einmal pro Raum
  if (isStale(room, now)) {
    const k = `${room.meta?.createdAt}`;
    if (abandonChecked !== k) { abandonChecked = k; A.markAbandoned(); }
  }
  // Spieler: kurze Vibration beim Auflösen (richtig: einmal, falsch: doppelt)
  if (key === "plGame" && g?.phase === "revealed" && me?.role === "player") {
    const k = `${room.meta?.createdAt}:${g.qIndex}`;
    if (revealVibed !== k && resultFor(room, g.qIndex)) {
      revealVibed = k;
      vibrate(resultFor(room, g.qIndex)?.points?.[s.uid] ? 80 : [60, 80, 60]);
    }
  }
  const free = isFree(room);
  const isHost = free && hostUid(room) === s.uid && me?.role === "player";
  const steers = me?.role === "moderator" || isHost;
  if (steers) A.syncIndex(room);

  // Ohne Moderator: Steuerung geht an den nächsten Spieler, wenn der Host weg ist
  if (free && me?.role === "player" && (room.meta?.status === "lobby" || room.meta?.status === "running")) {
    const succ = hostSuccessor(room, now);
    if (succ === s.uid) doOnce(`claim:${hostUid(room)}:${room.meta?.updatedAt}`, () => A.claimHost(hostUid(room)));
  }

  // Automatisch sperren, sobald alle eingeloggt haben (Moderator bzw. Host)
  if (steers && room.meta?.status === "running" && g?.phase === "answering" && allAnswered(room, free)) {
    const k = `${room.meta?.createdAt}:${g.qIndex}`;
    if (lockRequested !== k) { lockRequested = k; A.lockAnswers(g.qIndex); }
  }
  // Host ohne Moderator: Ablauf automatisch weiterschalten
  if (isHost && room.meta?.status === "running" && g) {
    const qi = g.qIndex, base = `${room.meta?.createdAt}:${qi}`;
    const q = room.questions?.[qi];
    if (g.phase === "locked") doOnce(`show:${base}`, () => A.showAnswers(qi), 400);
    if (g.phase === "shown" && q && !isOpenType(q)) doOnce(`reveal:${base}`, () => A.reveal(qi), 2200);
    // Einzelspiel: Schätz- und Freitextantwort automatisch bewerten
    if (g.phase === "shown" && q && isOpenType(q) && isSoloFree(room)) {
      const a = answerOf(room, qi, s.uid);
      if (a && !judgmentOf(room, qi, s.uid)) doOnce(`auto:${base}`, () => A.autoJudgeAnswer(qi, s.uid, autoJudge(q, a.value)));
    }
    if (g.phase === "shown" && q && isOpenType(q) && unjudgedCount(room) === 0) doOnce(`reveal:${base}`, () => A.reveal(qi), 800);
    if (g.phase === "revealed" && Object.keys(nextOf(room, qi)).length && !waitingForNext(room, qi).length) doOnce(`next:${base}`, () => A.nextQuestion(qi), 300);
  }
  // Lobby der Steuernden: Packliste einmal laden
  if (key === "modLobby") subscribePackData();
  if (key === "modLobby" && s.local.packs === null && !packsLoading) {
    packsLoading = true;
    loadPackList().then(list => setLocal({ packs: list })).catch(e => setLocal({ packs: { error: e.message } })).finally(() => { packsLoading = false; });
  }
}
let packsLoading = false;

// ── Timer-Anzeige: läuft zwischen den Renders, Moderator sperrt bei Ablauf ──
let expiredFor = null;
function tick() {
  const s = store, room = s.room, g = room?.game;
  const el = $("tnum");
  if (el && g && room?.meta?.status === "running") {
    const sec = room.settings?.timerSec || 30;
    const left = timerLeft(room, serverNow());
    if (left != null) {
      el.textContent = Math.ceil(left) + "s";
      const chip = $("tchip");
      if (chip) chip.className = "timer-chip" + (g.phase !== "answering" ? " off" : g.timer?.running ? (left <= 5 ? " urgent" : left <= 10 ? " warn" : "") : "");
      const bar = $("tbar");
      if (bar) { bar.style.width = Math.max(0, left / sec * 100) + "%"; bar.style.background = left <= 5 ? "var(--c5)" : left <= 10 ? "var(--c4)" : "var(--c2)"; }
      const steers = meIn(room, s.uid)?.role === "moderator" || (isFree(room) && hostUid(room) === s.uid);
      if (left <= 0 && g.phase === "answering" && g.timer?.running && steers) {
        const k = `${room.meta?.createdAt}:${g.qIndex}:${g.timer.startAt}`;
        if (expiredFor !== k) { expiredFor = k; A.timerExpired(g.qIndex); vibrate(200); }
      }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── Eingaben ───────────────────────────────────────────────────────────────
function parseEstimate(raw) {
  let t = raw.trim().replace(/\s/g, "");
  if (/,/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return t !== "" && isFinite(n) ? n : raw.trim();
}

// Fakten-Seite: hereinschieben bzw. hinausschieben, dann zurück zum vorherigen Bildschirm
function toggleFact() {
  const qi = store.room?.game?.qIndex;
  if (store.local.factOpen !== qi) return setLocal({ factOpen: qi, factAnim: true });
  const page = $("fact-page");
  if (page) { page.classList.remove("in"); page.classList.add("out"); setTimeout(() => setLocal({ factOpen: null }), 180); }
  else setLocal({ factOpen: null });
}

// Name merken, bevor die Seite für einen anderen Raum neu lädt
function saveName() { const n = String(store.local.name || "").trim(); if (n) try { localStorage.setItem("quiz.v4.name", n); } catch {} }

const handlers = {
  clearError: () => setLocal({ error: null }),
  createRoom: (el) => A.createRoom(store.local.name, el.dataset.arg || "moderated"),
  openRoom: (el) => { saveName(); goRoom(el.dataset.arg); },
  joinCode: () => { const c = normCode(store.local.code); if (c.length < 3) return setLocal({ error: "Bitte einen Raumcode eingeben" }); saveName(); goRoom(c); },
  newRoom: (el) => {
    if (!String(store.local.name || "").trim()) return setLocal({ error: "Bitte zuerst deinen Namen eingeben" });
    saveName();
    let code = newRoomCode();
    while (store.rooms?.[code]) code = newRoomCode();
    goRoom(code, el.dataset.arg);
  },
  overview: () => goOverview(),
  useJoker: () => A.useJoker(),
  override: (el) => A.overrideJudgment(store.room.game.qIndex, store.uid, el.dataset.val === "1"),
  markNext: (el) => { el.disabled = true; A.markNext(store.room.game.qIndex); },
  joinPlayer: () => A.joinAsPlayer(store.local.name),
  joinModerator: () => A.joinAsModerator(store.local.name),
  watch: () => A.joinAsSpectator(store.local.name),
  takeover: () => {
    if (!moderatorAway(store.room, serverNow())) return setLocal({ error: "Der Moderator ist wieder online." });
    if (confirm("Moderation übernehmen? Der bisherige Moderator wird zum Zuschauer.")) A.joinAsModerator(store.local.name, true);
  },
  leave: () => A.leaveRoom(),
  dismiss: () => setLocal({ dismissed: `${store.room?.meta?.createdAt}:${store.room?.meta?.finishedAt}` }),
  toggleReady: () => A.setReady(!store.room?.players?.[store.uid]?.ready),
  choosePack: (el) => { const p = (store.local.packs || []).find(x => x.id === el.dataset.arg); if (p) A.choosePack(p); },
  openPicker: () => setLocal({ picker: { q: "", filter: "all", showHidden: false } }),
  closePicker: () => setLocal({ picker: null }),
  pickPack: (el) => { const p = (store.local.packs || []).find(x => x.id === el.dataset.arg); if (p) { A.choosePack(p); setLocal({ picker: null }); } },
  packFilter: (el) => setLocal({ picker: { ...store.local.picker, filter: el.dataset.arg } }),
  toggleHidden: () => setLocal({ picker: { ...store.local.picker, showHidden: !store.local.picker?.showHidden } }),
  packFav: (el) => A.setPackPref(el.dataset.arg, "fav", !store.packPrefs?.[el.dataset.arg]?.fav),
  packHide: (el) => A.setPackPref(el.dataset.arg, "hidden", !store.packPrefs?.[el.dataset.arg]?.hidden),
  startGame: (el) => { el.disabled = true; A.startGame(); },
  closeRoom: () => { if (confirm("Partie für alle beenden und den Raum leeren?")) A.resetRoom(); },
  newRound: () => A.newRound(),
  timerMode: (el) => A.setTimer(el.dataset.arg),
  timerSec: (el) => A.setTimer(null, Number(el.dataset.arg)),
  timerStart: () => A.timerStart(),
  timerPause: () => A.timerPause(),
  timerReset: () => A.timerReset(),
  joker: (el) => A.grantJoker(el.dataset.arg),
  bonus: (el) => A.setBonus(el.dataset.arg || null),
  pick: (el) => { const qi = store.room?.game?.qIndex; setLocal({ pending: { qi, value: Number(el.dataset.arg) } }); vibrate(15); },
  commitPick: async (el) => {
    const p = store.local.pending; if (!p) return;
    el.disabled = true;
    await A.submitAnswer(p.qi, p.value);
  },
  commitDraft: async (el) => {
    const d = store.local.draft; if (!d || !String(d.value).trim()) return;
    const q = store.room?.questions?.[d.qi];
    el.disabled = true;
    await A.submitAnswer(d.qi, q?.type === "estimate" ? parseEstimate(d.value) : String(d.value).trim());
  },
  showAnswers: () => A.showAnswers(store.room.game.qIndex),
  reveal: () => A.reveal(store.room.game.qIndex),
  next: () => A.nextQuestion(store.room.game.qIndex),
  judge: (el) => A.judge(store.room.game.qIndex, el.dataset.arg, el.dataset.val === "1"),
  resetAll: () => { setLocal({ menu: false }); if (confirm(`Raum „${ROOM_ID}“ komplett zurücksetzen? Eine laufende Partie geht verloren.`)) A.resetRoom(); },
  theme: () => {
    const d = document.documentElement, light = d.getAttribute("data-theme") === "light";
    d.setAttribute("data-theme", light ? "dark" : "light");
    setBarStyle(!light);
    lastHtml = ""; rerender();
    try { localStorage.setItem("quiz.v4.theme", light ? "dark" : "light"); } catch {}
  },
  fullscreen: () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); },
  debug: () => { setLocal({ menu: false }); DBG.toggle(); },
  menu: () => setLocal({ menu: true }),
  closeMenu: (el, e) => { if (e.target === el) setLocal({ menu: false }); },
  toggleFact: () => toggleFact(),
  invite: async () => {
    const url = `https://erhas93.github.io/Quiz-app/?room=${ROOM_ID}`;
    const r = await share(`Komm in die Quiz-Lobby von ${store.local.name || "uns"} – Raumcode ${ROOM_ID}`, url);
    if (r === "kopiert") setLocal({ error: "Link kopiert – einfach verschicken." });
  }
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const h = handlers[el.dataset.act];
  if (h) { DBG.log("Klick", el.dataset.act); h(el, e); }
});

document.addEventListener("input", e => {
  const el = e.target;
  const kind = el.dataset?.input;
  if (kind === "name") store.local.name = el.value;
  if (kind === "code") store.local.code = el.value;
  if (kind === "packSearch") setLocal({ picker: { ...store.local.picker, q: el.value } });
  if (kind === "draft") {
    store.local.draft = { qi: store.room?.game?.qIndex, value: el.value };
    const b = document.querySelector('[data-act="commitDraft"]');
    if (b) b.disabled = !el.value.trim();
  }
});
document.addEventListener("change", e => {
  if (e.target.dataset?.commit === "setName") A.setName(e.target.value);
  if (e.target.dataset?.commit === "timerSec") { const v = Number(e.target.value); if (v >= 5 && v <= 300) A.setTimer(null, v); }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
  const map = { draft: "commitDraft", code: "joinCode" };
  const act = map[e.target.dataset.input];
  if (act) document.querySelector(`[data-act="${act}"]`)?.click();
  else e.target.blur();
});

// ── Start ──────────────────────────────────────────────────────────────────
(async function main() {
  try { const t = localStorage.getItem("quiz.v4.theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch {}
  onRender(render);
  rerender();
  const id = await initIdentity();
  store.uid = id.uid;
  store.authMode = id.mode;
  DBG.log("Start", { version: VERSION, room: ROOM_ID, auth: id.mode });
  subscribe();
  watchVisibility(store, rerender);
  // Android-App: Zurück-Taste schließt erst Overlays, sonst App minimieren; Rückkehr frischt auf
  initNative({
    onBack: () => {
      if (store.local.menu) { setLocal({ menu: false }); return true; }
      if (store.local.picker) { setLocal({ picker: null }); return true; }
      if (store.local.factOpen != null && store.local.factOpen === store.room?.game?.qIndex) { toggleFact(); return true; }
      const dbg = $("dbg-panel"); if (dbg && dbg.style.display !== "none") { DBG.toggle(); return true; }
      if (store.local.error) { setLocal({ error: null }); return true; }
      // In einem Raum, aber nicht mitten in einer eigenen Partie: zurück zur Übersicht
      const me = meIn(store.room, store.uid);
      if (ROOM_ID && !(me && store.room?.meta?.status === "running")) { goOverview(); return true; }
      return false;
    },
    onResume: () => { DBG.log("App wieder im Vordergrund"); rerender(); }
  });
  if (isApp()) { DBG.log("läuft in der Android-App"); setBarStyle(document.documentElement.getAttribute("data-theme") === "light"); }
  // Zeitabhängige Anzeigen (offline seit …, abgebrochen) regelmäßig auffrischen
  setInterval(rerender, 15000);
})();
