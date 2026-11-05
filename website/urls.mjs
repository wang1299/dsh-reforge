export function siteLocation(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Expected a public HTTP(S) site URL without credentials, query or fragment");
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  return { origin:url.origin, basePath, absolute:local => url.origin + basePath + local };
}
export function prefixHTML(html, basePath) {
  if (!basePath) return html;
  return html.replace(/\b(href|src|poster)="\/(?!\/)/g, (_, attribute) => attribute + '="' + basePath + "/");
}

