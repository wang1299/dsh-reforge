import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { sourceURL } from "./links.mjs";
for (const href of [" javascript:alert(1)", " data:text/html,<x>", "file:///private", "vbscript:msgbox(1)", "java\tscript:alert(1)", "\u0000https://example.org", ""]) {
  assert.equal(sourceURL(href, "docs/index.md"), null, "Reject unsafe Markdown URLs");
}
for (const href of ["https://example.org/a", "../README.md#heading", "#标题", " mailto:maintainer@example.org "]) {
  assert(sourceURL(href, "docs/index.md"), "Keep safe Markdown navigation");
}
const root = path.join(import.meta.dirname, "dist");
const info = JSON.parse(await readFile(path.join(root, "build-info.json"), "utf8"));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes:true })) {
    assert(!entry.isSymbolicLink(), "No links in publication");
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file); else files.push(file);
  }
}
await walk(root);
assert.equal(info.pages.length, 22);
const allowedFiles = new Set([
  ...info.pages.map(p => p.slice(1) + "index.html"),
  "assets/brand.png", "assets/logo.png", "assets/demo-poster.jpg", "assets/first-task.mp4",
  "assets/first-task.zh-CN.vtt", "assets/first-task.en.vtt",
  "styles.css", "app.js", "robots.txt", "sitemap.xml", "build-info.json"
]);
assert.equal(files.length, allowedFiles.size, "Exact static publication file count");
let references = 0;
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  assert(allowedFiles.has(relative), "Only explicitly listed public files: " + relative);
  assert(!/(^|\/)(\.git|\.probe-work|node_modules|\.env|plan\.env)(\/|$)|\.(sqlite|db|log)$/i.test(relative), "Unexpected publication path");
  if (!file.endsWith(".html")) continue;
  const html = await readFile(file, "utf8");
  assert(!/abc15|[A-Z]:[\\/]+Users[\\/]+|\{\{[A-Z0-9_]+\}\}/i.test(html), "Private paths or unresolved content");
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, "Exactly one main title");
  assert(html.includes('id="main"') && html.includes('href="#main"'), "Skip navigation");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, "Unique anchors");
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
    const label = match[2].trim();
    if (!match[1].startsWith("/")) continue;
    if (label === "English") assert(match[1].startsWith("/en/"), "English link selects English content");
    if (label === "中文") assert(!match[1].startsWith("/en/"), "Chinese link selects Chinese content");
  }
  for (const match of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const href = match[1].replaceAll("&amp;", "&").trim();
    assert(!/^(javascript|data|file):/i.test(href), "Safe URL protocols");
    if (/^(https?:|mailto:)/i.test(href)) continue;
    const current = "/" + path.relative(root, file).replaceAll("\\", "/");
    const target = new URL(href, "https://local.invalid" + current);
    let local = path.resolve(root, "." + decodeURIComponent(target.pathname));
    assert(local.startsWith(root + path.sep) || local === root, "Link stays within output");
    const meta = await stat(local).catch(() => null);
    assert(meta, "Missing local link " + href + " in " + relative);
    if (meta.isDirectory()) local = path.join(local, "index.html");
    if (target.hash && local.endsWith(".html")) {
      const content = local === file ? html : await readFile(local, "utf8");
      const id = decodeURIComponent(target.hash.slice(1));
      assert(content.includes('id="' + id + '"'), "Missing anchor " + href + " in " + relative);
    }
    references++;
  }
}
for (const language of ["zh-CN","en"]) assert((await readFile(path.join(root,"assets/first-task."+language+".vtt"),"utf8")).startsWith("WEBVTT\n"));
assert(!files.some(f => /\.(map|ts|srt)$/.test(f)), "Only required static assets");
console.log("Verified " + info.pages.length + " pages, " + references + " local references/anchors and the static publication whitelist.");

