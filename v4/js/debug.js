// Debug-Protokoll: Zustandsänderungen (als Diff) und Schreibvorgänge
export const DBG = {
  logs: [],
  log(msg, data) {
    const entry = { t: new Date().toISOString().slice(11, 23), msg, data };
    this.logs.push(entry);
    if (this.logs.length > 300) this.logs.shift();
    console.log(`[QUIZ ${entry.t}] ${msg}`, data ?? "");
    const p = document.getElementById("dbg-panel");
    if (p && p.style.display !== "none") this.render(p);
  },
  render(p) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    p.innerHTML = `<div class="dbg-head"><b>Debug-Log</b><span>
      <button onclick="DBG.copy()">Kopieren</button><button onclick="DBG.clear()">Leeren</button></span></div>`
      + this.logs.slice(-60).reverse().map(e =>
        `<div class="dbg-row"><span class="dbg-t">${e.t}</span> ${esc(e.msg)}${e.data !== undefined ? ` <span class="dbg-d">${esc(JSON.stringify(e.data)).slice(0, 220)}</span>` : ""}</div>`
      ).join("");
  },
  toggle() {
    const p = document.getElementById("dbg-panel");
    const show = p.style.display === "none";
    p.style.display = show ? "block" : "none";
    if (show) this.render(p);
  },
  clear() { this.logs = []; const p = document.getElementById("dbg-panel"); if (p) this.render(p); },
  copy() {
    const txt = this.logs.map(e => `${e.t} ${e.msg} ${e.data !== undefined ? JSON.stringify(e.data) : ""}`).join("\n");
    navigator.clipboard?.writeText(txt);
  }
};

// Flacher Diff zweier Objekte (zwei Ebenen tief), für das Log
export function diff(a, b, prefix = "", depth = 0) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const va = a?.[k], vb = b?.[k];
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    if (depth < 2 && va && vb && typeof va === "object" && typeof vb === "object") {
      Object.assign(out, diff(va, vb, prefix + k + ".", depth + 1));
    } else {
      out[prefix + k] = vb === undefined ? null : (typeof vb === "object" ? "{…}" : vb);
    }
  }
  return out;
}

window.DBG = DBG;
