// Animationen, die das komplette Neuzeichnen überstehen.
// Elemente tragen eine Animationsklasse (an-…) und data-an="<schlüssel>". Beim ersten Auftauchen eines Schlüssels
// startet die Animation; wird das HTML danach neu gesetzt, läuft sie über eine negative Verzögerung an derselben
// Stelle weiter, statt von vorn zu beginnen. Ist sie vorbei, bekommt das Element an-done (keine Animation mehr).
const seen = new Map();
const counts = new Map();
const bars = new Map();

// Attribut-Schnipsel für ein animiertes Element (delay in ms, z. B. für gestaffeltes Einblenden)
export const an = (key, delay = 0) => ` data-an="${key}"${delay ? ` data-and="${delay}"` : ""}`;

// Schlüssel-Präfix je Partie und Frage, damit eine neue Runde im selben Raum wieder animiert
export const animKey = (room, qi = room?.game?.qIndex ?? 0) => `${room?.meta?.createdAt || 0}.${room?.game?.startedAt || 0}.${qi}`;

const LIFE = 2200;   // länger dauert keine Animation (inkl. Verzögerung)

export function runAnims(root) {
  if (!root) return;
  const now = performance.now();
  root.querySelectorAll("[data-an]").forEach(el => {
    if (el.dataset.anr) return;            // schon eingerichtet (HTML wurde nicht neu gesetzt)
    el.dataset.anr = "1";
    const k = el.dataset.an;
    let t = seen.get(k);
    if (t == null) { t = now; seen.set(k, t); }
    const d = +(el.dataset.and || 0), e = now - t;
    if (e > LIFE + d) el.classList.add("an-done");
    else if (e > 0 || d) el.style.animationDelay = `${Math.round(d - e)}ms`;
  });
  // Punktzahlen hochzählen, wenn sie sich geändert haben
  root.querySelectorAll("[data-cnt]").forEach(el => {
    const k = el.dataset.cnt, v = +el.textContent || 0;
    const prev = counts.get(k);
    counts.set(k, v);
    if (prev == null || prev >= v || el.dataset.cntr) return;
    el.dataset.cntr = "1";
    const t0 = performance.now(), dur = 650;
    el.textContent = prev;
    const step = ts => {
      const p = Math.min(1, (ts - t0) / dur);
      if (!el.isConnected) return;
      el.textContent = Math.round(prev + (v - prev) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // Balken (Punkteleisten) vom alten auf den neuen Stand wachsen lassen
  root.querySelectorAll("[data-bar]").forEach(el => {
    const k = el.dataset.bar, w = el.style.width;
    const prev = bars.get(k);
    bars.set(k, w);
    if (prev == null || prev === w || el.dataset.barr) return;
    el.dataset.barr = "1";
    el.style.transition = "none";
    el.style.width = prev;
    void el.offsetWidth;
    el.style.transition = "";
    el.style.width = w;
  });
  if (seen.size > 800) for (const [k, t] of seen) if (now - t > 120000) seen.delete(k);
}

// Kurzer Hash für Schlüssel aus Text (z. B. Hinweiszeile: neue Zeile → kurz einblenden)
export const hk = str => { let x = 0; for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
