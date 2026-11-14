// Online-Status: nur wer im Raum eingetragen ist, meldet Präsenz.
// Bei jedem (Wieder-)Verbinden wird sie neu gesetzt, beim Trennen setzt der Server sie auf offline.
import { roomRef, set, onDisconnect, serverTimestamp } from "./firebase.js";
import { DBG } from "./debug.js";

let registeredFor = null; // "uid@roomCreatedAt" der aktuellen Verbindung

export function syncPresence(store) {
  const { uid, room, connected } = store;
  const member = uid && room?.players?.[uid];
  if (!connected) { registeredFor = null; return; }
  if (!member) { registeredFor = null; return; }
  const key = `${uid}@${room?.meta?.createdAt || ""}`;
  const online = room?.presence?.[uid]?.online;
  if (registeredFor === key && online) return;
  registeredFor = key;
  const pRef = roomRef(`presence/${uid}`);
  onDisconnect(pRef).set({ online: false, lastSeen: serverTimestamp() })
    .then(() => set(pRef, { online: true, lastSeen: serverTimestamp() }))
    .then(() => DBG.log("Präsenz gesetzt"))
    .catch(e => { registeredFor = null; DBG.log("Präsenz-Fehler", e.message); });
}

// Beim Zurückkehren in die App (Tab/App im Vordergrund) Präsenz erneut prüfen
export function watchVisibility(store, rerender) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { registeredFor = null; rerender(); }
  });
}
