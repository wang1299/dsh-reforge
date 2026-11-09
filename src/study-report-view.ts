import type { parseStudyReport, ReportCell, StudyReportView } from './study-report.js';

/** Browser-only reader. No service port, network, storage, authorization or execution capability. */
export function installStudyReport(root: HTMLElement, parse: typeof parseStudyReport, example: () => StudyReportView) {
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
  let generation = 0, report: StudyReportView | null = null, origin: 'example' | 'file' | null = null;
  const box = el('div', undefined, 'study-import surface');
  const sample = el('button', '查看合成示例'); sample.type = 'button'; sample.id = 'study-report-example';
  const label = el('label', '选择本机研究结果（JSON，最大 1 MiB）');
  const input = el('input'); input.type = 'file'; input.accept = '.json,application/json'; input.id = 'study-report-file'; label.htmlFor = input.id;
  const clear = el('button', '清除本页报告', 'secondary'); clear.type = 'button'; clear.disabled = true;
  const actions = el('div', undefined, 'study-import-actions'); actions.append(sample, clear);
  const status = el('p', '尚未选择报告。', 'muted'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const error = el('p', '', 'study-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const reading = el('ol', undefined, 'study-reading'); reading.setAttribute('aria-label', '报告阅读顺序');
  for (const [title, note] of [['看流程', '是否完整结束'], ['看验收', '失败和未知也计入分母'], ['看费用', '上界与未知占额分开']]) {
    const step = el('li'); step.append(el('strong', title), el('span', note)); reading.append(step);
  }
  box.append(el('h2', '先看懂一份效果报告'), el('p', '没有本机报告也可以先看合成示例，了解失败、未知和未尝试分别表示什么。', 'muted'),
    actions, reading, label, input, el('p', '选择研究生成的 study-result.json。文件只在本页内存中解析，关闭或清除后移除；读取不会调用模型或重放任务。', 'muted'), status, error);
  const content = el('div'); content.hidden = true; content.id = 'study-report-content';
  const metrics = el('div', undefined, 'study-metrics');
  const compare = el('div', undefined, 'study-arms');
  const scope = el('p', '', 'study-scope');
  const timing = el('details', undefined, 'study-timing surface');
  const filter = el('select'); filter.id = 'study-report-filter';
  for (const [value, text] of [['all', '全部配对'], ['failed', '含已知失败'], ['unknown', '含未知结果'], ['unattempted', '含未尝试']]) {
    const option = el('option', text); option.value = value!; filter.append(option);
  }
  const filterLabel = el('label', '筛选配对结果'); filterLabel.htmlFor = filter.id;
  const toolbar = el('div', undefined, 'study-toolbar'); toolbar.append(filterLabel, filter);
  const count = el('p', '', 'muted'); count.setAttribute('role', 'status');
  const rows = el('div', undefined, 'study-pairs');
  const provenance = el('p', '', 'notice warning');
  content.append(scope, metrics, provenance,
    timing, el('h2', '相同任务，三组对照'), compare, el('p', '每组固定 12 项。失败、未知和未尝试均保留在分母；提供参考不等于采用或受益。6 类作者可见合成任务各重复 2 次，不能代表外部任务或普遍效果。', 'muted'), toolbar, count, rows);
  root.append(box, content);
  function cellView(cell: ReportCell) {
    const article = el('article', undefined, 'study-cell'); article.dataset.outcome = cell.outcome;
    const outcome = { accepted: '通过验收', failed: '已知失败', unknown: '结果未知', unattempted: '未尝试' }[cell.outcome];
    article.append(el('h4', names[cell.arm]), el('span', (origin === 'example' ? '示例 · ' : '') + outcome, 'study-outcome'),
      el('p', cell.attempts.length ? '首轮' + (cell.firstPass ? '通过' : '未通过') + ' · ' + (cell.attempts.length - 1) + ' 次返工' : '没有可用的检查记录', 'muted'));
    if (cell.attempts.length) {
      const details = el('details'); details.append(el('summary', '查看检查过程 · ' + names[cell.arm]));
      for (const a of cell.attempts) {
        const line = el('div', undefined, 'study-attempt'); line.append(el('p', (origin === 'example' ? '示例 ' : '') + '第 ' + a.round + ' 轮 · ' + statuses[a.status]),
          el('p', (origin === 'example' ? '示例设定：' : '') + (a.executed ? '已尝试独立测试执行' : '未执行生成代码'), 'muted'));
        if (a.status === 'invalid_code') line.append(el('p', a.admission ? rules[a.admission.rule] + ' · AST: ' + a.admission.node : '旧记录未保存具体准入原因，无法追溯语法。', 'muted'));
        details.append(line);
      }
      details.append(el('p', (origin === 'example' ? '示例设定：' : '') + (cell.reference ? '该任务已提供经验参考。' : '该任务未提供经验参考。'), 'muted')); article.append(details);
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
    const r = report, isExample = origin === 'example'; content.hidden = false;
    scope.textContent = isExample ? '内置合成示例 · 数据与计时均为预制，未运行研究或调用模型'
      : '文件标记：' + (r.scope === 'live' ? '真实模型请求' : '合成夹具 · 无真实模型收益') + ' · 本机文件 · 源码 ' + r.sourceCommit.slice(0, 12);
    provenance.textContent = isExample ? '示例仅用于学习如何读报告，不是导入文件、真实研究、预算账本或效果证据。下方金额、请求次数与耗时均为模拟设定。'
      : '本机文件已通过结构一致性检查；本页未独立核对原始账本、测试或服务商账单。';
    metrics.replaceChildren();
    for (const [title, value, note, tone] of [
      ['研究流程', r.recorded + ' / 36 已记录', isExample ? '示例模拟中止；没有任务正在运行' : r.complete ? '流程完成；不代表所有任务通过' : '流程未完成；未知及未尝试已保留', r.complete ? 'success' : 'warning'],
      ['任务验收', r.arms.reduce((n, a) => n + a.final, 0) + ' / 36 通过', isExample ? '示例预制的检查状态，不是实际验收' : '按独立检查记录统计，不以模型自述判断', 'brand'],
      [isExample ? '模拟费用上界' : '峰值费用上界', money(r.upper), isExample ? '预制模拟金额，未产生费用' : r.scope === 'fixture' ? '夹具模拟金额，非真实费用' : '完整响应 ' + r.responses + ' / ' + r.calls + ' 次；尚非实际账单', 'warning'],
    ]) { const card = el('article', undefined, 'study-metric'); card.dataset.tone = tone; card.append(el('h3', title, 'study-metric-label'), el('strong', value), el('p', note, 'muted')); metrics.append(card); }
    if (r.held) metrics.append(el('p', (isExample ? '示例未知占额 ' : '未知费用预留 ') + money(r.held) + (isExample ? '：模拟一次缺失回执，不是你的账户费用。' : '，未退回或归零。'), 'notice warning'));
    if (!r.frozenUnchanged) metrics.append(el('p', '运行冻结检查未保持一致，不能作有效收益比较。', 'notice warning'));
    timing.replaceChildren(el('summary', '时间花在哪里'));
    if (!r.timing) timing.append(el('p', '报告未记录完整耗时，无法拆分；不会从调用次数推测。', 'muted'));
    else {
      const t = r.timing;
      timing.append(el('p', (isExample ? '示例模拟试验阶段共 ' : '任务试验阶段共 ') + (t.elapsedMs / 1000).toFixed(1) + ' 秒；此前安装、准备和启动前核对未计入。', 'muted'));
      for (const [label, ms] of [['运行检查', t.guardMs], ['请求与完整响应', t.providerMs], ['其余流程', t.otherMs]] as const) {
        const part = el('div', undefined, 'study-timing-row'), percent = t.elapsedMs ? ms / t.elapsedMs * 100 : 0;
        const line = el('p', undefined, 'study-time-label'); line.append(el('span', label), el('span', (ms / 1000).toFixed(1) + ' 秒 · ' + percent.toFixed(1) + '%'));
        const progress = el('progress'); progress.max = t.elapsedMs || 1; progress.value = ms;
        progress.setAttribute('aria-label', label); progress.setAttribute('aria-valuetext', (ms / 1000).toFixed(1) + '秒，占' + percent.toFixed(1) + '%');
        part.append(line, progress); timing.append(part);
      }
      timing.append(el('p', isExample ? '示例计时为预制数据，未运行模型或研究。' : r.scope === 'fixture' ? '夹具计时用于排查协议开销，不能当作模型速度。' : '请求与完整响应包含网络和接收等待，不等于纯模型推理；其余流程尚未细分。', 'muted'));
    }
    compare.replaceChildren();
    const baseline = r.arms[0]!.final;
    for (const a of r.arms) {
      const card = el('article', undefined, 'study-arm surface');
      card.append(el('h3', names[a.arm]), el('p', '最终通过 ' + a.final + ' / 12', 'study-score'), el('p', '首轮通过 ' + a.first + ' / 12', 'muted'));
      if (a.arm !== 'none') {
        const delta = (a.final - baseline) / 12 * 100;
        card.append(el('p', (isExample ? '示例差值（非实测）' : '相对无经验 ') + (delta > 0 ? '+' : '') + delta.toFixed(1) + ' 个百分点', 'muted'));
      }
      const list = el('dl');
      for (const [title, value] of [['失败 / 未知 / 未尝试', a.failed + ' / ' + a.unknown + ' / ' + a.unattempted], ['返工 / 请求', a.rework + ' / ' + a.requests],
        ['提供参考', a.references + ' / 12'], [isExample ? '模拟费用上界' : '峰值费用上界', money(a.upper)]]) list.append(el('dt', title), el('dd', value));
      card.append(list); compare.append(card);
    }
    renderRows();
  }
  function reset() { report = null; origin = null; content.hidden = true; metrics.replaceChildren(); compare.replaceChildren(); rows.replaceChildren(); timing.replaceChildren(); timing.open = false; scope.textContent = ''; provenance.textContent = ''; count.textContent = ''; clear.disabled = true; filter.value = 'all'; }
  clear.onclick = () => { const focus = origin === 'example' ? sample : input; generation++; reset(); input.value = ''; error.hidden = true; status.textContent = '已从本页移除报告。'; focus.focus(); };
  sample.onclick = () => { generation++; reset(); input.value = ''; error.hidden = true; report = example(); origin = 'example'; clear.disabled = false;
    status.textContent = '已打开合成示例；未读取文件或运行任务。'; render(); };
  filter.onchange = renderRows;
  input.onchange = async () => {
    const current = ++generation, file = input.files?.[0]; reset(); error.hidden = true;
    if (!file) { status.textContent = '尚未选择报告。'; return; }
    clear.disabled = false; status.textContent = '正在本页解析…';
    try {
      if (file.size > 1048576) throw new Error('size');
      const text = await file.text(); if (current !== generation) return;
      report = parse(text); origin = 'file'; status.textContent = '已读取本机报告；仅核对文件结构与汇总一致性。'; render();
    } catch {
      if (current !== generation) return;
      reset(); clear.disabled = false; status.textContent = '报告未载入。'; error.hidden = false;
      error.textContent = '无法读取：请选择不超过 1 MiB、结构及汇总一致的 schema 1 研究结果。未上传文件或执行任务。';
    }
  };
}

export const studyReportStyles = `
.study-import-actions{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.study-reading{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:0;list-style-position:inside;margin:20px 0}.study-reading li{min-width:0;font-size:.9rem}.study-reading strong{margin-right:8px}.study-reading span{display:block;color:var(--evolve-muted);margin-top:5px}
.study-timing{padding:16px 18px;margin:16px 0 24px}.study-timing summary{cursor:pointer;font-weight:600;color:var(--reforge-brand)}.study-timing[open] summary{margin-bottom:12px}.study-timing-row{margin:16px 0}.study-time-label{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.study-time-label span:last-child{font-variant-numeric:tabular-nums;color:var(--evolve-muted)}.study-timing progress{width:100%;height:8px;accent-color:var(--reforge-brand)}
.study-import{padding:20px;margin-bottom:20px}.study-import label{display:block;font-weight:600;margin:16px 0 8px}.study-import input{max-width:100%;margin:0 12px 12px 0}.study-import input::file-selector-button{font:inherit;border:1px solid var(--evolve-border);border-radius:6px;padding:8px 12px;background:var(--evolve-background);color:var(--evolve-text);margin-right:12px;cursor:pointer}.study-error{color:var(--reforge-danger)}
.study-scope{font-weight:600;margin:16px 0}.study-metrics,.study-arms,.study-pair-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.study-metrics{margin-bottom:16px}.study-metric,.study-cell{border:1px solid var(--evolve-border);border-radius:6px;background:var(--evolve-background);padding:18px;min-width:0}.study-metric{border-top:3px solid var(--reforge-brand)}.study-metric[data-tone=success]{border-top-color:var(--reforge-success)}.study-metric[data-tone=warning]{border-top-color:var(--reforge-warning)}.study-metric strong{font-size:1.6rem;font-variant-numeric:tabular-nums}.study-metrics>.notice{grid-column:1/-1}.study-arms{margin:16px 0}.study-arm{padding:18px;min-width:0}.study-score{font-size:1.3rem;font-weight:650}.study-arm dl{display:grid;grid-template-columns:1fr auto;gap:10px;font-size:.9rem;margin:16px 0 0}.study-arm dt{color:var(--evolve-muted)}.study-arm dd{margin:0;font-variant-numeric:tabular-nums}.study-toolbar{display:flex;align-items:center;gap:12px;margin:24px 0 8px;flex-wrap:wrap}.study-pairs{display:grid;gap:22px;margin-top:18px}.study-cell h4{font-size:1rem;margin:0 0 10px}.study-outcome{display:inline-block;padding:3px 9px;border-radius:4px;background:var(--reforge-brand-bg);color:var(--reforge-brand);font-weight:600}.study-cell[data-outcome=accepted] .study-outcome{background:var(--reforge-success-bg);color:var(--reforge-success)}.study-cell[data-outcome=failed] .study-outcome{background:var(--reforge-danger-bg);color:var(--reforge-danger)}.study-cell[data-outcome=unknown] .study-outcome{background:var(--reforge-warning-bg);color:var(--reforge-warning)}.study-cell[data-outcome=unattempted] .study-outcome{background:var(--evolve-surface);color:var(--evolve-muted)}.study-cell details{margin-top:14px}.study-cell summary{cursor:pointer;color:var(--reforge-brand)}.study-attempt{border-top:1px solid var(--evolve-border);padding-top:10px;margin-top:10px}
@media(max-width:700px){.study-metrics,.study-arms,.study-pair-grid,.study-reading{grid-template-columns:1fr}.study-import,.study-metric,.study-arm,.study-cell{padding:16px}.study-import input{width:100%}.study-arm dl{grid-template-columns:1fr auto}}
`;
