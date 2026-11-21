// Kategorie-Duell: Spielbrett (Vorstellen, Lieblingskategorien, Auslosen, Wählen) und Bausteine fürs Duell
import { esc, activePlayers, duelBoard, duelOf, pickOf, isStartQ, resultFor, favCatsOf, favDone, isFree, hostUid, moderatorOf,
  DUEL_TURNS, PICK_SEC, DRAW_MS, DIFF_LABEL, pointsOf, playOrder, spectatorsOf, duelRule } from "../model.js";
import { menuBtn, ICON } from "./common.js";
import { ROOM_ID } from "../firebase.js";

// Spieler A/B bekommen feste Farben (Sitzreihenfolge)
export const sideOf = (room, uid) => { const i = activePlayers(room).findIndex(p => p.uid === uid); return i === 0 ? "pa" : i === 1 ? "pb" : ""; };
const nameOf = (room, uid) => room?.players?.[uid]?.name || "?";
const short = n => esc(String(n || "").slice(0, 5));

// Zelle: frei → Punktzahl; gespielt → Farbe dessen, der die Punkte bekam
function cellHtml(room, qi, { clickable, hl }) {
  const q = room.questions?.[qi];
  if (!q) return `<span class="cell void"></span>`;
  // während der Auslos-Animation das ausgeloste Feld noch nicht verraten
  const played = (isStartQ(room, qi) && room.game?.phase !== "drawing") || pickOf(room, qi);
  const r = resultFor(room, qi);
  const pts = pointsOf(q);
  let cls = "cell", inner = `<span class="cell-pts">${pts}</span>`;
  if (played && r) {
    const winners = Object.entries(r.points || {}).filter(([, v]) => v > 0).map(([u]) => u);
    if (!winners.length) { cls += " none"; inner = `<span class="cell-pts">–</span>`; }
    else {
      cls += winners.length > 1 ? " both" : " " + sideOf(room, winners[0]);
      const tag = isStartQ(room, qi) ? "Start" : r.stolen ? "klaut" : "✓";
      const who = winners.length > 1 ? "beide" : short(nameOf(room, winners[0]));
      inner = `<span class="cell-who">${who}</span><span class="cell-tag">${tag}</span>`;
    }
  } else if (played) { cls += " cur"; inner = `<span class="cell-pts">${pts}</span><span class="cell-tag">läuft</span>`; }
  if (hl === qi) cls += " hl final";
  const can = clickable && !played;
  return `<button class="${cls}" id="cell-${qi}" ${can ? `data-act="pickCell" data-arg="${qi}"` : "disabled"} aria-label="${esc(q.cat || "")} ${DIFF_LABEL[q.diff] || ""}, ${pts} Punkte">${inner}</button>`;
}

// Das Brett: Kategorien als Zeilen, Stufen als Spalten (Hochformat)
export function boardHtml(room, uid, { clickable = false, favEdit = false, showFavs = null, hl = null } = {}) {
  const rows = duelBoard(room);
  const myFavs = uid ? favCatsOf(room, uid) : [];
  const head = `<div class="brow bhead"><span class="bcat"></span>${[1, 2, 3].map(d => `<span class="bh">${DIFF_LABEL[d]}</span>`).join("")}</div>`;
  return `<div class="board" id="board">${head}${rows.map((r, ci) => {
    const fav = myFavs.includes(ci);
    let cat;
    if (favEdit) cat = `<button class="bcat edit${fav ? " fav" : ""}" data-act="favCat" data-arg="${ci}" aria-pressed="${fav}"><span class="bstar">${fav ? "★" : "☆"}</span><span class="bname">${esc(r.cat)}</span></button>`;
    else {
      const stars = showFavs ? showFavs.filter(u => favCatsOf(room, u).includes(ci)).map(u => `<span class="bfav ${sideOf(room, u)}">★</span>`).join("") : (fav ? `<span class="bfav">★</span>` : "");
      cat = `<span class="bcat"><span class="bname">${esc(r.cat)}</span>${stars}</span>`;
    }
    // Beim Auswählen der Lieblingskategorien schaltet die ganze Zeile (Name und Felder) um –
    // viele tippen intuitiv auf die Felder statt auf den Namen
    const cells = favEdit
      ? r.cells.map(qi => qi == null ? `<span class="cell void"></span>` : `<button class="cell fp${fav ? " on" : ""}" data-act="favCat" data-arg="${ci}" aria-pressed="${fav}"><span class="cell-pts">${pointsOf(room.questions[qi])}</span></button>`).join("")
      : r.cells.map(qi => qi == null ? `<span class="cell void"></span>` : cellHtml(room, qi, { clickable, hl })).join("");
    return `<div class="brow${favEdit && fav ? " favrow" : ""}">${cat}${cells}</div>`;
  }).join("")}</div>`;
}

// Kopf: Titel, Zug, Punktestand beider Spieler
export function duelTop(s, roleLabel = "") {
  const room = s.room, d = duelOf(room);
  const turn = d.turn || 0;
  const sub = d.startQ == null ? "Kategorien vorstellen" : room.game?.phase === "drawing" ? "Startfrage wird ausgelost" : `Zug ${Math.min(room.game?.phase === "picked" ? turn : turn + 1, DUEL_TURNS)} von ${DUEL_TURNS}`;
  const specN = spectatorsOf(room).length;
  return `<div class="top"><div class="top-main"><div class="top-title sm">Kategorie-Duell${specN ? ` <span class="muted small" style="font-weight:500">· ${ICON.eye(14)} ${specN}</span>` : ""}</div><div class="top-sub">Raum ${esc(ROOM_ID)} · ${sub}</div></div>
    ${roleLabel}${menuBtn(s.connected)}</div>
    <div class="chips">${activePlayers(room).map(p => `<div class="chip ${sideOf(room, p.uid)}${p.uid === s.uid ? " me" : ""}${d.picker === p.uid && room.game?.phase === "board" && d.startQ != null ? " turn" : ""}">
      <span class="dot ${p.online ? "on" : "off"}"></span><span class="chip-name">${esc(p.name)}</span><span class="chip-pts">${scoreOfDuel(room, p.uid)}</span></div>`).join("")}</div>
    ${raceBar(room)}`;
}

// Füllstand: Punkte jedes Spielers von 30 und was noch auf dem Brett liegt. Eine feste Siegmarke gibt es nicht,
// weil bei der Startfrage beide punkten können – entschieden ist es, sobald der Vorsprung größer ist als der Rest.
export function raceBar(room) {
  const ps = activePlayers(room).slice(0, 2);
  if (ps.length !== 2) return "";
  const total = (room.questions || []).reduce((a, q) => a + (q ? pointsOf(q) : 0), 0) || 30;
  const left = (room.questions || []).reduce((a, q, qi) => a + (q && !resultFor(room, qi) ? pointsOf(q) : 0), 0);
  const sc = ps.map(p => scoreOfDuel(room, p.uid));
  const lead = Math.abs(sc[0] - sc[1]);
  const leader = sc[0] > sc[1] ? ps[0] : sc[1] > sc[0] ? ps[1] : null;
  let txt = `Noch ${left} von ${total} Punkten auf dem Brett${leader ? ` · ${esc(leader.name)} führt mit ${lead}` : ""}`;
  if (leader && lead > left) txt = `<b>${esc(leader.name)}</b> ist nicht mehr einzuholen`;
  else if (!left) txt = leader ? `${esc(leader.name)} gewinnt` : "Unentschieden";
  const bar = (p, i) => `<div class="race-row ${sideOf(room, p.uid)}"><span class="race-track"><i data-bar="dr.${p.uid}" style="width:${Math.min(100, sc[i] / total * 100)}%"></i></span></div>`;
  return `<div class="race">${ps.map(bar).join("")}<div class="race-txt">${txt}</div></div>`;
}
const scoreOfDuel = (room, uid) => Object.values(room.results || {}).reduce((a, r) => a + (r?.points?.[uid] || 0), 0);

// Brett-Phasen: board (Vorstellen bzw. Wählen) und drawing (Auslosen)
export function duelBoardView(s, me) {
  const room = s.room, g = room.game || {}, d = duelOf(room);
  const players = activePlayers(room);
  const isMod = me.role === "moderator";
  const spectator = me.role === "spectator";
  const free = isFree(room);
  const iAmHost = free && hostUid(room) === s.uid && me.role === "player";
  const intro = g.phase === "board" && d.startQ == null;
  const drawing = g.phase === "drawing";
  const picking = g.phase === "board" && d.startQ != null;
  const picked = g.phase === "picked";
  const pickerName = esc(nameOf(room, d.picker));
  const myTurn = picking && d.picker === s.uid;
  const mod = moderatorOf(room);

  let body = "", note = "", noteCls = "", actions = "";
  if (intro) {
    const edit = me.role === "player" && !favDone(room, s.uid);
    const waiting = players.filter(p => !favDone(room, p.uid));
    body += edit ? `<div class="notice gold">Tippe auf die Zeilen deiner Lieblingskategorien (★) – keine, eine oder mehrere. Die anderen sehen das erst am Ende.</div>` : "";
    body += boardHtml(room, me.role === "player" ? s.uid : null, { favEdit: edit });
    const status = players.map(p => `${esc(p.name)} ${favDone(room, p.uid) ? "✓" : "…"}`).join(" · ");
    const allDone = !waiting.filter(p => p.online).length;
    if (isMod || iAmHost) {
      note = allDone ? "Alle haben ihre Lieblingsthemen angegeben" : `Lieblingsthemen: ${status}`;
      noteCls = allDone ? "ok" : "";
      if (edit) actions = `<button class="btn btn-primary" data-act="confirmFavs">Lieblingsthemen bestätigen</button>`;
      else actions = `<button class="btn btn-gold" data-act="duelDraw" ${allDone ? "" : "disabled"}>Startfrage auslosen</button>`
        + (iAmHost ? `<button class="btn btn-text" data-act="unconfirmFavs">Lieblingsthemen ändern</button>` : "");
    } else if (edit) {
      note = free ? `Danach lost ${esc(nameOf(room, hostUid(room)))} die Startfrage aus` : `${mod ? esc(mod.name) : "Der Moderator"} stellt die Kategorien vor`;
      actions = `<button class="btn btn-primary" data-act="confirmFavs">Lieblingsthemen bestätigen</button>`;
    } else if (me.role === "player") {
      note = waiting.length ? `Bestätigt ✓ · warte auf ${waiting.map(p => esc(p.name)).join(", ")}` : `Gleich wird die Startfrage ausgelost …`;
      noteCls = "ok";
      actions = `<button class="btn btn-text" data-act="unconfirmFavs">Lieblingsthemen ändern</button>`;
    } else note = "Die Kategorien werden vorgestellt …";
  } else if (drawing) {
    body += boardHtml(room, null, {});
    note = "Startfrage wird ausgelost …";
  } else if (picking) {
    const clickable = myTurn || isMod;
    body += boardHtml(room, null, { clickable });
    const timer = room.settings?.pickTimer ? ` · <span id="pnum">${PICK_SEC}</span> s` : "";
    if (myTurn) { note = `Du wählst – tippe auf ein freies Feld${timer}`; noteCls = "ok"; }
    else if (isMod) note = `${pickerName} wählt${timer} · du kannst auch für ${pickerName} tippen`;
    else note = `${pickerName} wählt …${timer}`;
    const pending = room.players?.[d.picker]?.pick;
    if (pending && pending.turn === (d.turn || 0) && !isMod) note = `${pickerName} hat gewählt …`;
  }
  if (picked) {
    const q = room.questions?.[g.qIndex];
    const by = pickOf(room, g.qIndex)?.by;
    body += boardHtml(room, null, { hl: g.qIndex });
    note = `${by === s.uid ? "Du hast" : `${esc(nameOf(room, by))} hat`} gewählt: ${esc(q?.cat || "")} · ${DIFF_LABEL[q?.diff] || ""} (${pointsOf(q)} P)`;
    noteCls = "ok";
    if (isMod) actions = `<button class="btn btn-gold" data-act="releaseQ">Frage freigeben</button>`;
    else if (!free) note += ` · ${mod ? esc(mod.name) : "der Moderator"} gibt die Frage frei`;
  }
  if (spectator) actions = `<button class="btn btn-text" data-act="leave">Zuschauen beenden</button>`;

  return `<div class="screen duel">
    ${duelTop(s, isMod ? `<span class="role">Moderator</span>` : spectator ? `<span class="role spec">Zuschauer</span>` : "")}
    <div class="body">${body}<div class="spacer"></div></div>
    <div class="actions"><div class="foot-note ${noteCls}" id="pnote">${note}</div>${actions}</div>
  </div>`;
}

// Zeile über der Frage: worum gespielt wird
export function duelStakeLine(room, qi, uid) {
  const q = room.questions?.[qi];
  const pts = pointsOf(q);
  if (isStartQ(room, qi)) return `<div class="stake">Startfrage · jeder Richtige bekommt ${pts} ${pts === 1 ? "Punkt" : "Punkte"} · wer gewinnt, wählt zuerst</div>`;
  const by = pickOf(room, qi)?.by;
  if (duelRule(room) === "all") return `<div class="stake ${sideOf(room, by)}">${by === uid ? "Deine Wahl" : `${esc(nameOf(room, by))}s Wahl`} · jeder Richtige bekommt ${pts} ${pts === 1 ? "Punkt" : "Punkte"}</div>`;
  const opp = activePlayers(room).find(p => p.uid !== by);
  const who = by === uid ? "Du spielst" : `${esc(nameOf(room, by))} spielt`;
  const steal = opp ? (opp.uid === uid ? "bei Fehler kannst du klauen" : `bei Fehler klaut ${esc(opp.name)}`) : "";
  return `<div class="stake ${sideOf(room, by)}">${who} um ${pts} ${pts === 1 ? "Punkt" : "Punkte"}${steal ? ` · ${steal}` : ""}</div>`;
}

// Ergebnis einer Duell-Frage in Worten: { kind, big, sub } aus Sicht von uid (oder neutral)
export function duelOutcome(room, qi, uid) {
  const r = resultFor(room, qi);
  const q = room.questions?.[qi];
  const pts = pointsOf(q);
  if (!r) return null;
  const mine = r.points?.[uid] || 0;
  if (isStartQ(room, qi)) {
    const w = r.startWinner;
    const sub = w ? (w === uid ? "Du wählst zuerst" : `${esc(nameOf(room, w))} wählt zuerst`) : "";
    const anyRight = Object.values(r.points || {}).some(v => v > 0);
    if (uid && room.players?.[uid]?.role === "player") return mine ? { kind: "ok", big: `Richtig! +${pts}`, sub } : { kind: "no", big: "Leider falsch", sub: sub + (anyRight ? "" : " (ausgelost)") };
    return { kind: "neutral", big: anyRight ? "Startfrage aufgelöst" : "Beide falsch – ausgelost", sub };
  }
  const by = r.by, opp = activePlayers(room).find(p => p.uid !== by)?.uid;
  const byName = esc(nameOf(room, by)), oppName = esc(nameOf(room, opp));
  if (r.rule === "all") {
    const won = activePlayers(room).filter(p => r.points?.[p.uid]).map(p => p.uid);
    const others = won.filter(u => u !== uid).map(u => esc(nameOf(room, u)));
    const sub = others.length ? `${others.join(" & ")} ${others.length > 1 ? "punkten" : "punktet"} auch` : "";
    if (uid && room.players?.[uid]?.role === "player") return mine ? { kind: "ok", big: `Richtig! +${pts}`, sub } : { kind: "no", big: "Leider falsch", sub: others.length ? `${others.join(" & ")} holt ${pts}` : "" };
    return { kind: "neutral", big: won.length ? `${won.map(u => esc(nameOf(room, u))).join(" & ")} ${won.length > 1 ? "holen" : "holt"} ${pts}` : "Niemand punktet", sub: "" };
  }
  if (uid === by) return mine ? { kind: "ok", big: `Richtig! +${pts}`, sub: "" } : { kind: "no", big: r.stolen ? `Falsch – ${oppName} klaut ${pts}` : "Leider falsch", sub: "" };
  if (uid === opp) return mine ? { kind: "ok", big: `Geklaut! +${pts}`, sub: `${byName} lag falsch` } : { kind: r.points?.[by] ? "no" : "neutral", big: r.points?.[by] ? `${byName} holt ${pts}` : "Beide falsch", sub: "" };
  if (r.points?.[by]) return { kind: "neutral", big: `${byName} holt ${pts}`, sub: "" };
  if (r.stolen) return { kind: "neutral", big: `${oppName} klaut ${pts}`, sub: "" };
  return { kind: "neutral", big: "Niemand punktet", sub: "" };
}

// Animation beim Auslosen: Lichtpunkt springt über die Felder, wird langsamer und bleibt auf startQ stehen.
// Rein aus drawAt und startQ berechnet, damit alle Geräte dasselbe zeigen.
export function drawFrame(room, now) {
  const d = duelOf(room);
  if (d.startQ == null || !d.drawAt) return null;
  const cells = (room.questions || []).map((_, i) => i);
  const N = 22, T = DRAW_MS - 600;
  const t = now - d.drawAt;
  if (t >= T) return { qi: d.startQ, done: true };
  let seed = Math.floor(d.drawAt) % 2147483647 || 1;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const seq = [];
  for (let k = 0; k < N; k++) {
    let c;
    do c = cells[Math.floor(rnd() * cells.length)]; while (c === seq[k - 1] || (k === N - 2 && c === d.startQ));
    seq.push(c);
  }
  seq[N - 1] = d.startQ;
  // Zeitpunkte wachsen quadratisch → Sprünge werden langsamer
  let k = 0;
  while (k < N - 1 && T * Math.pow((k + 1) / N, 2) <= t) k++;
  return { qi: seq[k], done: false };
}

// Bilanz pro Kategorie fürs Ergebnis
export function categoryTable(room) {
  const rows = duelBoard(room);
  const ps = activePlayers(room);
  const playedSet = new Set(playOrder(room));
  return `<table class="ttable ctable"><thead><tr><th>Kategorie</th>${ps.map(p => `<th class="${sideOf(room, p.uid)}">${esc(p.name.slice(0, 8))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, ci) => `<tr><td>${esc(r.cat)}</td>${ps.map(p => {
      let got = 0, right = 0, n = 0;
      for (const qi of r.cells) {
        if (qi == null || !playedSet.has(qi)) continue;
        const res = resultFor(room, qi);
        n++;
        got += res?.points?.[p.uid] || 0;
        if (res?.ok?.[p.uid]) right++;
      }
      const fav = favCatsOf(room, p.uid).includes(ci) ? " ★" : "";
      return `<td>${got} P <span class="muted small">· ${right}/${n}</span>${fav}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
}
