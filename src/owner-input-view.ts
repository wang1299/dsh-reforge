/** Stable browser form: polling updates status and options, never replaces the user's inputs. */
export function installOwnerInput(root: HTMLElement, port: {
  request(path: string, method?: string, input?: unknown): Promise<unknown>;
  experiences(): { id: string; revision: number; title: string }[];
}, goals: Record<string, string>) {
  type Preview = { instanceId: string; previewId: string; sha256: string; rulesRevision: number; expiresAt: number;
    path: string; property: string; facts: Record<string, string | boolean>; goal: string | null; summary: string | null };
  type Rule = { experienceId: string; experienceRevision: number; revision: number; enabled: boolean; path: string; property: string;
    allowedGoals: string[]; contract: { requires: { field: string; oneOf: (string | boolean)[] }[] } };
  type Receipt = { id: string; phase: string; reason: string; goal: string; path: string; property: string; taskId: string | null };
  type State = { available: boolean; canSubmit: boolean; reason: string; mode?: string; rulesRevision?: number; rules: Rule[]; receipts: Receipt[] };
  let state: State | null = null, source: Preview | null = null, prepared: Preview | null = null, busy = false, reading = false;
  let consumed = false, requestId: string | null = null, expectedRule = 0;
  let declarationExperience: { id: string; revision: number } | null = null;
  let rulesFingerprint = '', receiptsFingerprint = '', restoreRuleFocus = false;
  let ruleControls: HTMLButtonElement[] = [];
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node;
  };
  const field = (label: string, control: HTMLElement) => { const box = el('label', label, 'owner-field'); box.append(control); return box; };
  const control = (label: string, callback: () => void | Promise<void>, cls = 'quiet') => {
    const button = el('button', label, cls); button.type = 'button'; button.onclick = callback; return button;
  };
  const hint = el('p', '正在读取当前对话能力…', 'owner-capability'); hint.setAttribute('role', 'status');
  const status = el('p', '', 'owner-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const path = el('input'); path.placeholder = '例如 contract.schema.json'; path.maxLength = 250; path.setAttribute('aria-label', 'Schema 相对路径');
  const property = el('input'); property.placeholder = '例如 state'; property.maxLength = 64; property.setAttribute('aria-label', '要核对的字段');
  const text = el('textarea'); text.rows = 3; text.maxLength = 2000; text.placeholder = '描述本次要完成的任务'; text.setAttribute('aria-label', '本次任务');
  const goal = el('select'); goal.setAttribute('aria-label', '本次任务目标');
  const option = (value: string, label: string) => { const o = el('option', label); o.value = value; return o; };
  goal.append(option('', '请选择明确目标')); for (const [value, label] of Object.entries(goals)) goal.append(option(value, label));
  const facts = el('div', undefined, 'owner-facts'); const confirmation = el('div', undefined, 'owner-confirmation'); confirmation.hidden = true;
  const receiptList = el('div', undefined, 'owner-receipts'); const ruleList = el('div', undefined, 'owner-rules');
  const editor = el('details', undefined, 'fold owner-rule-editor'); editor.append(el('summary', '管理经验适用条件'));
  const experience = el('select'); experience.setAttribute('aria-label', '声明条件的经验'); experience.append(option('', '选择一条经验'));
  const selectedFields = new Map<string, HTMLInputElement>(); const selectedGoals = new Map<string, HTMLInputElement>();
  const prerequisites = el('fieldset'); prerequisites.append(el('legend', '明确选取必要前提'));
  const fieldNames: Record<string, string> = { field_required: '字段必须存在', field_nullable: '字段是否允许 null', field_type: '字段类型' };
  for (const [name, label] of Object.entries(fieldNames)) { const input = el('input'); input.type = 'checkbox'; input.checked = false; selectedFields.set(name, input); prerequisites.append(field(label, input)); }
  const permitted = el('fieldset'); permitted.append(el('legend', '允许参考的任务目标'));
  for (const [name, label] of Object.entries(goals)) { const input = el('input'); input.type = 'checkbox'; input.checked = false; selectedGoals.set(name, input); permitted.append(field(label, input)); }
  const ruleVersion = el('p', '先检查来源文件，再选择经验和条件。', 'muted');
  const sourceCheck = control('检查文件与字段', () => run(async () => {
    source = await port.request('/api/owner-input/source-preview', 'POST', { path: path.value.trim(), property: property.value.trim() }) as Preview;
    const selected = port.experiences().find(e => e.id === experience.value);
    declarationExperience = selected ? { id: selected.id, revision: selected.revision } : null;
    expectedRule = state?.rules.find(r => r.experienceId === experience.value)?.revision ?? 0;
    renderFacts(source); ruleVersion.textContent = '声明依据为本次预览；保存只增加适用检查，不代表策略已验证。';
    tell('文件已核对。请检查下面的三项事实，再选择适用条件。');
  }));
  const preview = control('预览当前任务', () => run(async () => {
    prepared = await port.request('/api/owner-input/task-preview', 'POST', { path: path.value.trim(), property: property.value.trim(), text: text.value.trim(), goal: goal.value }) as Preview;
    requestId = crypto.randomUUID(); renderFacts(prepared); confirmation.replaceChildren(); confirmation.hidden = false;
    confirmation.append(el('h3', '确认提交内容'), el('p', goals[prepared.goal!] + ' · ' + prepared.path + ' → ' + prepared.property),
      el('p', prepared.summary ?? '', 'owner-summary'), el('p', '将发送你填写的完整任务，以上为最多256字符的脱敏摘要预览。预览有效期2分钟。', 'muted'));
    tell('预览完成。确认文件、字段和目标后，再提交当前对话。');
  }), 'primary');
  const submit = control('确认并提交当前对话', () => run(async () => {
    if (!prepared || !requestId || consumed) return;
    const body = { instanceId: prepared.instanceId, previewId: prepared.previewId, idempotencyKey: requestId };
    consumed = true; // Any uncertain transport is non-replayable from this page.
    try {
      const receipt = await port.request('/api/owner-input/submit', 'POST', body) as Receipt;
      tell('已取得提交回执 ' + receipt.id.slice(0, 8) + '。回执和回合结束均不代表任务验收通过。');
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      const denied = typeof code === 'string' && ['owner_source_changed', 'owner_preview_expired', 'owner_sharing_disabled', 'owner_conversation_changed',
        'owner_repository_mismatch', 'owner_model_changed', 'owner_conversation_busy', 'owner_conversation_required', 'owner_message_limit', 'owner_receipt_limit', 'conflict'].includes(code);
      if (denied) {
        consumed = false; prepared = null; requestId = null; confirmation.hidden = true;
        tell('本次在提交前已被拦截，没有发送任务。草稿已保留，请核对后重新预览；不会自动发送。' + errorMessage(error));
      } else tell('提交结果待核对，草稿已保留。请刷新下方回执；本页不会重新发送。' + errorMessage(error));
    }
    await read();
  }), 'primary');
  const save = control('保存所选适用条件', () => run(async () => {
    const exp = port.experiences().find(e => e.id === experience.value);
    if (!source || !exp || declarationExperience?.id !== exp.id || declarationExperience.revision !== exp.revision) { tell('请重新检查来源文件并确认当前经验版本。'); return; }
    const fields = [...selectedFields].filter(([, c]) => c.checked).map(([name]) => name);
    const allowedGoals = [...selectedGoals].filter(([, c]) => c.checked).map(([name]) => name);
    if (!fields.length || !allowedGoals.length) { tell('至少选择一个必要前提和一个允许的任务目标。'); return; }
    await port.request('/api/owner-input/declare', 'POST', { previewId: source.previewId, experienceId: exp.id, experienceRevision: exp.revision,
      expectedGlobal: source.rulesRevision, expectedRule, fields, allowedGoals });
    source = null; tell('适用条件已保存。请重新预览任务，使用最新条件。'); prepared = null; confirmation.hidden = true; await read();
  }), 'primary');
  const fresh = control('准备另一项任务', () => {
    consumed = false; prepared = null; requestId = null; confirmation.hidden = true; text.value = ''; goal.value = ''; tell('请填写新的任务并重新预览。'); lock(); text.focus();
  }); fresh.hidden = true;
  const actions = el('div', undefined, 'owner-actions'); actions.append(sourceCheck, preview);
  const sendActions = el('div', undefined, 'owner-actions'); sendActions.append(submit, fresh);
  const inputs = el('div', undefined, 'owner-source-fields'); inputs.append(field('Schema 相对路径', path), field('要核对的字段', property));
  root.append(el('p', '在模型开始前核对', 'eyebrow'), el('h2', '准备下一次任务'), hint,
    el('p', '明确任务目标与文件事实，让不适用的经验留在经验库。', 'muted'), inputs, field('本次任务', text), field('本次任务目标', goal), actions, facts, confirmation,
    el('p', '提交会使用当前对话模型，可能产生该模型的费用。DSH按自身规则保存对话；本插件仅保留最多256字符的脱敏任务摘要和有界来源记录。', 'owner-cost'), sendActions, status);
  const permission = el('p', '', 'muted'); root.append(permission);
  editor.append(el('p', '旧经验不会自动补条件。你声明的是具体版本的必要前提；经验修订后需重新声明。', 'muted'), field('经验', experience), ruleVersion, prerequisites, permitted, save, ruleList);
  root.append(editor, el('h3', '最近提交回执'), el('p', '这里只保留最近12条展示。结果未知时请核对原对话，不要重复发送。', 'muted'), control('刷新能力与回执', read), receiptList);
  function errorMessage(error: unknown): string { return error instanceof Error ? ' ' + error.message : ''; }
  function tell(message: string) { status.textContent = message; }
  function renderFacts(p: Preview) {
    facts.replaceChildren(el('h3', '从文件核对的事实'));
    for (const [key, label] of Object.entries(fieldNames)) facts.append(el('p', label + '：' + String(p.facts[key]), 'owner-fact'));
    facts.append(el('p', p.path + ' → ' + p.property + ' · 摘要 ' + p.sha256.slice(0, 12), 'muted'));
  }
  function lock() {
    for (const input of [path, property, text, goal, experience, ...selectedFields.values(), ...selectedGoals.values()]) input.disabled = busy;
    sourceCheck.disabled = busy; save.disabled = busy || !source;
    preview.disabled = busy || consumed || !state?.canSubmit;
    submit.disabled = busy || consumed || !prepared || !state?.canSubmit || prepared.expiresAt <= Date.now();
    for (const button of [sourceCheck, preview, submit, save]) button.setAttribute('aria-busy', String(busy));
    for (const button of ruleControls) button.disabled = busy;
    const receipt = state?.receipts.find(r => r.id === requestId);
    fresh.hidden = !consumed || !receipt || !['ended', 'blocked'].includes(receipt.phase); fresh.disabled = busy;
  }
  async function run(operation: () => Promise<void>) {
    if (busy) return; busy = true; lock();
    try { await operation(); } catch (error) { tell('未完成操作，当前输入已保留。' + errorMessage(error)); }
    finally { busy = false; lock(); if (restoreRuleFocus) { experience.focus(); restoreRuleFocus = false; } }
  }
  function invalidate(sourceChanged = false) {
    if (sourceChanged) { source = null; declarationExperience = null; facts.replaceChildren(); }
    if (consumed) { tell('当前编辑不会改变已经提交的任务；来源变化后需要重新核对。'); lock(); return; }
    prepared = null; requestId = null; confirmation.hidden = true;
    tell('输入已变更，请重新预览后提交。'); lock();
  }
  path.oninput = () => invalidate(true); property.oninput = () => invalidate(true); text.oninput = () => invalidate(); goal.onchange = () => invalidate();
  function changeExperience() { expectedRule = state?.rules.find(r => r.experienceId === experience.value)?.revision ?? 0; source = null; declarationExperience = null;
    ruleVersion.textContent = '已选择经验，请重新检查文件以锁定本次声明的版本。'; lock(); }
  experience.onchange = changeExperience;
  let experienceSignature = '';
  function updateExperiences() {
    const bank = port.experiences(); const signature = JSON.stringify(bank.map(e => [e.id, e.revision, e.title]));
    if (signature === experienceSignature) return; experienceSignature = signature;
    const selected = experience.value; experience.replaceChildren(option('', '选择一条经验'));
    for (const exp of bank) experience.append(option(exp.id, exp.title + ' · v' + exp.revision));
    if (bank.some(e => e.id === selected)) experience.value = selected;
  }
  async function read() {
    if (reading) return; reading = true;
    try {
      const next = await port.request('/api/owner-input/state') as State;
      if (typeof next?.available !== 'boolean') return; state = next; root.hidden = false;
      const reasons: Record<string, string> = { ready: '当前对话可以接收新任务', owner_conversation_required: '请从当前对话的“经验”页提交；此入口可以核对文件和管理条件。',
        owner_sharing_disabled: '模型共享尚未开启。仍可检查文件和管理条件。', owner_conversation_busy: '当前对话正在处理任务或有待处理输入，请等待结束。',
        owner_configuration_unavailable: '适用条件数据不可用，已停止提供受保护经验。请核对完整数据目录。' };
      hint.textContent = reasons[next.reason] ?? '当前对话暂不可提交，请刷新核对。';
      permission.textContent = next.mode === 'automatic' ? '按已有自动学习配置处理，不增加提炼授权。' : '本入口仅提供参考：任务结束后不排队学习或提炼。';
      updateExperiences();
      const rulesKey = JSON.stringify([next.rules, port.experiences()]);
      if (rulesKey !== rulesFingerprint) {
      rulesFingerprint = rulesKey; restoreRuleFocus = ruleControls.some(c => document.activeElement === c); ruleControls = []; ruleList.replaceChildren();
      for (const rule of next.rules ?? []) {
        const card = el('article', undefined, 'owner-record'); const exp = port.experiences().find(e => e.id === rule.experienceId);
        card.append(el('strong', (exp?.title ?? '经验已不可用') + ' · v' + rule.experienceRevision),
          el('p', !rule.enabled ? '已停止检查此规则' : exp?.revision !== rule.experienceRevision ? '经验已修订，原条件过期；请重新声明。' : '适用条件已启用'),
          el('p', rule.path + ' → ' + rule.property), el('p', rule.contract.requires.map(r => fieldNames[r.field] + ' = ' + r.oneOf.join('、')).join('；')),
          el('p', '允许目标：' + rule.allowedGoals.map(g => goals[g]).join('、')));
        if (rule.enabled) { const stop = control('停止检查此规则', () => run(async () => {
          await port.request('/api/owner-input/disable', 'POST', { experienceId: rule.experienceId, expectedGlobal: next.rulesRevision, expectedRule: rule.revision });
          tell('已停止该规则检查。准备任务仍要求明确声明过适用条件。'); prepared = null; source = null; confirmation.hidden = true; await read();
        })); ruleControls.push(stop); card.append(stop); }
        ruleList.append(card);
      }
      if (restoreRuleFocus && !busy) { experience.focus(); restoreRuleFocus = false; }
      }
      const receiptsKey = JSON.stringify(next.receipts);
      if (receiptsKey !== receiptsFingerprint) {
      receiptsFingerprint = receiptsKey;
      receiptList.replaceChildren(); const phases: Record<string, string> = { reserved: '已预留，等待确认', submitted: '已提交，等待处理', bound: '已绑定本次任务', ended: '回合已结束，尚非验收', blocked: '已拦截', unknown: '结果未知，请核对原对话' };
      for (const receipt of next.receipts ?? []) {
        const card = el('article', undefined, 'owner-record'); card.setAttribute('data-phase', receipt.phase);
        card.append(el('strong', phases[receipt.phase] ?? '状态待核对'), el('p', goals[receipt.goal] + ' · ' + receipt.path + ' → ' + receipt.property),
          el('small', '回执 ' + receipt.id.slice(0, 8) + (receipt.taskId ? ' · 任务 ' + receipt.taskId.slice(0, 8) : ''))); receiptList.append(card);
      }
      if (!next.receipts?.length) receiptList.append(el('p', '尚未从此入口提交任务。', 'muted'));
      }
      lock();
    } catch { hint.textContent = '暂时无法读取提交状态；当前输入已保留，请刷新核对。'; if (state) state.canSubmit = false; lock(); }
    finally { reading = false; }
  }
  lock();
  return { refresh: read, edit(id: string) { updateExperiences(); experience.value = id; changeExperience(); editor.open = true; (root as HTMLDetailsElement).open = true; root.scrollIntoView({ block: 'start' }); path.focus(); } };
}

export const ownerInputStyles = `
.owner-input{border:1px solid var(--evolve-border,#dce1e7);border-top:3px solid var(--reforge-brand,#206bc4);border-radius:8px;padding:20px;margin-bottom:28px;background:var(--evolve-background,#fff)}
.owner-input h2{margin-top:4px}.owner-input h3{font-size:15px}.owner-field{display:grid;gap:7px;margin:12px 0;font-weight:500}.owner-source-fields{display:grid;grid-template-columns:2fr 1fr;gap:12px}
.owner-field input:not([type=checkbox]),.owner-field select,.owner-field textarea{box-sizing:border-box;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--evolve-border,#dce1e7);border-radius:6px;background:var(--evolve-background,#fff);color:inherit;font:inherit}.owner-field textarea{resize:vertical}
.owner-actions{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.owner-actions button{min-height:42px}.owner-facts{display:grid;gap:6px}.owner-fact{margin:0;padding:8px 12px;background:var(--evolve-surface,#edf5ff);border-radius:5px}.owner-capability{font-weight:600;color:var(--reforge-brand,#206bc4)}
.owner-confirmation,.owner-cost{padding:12px;border-radius:6px;border:1px solid var(--evolve-border,#dce1e7);background:var(--evolve-surface,#f7f9fc);line-height:1.65}.owner-summary{white-space:pre-wrap;overflow-wrap:anywhere}.owner-status{line-height:1.65;white-space:pre-wrap}.owner-input fieldset{border:1px solid var(--evolve-border,#dce1e7);border-radius:6px;margin:12px 0}.owner-input fieldset .owner-field{display:flex;flex-direction:row-reverse;justify-content:flex-end;align-items:center;font-weight:400;gap:8px}.owner-input input[type=checkbox]{width:17px;height:17px;accent-color:var(--reforge-brand,#206bc4)}
.owner-record{padding:12px 0;border-bottom:1px solid var(--evolve-border,#dce1e7);overflow-wrap:anywhere}.owner-record p{margin:6px 0}.owner-record[data-phase=unknown]{border-left:3px solid #d97706;padding-left:10px}.owner-input:focus-within{border-color:var(--reforge-brand,#206bc4)}
@media(max-width:600px){.owner-input{padding:14px}.owner-source-fields{grid-template-columns:1fr;gap:0}.owner-actions{flex-direction:column}.owner-actions button{width:100%}}
`;
