#!/usr/bin/env node
// Prüft alle Fragenpakete in packs/ und erzeugt den Katalog.
//
//   node tools/check-packs.mjs          nur prüfen
//   node tools/check-packs.mjs --write  prüfen und packs/index.json + packs/catalog.json schreiben
//   node tools/check-packs.mjs --json   Ergebnis als JSON ausgeben
//
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
    } else if (type === "open") {
      if (typeof q.answer !== "string" || !q.answer.trim()) errors.push(`${n}: Freitextfrage braucht "answer" als Text`);
    }
    const key = norm(q.q);
    if (key) { if (seen.has(key)) errors.push(`${n}: gleicher Fragetext wie Frage ${seen.get(key) + 1}`); else seen.set(key, i); }
  });

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
  return { id, pack: p, errors, warnings, types, positions: pos, count: qs.length, keys: [...seen.keys()] };
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

function main() {
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
        id: r.id, name: r.pack.name, emoji: r.pack.emoji || "", count: r.count,
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
