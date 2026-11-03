/** Small original, local-only line icons. Labels always remain in adjacent text. */
export function workbenchIcon(name: string): SVGSVGElement {
  const paths: Record<string, string[]> = {
    book: ['M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4Z', 'M13 7a3 3 0 0 1 3-3h4v14h-3a4 4 0 0 0-4 3'],
    grid: ['M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z'],
    check: ['M5 12l4 4L19 6'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
    reference: ['M4 5v6a4 4 0 0 0 4 4h11', 'M15 10l5 5-5 5'],
    progress: ['M5 5h14 M5 12h14 M5 19h14', 'M8 3v4 M15 10v4 M11 17v4'],
    settings: ['M4 6h16 M4 12h16 M4 18h16', 'M8 4v4 M16 10v4 M10 16v4'],
    refresh: ['M20 9a8 8 0 1 0 0 6', 'M20 4v5h-5'],
    search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M15 15l6 6'],
    alert: ['M12 3 2 21h20Z', 'M12 9v5 M12 17v.2'],
    pause: ['M8 5v14 M16 5v14'],
    bulb: ['M8 15a7 7 0 1 1 8 0l-1 3H9Z', 'M9 21h6'],
    close: ['M6 6l12 12 M18 6 6 18'],
    loader: ['M12 3a9 9 0 1 1-9 9'],
    info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6 M12 7v.2'],
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'ui-icon' + (name === 'loader' ? ' spinning' : '') })) svg.setAttribute(key, value);
  for (const d of paths[name] ?? paths.info!) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
