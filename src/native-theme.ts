const colors = {
  background: ['--dsw-alias-bg-layer-1', '#ffffff', '#171717'],
  surface: ['--dsw-alias-bg-layer-2', '#f7f7f8', '#222222'],
  text: ['--dsw-alias-label-primary', '#202123', '#eeeeee'],
  muted: ['--dsw-alias-label-secondary', '#6b6c70', '#aaaaaa'],
  border: ['--dsw-alias-border-l3', '#e5e5e7', '#393939'],
  accent: ['--dsw-alias-brand-primary', '#4d6bfe', '#879bff'],
  success: ['--dsw-alias-state-success-primary', '#248147', '#65be83'],
  warning: ['--dsw-alias-state-warn-primary', '#9a6800', '#e8b65b'],
  danger: ['--dsw-alias-state-error-primary', '#be4242', '#f58b8b'],
} as const;

/** Read only the official theme presenter's bounded DOM projection. */
export function watchNativeTheme(frame: HTMLIFrameElement, channel: string): () => void {
  const send = () => {
    const style = getComputedStyle(document.body); const dark = document.body.hasAttribute('data-ds-dark-theme');
    const appearance: Record<string, unknown> = { dark, fontSize: Math.min(24, Math.max(10, parseInt(style.getPropertyValue('--dsh-content-font-size')) || 14)) };
    for (const [key, [token, light, night]] of Object.entries(colors)) appearance[key] = style.getPropertyValue(token).trim() || (dark ? night : light);
    frame.contentWindow?.postMessage({ channel, type: 'theme', appearance }, '*');
  };
  const observer = new MutationObserver(send);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-ds-dark-theme'] });
  frame.addEventListener('load', send); send();
  return () => { observer.disconnect(); frame.removeEventListener('load', send); };
}

/** Self-contained: serialized into the isolated child, no host DOM access. */
export function applyNativeTheme(input: unknown): boolean {
  const keys = ['background', 'surface', 'text', 'muted', 'border', 'accent', 'success', 'warning', 'danger'];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 11 || Object.keys(value).some(k => ![...keys, 'dark', 'fontSize'].includes(k))) return false;
  if (typeof value.dark !== 'boolean' || !Number.isInteger(value.fontSize) || (value.fontSize as number) < 10 || (value.fontSize as number) > 24) return false;
  for (const key of keys) {
    const color = value[key];
    if (typeof color !== 'string' || color.length > 120 || /[;{}<>\\]|url|var\(/i.test(color) || !CSS.supports('color', color)) return false;
  }
  for (const key of keys) document.documentElement.style.setProperty('--evolve-' + key, value[key] as string);
  document.documentElement.style.setProperty('--evolve-font-size', value.fontSize + 'px');
  document.documentElement.style.colorScheme = value.dark ? 'dark' : 'light';
  return true;
}

export const nativePanelStyles = `
.native .brand{display:none}.native .topbar{min-height:30px;justify-content:flex-end;padding-top:5px;padding-bottom:5px}.native main,.native .topbar,.native .navigation{max-width:none}.native main{padding-bottom:120px}
`;
