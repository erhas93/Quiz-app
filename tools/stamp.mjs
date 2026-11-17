// Versionsstempel für GitHub Pages (ohne Build-Schritt):
// - Import-Map in index.html: jede JS-Datei bekommt ?v=<Inhalts-Hash>. So lädt ein Gerät immer einen
//   zusammenpassenden Stand aller Module statt einer Mischung aus alten und neuen Dateien aus dem Cache.
// - version.json mit Build-Kennung; die App fragt sie ohne Cache ab und bietet bei neuer Version „Neu laden“ an.
// Aufruf: node tools/stamp.mjs   (läuft automatisch im pre-commit-Hook)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
})(join(root, "js"));
files.sort();
const h = s => createHash("sha1").update(s).digest("hex").slice(0, 8);
const map = {};
let all = "";
for (const f of files) {
  const src = readFileSync(f, "utf8");
  all += src;
  map["./" + relative(root, f)] = "./" + relative(root, f) + "?v=" + h(src);
}
const css = readFileSync(join(root, "css/app.css"), "utf8");
const build = h(all + css);
const version = (readFileSync(join(root, "js/app.js"), "utf8").match(/VERSION = "([^"]+)"/) || [])[1] || "?";

let html = readFileSync(join(root, "index.html"), "utf8");
const block = `<!-- stamp:start -->
<script>window.__BUILD = "${build}";</script>
<script type="importmap">${JSON.stringify({ imports: map })}</script>
<link rel="stylesheet" href="css/app.css?v=${h(css)}">
<!-- stamp:end -->`;
if (html.includes("<!-- stamp:start -->")) html = html.replace(/<!-- stamp:start -->[\s\S]*?<!-- stamp:end -->/, block);
else html = html.replace(/<link rel="stylesheet" href="css\/app\.css[^"]*">/, block);
html = html.replace(/<script type="module" src="js\/app\.js[^"]*"><\/script>/, `<script type="module" src="${map["./js/app.js"]}"></script>`);
writeFileSync(join(root, "index.html"), html);
writeFileSync(join(root, "version.json"), JSON.stringify({ version, build }) + "\n");
console.log("stamp", version, build, files.length, "Module");
