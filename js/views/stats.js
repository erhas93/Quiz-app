// Statistik-Seite: Trefferquoten aus /questionStats (pro Stufe, pro Pack, pro Frage) und Rohdaten zum Weitergeben
import { esc } from "../model.js";
import { topBar } from "./common.js";

const TARGET = { 1: [80, 95], 2: [50, 80], 3: [25, 50] };
const DIFF = { 1: "leicht", 2: "mittel", 3: "schwer" };
const pct = (a, n) => (n ? Math.round(a / n * 100) : null);
const sec = (ms, n) => (n ? `${Math.round(ms / n / 1000)} s` : "–");

function sum(list) {
  const t = { n: 0, right: 0, fav: 0, favRight: 0, nofav: 0, nofavRight: 0, unclear: 0 };
  for (const e of list) for (const k of Object.keys(t)) t[k] += Number(e?.[k]) || 0;
  return t;
}
// Ampel gegenüber dem Zielbereich der Stufe
function rate(p, diff) {
  if (p == null) return "";
  const t = TARGET[diff];
  if (!t) return "";
  return p > t[1] ? "hi" : p < t[0] ? "lo" : "ok";
}

// Details je Frage: gewählte Antworten (MC), häufige falsche Eingaben (Freitext), Schätzfehler
function detail(e) {
  const parts = [];
  if (e.pick) parts.push("Gewählt: " + ["a0", "a1", "a2", "a3"].map((k, i) => `${"ABCD"[i]} ${e.pick[k] || 0}`).join(" · "));
  if (e.wrong) parts.push("Falsch: " + Object.entries(e.wrong).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `„${esc(k)}“${v > 1 ? ` ${v}×` : ""}`).join(", "));
  if (e.yerr) { const y = e.yerr, n = k => y[k] || 0; parts.push(`Jahreszahlen: ${n("z")}× genau · ${n("m1") + n("p1")}× ±2 J. · ${n("m2") + n("p2")}× ±10 J. · ${n("m3") + n("p3")}× weiter daneben`); }
  if (e.bet) parts.push(`🎯 Einsatz: ${e.bet}× gesetzt, ${e.betRight || 0}× richtig`);
  if (e.err) { const lo = (e.err.m3 || 0) + (e.err.m2 || 0) + (e.err.m1 || 0), hi = (e.err.p1 || 0) + (e.err.p2 || 0) + (e.err.p3 || 0); parts.push(`Schätzungen: ${lo}× zu niedrig · ${e.err.z || 0}× fast genau · ${hi}× zu hoch`); }
  return parts.length ? `<div class="sq-x">${parts.join("<br>")}</div>` : "";
}

export function statsView(s) {
  const st = s.local.stats || {};
  const head = topBar("Statistik", "Trefferquoten aus allen Partien (ohne Testräume)", { back: "closeStats", connected: s.connected });
  if (st.loading) return `<div class="screen">${head}<div class="body center"><div class="spin"></div></div></div>`;
  if (st.error) return `<div class="screen">${head}<div class="body"><div class="notice warn">Statistik nicht ladbar: ${esc(st.error)}</div></div></div>`;
  const data = st.data || {};
  const packs = Object.entries(data).filter(([, v]) => v && typeof v === "object");
  if (!packs.length) return `<div class="screen">${head}<div class="body"><div class="muted">Noch keine Daten. Nach jeder aufgelösten Frage wird mitgezählt.</div></div></div>`;
  const all = packs.flatMap(([, qs]) => Object.values(qs));

  // 1. Pro Stufe (nur Fragen mit Stufe, also Duell-Packs)
  const byDiff = [1, 2, 3].map(d => ({ d, ...sum(all.filter(e => e.diff === d)) })).filter(x => x.n);
  const diffRows = byDiff.map(x => {
    const p = pct(x.right, x.n);
    return `<tr><td>${DIFF[x.d]}</td><td class="r ${rate(p, x.d)}">${p} %</td><td class="muted">${TARGET[x.d][0]}–${TARGET[x.d][1]} %</td><td>${x.n}</td></tr>`;
  }).join("");

  // 2. Lieblingsthema
  const t = sum(all);
  const favLine = t.fav || t.nofav
    ? `<div class="stat-fav"><span>★ Lieblingsthema: <b>${pct(t.favRight, t.fav) ?? "–"} %</b> <span class="muted">(${t.fav})</span></span><span>sonst: <b>${pct(t.nofavRight, t.nofav) ?? "–"} %</b> <span class="muted">(${t.nofav})</span></span></div>` : "";

  // 3. Pro Pack, aufklappbar mit allen Fragen
  const open = st.open || null;
  const packCards = packs.map(([id, qs]) => {
    const list = Object.values(qs).filter(e => e && typeof e === "object");
    const x = sum(list);
    const p = pct(x.right, x.n);
    const isOpen = open === id;
    const rows = isOpen ? list.slice().sort((a, b) => (a.diff || 0) - (b.diff || 0) || (pct(a.right, a.n) ?? 0) - (pct(b.right, b.n) ?? 0)).map(e => {
      const q = pct(e.right, e.n);
      const fbTxt = o => o ? Object.entries(o).filter(([, v]) => v > 0).map(([k, v]) => `${{ easy: "zu leicht", ok: "passt", hard: "zu schwer", bad: "Fehler" }[k] || k} ${v}`).join(", ") : "";
      const fb = [fbTxt(e.fb) && `Moderator: ${fbTxt(e.fb)}`, fbTxt(e.pfb) && `Spieler: ${fbTxt(e.pfb)}`].filter(Boolean).join(" · ");
      return `<div class="sq"><div class="sq-q">${esc(e.q || "?")}</div><div class="sq-m">${e.diff ? `<span class="sq-d d${e.diff}">${DIFF[e.diff]}</span>` : ""}${e.cat ? `<span class="muted">${esc(e.cat)}</span>` : ""}<span class="r ${rate(q, e.diff)}">${e.right || 0}/${e.n || 0}</span>${e.unclear ? `<span class="sq-u">❓ ${e.unclear}× unverständlich</span>` : ""}${fb ? `<span class="muted">· ${esc(fb)}</span>` : ""}</div>${detail(e)}</div>`;
    }).join("") : "";
    return `<div class="card stat-pack"><button class="stat-head" data-act="statsOpen" data-arg="${esc(id)}"><span class="pack-txt"><span class="pack-name">${esc(st.names?.[id] || id)}</span><span class="pack-sub">${list.length} Fragen · ${x.n} Antworten${x.unclear ? ` · ❓ ${x.unclear}` : ""}</span></span><span class="r">${p} %</span></button>${rows}</div>`;
  }).join("");

  return `<div class="screen">${head}
    <div class="body">
      ${byDiff.length ? `<div class="card"><span class="label">Pro Stufe (Duell-Packs)</span>
        <table class="ttable stat-t"><thead><tr><th>Stufe</th><th>richtig</th><th>Ziel</th><th>Antw.</th></tr></thead><tbody>${diffRows}</tbody></table>${favLine}</div>` : favLine ? `<div class="card">${favLine}</div>` : ""}
      <div class="card"><span class="label">Gesamt</span><div class="muted small">${all.length} Fragen · ${t.n} Antworten · ${pct(t.right, t.n)} % richtig. Wenige Antworten pro Frage sind nur ein erster Eindruck.</div></div>
      ${packCards}
      <div class="spacer"></div>
    </div>
    <div class="actions"><button class="btn btn-ghost" data-act="statsCopy">Rohdaten kopieren / teilen</button></div>
  </div>`;
}
