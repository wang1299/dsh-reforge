/** Tabler blue identity with readable semantic tones in both host color schemes. */
export const workbenchPalette = {
  light: {
    brand: '#206bc4', 'brand-hover': '#1a569d', 'brand-on': '#ffffff',
    'brand-bg': '#eaf2fc', 'brand-border': '#c9dcf4',
    success: '#176b47', 'success-bg': '#eaf6ef', 'success-border': '#b9dcc9',
    warning: '#855000', 'warning-bg': '#fff5df', 'warning-border': '#e7cd96',
    danger: '#a53143', 'danger-bg': '#fff0f2', 'danger-border': '#e9bec7',
  },
  dark: {
    brand: '#8ab9f1', 'brand-hover': '#a7cdf8', 'brand-on': '#10243b',
    'brand-bg': '#1c2c42', 'brand-border': '#355274',
    success: '#80dbaa', 'success-bg': '#192f24', 'success-border': '#315b43',
    warning: '#f1c271', 'warning-bg': '#342817', 'warning-border': '#71552a',
    danger: '#ff9ba5', 'danger-bg': '#382024', 'danger-border': '#70404a',
  },
} as const;

const variables = (Object.keys(workbenchPalette.light) as (keyof typeof workbenchPalette.light)[])
  .map(key => `--reforge-${key}:light-dark(${workbenchPalette.light[key]},${workbenchPalette.dark[key]});`).join('');

export const workbenchColorStyles = `
:root{${variables}--evolve-accent:var(--reforge-brand);--evolve-success:var(--reforge-success);--evolve-warning:var(--reforge-warning);--evolve-danger:var(--reforge-danger)}
button.primary{background:var(--reforge-brand);border-color:var(--reforge-brand);color:var(--reforge-brand-on);font-weight:600}button.primary:hover{background:var(--reforge-brand-hover);border-color:var(--reforge-brand-hover);color:var(--reforge-brand-on)}
button.danger{color:var(--reforge-danger)}button.danger:hover{background:var(--reforge-danger-bg)}.connected{color:var(--reforge-success)}
.stat[data-tone=success] .ui-icon{color:var(--reforge-success);background:var(--reforge-success-bg)}.stat[data-tone=warning] .ui-icon{color:var(--reforge-warning);background:var(--reforge-warning-bg)}.stat[data-tone=neutral] .ui-icon{color:var(--evolve-muted);background:var(--evolve-surface)}.stat small.warning{color:var(--reforge-warning)}
.pill.source_verified,.progress-card.ready .pill{background:var(--reforge-success-bg);border-color:var(--reforge-success-border);color:var(--reforge-success)}
.pill.candidate,.progress-card.needs_attention .pill,.progress-card.unknown .pill{background:var(--reforge-warning-bg);border-color:var(--reforge-warning-border);color:var(--reforge-warning)}
.progress-card.recording .pill,.progress-card.verifying .pill,.progress-card.extracting .pill,.progress-card.qualifying .pill{background:var(--reforge-brand-bg);border-color:var(--reforge-brand-border);color:var(--reforge-brand)}
.experience-card[data-tone=success]{border-top-color:var(--reforge-success)}.experience-card[data-tone=warning]{border-top-color:var(--reforge-warning)}.experience-card[data-tone=neutral]{border-top-color:var(--evolve-border)}
#overview-next{border-top:2px solid var(--reforge-brand)}#overview-next[data-tone=warning]{border-top-color:var(--reforge-warning)}#overview-next[data-tone=warning] .status-label{color:var(--reforge-warning)}
.notice.warning{background:var(--reforge-warning-bg);border-color:var(--reforge-warning-border);color:var(--reforge-warning)}
.message[data-tone=success]{background:var(--reforge-success-bg);border-color:var(--reforge-success-border);color:var(--reforge-success)}.message[data-tone=warning]{background:var(--reforge-warning-bg);border-color:var(--reforge-warning-border);color:var(--reforge-warning)}
.story-number{color:var(--reforge-brand);background:var(--reforge-brand-bg);border-color:var(--reforge-brand-border)}.story-connection:before,.journey-use .usage-state:before{color:var(--reforge-brand)}
.check-cell.passed{border-color:var(--reforge-success-border);background:var(--reforge-success-bg)}.check-cell.passed .check-symbol{color:var(--reforge-success)}.check-cell.failed,.check-base.passed{border-color:var(--reforge-danger-border);background:var(--reforge-danger-bg)}.check-cell.failed .check-symbol,.check-base.passed .check-symbol{color:var(--reforge-danger)}
.check-cell.unknown,.check-cell.missing{border-color:var(--reforge-warning-border);background:var(--reforge-warning-bg)}.check-cell.unknown .check-symbol,.check-cell.missing .check-symbol{color:var(--reforge-warning)}.check-base.passed{border-left-color:var(--reforge-danger)}.check-fixed.passed{border-left-color:var(--reforge-success)}
.step.done{border-color:var(--reforge-success)}.step.active{border-color:var(--reforge-brand)}.step.blocked,.step.unknown{border-color:var(--reforge-warning)}.progress-card.needs_attention,.progress-card.unknown{border-color:var(--reforge-warning-border)}
`;
