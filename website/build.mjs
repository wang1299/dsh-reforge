import { readFile, writeFile, mkdir, copyFile, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Marked } from "marked";
import { sourceURL } from "./links.mjs";
import { siteLocation, prefixHTML } from "./urls.mjs";

const siteRoot = import.meta.dirname;
const repoRoot = path.dirname(siteRoot);
const out = path.resolve(siteRoot, "dist");
if (out !== path.join(siteRoot, "dist") || (await lstat(out).catch(() => null))?.isSymbolicLink()) throw new Error("Unsafe output directory");
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "assets"), { recursive: true });
const read = file => readFile(path.join(siteRoot, file), "utf8");
const config = JSON.parse(await read("site.json"));
const copy = JSON.parse(await read("copy.json"));
if (JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")).version !== config.version) throw new Error("Website/package version drift");
const location = siteLocation(process.env.WEBSITE_URL || config.url);
const { origin, basePath } = location;
const repoURL = "https://github.com/wang1299/dsh-reforge";
const assets = [
  ["docs/assets/dsh-reforge-hero-v3.png", "brand.png"],
  ["docs/assets/dsh-reforge-logo-v1.png", "logo.png"],
  ["docs/assets/demos/first-task-poster.jpg", "demo-poster.jpg"],
  ["docs/assets/demos/first-task-demo-1080p.mp4", "first-task.mp4"]
];
const inputs = [];
for (const [source, target] of assets) {
  const bytes = await readFile(path.join(repoRoot, source));
  inputs.push({ path: source, sha256: createHash("sha256").update(bytes).digest("hex") });
  await copyFile(path.join(repoRoot, source), path.join(out, "assets", target));
}
for (const locale of ["zh-CN", "en"]) {
  const source = "docs/assets/demos/first-task." + locale + ".srt";
  const text = await readFile(path.join(repoRoot, source), "utf8");
  inputs.push({ path: source, sha256: createHash("sha256").update(text).digest("hex") });
  await writeFile(path.join(out, "assets", "first-task." + locale + ".vtt"), "WEBVTT\n\n" + text.replace(/^\uFEFF/, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"));
}
for (const name of ["styles.css", "app.js"]) await copyFile(path.join(siteRoot, name), path.join(out, name));
const docs = [
  { key:"overview", source:["docs/index.md","docs/index.en.md"], title:["文档导航","Documentation"], desc:["按任务找到教程、参考与验证记录。","Find guides, references and actual verification records."] },
  { key:"start", source:["docs/getting-started/quickstart.md","docs/getting-started/quickstart.en.md"], title:["第一次使用","Your first run"], desc:["案例、只读绑定、授权与结果核对。","Example, read-only setup, permissions and verification."] },
  { key:"install", source:["docs/installation.md","docs/installation.md"], title:["安装与配置","Installation"], desc:["配置、profile、模型共享与提炼授权。","Configuration, profiles, sharing and extraction grants."] },
  { key:"example", source:["examples/customer-form/README.md","examples/customer-form/README.en.md"], title:["完整表单案例","Runnable example"], desc:["复现 2 项失败、修复通过和 3 项回归。","Reproduce the failures, fixed acceptance and regressions."] },
  { key:"compatibility", source:["docs/dsh-version-matrix.md","docs/dsh-version-matrix.md"], title:["兼容版本","Compatibility"], desc:["准确宿主版本与实际检查范围。","Exact host versions and actual verification scope."] },
  { key:"faq", source:["docs/faq.md","docs/faq.md"], title:["常见问题","Troubleshooting"], desc:["连接、安装、仓库归属与经验资格。","Connections, installation, repository and qualification."] },
  { key:"maintenance", source:["docs/maintenance.md","docs/maintenance.md"], title:["数据维护","Data maintenance"], desc:["停机备份、恢复、升级与保留。","Stopped backups, recovery, upgrades and retention."] },
  { key:"evidence", source:["docs/evaluation/t049-20261104/README.md","docs/evaluation/t049-20261104/README.md"], title:["实际验证与限制","Evidence and limits"], desc:["2026-11-04 自动闭环及当日两检索拒选的结果。","The 2026-11-04 automatic loop and its no-treatment pilot."] },
  { key:"releases", source:["docs/release-status.md","docs/release-status.md"], title:["发行状态","Release status"], desc:["公开制品、精确兼容、证据与摘要。","Public artifacts, exact hosts, evidence and hashes."] }
];
const paths = { ARROW:"arrow", PLAY:"play", FILE_ICON:"file", DATABASE_ICON:"database", LOCK_ICON:"lock", OPEN_ICON:"external", CODE_ICON:"code", CHECK_ICON:"check", LAYERS_ICON:"layers", COMPASS_ICON:"compass", TERMINAL_ICON:"terminal", LIFE_ICON:"life", RECEIPT_ICON:"receipt", INFO_ICON:"info" };
const iconPaths = {
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  play:'<path d="m9 5 11 7-11 7Z"/>',
  file:'<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  external:'<path d="M14 3h7v7M21 3l-9 9M10 3H4v17h17v-6"/>',
  code:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>',
  check:'<path d="M9 12l2 2 4-5M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
  terminal:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 8 4 4-4 4m7 0h4"/>',
  life:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6m5.6 5.6 3.6 3.6m-12.8 0 3.6-3.6m5.6-5.6 3.6-3.6"/>',
  receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 7h8M8 11h8M8 15h4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};
function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + iconPaths[name] + "</svg>"; }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])); }
function prefix(locale) { return locale === 1 ? "/en" : ""; }
function route(locale, key = "") { return prefix(locale) + (key ? "/docs/" + key + "/" : "/"); }
function t(key, locale) { if (!copy[key]?.[locale]) throw new Error("Missing translation: " + key); return copy[key][locale]; }
function brand(locale) { return '<a class="brand" href="' + route(locale) + '"><span class="brand-mark" aria-hidden="true">R</span>DSH-Reforge</a>'; }
function shell(locale, title, description, body, pagePath, oppositePath, isDocs = false) {
  const en = locale === 1;
  const siteTitle = title + " · DSH-Reforge";
  return ['<!doctype html><html lang="' + (en ? "en" : "zh-CN") + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light"><title>' + escapeHTML(siteTitle) + '</title><meta name="description" content="' + escapeHTML(description) + '">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; media-src \'self\'; object-src \'none\'; base-uri \'none\'; frame-src \'none\'; form-action \'none\'">',
    '<link rel="icon" type="image/png" href="/assets/logo.png"><link rel="stylesheet" href="/styles.css"><script src="/app.js" defer></script>',
    '<meta property="og:type" content="website"><meta property="og:title" content="' + escapeHTML(siteTitle) + '"><meta property="og:description" content="' + escapeHTML(description) + '">',
    '<link rel="canonical" href="' + escapeHTML(location.absolute(pagePath)) + '"><meta property="og:url" content="' + escapeHTML(location.absolute(pagePath)) + '"><meta property="og:image" content="' + escapeHTML(location.absolute("/assets/brand.png")) + '">',
    '<link rel="alternate" hreflang="' + (en ? "zh-CN" : "en") + '" href="' + escapeHTML(location.absolute(oppositePath)) + '"></head><body>',
    '<a class="skip" href="#main">' + (en ? "Skip to content" : "跳到正文") + '</a><header class="header"><div class="wrap header-row">' + brand(locale),
    '<button class="menu" type="button" aria-expanded="false" aria-controls="navigation" aria-label="' + (en ? "Toggle navigation" : "展开导航") + '" data-menu><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>',
    '<nav class="nav" id="navigation" aria-label="' + (en ? "Main navigation" : "主导航") + '"><a href="' + route(locale) + '#how">' + (en ? "How it works" : "工作方式") + '</a><a href="' + route(locale) + '#demo">' + (en ? "Demo" : "案例演示") + '</a><a href="' + prefix(locale) + '/docs/"' + (isDocs ? ' aria-current="page"' : "") + '>' + (en ? "Documentation" : "文档") + '</a><a class="github" href="' + repoURL + '">GitHub ' + icon("external") + '</a><a class="lang" href="' + oppositePath + '" lang="' + (en ? "zh-CN" : "en") + '">' + (en ? "中文" : "English") + '</a></nav></div></header>',
    '<main id="main">' + body + '</main><footer class="footer wrap"><div class="footer-top">' + brand(locale) + '<nav class="footer-links" aria-label="' + (en ? "Project links" : "项目链接") + '"><a href="' + prefix(locale) + '/docs/">' + (en ? "Documentation" : "文档导航") + '</a><a href="https://www.npmjs.com/package/dsh-reforge/v/' + config.version + '">npm</a><a href="' + repoURL + '/releases/tag/v' + config.version + '">Release</a><a href="' + repoURL + '/issues/new/choose">' + (en ? "Report an issue" : "报告问题") + '</a><a href="' + repoURL + '/issues/112">' + (en ? "Join the trial" : "参与试用") + '</a></nav></div><div class="footer-bottom"><p>' + (en ? "An independent community plugin for DeepSeek Harness. Not an extension for the DeepSeek chat website. No official review or endorsement is implied." : "DeepSeek Harness 的独立社区插件，不适用于 DeepSeek 官方聊天网页。不代表 DeepSeek 官方审核、推荐或安全认证。") + '</p><span>© 2026 DSH-Reforge · <a href="' + repoURL + '/blob/main/LICENSE">MIT</a> · ' + config.version + "</span></div></footer></body></html>"
  ].join("");
}
const pages = [];
async function emit(url, html) {
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("Unresolved page token: " + url);
  const directory = path.join(out, url.slice(1));
  await mkdir(directory, { recursive:true });
  await writeFile(path.join(directory, "index.html"), prefixHTML(html, basePath));
  pages.push(url);
}
const home = await read("home.html");
for (const locale of [0, 1]) {
  const replacements = Object.fromEntries(Object.keys(copy).map(key => [key, t(key, locale)]));
  for (const [token, name] of Object.entries(paths)) replacements[token] = icon(name);
  for (const [token, key] of Object.entries({ DOC_START:"start", DOC_INSTALL:"install", DOC_COMPAT:"compatibility", DOC_FAQ:"faq", DOC_EXAMPLE:"example", DOC_MAINTENANCE:"maintenance", DOC_EVIDENCE:"evidence", DOC_OVERVIEW:"overview" })) replacements[token] = route(locale, key);
  replacements.ZH_DEFAULT = locale === 0 ? "default" : "";
  replacements.EN_DEFAULT = locale === 1 ? "default" : "";
  const body = home.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => { if (!(key in replacements)) throw new Error("Missing home token: " + key); return replacements[key]; });
  await emit(route(locale), shell(locale, locale ? "Traceable experience from verified fixes" : "修复有据，经验可循", locale ? "A DeepSeek Harness community plugin for traceable experience from test-verified Python fixes. Learn, try the example and install alpha.2." : "从有测试依据的 Python 修复中积累可追溯经验。了解 DSH-Reforge，观看实际演示，运行完整案例并安装 alpha.2。", body, route(locale), route(1-locale)));

  const hub = '<section class="wrap docs-hub"><div class="docs-intro"><p class="eyebrow">GUIDES / REFERENCE / EVIDENCE</p><h1>' + (locale ? "A guide for every next step." : "从第一次体验，到日常维护。") + '</h1><p>' + (locale ? "Start with the runnable example, configure read-only access, then decide whether to enable learning. The guides below are built from the repository documentation." : "先运行完整案例，再绑定自己的仓库，最后决定是否开启学习。以下网页与仓库文档同源，每页都保留原始文档入口。") + '</p></div><div class="docs-grid hub-grid">' + docs.map((d, i) => '<a class="doc-card" href="' + route(locale, d.key) + '">' + icon(["compass","terminal","file","check","layers","life","database","receipt","external"][i]) + '<h3>' + d.title[locale] + '</h3><p>' + d.desc[locale] + '</p><span class="arrow" aria-hidden="true">↗</span></a>').join("") + '</div></section>';
  await emit(prefix(locale) + "/docs/", shell(locale, locale ? "Documentation" : "文档导航", locale ? "Task-oriented guides for DSH-Reforge." : "从体验、安装、验证到数据运维的任务导向指南。", hub, prefix(locale) + "/docs/", prefix(1-locale) + "/docs/", true));

  for (const doc of docs) {
    const source = doc.source[locale];
    const markdown = await readFile(path.join(repoRoot, source), "utf8");
    if (!inputs.some(x => x.path === source)) inputs.push({ path:source, sha256:createHash("sha256").update(markdown).digest("hex") });
    const headings = [];
    const used = new Map();
    function resolve(href, image = false) {
      const target = sourceURL(href, source);
      if (!target) return "#";
      href = href.trim();
      if (href.startsWith("#")) return href;
      if (target.origin !== "https://source.invalid") return target.href;
      const file = decodeURIComponent(target.pathname).slice(1);
      const match = docs.find(d => d.source.includes(file));
      if (match && !image) {
        const targetLocale = match.source[0] !== match.source[1] ? match.source.indexOf(file) : locale;
        return route(targetLocale, match.key) + target.hash;
      }
      const asset = assets.find(([s]) => s === file);
      if (asset) return "/assets/" + asset[1] + target.hash;
      const info = awaitStat.get(file);
      const kind = info === "directory" ? "tree" : "blob";
      return repoURL + "/" + kind + "/main/" + file.split("/").map(encodeURIComponent).join("/") + target.hash;
    }
    const awaitStat = new Map();
    const renderer = {
      html({ text }) { return escapeHTML(text); },
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        let id = text.replace(/<[^>]*>/g, "").toLowerCase().replace(/&[^;]+;/g, "").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().replace(/ /g, "-");
        if (!id) id = "section";
        const count = used.get(id) ?? 0; used.set(id, count+1);
        if (count) id += "-" + count;
        if (depth === 2 || depth === 3) headings.push({ id, text:text.replace(/<[^>]*>/g, "") });
        return "<h" + depth + ' id="' + escapeHTML(id) + '">' + text + "</h" + depth + ">";
      },
      link({ href, title, tokens }) {
        const resolved = resolve(href);
        return '<a href="' + escapeHTML(resolved) + '"' + (title ? ' title="' + escapeHTML(title) + '"' : "") + ">" + this.parser.parseInline(tokens) + "</a>";
      },
      image({ href, text }) {
        const resolved = resolve(href, true);
        if (!resolved.startsWith("/assets/")) return '<a href="' + escapeHTML(resolved) + '">' + escapeHTML(text || (locale ? "View image" : "查看图片")) + "</a>";
        return '<img loading="lazy" src="' + escapeHTML(resolved) + '" alt="' + escapeHTML(text) + '">';
      }
    };
    // Only known source directories can receive GitHub tree links.
    for (const folder of ["docs/decisions","docs","docs/development","examples/customer-form","docs/evaluation/t049-20261104"]) awaitStat.set(folder,"directory");
    const html = new Marked({ gfm:true, renderer }).parse(markdown);
    const sidebar = '<aside class="docs-side" aria-label="' + (locale ? "Documentation navigation" : "文档导航") + '"><p>' + (locale ? "DSH-Reforge guides" : "使用指南") + '</p><nav>' + docs.map(d => '<a href="' + route(locale, d.key) + '"' + (d.key === doc.key ? ' aria-current="page"' : "") + ">" + d.title[locale] + "</a>").join("") + '</nav><a class="source-link" href="' + repoURL + '/blob/main/' + source + '">' + icon("external") + (locale ? "Original Markdown" : "查看原始文档") + "</a></aside>";
    const note = locale && doc.source[0] === doc.source[1] ? '<div class="doc-note">Generated from the canonical repository guide, which may include Chinese text. For a fully English first-run path, see the <a href="/en/docs/start/">English quickstart</a>.</div>' : "";
    const body = '<div class="wrap docs-layout">' + sidebar + '<article class="article"><div class="breadcrumb"><a href="' + prefix(locale) + '/docs/">' + (locale ? "DOCUMENTATION" : "文档") + '</a> / ' + doc.title[locale] + '</div>' + note + html + '<div class="article-source"><a href="' + repoURL + '/blob/main/' + source + '">' + (locale ? "Read or edit the source on GitHub ↗" : "在 GitHub 查看或编辑本文 ↗") + '</a><span>' + config.version + '</span></div></article><aside class="toc" aria-label="' + (locale ? "On this page" : "本页内容") + '"><p>' + (locale ? "On this page" : "本页内容") + "</p>" + headings.map(h => '<a href="#' + escapeHTML(h.id) + '">' + escapeHTML(h.text) + "</a>").join("") + "</aside></div>";
    await emit(route(locale, doc.key), shell(locale, doc.title[locale], doc.desc[locale], body, route(locale, doc.key), route(1-locale, doc.key), true));
  }
}
await writeFile(path.join(out, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: " + location.absolute("/sitemap.xml") + "\n");
await writeFile(path.join(out, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + pages.map(p => "<url><loc>" + escapeHTML(location.absolute(p)) + "</loc></url>").join("") + "</urlset>");
await writeFile(path.join(out, "build-info.json"), JSON.stringify({ version:config.version, hosts:config.hosts, origin, basePath, pages, publicInputs:inputs }, null, 2));
console.log("Built " + pages.length + " bilingual pages; " + inputs.length + " whitelisted public inputs.");

