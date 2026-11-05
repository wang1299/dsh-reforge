import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "dist");
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".mp4":"video/mp4", ".vtt":"text/vtt; charset=utf-8", ".json":"application/json", ".xml":"application/xml", ".txt":"text/plain" };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Outside preview");
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const data = await readFile(file);
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range && path.extname(file) === ".mp4") {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
      if (start > end || start >= data.length) { res.writeHead(416, { "Content-Range": "bytes */" + data.length }); res.end(); return; }
      res.writeHead(206, { "Content-Range": "bytes " + start + "-" + end + "/" + data.length, "Accept-Ranges":"bytes", "Content-Length":end-start+1 });
      res.end(data.subarray(start, end+1)); return;
    }
    res.writeHead(200, { "Content-Length":data.length }); res.end(data);
  } catch { res.writeHead(404, { "Content-Type":"text/plain" }); res.end("Not found"); }
});
server.listen(0, "127.0.0.1", () => console.log("Local: http://127.0.0.1:" + server.address().port));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
