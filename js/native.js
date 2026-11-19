// Gerätefunktionen: in der Android-App über die Capacitor-Brücke, im Browser mit Web-APIs.
// Die App lädt diese Seite direkt von GitHub Pages; die Brücke (window.Capacitor) wird von der
// Android-Hülle eingeschleust. Deshalb rufen wir die Plugins direkt über nativePromise auf.
const cap = () => (window.Capacitor?.isNativePlatform?.() && window.Capacitor.nativePromise) ? window.Capacitor : null;
export const isApp = () => !!cap();

function call(plugin, method, options = {}) {
  const c = cap();
  if (!c) return Promise.reject(new Error("keine App"));
  return c.nativePromise(plugin, method, options);
}

export function vibrate(pattern = 60) {
  const ms = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
  if (cap()) { call("Haptics", "vibrate", { duration: ms }).catch(() => {}); return; }
  try { navigator.vibrate?.(pattern); } catch {}
}

// Bildschirm während der Partie wach halten
let lock = null, want = false, appAwake = null;
export async function keepAwake(on) {
  want = on;
  if (cap()) {
    if (appAwake === on) return;
    appAwake = on;
    call("KeepAwake", on ? "keepAwake" : "allowSleep").catch(() => { appAwake = null; });
    return;
  }
  try {
    if (on && !lock && "wakeLock" in navigator) {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && want && !cap()) keepAwake(true);
});

// Teilen-Menü (App) bzw. Web Share / Zwischenablage (Browser)
export async function share(text, url) {
  if (cap()) return call("Share", "share", { title: "15 Fragen", text, url, dialogTitle: "Einladen" }).catch(() => {});
  if (navigator.share) return navigator.share({ title: "15 Fragen", text, url }).catch(() => {});
  try { await navigator.clipboard.writeText(`${text} ${url}`); return "kopiert"; } catch {}
}

// Android-Zurück-Taste und Rückkehr in die App
export function initNative({ onBack, onResume }) {
  const c = cap();
  if (!c?.addListener) return;
  c.addListener("App", "backButton", () => { if (!onBack()) call("App", "minimizeApp").catch(() => {}); });
  c.addListener("App", "resume", () => onResume());
  document.documentElement.classList.add("in-app");
}

// Statusleisten-Symbole passend zum Design: helles Design → dunkle Symbole
export function setBarStyle(light) {
  if (cap()) call("SystemBars", "setStyle", { style: light ? "LIGHT" : "DARK" }).catch(() => {});
}
