// Gerätefunktionen: in der Android-App über Capacitor-Plugins, im Browser mit Web-APIs
const cap = () => window.Capacitor?.isNativePlatform?.() ? window.Capacitor : null;

export function vibrate(pattern = 60) {
  try {
    const H = cap()?.Plugins?.Haptics;
    if (H) { H.vibrate({ duration: Array.isArray(pattern) ? pattern[0] : pattern }); return; }
    navigator.vibrate?.(pattern);
  } catch {}
}

// Bildschirm während der Partie wach halten
let lock = null, want = false;
export async function keepAwake(on) {
  want = on;
  try {
    const K = cap()?.Plugins?.KeepAwake;
    if (K) { on ? await K.keepAwake() : await K.allowSleep(); return; }
    if (on && !lock && "wakeLock" in navigator) {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && want) keepAwake(true);
});
