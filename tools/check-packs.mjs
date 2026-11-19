#!/usr/bin/env node
// Prüft alle Fragenpakete in packs/ und erzeugt den Katalog.
//
//   node tools/check-packs.mjs          nur prüfen
//   node tools/check-packs.mjs --write  prüfen und packs/index.json + packs/catalog.json schreiben
//   node tools/check-packs.mjs --json   Ergebnis als JSON ausgeben
//
// Hinweis-Packs ("mode": "hints"): je Frage "hints" mit genau 3 Hinweisen (schwer → leicht), keiner nennt die Lösung.
// Duell-Packs ("mode": "duel"): 15 Fragen, 5 Kategorien ("cat") mit je einer Frage pro Stufe ("diff" 1–3).
// Fehler (blockieren): kaputtes JSON, fehlende Pflichtfelder, ungültige Typen/Antworten.
// Warnungen (blockieren nicht): Regeln aus den Pack-Richtlinien (Anzahl, Typen-Mix,
// Verteilung der richtigen Antworten, auffällig lange richtige Antwort, Duplikate).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR = path.join(ROOT, "packs");
const GENERATED = new Set(["index.json", "catalog.json"]);
const args = new Set(process.argv.slice(2));

const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();

function gitDate(file) {
  try { return execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { cwd: ROOT, encoding: "utf8" }).trim() || null; }
  catch { return null; }
}

export function checkPack(id, raw) {
  const errors = [], warnings = [];
  let p;
  try { p = JSON.parse(raw); } catch (e) { return { id, errors: [`Kein gültiges JSON: ${e.message}`], warnings }; }
  if (!/^[a-z0-9-]+$/.test(id)) errors.push(`Dateiname "${id}" darf nur a-z, 0-9 und - enthalten`);
  if (typeof p.name !== "string" || !p.name.trim()) errors.push("Feld \"name\" fehlt");
  if (p.emoji != null && typeof p.emoji !== "string") errors.push("Feld \"emoji\" muss Text sein");
  if (!Array.isArray(p.questions) || !p.questions.length) { errors.push("Keine Fragen (\"questions\")"); return { id, pack: p, errors, warnings }; }

  const qs = p.questions;
  const types = { mc: 0, estimate: 0, open: 0 };
  const pos = [0, 0, 0, 0];
  const seen = new Map();
  qs.forEach((q, i) => {
    const n = `Frage ${i + 1}`;
    if (!q || typeof q !== "object") { errors.push(`${n}: kein Objekt`); return; }
    if (typeof q.q !== "string" || !q.q.trim()) errors.push(`${n}: Fragetext "q" fehlt`);
    const type = q.type || "mc";
    if (!(type in types)) { errors.push(`${n}: unbekannter Typ "${type}" (erlaubt: mc, estimate, open)`); return; }
    types[type]++;
    if (typeof q.fact !== "string" || !q.fact.trim()) errors.push(`${n}: Hintergrund "fact" fehlt`);
    if (type === "mc") {
      if (!Array.isArray(q.a) || q.a.length !== 4 || q.a.some(x => typeof x !== "string" || !x.trim())) errors.push(`${n}: MC braucht genau 4 Antworten in "a"`);
      else if (new Set(q.a.map(norm)).size !== 4) errors.push(`${n}: doppelte Antwortoptionen`);
      if (!Number.isInteger(q.r) || q.r < 0 || q.r > 3) errors.push(`${n}: "r" muss 0–3 sein`);
      else {
        pos[q.r]++;
        if (Array.isArray(q.a) && q.a.length === 4) {
          const len = q.a.map(x => String(x).length);
          const others = len.filter((_, k) => k !== q.r);
          const avg = others.reduce((a, b) => a + b, 0) / others.length;
          if (len[q.r] > avg * 1.6 && len[q.r] - avg > 15) warnings.push(`${n}: richtige Antwort deutlich länger als die anderen`);
        }
      }
    } else if (type === "estimate") {
      if (typeof q.answer !== "number" || !isFinite(q.answer)) errors.push(`${n}: Schätzfrage braucht eine Zahl in "answer"`);
      if (q.tol != null && (typeof q.tol !== "number" || q.tol < 0)) errors.push(`${n}: "tol" (Toleranz fürs Einzelspiel) muss eine Zahl ≥ 0 sein`);
    } else if (type === "open") {
      if (typeof q.answer !== "string" || !q.answer.trim()) errors.push(`${n}: Freitextfrage braucht "answer" als Text`);
      if (q.alt != null && (!Array.isArray(q.alt) || q.alt.some(x => typeof x !== "string" || !x.trim()))) errors.push(`${n}: "alt" (weitere richtige Antworten) muss eine Liste von Texten sein`);
    }
    const key = norm(q.q + (Array.isArray(q.hints) ? " " + q.hints[0] : ""));   // Hinweis-Fragen: Frage + 1. Hinweis
    if (key) { if (seen.has(key)) errors.push(`${n}: gleicher Fragetext wie Frage ${seen.get(key) + 1}`); else seen.set(key, i); }
  });

  // Duell-Packs: genau 5 Kategorien mit je einer Frage pro Stufe (diff 1–3)
  let cats = null;
  if (p.mode != null && p.mode !== "duel" && p.mode !== "hints") errors.push(`Unbekannter Modus "${p.mode}" (erlaubt: duel, hints)`);
  // Hinweise: Pflicht in Hinweis-Packs; klassische Packs sind hinweis-tauglich, wenn ALLE Fragen welche haben
  const withHints = qs.filter(q => q && Array.isArray(q.hints)).length;
  const hintsReady = p.mode === "hints" || (!p.mode && qs.length > 0 && withHints === qs.length);
  if (!p.mode && withHints && withHints < qs.length) warnings.push(`Hinweis-Modus: erst ${withHints} von ${qs.length} Fragen haben Hinweise – Pack noch nicht hinweis-tauglich`);
  if (p.mode === "hints" || withHints) qs.forEach((q, i) => {
    if (p.mode !== "hints" && !Array.isArray(q?.hints)) return;
    if (!q || typeof q !== "object") return;
    if (!Array.isArray(q.hints) || q.hints.length !== 3 || q.hints.some(h => typeof h !== "string" || !h.trim()))
      return errors.push(`Frage ${i + 1}: Hinweis-Frage braucht genau 3 Hinweise ("hints")`);
    const sols = [q.type === "estimate" || q.type === "open" ? q.answer : q.a?.[q.r], ...(Array.isArray(q.alt) ? q.alt : [])]
      .map(x => String(x ?? "").toLowerCase().trim()).filter(x => x.length >= 3);
    q.hints.forEach((h, k) => { const t = h.toLowerCase(); for (const sol of sols) if (t.includes(sol)) errors.push(`Frage ${i + 1}, Hinweis ${k + 1}: verrät die Lösung „${sol}“`); });
  });
  if (p.mode === "duel") {
    const byCat = new Map();
    qs.forEach((q, i) => {
      if (!q || typeof q !== "object") return;
      if (typeof q.cat !== "string" || !q.cat.trim()) errors.push(`Frage ${i + 1}: Duell-Frage braucht eine Kategorie "cat"`);
      if (![1, 2, 3].includes(q.diff)) errors.push(`Frage ${i + 1}: "diff" muss 1, 2 oder 3 sein`);
      if (typeof q.cat === "string" && q.cat.trim()) { const k = q.cat.trim(); if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(q.diff); }
    });
    if (qs.length !== 15) errors.push(`Duell-Pack braucht genau 15 Fragen (hat ${qs.length})`);
    if (byCat.size !== 5) errors.push(`Duell-Pack braucht genau 5 Kategorien (hat ${byCat.size}: ${[...byCat.keys()].join(", ")})`);
    for (const [c, ds] of byCat) if (ds.slice().sort().join() !== "1,2,3") errors.push(`Kategorie "${c}": braucht genau eine Frage je Stufe 1, 2, 3 (hat ${ds.join(", ")})`);
    cats = [...byCat.keys()];
  } else qs.forEach((q, i) => { if (q?.diff != null && ![1, 2, 3].includes(q.diff)) errors.push(`Frage ${i + 1}: "diff" muss 1, 2 oder 3 sein`); });

  // Richtlinien → Warnungen
  const isTest = /test|demo/.test(id);
  const want = isTest ? 5 : 15;
  if (qs.length !== want) warnings.push(`${qs.length} Fragen (Richtwert ${want})`);
  if (types.mc <= types.estimate + types.open) warnings.push(`MC (${types.mc}) sollte mehr sein als Schätzen + Freitext (${types.estimate + types.open})`);
  if (types.open < 1 || types.open > 2) warnings.push(`${types.open} Freitextfragen (Richtwert 1–2)`);
  if (types.mc >= 8) {
    const max = Math.ceil(types.mc * 0.4);
    const L = ["A", "B", "C", "D"];
    pos.forEach((c, k) => { if (c > max) warnings.push(`Richtige Antwort ${c}× auf ${L[k]} (max. ${max} bei ${types.mc} MC-Fragen)`); });
    const unused = pos.map((c, k) => c === 0 ? L[k] : null).filter(Boolean);
    if (unused.length) warnings.push(`Richtige Antwort nie auf ${unused.join(", ")}`);
  }
  return { id, pack: p, errors, warnings, types, positions: pos, count: qs.length, keys: [...seen.keys()], mode: p.mode || null, cats, hintsReady };
}

export function checkAll() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json") && !GENERATED.has(f)).sort();
  const results = files.map(f => {
    const raw = fs.readFileSync(path.join(DIR, f), "utf8");
    const r = checkPack(f.slice(0, -5), raw);
    r.file = f;
    r.hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 10);
    return r;
  });
  // Duplikate über Packs hinweg (Warnung)
  const owner = new Map();
  for (const r of results) for (const k of r.keys || []) {
    if (owner.has(k)) r.warnings.push(`Frage doppelt mit Pack "${owner.get(k)}": ${k.slice(0, 60)}…`);
    else owner.set(k, r.id);
  }
  return results;
}

// Ähnliche Fragen über alle Packs finden (für neue Packs): node tools/check-packs.mjs --similar <packId>
// Treffer: viele gemeinsame Inhaltswörter (Jaccard ≥ 0,45) oder gleiche Lösung mit gemeinsamem Inhaltswort.
const STOP = new Set("der die das den dem des ein eine einer eines einem einen und oder aber mit von vom zu zum zur im in ins an am auf aus bei für über unter nach vor wie was wer wo wann welche welcher welches welchem welchen wieviel viele viel ist sind war waren wird wurde wurden hat hatte haben gilt als auch nicht noch nur sich es er sie man heute laut etwa rund ungefähr jahr jahre jahren meter kilometer gibt heißt hieß nennt genannt bekannt erste ersten welchem".split(" "));
const words = t => new Set(String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ß ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
const solution = q => String(q.type === "estimate" || q.type === "open" ? q.answer : q.a?.[q.r] ?? "").toLowerCase().trim();
function similar(id) {
  const all = checkAll().filter(r => r.pack?.questions);
  const me = all.find(r => r.id === id);
  if (!me) { console.error(`Pack „${id}“ nicht gefunden`); process.exit(1); }
  const hits = [];
  for (const [i, q] of me.pack.questions.entries()) {
    const text = x => [x.q, ...(Array.isArray(x.hints) ? x.hints : [])].join(" ");
    const wq = words(text(q));
    for (const r of all) for (const [j, o] of r.pack.questions.entries()) {
      if (r.id === id && j <= i) continue;
      const wo = words(text(o));
      const common = [...wq].filter(w => wo.has(w));
      const jac = common.length / (new Set([...wq, ...wo]).size || 1);
      const sameSol = solution(q) && solution(q) === solution(o);
      if (jac >= 0.45 || (sameSol && common.length)) hits.push({ jac, a: `${id} #${i + 1}: ${text(q).slice(0, 140)}`, b: `${r.id} #${j + 1}: ${text(o).slice(0, 140)}`, why: sameSol ? "gleiche Lösung" : `${Math.round(jac * 100)} % gleiche Wörter` });
    }
  }
  hits.sort((x, y) => y.jac - x.jac);
  for (const h of hits) console.log(`! ${h.why}\n    ${h.a}\n    ${h.b}`);
  console.log(`\n${hits.length} ähnliche Fragen gefunden`);
}

function main() {
  const si = process.argv.indexOf("--similar");
  if (si > 0) return similar(process.argv[si + 1]);
  const results = checkAll();
  const errs = results.filter(r => r.errors.length);
  if (args.has("--json")) {
    console.log(JSON.stringify(results.map(({ pack, keys, ...r }) => r), null, 2));
  } else {
    for (const r of results) {
      const mark = r.errors.length ? "✗" : r.warnings.length ? "!" : "✓";
      console.log(`${mark} ${r.id}${r.count ? ` (${r.count} Fragen)` : ""}`);
      for (const e of r.errors) console.log(`    FEHLER  ${e}`);
      for (const w of r.warnings) console.log(`    Hinweis ${w}`);
    }
    console.log(`\n${results.length} Packs · ${errs.length} mit Fehlern · ${results.filter(r => r.warnings.length).length} mit Hinweisen`);
  }
  if (errs.length) { console.error("\nPrüfung fehlgeschlagen – Katalog wird nicht geschrieben."); process.exit(1); }

  if (args.has("--write")) {
    const ok = results.slice().sort((a, b) => a.pack.name.localeCompare(b.pack.name, "de"));
    const index = ok.map(r => r.id);
    const catalog = {
      generated: new Date().toISOString(),
      packs: ok.map(r => ({
        id: r.id, name: r.pack.name, emoji: r.pack.emoji || "", count: r.count, ...(r.mode ? { mode: r.mode, cats: r.cats } : {}), ...(r.hintsReady && !r.mode ? { hints: true } : {}),
        types: r.types, hash: r.hash, updated: gitDate(path.join("packs", r.file)), warnings: r.warnings.length
      }))
    };
    const write = (f, data) => {
      const file = path.join(DIR, f), txt = JSON.stringify(data, null, 2) + "\n";
      const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      // catalog.json nicht nur wegen des Zeitstempels neu schreiben
      const strip = s => s.replace(/"generated": "[^"]*",?\n/, "");
      if (strip(old) !== strip(txt)) { fs.writeFileSync(file, txt); console.log(`geschrieben: packs/${f}`); }
    };
    write("index.json", index);
    write("catalog.json", catalog);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
