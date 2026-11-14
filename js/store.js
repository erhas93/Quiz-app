// Zentraler Zustand: Raum aus Firebase + lokale, noch nicht abgeschickte Eingaben.
// Jede Änderung löst genau ein render() aus.
import { db, ref, onValue, roomRef } from "./firebase.js";
import { DBG, diff } from "./debug.js";

export const store = {
  uid: null,
  authMode: null,
  room: null,          // kompletter Raumzustand aus Firebase (oder null)
  loaded: false,       // erster Snapshot angekommen
  connected: true,
  packPrefs: {},       // Favoriten/ausgeblendet je Pack (/packPrefs)
  history: {},         // Kurzfassungen beendeter Partien (/history)
  local: {
    pending: null,     // MC-Auswahl vor dem Einloggen: { qi, value }
    draft: null,       // Text-/Zahleneingabe vor dem Einloggen: { qi, value }
    name: (() => { try { return localStorage.getItem("quiz.v4.name") || ""; } catch { return ""; } })(),
    packs: null,       // geladene Pack-Liste (nur Moderator-Lobby)
    picker: null,      // Pack-Auswahl offen: { q, filter, showHidden }
    error: null
  }
};

let renderFn = () => {};
let scheduled = false;
export function onRender(fn) { renderFn = fn; }
export function rerender() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; try { renderFn(store); } catch (e) { DBG.log("render-Fehler", String(e.stack || e)); console.error(e); } });
}

export function setLocal(patch) { Object.assign(store.local, patch); rerender(); }

export function subscribe() {
  onValue(ref(db, ".info/connected"), s => {
    store.connected = !!s.val();
    DBG.log("verbunden", store.connected);
    rerender();
  });
  onValue(roomRef(), snap => {
    const next = snap.val();
    const d = diff(store.room || {}, next || {});
    if (Object.keys(d).length) DBG.log("Zustand", d);
    store.room = next;
    store.loaded = true;
    cleanupLocal();
    rerender();
  }, err => {
    DBG.log("Lesefehler", err.message);
    store.local.error = "Keine Leserechte für die Datenbank: " + err.message;
    store.loaded = true;
    rerender();
  });
}

// Lokale Auswahl nur verwerfen, wenn die Frage gewechselt hat oder die eigene Antwort gespeichert ist.
// Änderungen anderer Spieler berühren sie nie.
function cleanupLocal() {
  const g = store.room?.game;
  const qi = g?.qIndex ?? -1;
  const mine = store.room?.answers?.[qi]?.[store.uid];
  for (const k of ["pending", "draft"]) {
    const v = store.local[k];
    if (v && (v.qi !== qi || mine || g?.phase !== "answering" || store.room?.meta?.status !== "running")) store.local[k] = null;
  }
}

// Pack-Favoriten und Spielhistorie: nur abonnieren, wenn die Pack-Auswahl gebraucht wird
let packDataSubscribed = false;
export function subscribePackData() {
  if (packDataSubscribed) return;
  packDataSubscribed = true;
  onValue(ref(db, "packPrefs"), s => { store.packPrefs = s.val() || {}; rerender(); }, e => DBG.log("packPrefs-Fehler", e.message));
  onValue(ref(db, "history"), s => { store.history = s.val() || {}; rerender(); }, e => DBG.log("history-Fehler", e.message));
}
