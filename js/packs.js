// Fragenpakete aus dem Repo laden (packs/ liegt neben js/, unabhängig von der Seiten-URL)
import { DBG } from "./debug.js";

const BASE = new URL("../packs/", import.meta.url).href;
const cache = {};

// Katalog (von der GitHub Action erzeugt); Fallback: index.json + jedes Pack einzeln
export async function loadPackList() {
  try {
    const r = await fetch(`${BASE}catalog.json?_=${Date.now()}`);
    if (r.ok) {
      const c = await r.json();
      if (Array.isArray(c.packs) && c.packs.length) {
        DBG.log("Katalog geladen", c.packs.length);
        return c.packs;
      }
    }
  } catch {}
  const r = await fetch(`${BASE}index.json?_=${Date.now()}`);
  if (!r.ok) throw new Error("packs/index.json nicht gefunden");
  const ids = await r.json();
  const list = await Promise.all(ids.map(async id => {
    try {
      const p = await loadPack(id);
      return { id, name: p.name, emoji: p.emoji || "", count: p.questions.length, updated: null };
    } catch { return null; }
  }));
  const ok = list.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "de"));
  DBG.log("Packs einzeln geladen", ok.length);
  return ok;
}

export async function loadPack(id) {
  if (cache[id]) return cache[id];
  const r = await fetch(`${BASE}${encodeURIComponent(id)}.json?_=${Date.now()}`);
  if (!r.ok) throw new Error(`Pack ${id} nicht gefunden`);
  const p = await r.json();
  if (!Array.isArray(p.questions) || !p.questions.length) throw new Error(`Pack ${id} ist leer`);
  cache[id] = p;
  return p;
}
