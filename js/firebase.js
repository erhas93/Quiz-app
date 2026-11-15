// Firebase-Anbindung: Init, Identität (anonyme Anmeldung mit Fallback), Pfade, Serverzeit
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, get, remove, runTransaction,
  onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { DBG } from "./debug.js";

const app = initializeApp({
  apiKey: "AIzaSyCXDcsJocNsiOFY4QUWp8diFRGiYl-BoK8",
  authDomain: "quiz-app-82c51.firebaseapp.com",
  projectId: "quiz-app-82c51",
  storageBucket: "quiz-app-82c51.firebasestorage.app",
  messagingSenderId: "490424508080",
  appId: "1:490424508080:web:f93e1e14ae5c5b16076575",
  databaseURL: "https://quiz-app-82c51-default-rtdb.firebaseio.com"
});

export const db = getDatabase(app);
export { ref, onValue, set, update, get, remove, runTransaction, onDisconnect, serverTimestamp };

// Raum aus der Adresse (?room=CODE); ohne Raum zeigt die App die Übersicht aller offenen Räume
const params = new URLSearchParams(location.search);
export const ROOM_ID = (params.get("room") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || null;
export const CREATE_MODE = ["moderated", "players"].includes(params.get("create")) ? params.get("create") : null;

// Raumcode: 4 Großbuchstaben ohne leicht verwechselbare (I, O)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const newRoomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
export const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);

// Navigation zwischen Räumen über die Adresse (funktioniert gleich im Browser und in der Android-App)
function go(extra) {
  const q = new URLSearchParams();
  if (params.get("test")) q.set("test", params.get("test"));
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  location.href = location.pathname + (s ? "?" + s : "");
}
export const goRoom = (code, create = null) => go({ room: normCode(code), create });
export const goOverview = () => go({});
export function clearCreateParam() {
  if (!CREATE_MODE) return;
  const q = new URLSearchParams(location.search); q.delete("create");
  history.replaceState(null, "", location.pathname + "?" + q.toString());
}

export const roomPath = (sub = "") => `rooms/${ROOM_ID}${sub ? "/" + sub : ""}`;
export const roomRef = (sub = "") => ref(db, roomPath(sub));

// Serverzeit
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
export const serverNow = () => Date.now() + offset;

// Identität: anonyme Firebase-Anmeldung; falls nicht aktiviert, lokale ID als Fallback.
// ?test=x erzeugt eine eigene Identität pro Tab (zum Testen mehrerer Spieler auf einem Gerät).
const TEST_SUFFIX = (params.get("test") || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
export async function initIdentity() {
  const id = await baseIdentity();
  if (TEST_SUFFIX) { id.uid = `${id.uid}_t${TEST_SUFFIX}`; id.mode += "+test"; }
  return id;
}
async function baseIdentity() {
  const auth = getAuth(app);
  try {
    const user = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout bei der Anmeldung")), 8000);
      const unsub = onAuthStateChanged(auth, u => {
        if (u) { clearTimeout(t); unsub(); resolve(u); }
      });
      signInAnonymously(auth).catch(e => { clearTimeout(t); unsub(); reject(e); });
    });
    DBG.log("auth: anonym angemeldet", { uid: user.uid.slice(0, 8) });
    return { uid: user.uid, mode: "anon" };
  } catch (e) {
    let uid = null;
    try { uid = localStorage.getItem("quiz.v4.uid"); } catch {}
    if (!uid) {
      uid = "l_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36));
      try { localStorage.setItem("quiz.v4.uid", uid); } catch {}
    }
    DBG.log("auth: Fallback auf lokale ID", { error: e.code || e.message, uid: uid.slice(0, 10) });
    return { uid, mode: "local", error: e.code || e.message };
  }
}
