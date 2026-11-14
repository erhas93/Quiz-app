// Einstieg: Identität, Abo auf den Raum, Rendern, Ereignisse
import { initIdentity, ROOM_ID, serverNow } from "./firebase.js";
import { store, subscribe, onRender, rerender, setLocal, subscribePackData } from "./store.js";
import { syncPresence, watchVisibility } from "./presence.js";
import { DBG } from "./debug.js";
import * as A from "./actions.js";
import { loadPackList } from "./packs.js";
import { meIn, allAnswered, resultFor, esc, isStale, moderatorAway, timerLeft } from "./model.js";
import { vibrate, keepAwake, share, initNative, isApp, setBarStyle } from "./native.js";
import { homeView } from "./views/home.js";
import { modLobbyView, playerLobbyView, spectatorLobbyView } from "./views/lobby.js";
import { playerGameView } from "./views/player.js";
import { modGameView } from "./views/moderator.js";
import { resultsView } from "./views/results.js";
import { packPickerView } from "./views/packs.js";

export const VERSION = "v4.2.1";
const $ = id => document.getElementById(id);

// ── Welche Ansicht? Nur aus dem Zustand abgeleitet ─────────────────────────
function pickView(s) {
  if (!s.loaded) return { key: "loading", html: `<div class="page center"><div class="spin"></div></div>` };
  const room = s.room;
  const status = room?.meta?.status || "none";
  const me = meIn(room, s.uid);
  const dismissed = s.local.dismissed && s.local.dismissed === `${room?.meta?.createdAt}:${room?.meta?.finishedAt}`;
  if (!me || status === "none" || status === "abandoned" || (status === "finished" && dismissed)) return { key: "home", html: homeView(s, serverNow()) };
  if (status === "lobby") {
    if (me.role === "moderator") return s.local.picker ? { key: "modLobby", html: packPickerView(s) } : { key: "modLobby", html: modLobbyView(s, me) };
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
  const scroller = document.querySelector("#app .g-body, #app .page");
  const scrollTop = scroller?.scrollTop || 0;

  const v = pickView(s);
  const html = banners(s) + v.html + (v.key === "plGame" ? overlay(s) : "");
  // Unverändertes HTML nicht neu setzen: sonst gehen Taps verloren, die genau während eines Updates passieren
  if (html === lastHtml) { $("conn-dot").className = "dot " + (s.connected ? "on" : "off"); afterRender(s, v.key); return; }
  lastHtml = html;
  $("app").innerHTML = html;

  if (v.key === lastView) { const sc = document.querySelector("#app .g-body, #app .page"); if (sc) sc.scrollTop = scrollTop; }
  if (v.key !== lastView) DBG.log("Ansicht", v.key);
  lastView = v.key;
  if (focus) { const el = $(focus.id); if (el) { el.value = focus.value; el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch {} } }

  $("conn-dot").className = "dot " + (s.connected ? "on" : "off");
  afterRender(s, v.key);
}

function banners(s) {
  let h = "";
  if (s.loaded && !s.connected) h += `<div class="banner warn">Verbindung getrennt – verbinde neu …</div>`;
  if (s.local.error) h += `<div class="banner err"><span>${esc(s.local.error)}</span><button data-act="clearError">OK</button></div>`;
  return h;
}

// Kurze Einblendung „Richtig/Falsch“ beim Auflösen, einmal pro Frage
let overlayShownFor = null, overlayTimer = null, overlayVisible = false;
function overlay(s) {
  if (!overlayVisible || s.room?.game?.phase !== "revealed") return "";
  const qi = s.room?.game?.qIndex;
  const ok = resultFor(s.room, qi)?.points?.[s.uid];
  return `<div class="overlay"><div class="overlay-big" style="color:${ok ? "var(--c2)" : "var(--c5)"}">${ok ? "Richtig!" : "Leider falsch"}</div></div>`;
}

let lockRequested = null, abandonChecked = null;
function afterRender(s, key) {
  syncPresence(s);
  const room = s.room;
  const g = room?.game;
  keepAwake(key === "modGame" || key === "plGame");

  // Verlassene Partie (alle seit 10 min offline) als abgebrochen markieren – einmal pro Raum
  if (isStale(room, serverNow())) {
    const k = `${room.meta?.createdAt}`;
    if (abandonChecked !== k) { abandonChecked = k; A.markAbandoned(); }
  }
  if (key === "plGame" && g?.phase === "revealed" && meIn(room, s.uid)?.role === "player") {
    const k = `${room.meta?.createdAt}:${g.qIndex}`;
    if (overlayShownFor !== k && resultFor(room, g.qIndex)) {
      overlayShownFor = k; overlayVisible = true;
      vibrate(resultFor(room, g.qIndex)?.points?.[s.uid] ? 80 : [60, 80, 60]);
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => { overlayVisible = false; rerender(); }, 2500);
      rerender();
    }
  }
  if (key === "modGame" || key === "modLobby" || key === "results") {
    const me = meIn(room, s.uid);
    if (me?.role === "moderator") A.syncIndex(room);
  }
  // Moderator: automatisch sperren, sobald alle eingeloggt haben
  if (key === "modGame" && g?.phase === "answering" && allAnswered(room)) {
    const k = `${room.meta?.createdAt}:${g.qIndex}`;
    if (lockRequested !== k) { lockRequested = k; A.lockAnswers(g.qIndex); }
  }
  // Moderator-Lobby: Packliste einmal laden
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
      el.className = "t-num" + (g.phase === "answering" && g.timer?.running ? (left <= 5 ? " urgent" : left <= 10 ? " warn" : "") : "");
      const bar = $("tbar");
      if (bar) { bar.style.width = Math.max(0, left / sec * 100) + "%"; bar.style.background = left <= 5 ? "var(--c5)" : left <= 10 ? "var(--c4)" : "var(--c2)"; }
      if (left <= 0 && g.phase === "answering" && g.timer?.running && meIn(room, s.uid)?.role === "moderator") {
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

const handlers = {
  clearError: () => setLocal({ error: null }),
  createRoom: () => A.createRoom(store.local.name),
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
  resetAll: () => { if (confirm(`Raum „${ROOM_ID}“ komplett zurücksetzen? Eine laufende Partie geht verloren.`)) A.resetRoom(); },
  theme: () => {
    const d = document.documentElement, light = d.getAttribute("data-theme") === "light";
    d.setAttribute("data-theme", light ? "dark" : "light");
    setBarStyle(!light);
    try { localStorage.setItem("quiz.v4.theme", light ? "dark" : "light"); } catch {}
  },
  fullscreen: () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); },
  debug: () => DBG.toggle(),
  invite: async () => {
    const url = "https://erhas93.github.io/Quiz-app/" + (ROOM_ID !== "main" ? `?room=${ROOM_ID}` : "");
    const r = await share(`Komm in die Quiz-Lobby von ${store.local.name || "uns"}!`, url);
    if (r === "kopiert") setLocal({ error: "Link kopiert – einfach verschicken." });
  }
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const h = handlers[el.dataset.act];
  if (h) { DBG.log("Klick", el.dataset.act); h(el); }
});

document.addEventListener("input", e => {
  const el = e.target;
  const kind = el.dataset?.input;
  if (kind === "name") store.local.name = el.value;
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
  const map = { draft: "commitDraft" };
  const act = map[e.target.dataset.input];
  if (act) document.querySelector(`[data-act="${act}"]`)?.click();
  else e.target.blur();
});

// ── Start ──────────────────────────────────────────────────────────────────
(async function main() {
  try { const t = localStorage.getItem("quiz.v4.theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch {}
  $("vtag").textContent = `${VERSION} · Raum ${ROOM_ID}`;
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
      if (store.local.picker) { setLocal({ picker: null }); return true; }
      const dbg = $("dbg-panel"); if (dbg && dbg.style.display !== "none") { DBG.toggle(); return true; }
      if (store.local.error) { setLocal({ error: null }); return true; }
      return false;
    },
    onResume: () => { DBG.log("App wieder im Vordergrund"); rerender(); }
  });
  if (isApp()) { DBG.log("läuft in der Android-App"); setBarStyle(document.documentElement.getAttribute("data-theme") === "light"); }
  // Zeitabhängige Anzeigen (offline seit …, abgebrochen) regelmäßig auffrischen
  setInterval(rerender, 15000);
})();
