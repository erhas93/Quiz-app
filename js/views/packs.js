// Pack-Auswahl als eigene Ansicht: Suche, Filter, Favoriten, Ausblenden, "gespielt am"
import { esc } from "../model.js";
import { topBar } from "./common.js";

// Spielstatistik je Pack aus /history
export function playStats(history) {
  const out = {};
  for (const h of Object.values(history || {})) {
    if (!h?.packId) continue;
    const o = out[h.packId] || (out[h.packId] = { count: 0, last: 0 });
    o.count++;
    o.last = Math.max(o.last, h.at || 0);
  }
  return out;
}

const fmtDate = t => t ? new Date(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";

export function packLine(p, stats) {
  const st = stats[p.id];
  return st ? `${st.count}× gespielt · zuletzt ${fmtDate(st.last)}` : "noch nie gespielt";
}

export function packPickerView(s) {
  const packs = s.local.packs;
  const pk = s.local.picker || {};
  const prefs = s.packPrefs || {};
  const stats = playStats(s.history);
  const sel = s.room?.settings?.packId;
  const q = (pk.q || "").trim().toLowerCase();
  const filter = pk.filter || "all";

  const game = s.room?.settings?.game || "classic";
  const duel = game === "duel";
  const want = duel ? "duel" : game === "hints" ? "hints" : null;
  let list = Array.isArray(packs) ? packs.filter(p => (p.mode || null) === want) : [];
  const total = list.length;
  const hiddenCount = list.filter(p => prefs[p.id]?.hidden).length;
  if (!pk.showHidden) list = list.filter(p => !prefs[p.id]?.hidden || p.id === sel);
  if (filter === "fav") list = list.filter(p => prefs[p.id]?.fav);
  if (filter === "new") list = list.filter(p => !stats[p.id]);
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.id.includes(q));
  // Favoriten zuerst, dann nie gespielte, dann länger nicht gespielte
  list.sort((a, b) => (!!prefs[b.id]?.fav - !!prefs[a.id]?.fav)
    || ((stats[a.id]?.last || 0) - (stats[b.id]?.last || 0))
    || a.name.localeCompare(b.name, "de"));

  const tabs = [["all", "Alle"], ["fav", "★ Favoriten"], ["new", "Neu"]];
  const items = packs === null ? `<div class="spin"></div>`
    : packs?.error ? `<div class="muted">${esc(packs.error)}</div>`
    : !list.length ? `<div class="muted small" style="text-align:center;padding:16px">Keine Packs gefunden.</div>`
    : list.map(p => {
      const pr = prefs[p.id] || {};
      return `<div class="pk${p.id === sel ? " on" : ""}${pr.hidden ? " hid" : ""}">
        <button class="pack-row" data-act="pickPack" data-arg="${esc(p.id)}">
          <span class="pack-ico">${esc(p.emoji || "❓")}</span>
          <span class="pack-txt"><span class="pack-name">${esc(p.name)}</span>
            <span class="pack-sub">${p.count} Fragen · ${packLine(p, stats)}</span></span>
        </button>
        <button class="pk-icon${pr.fav ? " fav" : ""}" data-act="packFav" data-arg="${esc(p.id)}" aria-label="${pr.fav ? "Favorit entfernen" : "Als Favorit merken"}">${pr.fav ? "★" : "☆"}</button>
        <button class="pk-icon" data-act="packHide" data-arg="${esc(p.id)}" aria-label="${pr.hidden ? "Einblenden" : "Ausblenden"}">${pr.hidden ? "↺" : "✕"}</button>
      </div>`;
    }).join("");

  return `<div class="screen">
    ${topBar(duel ? "Duell-Pack" : want === "hints" ? "Hinweis-Pack" : "Fragenpaket", Array.isArray(packs) ? `${total} Packs` : "", { back: "closePicker", connected: s.connected })}
    <div class="search">
      <input class="inp" id="in-packsearch" data-input="packSearch" placeholder="Suchen …" aria-label="Packs durchsuchen" value="${esc(pk.q || "")}" autocomplete="off">
      <div class="seg3">${tabs.map(([k, l]) => `<button class="${k === filter ? "on" : ""}" data-act="packFilter" data-arg="${k}">${l}</button>`).join("")}</div>
    </div>
    <div class="body">${items}
      ${hiddenCount ? `<button class="btn btn-text" data-act="toggleHidden">${pk.showHidden ? "Ausgeblendete verbergen" : `${hiddenCount} ausgeblendete anzeigen`}</button>` : ""}
    </div>
  </div>`;
}
