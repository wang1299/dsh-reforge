/** Plugin identity and semantic tones; native themes still own surfaces and type. */
export const workbenchPalette = {
  light: {
    brand: '#5142c8', 'brand-hover': '#4030a8', 'brand-on': '#ffffff',
    'brand-bg': '#f2efff', 'brand-border': '#d7cff5',
    success: '#176b47', 'success-bg': '#eaf6ef', 'success-border': '#b9dcc9',
    warning: '#855000', 'warning-bg': '#fff5df', 'warning-border': '#e7cd96',
    danger: '#a53143', 'danger-bg': '#fff0f2', 'danger-border': '#e9bec7',
  },
  dark: {
    brand: '#b7acff', 'brand-hover': '#c9bfff', 'brand-on': '#19142f',
    'brand-bg': '#29243f', 'brand-border': '#51466f',
    success: '#80dbaa', 'success-bg': '#192f24', 'success-border': '#315b43',
    warning: '#f1c271', 'warning-bg': '#342817', 'warning-border': '#71552a',
    danger: '#ff9ba5', 'danger-bg': '#382024', 'danger-border': '#70404a',
  },
} as const;

const variables = (Object.keys(workbenchPalette.light) as (keyof typeof workbenchPalette.light)[])
  .map(key => `--reforge-${key}:light-dark(${workbenchPalette.light[key]},${workbenchPalette.dark[key]});`).join('');

export const workbenchColorStyles = `
:root{color-scheme:light dark;${variables}}
.brand-mark{background:var(--reforge-brand);color:var(--reforge-brand-on)}
.hero,.native .hero{padding:18px 20px 20px;margin-bottom:6px;border:1px solid var(--reforge-brand-border);border-radius:14px;background:linear-gradient(125deg,var(--reforge-brand-bg),var(--evolve-background) 74%)}
.hero h1:before{content:'';display:inline-block;width:4px;height:.8em;border-radius:3px;background:var(--reforge-brand);margin-right:10px}.hero-copy{margin-bottom:16px}
.stat{position:relative;overflow:hidden;box-shadow:0 2px 7px #00000003}.stat:before{content:'';position:absolute;inset:0 0 auto;height:3px;background:var(--evolve-border)}
.stat[data-tone=brand]{border-color:var(--reforge-brand-border)}.stat[data-tone=brand]:before{background:var(--reforge-brand)}.stat[data-tone=brand] strong{color:var(--reforge-brand)}
.stat[data-tone=success]{border-color:var(--reforge-success-border);background:linear-gradient(150deg,var(--reforge-success-bg),var(--evolve-background) 78%)}.stat[data-tone=success]:before{background:var(--reforge-success)}.stat[data-tone=success] strong{color:var(--reforge-success)}
.stat[data-tone=warning]{border-color:var(--reforge-warning-border);background:linear-gradient(150deg,var(--reforge-warning-bg),var(--evolve-background) 78%)}.stat[data-tone=warning]:before{background:var(--reforge-warning)}.stat[data-tone=warning] strong,.stat small.warning{color:var(--reforge-warning)}
.stat:hover{box-shadow:0 3px 12px #00000009}.navigation [role=tab].active{color:var(--reforge-brand);border-bottom-color:var(--reforge-brand)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline-color:var(--reforge-brand)}
button.primary{background:var(--reforge-brand);border-color:var(--reforge-brand);color:var(--reforge-brand-on);font-weight:550;padding:6px 14px}button.primary:hover{background:var(--reforge-brand-hover);border-color:var(--reforge-brand-hover);color:var(--reforge-brand-on)}
button.primary:disabled{opacity:.6}#mode-status .quiet,.card-foot .quiet,.activity-item .quiet,.progress-actions .quiet{color:var(--reforge-brand)}
.quiet.danger,button.danger{color:var(--reforge-danger)}.quiet.danger:hover,button.danger:hover{background:var(--reforge-danger-bg);color:var(--reforge-danger)}
.status-card{border-radius:12px}#overview-next{border-left:3px solid var(--reforge-brand);background:linear-gradient(130deg,var(--reforge-brand-bg),var(--evolve-background) 85%)}
#overview-next[data-tone=warning]{border-color:var(--reforge-warning-border);border-left-color:var(--reforge-warning);background:linear-gradient(130deg,var(--reforge-warning-bg),var(--evolve-background) 85%)}
#overview-next[data-tone=warning] .status-label{color:var(--reforge-warning)}#overview-next .primary{margin-top:6px;margin-left:0}
.pill{border:1px solid var(--evolve-border);background:var(--evolve-surface);color:var(--evolve-muted)}
.pill.source_verified,.progress-card.ready .pill{border-color:var(--reforge-success-border);background:var(--reforge-success-bg);color:var(--reforge-success)}
.pill.candidate,.progress-card.needs_attention .pill,.progress-card.unknown .pill{border-color:var(--reforge-warning-border);background:var(--reforge-warning-bg);color:var(--reforge-warning)}
.progress-card.recording .pill,.progress-card.verifying .pill,.progress-card.extracting .pill,.progress-card.qualifying .pill{border-color:var(--reforge-brand-border);background:var(--reforge-brand-bg);color:var(--reforge-brand)}
.pill.disabled{border-color:var(--evolve-border);background:var(--evolve-surface);color:var(--evolve-muted)}
.experience-card[data-tone=success]{border-left:3px solid var(--reforge-success)}.experience-card[data-tone=warning]{border-left:3px solid var(--reforge-warning)}.experience-card[data-tone=neutral]{border-left:3px solid var(--evolve-border)}
.experience-card .story-reminder,.story-reminder{border-left-color:var(--reforge-brand);background:var(--reforge-brand-bg)}.story-reminder.unavailable{border-left-color:var(--evolve-border);background:var(--evolve-surface)}.story-number{color:var(--reforge-brand);background:var(--reforge-brand-bg);border-color:var(--reforge-brand-border)}
.activity-mark{background:var(--reforge-brand-bg);color:var(--reforge-brand)}.story-connection:before,.journey-use .usage-state:before{color:var(--reforge-brand)}
.notice{background:var(--reforge-brand-bg);border-color:var(--reforge-brand-border);color:var(--evolve-text)}.notice.warning{background:var(--reforge-warning-bg);border-color:var(--reforge-warning-border);color:var(--reforge-warning)}
.message:not(:empty){border:1px solid var(--reforge-brand-border);background:var(--reforge-brand-bg);color:var(--evolve-text)}.message[data-tone=success]{border-color:var(--reforge-success-border);background:var(--reforge-success-bg);color:var(--reforge-success)}.message[data-tone=warning]{border-color:var(--reforge-warning-border);background:var(--reforge-warning-bg);color:var(--reforge-warning)}
.connected{color:var(--reforge-success)}.connected:before{background:var(--reforge-success)}
.check-cell.passed{border-color:var(--reforge-success-border);background:var(--reforge-success-bg)}.check-cell.passed .check-symbol{color:var(--reforge-success)}
.check-cell.failed,.check-base.passed{border-color:var(--reforge-danger-border);background:var(--reforge-danger-bg)}.check-cell.failed .check-symbol,.check-base.passed .check-symbol{color:var(--reforge-danger)}
.check-cell.unknown,.check-cell.missing{border-color:var(--reforge-warning-border);background:var(--reforge-warning-bg)}.check-cell.unknown .check-symbol,.check-cell.missing .check-symbol{color:var(--reforge-warning)}
.check-base.passed{border-left-color:var(--reforge-danger)}.check-fixed.passed{border-left-color:var(--reforge-success)}.step.done{border-color:var(--reforge-success)}.step.active{border-color:var(--reforge-brand)}.step.blocked,.step.unknown{border-color:var(--reforge-warning)}.progress-card.needs_attention,.progress-card.unknown{border-color:var(--reforge-warning-border)}
@media(max-width:760px){.hero,.native .hero{padding:16px 12px}.stat,.native .stat{padding:12px}.card-foot button.primary{padding:5px 10px}}
`;
