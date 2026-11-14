// Fragenpakete aus dem Repo laden (packs/ liegt neben js/, unabhängig von der Seiten-URL)
import { DBG } from "./debug.js";

const BASE = new URL("../packs/", import.meta.url).href;
const cache = {};

export async function loadPackList() {
  const r = await fetch(`${BASE}index.json?_=${Date.now()}`);
  if (!r.ok) throw new Error("packs/index.json nicht gefunden");
  const ids = await r.json();
  const list = await Promise.all(ids.map(async id => {
    try {
      const p = await loadPack(id);
      return { id, name: p.name, emoji: p.emoji || "", count: p.questions.length };
    } catch { return null; }
  }));
  const ok = list.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "de"));
  DBG.log("Packs geladen", ok.length);
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
