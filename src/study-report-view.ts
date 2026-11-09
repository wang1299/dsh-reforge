import type { parseStudyReport, ReportCell, StudyReportView } from './study-report.js';

/** Browser-only reader. No service port, network, storage, authorization or execution capability. */
export function installStudyReport(root: HTMLElement, parse: typeof parseStudyReport) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node;
  };
  const money = (value: number) => '¥' + (value / 1_000_000).toFixed(6);
  const names = { none: '无经验', plain: '普通检索', reforge: 'Reforge' };
  const caseNames: Record<string, string> = { preferences_patch: '偏好更新回滚', role_batch: '角色批量更新', outbox_receipt: '发件回执',
    delivery_batch: '批量投递', nullable_deadline: '可空截止时间', required_deadline: '必填截止时间' };
  const statuses = { accepted: '测试通过', tests_failed: '测试未通过', invalid_output: '输出格式未通过', invalid_code: '代码准入未通过',
    execution_unknown: '执行结果未知', transport_unknown: '响应结果未知' };
  const rules: Record<string, string> = { code_size: '代码超过字节上限', function_shape: '函数形状不符', function_limits: '装饰器或节点上限不符',
    unsupported_syntax: '语法超出允许子集', private_name: '禁止的名称形式', unbound_name: '读取未绑定名称', builtin_rebinding: '覆盖受保护调用名称',
    attribute: '属性超出允许集合', integer: '整数超过上限', call: '调用形式不符', syntax_error: 'Python 语法无法解析', parse_limit: '解析达到限制' };
  let generation = 0, report: StudyReportView | null = null;
  const box = el('div', undefined, 'study-import surface');
  const label = el('label', '选择本机研究结果（JSON，最大 1 MiB）');
  const input = el('input'); input.type = 'file'; input.accept = '.json,application/json'; input.id = 'study-report-file'; label.htmlFor = input.id;
  const clear = el('button', '清除本页报告', 'secondary'); clear.type = 'button'; clear.disabled = true;
  const status = el('p', '尚未选择报告。', 'muted'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const error = el('p', '', 'study-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  box.append(el('h2', '读取一次效果对照'), el('p', '选择研究生成的 study-result.json。文件只在本页内存中解析，关闭或清除后移除；读取不会调用模型或重放任务。', 'muted'), label, input, clear, status, error);
  const content = el('div'); content.hidden = true; content.id = 'study-report-content';
  const metrics = el('div', undefined, 'study-metrics');
  const compare = el('div', undefined, 'study-arms');
  const scope = el('p', '', 'study-scope');
  const filter = el('select'); filter.id = 'study-report-filter';
  for (const [value, text] of [['all', '全部配对'], ['failed', '含已知失败'], ['unknown', '含未知结果'], ['unattempted', '含未尝试']]) {
    const option = el('option', text); option.value = value!; filter.append(option);
  }
  const filterLabel = el('label', '筛选配对结果'); filterLabel.htmlFor = filter.id;
  const toolbar = el('div', undefined, 'study-toolbar'); toolbar.append(filterLabel, filter);
  const count = el('p', '', 'muted'); count.setAttribute('role', 'status');
  const rows = el('div', undefined, 'study-pairs');
  content.append(scope, metrics, el('p', '本机文件已通过结构一致性检查；本页未独立核对原始账本、测试或服务商账单。', 'notice warning'),
    el('h2', '相同任务，三组对照'), compare, el('p', '每组固定 12 项。失败、未知和未尝试均保留在分母；提供参考不等于采用或受益。6 类作者可见合成任务各重复 2 次，不能代表外部任务或普遍效果。', 'muted'), toolbar, count, rows);
  root.append(box, content);
  function cellView(cell: ReportCell) {
    const article = el('article', undefined, 'study-cell'); article.dataset.outcome = cell.outcome;
    const outcome = { accepted: '通过验收', failed: '已知失败', unknown: '结果未知', unattempted: '未尝试' }[cell.outcome];
    article.append(el('h4', names[cell.arm]), el('span', outcome, 'study-outcome'),
      el('p', cell.attempts.length ? '首轮' + (cell.firstPass ? '通过' : '未通过') + ' · ' + (cell.attempts.length - 1) + ' 次返工' : '没有可用的检查记录', 'muted'));
    if (cell.attempts.length) {
      const details = el('details'); details.append(el('summary', '查看检查过程 · ' + names[cell.arm]));
      for (const a of cell.attempts) {
        const line = el('div', undefined, 'study-attempt'); line.append(el('p', '第 ' + a.round + ' 轮 · ' + statuses[a.status]),
          el('p', a.executed ? '已尝试独立测试执行' : '未执行生成代码', 'muted'));
        if (a.status === 'invalid_code') line.append(el('p', a.admission ? rules[a.admission.rule] + ' · AST: ' + a.admission.node : '旧记录未保存具体准入原因，无法追溯语法。', 'muted'));
        details.append(line);
      }
      details.append(el('p', cell.reference ? '该任务已提供经验参考。' : '该任务未提供经验参考。', 'muted')); article.append(details);
    }
    return article;
  }
  function renderRows() {
    rows.replaceChildren(); if (!report) return;
    const selected = report.rows.filter(row => filter.value === 'all' || row.cells.some(cell => cell.outcome === filter.value));
    count.textContent = '显示 ' + selected.length + ' / 12 组同题配对；每组包含三种方法。';
    for (const row of selected) {
      const section = el('section', undefined, 'study-pair'); section.append(el('h3', caseNames[row.case] + ' · 第 ' + row.repeat + ' 次'));
      const grid = el('div', undefined, 'study-pair-grid'); grid.append(...row.cells.map(cellView)); section.append(grid); rows.append(section);
    }
    if (!selected.length) rows.append(el('p', '当前报告没有符合筛选的配对。', 'empty'));
  }
  function render() {
    if (!report) return;
    const r = report; content.hidden = false;
    scope.textContent = '文件标记：' + (r.scope === 'live' ? '真实模型请求' : '合成夹具 · 无真实模型收益') + ' · 本机文件 · 源码 ' + r.sourceCommit.slice(0, 12);
    metrics.replaceChildren();
    for (const [title, value, note, tone] of [
      ['研究流程', r.recorded + ' / 36 已记录', r.complete ? '流程完成；不代表所有任务通过' : '流程未完成；未知及未尝试已保留', r.complete ? 'success' : 'warning'],
      ['任务验收', r.arms.reduce((n, a) => n + a.final, 0) + ' / 36 通过', '按独立检查记录统计，不以模型自述判断', 'brand'],
      ['峰值费用上界', money(r.upper), r.scope === 'fixture' ? '夹具模拟金额，非真实费用' : '完整响应 ' + r.responses + ' / ' + r.calls + ' 次；尚非实际账单', 'warning'],
    ]) { const card = el('article', undefined, 'study-metric'); card.dataset.tone = tone; card.append(el('h3', title, 'study-metric-label'), el('strong', value), el('p', note, 'muted')); metrics.append(card); }
    if (r.held) metrics.append(el('p', '未知费用预留 ' + money(r.held) + '，未退回或归零。', 'notice warning'));
    if (!r.frozenUnchanged) metrics.append(el('p', '运行冻结检查未保持一致，不能作有效收益比较。', 'notice warning'));
    compare.replaceChildren();
    const baseline = r.arms[0]!.final;
    for (const a of r.arms) {
      const card = el('article', undefined, 'study-arm surface');
      card.append(el('h3', names[a.arm]), el('p', '最终通过 ' + a.final + ' / 12', 'study-score'), el('p', '首轮通过 ' + a.first + ' / 12', 'muted'));
      if (a.arm !== 'none') {
        const delta = (a.final - baseline) / 12 * 100;
        card.append(el('p', '相对无经验 ' + (delta > 0 ? '+' : '') + delta.toFixed(1) + ' 个百分点', 'muted'));
      }
      const list = el('dl');
      for (const [title, value] of [['失败 / 未知 / 未尝试', a.failed + ' / ' + a.unknown + ' / ' + a.unattempted], ['返工 / 请求', a.rework + ' / ' + a.requests],
        ['提供参考', a.references + ' / 12'], ['峰值费用上界', money(a.upper)]]) list.append(el('dt', title), el('dd', value));
      card.append(list); compare.append(card);
    }
    renderRows();
  }
  function reset() { report = null; content.hidden = true; metrics.replaceChildren(); compare.replaceChildren(); rows.replaceChildren(); clear.disabled = true; filter.value = 'all'; }
  clear.onclick = () => { generation++; reset(); input.value = ''; error.hidden = true; status.textContent = '已从本页移除报告。'; input.focus(); };
  filter.onchange = renderRows;
  input.onchange = async () => {
    const current = ++generation, file = input.files?.[0]; reset(); error.hidden = true;
    if (!file) { status.textContent = '尚未选择报告。'; return; }
    clear.disabled = false; status.textContent = '正在本页解析…';
    try {
      if (file.size > 1048576) throw new Error('size');
      const text = await file.text(); if (current !== generation) return;
      report = parse(text); status.textContent = '已读取本机报告；仅核对文件结构与汇总一致性。'; render();
    } catch {
      if (current !== generation) return;
      reset(); clear.disabled = false; status.textContent = '报告未载入。'; error.hidden = false;
      error.textContent = '无法读取：请选择不超过 1 MiB、结构及汇总一致的 schema 1 研究结果。未上传文件或执行任务。';
    }
  };
}

export const studyReportStyles = `
.study-import{padding:20px;margin-bottom:20px}.study-import label{display:block;font-weight:600;margin:16px 0 8px}.study-import input{max-width:100%;margin:0 12px 12px 0}.study-import input::file-selector-button{font:inherit;border:1px solid var(--evolve-border);border-radius:6px;padding:8px 12px;background:var(--evolve-background);color:var(--evolve-text);margin-right:12px;cursor:pointer}.study-error{color:var(--reforge-danger)}
.study-scope{font-weight:600;margin:16px 0}.study-metrics,.study-arms,.study-pair-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.study-metrics{margin-bottom:16px}.study-metric,.study-cell{border:1px solid var(--evolve-border);border-radius:6px;background:var(--evolve-background);padding:18px;min-width:0}.study-metric{border-top:3px solid var(--reforge-brand)}.study-metric[data-tone=success]{border-top-color:var(--reforge-success)}.study-metric[data-tone=warning]{border-top-color:var(--reforge-warning)}.study-metric strong{font-size:1.6rem;font-variant-numeric:tabular-nums}.study-metrics>.notice{grid-column:1/-1}.study-arms{margin:16px 0}.study-arm{padding:18px;min-width:0}.study-score{font-size:1.3rem;font-weight:650}.study-arm dl{display:grid;grid-template-columns:1fr auto;gap:10px;font-size:.9rem;margin:16px 0 0}.study-arm dt{color:var(--evolve-muted)}.study-arm dd{margin:0;font-variant-numeric:tabular-nums}.study-toolbar{display:flex;align-items:center;gap:12px;margin:24px 0 8px;flex-wrap:wrap}.study-pairs{display:grid;gap:22px;margin-top:18px}.study-cell h4{font-size:1rem;margin:0 0 10px}.study-outcome{display:inline-block;padding:3px 9px;border-radius:4px;background:var(--reforge-brand-bg);color:var(--reforge-brand);font-weight:600}.study-cell[data-outcome=accepted] .study-outcome{background:var(--reforge-success-bg);color:var(--reforge-success)}.study-cell[data-outcome=failed] .study-outcome{background:var(--reforge-danger-bg);color:var(--reforge-danger)}.study-cell[data-outcome=unknown] .study-outcome{background:var(--reforge-warning-bg);color:var(--reforge-warning)}.study-cell[data-outcome=unattempted] .study-outcome{background:var(--evolve-surface);color:var(--evolve-muted)}.study-cell details{margin-top:14px}.study-cell summary{cursor:pointer;color:var(--reforge-brand)}.study-attempt{border-top:1px solid var(--evolve-border);padding-top:10px;margin-top:10px}
@media(max-width:700px){.study-metrics,.study-arms,.study-pair-grid{grid-template-columns:1fr}.study-import,.study-metric,.study-arm,.study-cell{padding:16px}.study-import input{width:100%}.study-arm dl{grid-template-columns:1fr auto}}
`;
