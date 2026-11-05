// Markdown is authored in the repository, but URL handling still fails closed.
export function sourceURL(href, source) {
  if (typeof href !== "string" || /[\u0000-\u001f\u007f]/.test(href)) return null;
  const value = href.trim();
  if (!value) return null;
  try {
    const url = new URL(value, "https://source.invalid/" + source);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
