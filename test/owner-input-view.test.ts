import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { installOwnerInput } from '../src/owner-input-view.js';
import { ownerGoalLabels } from '../src/owner-input-copy.js';

function browser(canSubmit = true) {
  const elements: Element[] = [];
  class Element {
    value = ''; textContent = ''; className = ''; type = ''; hidden = false; disabled = false; checked = false; open = false;
    children: Element[] = []; attributes = new Map<string, string>();
    onclick?: () => Promise<void> | void; oninput?: () => void; onchange?: () => void;
    constructor(readonly tag: string) { elements.push(this); }
    set innerHTML(_value: string) { throw new Error('HTML injection is forbidden'); }
    append(...nodes: Element[]) { if (this.tag === 'select' && !this.children.length && nodes[0]?.tag === 'option') this.value = nodes[0].value; this.children.push(...nodes); }
    replaceChildren(...nodes: Element[]) { this.textContent = ''; this.children = nodes; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    scrollIntoView() {} focus() { document.activeElement = this; }
  }
  const document = { activeElement: null as Element | null, createElement: (tag: string) => new Element(tag) };
  const root = new Element('details'); const exp = { id: randomUUID(), revision: 1, title: '<img src=x> transaction rollback' };
  const current = { available: true, canSubmit, reason: canSubmit ? 'ready' : 'owner_conversation_required', mode: 'context_only', rulesRevision: 0,
    rules: [] as { experienceId: string; experienceRevision: number; revision: number; enabled: boolean; path: string; property: string; allowedGoals: string[]; contract: { requires: { field: string; oneOf: boolean[] }[] } }[], receipts: [] };
  const posts: { path: string; body: Record<string, unknown> }[] = []; let unknown = false; let offline = false; let denied = '';
  const preview = { instanceId: randomUUID(), previewId: randomUUID(), sha256: 'a'.repeat(64), rulesRevision: 0, expiresAt: Date.now() + 120000,
    path: 'contract.schema.json', property: 'state', facts: { field_required: true, field_nullable: false, field_type: 'object' }, goal: 'repair_behavior', summary: 'Bounded summary' };
  const port = { experiences: () => [exp], request: async (path: string, method = 'GET', input?: unknown) => {
    if (method === 'GET') { if (offline) throw new Error('Synthetic offline'); return structuredClone(current); }
    const body = input as Record<string, unknown>; posts.push({ path, body });
    if (path.endsWith('/submit') && denied) throw Object.assign(new Error('Known pre-reserve rejection'), { code: denied });
    if (path.endsWith('/submit') && unknown) throw new Error('Synthetic interrupted response');
    if (path.endsWith('-preview')) return { ...preview };
    return { id: body.idempotencyKey, phase: 'submitted' };
  } };
  const context = createContext({ document, root, port, goals: ownerGoalLabels, crypto: { randomUUID }, console });
  new Script('var view=(' + installOwnerInput.toString() + ')(root,port,goals);').runInContext(context);
  const view = new Script('view').runInContext(context) as ReturnType<typeof installOwnerInput>;
  const get = (label: string) => elements.find(e => e.attributes.get('aria-label') === label)!;
  const button = (label: string) => elements.find(e => e.tag === 'button' && e.textContent === label)!;
  const fill = () => { get('Schema 相对路径').value = preview.path; get('要核对的字段').value = preview.property; get('本次任务').value = 'Keep my actual task draft'; get('本次任务目标').value = 'repair_behavior'; };
  const allText = (node: Element): string => node.textContent + node.children.map(allText).join('');
  return { view, root, exp, current, posts, get, button, fill, elements, document, allText, unknown: () => { unknown = true; }, offline: () => { offline = true; }, deny: (code: string) => { denied = code; } };
}

test('owner polling preserves draft, explicit goal and focus; an unavailable read disables confirmation', async () => {
  const b = browser(); await b.view.refresh(); b.fill(); const task = b.get('本次任务'); task.focus();
  await b.button('预览当前任务').onclick!(); assert.equal(b.button('确认并提交当前对话').disabled, false);
  await b.view.refresh(); assert.equal(b.get('本次任务'), task); assert.equal(task.value, 'Keep my actual task draft');
  assert.equal(b.get('本次任务目标').value, 'repair_behavior'); assert.equal(b.document.activeElement, task);
  b.offline(); await b.view.refresh(); assert.equal(b.button('确认并提交当前对话').disabled, true);
  assert.equal(b.posts.filter(p => p.path.endsWith('/submit')).length, 0);
});

test('unknown owner submission is sent once, keeps its draft and cannot be retried with another click or poll', async () => {
  const b = browser(); await b.view.refresh(); b.fill(); await b.button('预览当前任务').onclick!(); b.unknown();
  await b.button('确认并提交当前对话').onclick!(); await b.button('确认并提交当前对话').onclick!(); await b.view.refresh();
  assert.equal(b.posts.filter(p => p.path.endsWith('/submit')).length, 1); assert.equal(b.button('确认并提交当前对话').disabled, true);
  assert.match(b.allText(b.root), /提交结果待核对/); assert.equal(b.get('本次任务').value, 'Keep my actual task draft');
});

test('source/rule controls are explicit, preserve captured revisions and insert untrusted labels as text', async () => {
  const b = browser(false); await b.view.refresh(); b.fill(); assert.equal(b.button('预览当前任务').disabled, true);
  b.view.edit(b.exp.id); await b.button('检查文件与字段').onclick!();
  assert.match(b.allText(b.root), /field|字段/); assert.ok(b.elements.some(e => e.tag === 'option' && e.textContent.includes('<img src=x>')));
  assert.equal(b.elements.some(e => e.tag === 'img'), false);
  for (const e of b.elements.filter(e => e.type === 'checkbox')) e.checked = true;
  b.current.rulesRevision = 4; await b.view.refresh(); b.exp.revision = 2; await b.view.refresh();
  await b.button('保存所选适用条件').onclick!(); assert.equal(b.posts.filter(p => p.path.endsWith('/declare')).length, 0);
  assert.match(b.allText(b.root), /确认当前经验版本/);
  b.exp.revision = 1; await b.view.refresh(); await b.button('保存所选适用条件').onclick!();
  const declaration = b.posts.find(p => p.path.endsWith('/declare'))!; assert.ok(declaration); assert.equal(declaration.body.expectedGlobal, 0);
  assert.equal(declaration.body.experienceRevision, 1); assert.equal(declaration.body.expectedRule, 0);
});

test('a proven pre-reserve rejection retains the draft and requires a fresh preview before any new explicit attempt', async () => {
  const b = browser(); await b.view.refresh(); b.fill(); await b.button('预览当前任务').onclick!(); b.deny('owner_source_changed');
  await b.button('确认并提交当前对话').onclick!();
  assert.match(b.allText(b.root), /提交前已被拦截/); assert.equal(b.get('本次任务').value, 'Keep my actual task draft');
  assert.equal(b.button('确认并提交当前对话').disabled, true); assert.equal(b.button('预览当前任务').disabled, false);
  await b.view.refresh(); assert.equal(b.posts.filter(p => p.path.endsWith('/submit')).length, 1);
  await b.button('预览当前任务').onclick!(); assert.equal(b.button('确认并提交当前对话').disabled, false);
  assert.equal(b.posts.filter(p => p.path.endsWith('/submit')).length, 1, 'Preview is not another submission');
});

test('changing a source after an uncertain submit invalidates rule source independently of the non-replayable task', async () => {
  const b = browser(); await b.view.refresh(); b.fill(); b.view.edit(b.exp.id); await b.button('检查文件与字段').onclick!();
  assert.equal(b.button('保存所选适用条件').disabled, false); await b.button('预览当前任务').onclick!(); b.unknown(); await b.button('确认并提交当前对话').onclick!();
  b.get('Schema 相对路径').value = 'other.schema.json'; b.get('Schema 相对路径').oninput!();
  assert.equal(b.button('保存所选适用条件').disabled, true); assert.equal(b.button('确认并提交当前对话').disabled, true);
  assert.equal(b.posts.filter(p => p.path.endsWith('/submit')).length, 1);
});

test('unchanged owner polling preserves a focused rule control instead of rebuilding it', async () => {
  const b = browser(); b.current.rules.push({ experienceId: b.exp.id, experienceRevision: 1, revision: 1, enabled: true,
    path: 'contract.schema.json', property: 'state', allowedGoals: ['repair_behavior'], contract: { requires: [{ field: 'field_nullable', oneOf: [false] }] } });
  await b.view.refresh(); const stop = b.button('停止检查此规则'); stop.focus(); const count = b.elements.filter(e => e.textContent === '停止检查此规则').length;
  await b.view.refresh(); assert.equal(b.elements.filter(e => e.textContent === '停止检查此规则').length, count); assert.equal(b.document.activeElement, stop);
});
