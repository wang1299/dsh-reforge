import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { renderPanel } from '../src/panel-view.js';

// A small DOM port exercises the shipped client, including real event callbacks.
// Layout, native controls and accessibility are separately checked in a browser.
function browser() {
  class Element {
    id = ''; value = ''; hidden = false; open = false; className = ''; textContent = ''; type = '';
    children: Element[] = []; attributes = new Map<string, string>(); listeners = new Map<string, () => void>();
    onclick?: () => Promise<void> | void; onchange?: () => void; oninput?: () => void;
    classList = { toggle: (_name: string, _value: boolean) => undefined };
    constructor(readonly tag: string) { elements.push(this); }
    set innerHTML(_value: string) { throw new Error('Untrusted HTML insertion is forbidden'); }
    append(...children: Element[]) { if (this.tag === 'select' && this.children.length === 0 && children[0]?.tag === 'option') this.value = children[0].value; this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    closest() { return null; }
    focus() { document.activeElement = this; }
    scrollIntoView() { /* no layout in this port */ }
  }
  const elements: Element[] = [];
  const html = renderPanel('unit-test-nonce'); const markup = html.slice(0, html.indexOf('<script'));
  for (const match of markup.matchAll(/id="([^"]+)"/g)) { const element = new Element('static'); element.id = match[1]!; }
  const get = (id: string) => elements.findLast(e => e.id === id)!;
  get('filter').value = 'all'; get('records').open = false;
  const document: { activeElement: Element | null; hidden: boolean; getElementById: typeof get; createElement: (tag: string) => Element; addEventListener: () => void } = {
    activeElement: null, hidden: false, getElementById: get, createElement: tag => new Element(tag), addEventListener: () => undefined,
  };
  const exp = { id: 'experience-one', revision: 1, status: 'candidate', title: '<img src=x onerror=alert(1)>', strategy: 'Restore the prior state', observedFacts: ['A correction was recorded'], inferences: [], recommendations: [], scope: { repoId: 'repo', requiredFiles: { 'ledger.py': 'a'.repeat(64) } }, sourceTaskId: 'source', verificationId: null, createdAt: '2026-10-20T00:00:00Z' };
  const current = { experiences: [exp], tasks: [{ id: 'source', summary: '转账失败时恢复余额' }, { id: 'target', summary: '库存异常后数量不正确' }], applications: [{ id: 'application-one', taskId: 'target', experienceId: exp.id, revision: 1, createdAt: exp.createdAt }], feedback: [] as { id: string; applicationId: string; outcome: string; note: string; createdAt: string }[], evidence: [{ id: 'source-evidence', taskId: 'source', repoId: 'repo', kind: 'correction', note: 'restore balance', digest: 'd' }], verifications: {}, histories: { [exp.id]: [exp] }, provenance: { [exp.id]: { 1: { complete: false, facts: [{ factIndex: 0, factDigest: 'f' }], citations: [] } } }, learningJobs: [{ id: 'job-one', state: 'succeeded', input: { taskId: 'source', baseCommit: 'a'.repeat(40), fixCommit: 'b'.repeat(40), sources: [], observations: [] } }], evidenceBundles: [], extractionJobs: [{ id: 'extraction-one', evidenceJobId: 'job-one', state: 'candidate', reason: 'extracted', candidateId: exp.id, policy: { provider: 'offline', model: 'fixture' } }], extractionGrants: [] };
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let offline = false; let postStatus = 409;
  const context = createContext({ document, URLSearchParams, Intl, Date, JSON, crypto: { randomUUID }, location: { hash: '#token=fixture', pathname: '/' }, history: { replaceState: () => undefined }, setInterval: () => undefined,
    fetch: async (path: string, init: { method: string; body?: string }) => {
      if (offline) throw new Error('Synthetic offline');
      if (init.method === 'POST') { posts.push({ path, body: JSON.parse(init.body!) as Record<string, unknown> }); if (postStatus === 0) throw new Error('Synthetic interrupted response'); return { ok: postStatus === 200, json: async () => ({ error: 'Experience changed; refresh before editing' }) }; }
      return { ok: true, json: async () => structuredClone(current) };
    },
  });
  new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!).runInContext(context);
  const run = async (code: string) => { await new Promise<void>(resolve => setImmediate(resolve)); await new Script(code).runInContext(context) as Promise<void>; };
  const descendants = (root: Element): Element[] => root.children.flatMap(e => [e, ...descendants(e)]);
  const control = (label: string) => descendants(get('detail')).find(e => e.attributes.get('aria-label') === label)!;
  const click = async (text: string) => { const control = descendants(get('detail')).find(e => e.tag === 'button' && e.textContent === text); assert.ok(control); await control.onclick!(); };
  const clickRecordCandidate = async () => { const button = descendants(get('evidence-jobs')).find(e => e.tag === 'button' && e.textContent === '查看候选经验'); assert.ok(button); await button.onclick!(); };
  return { get, current, posts, run, control, click, clickRecordCandidate, descendants, offline: () => { offline = true; }, unknownWrites: () => { postStatus = 0; } };
}

test('workbench separates all reference records and counts unconfirmed results from the latest feedback', async () => {
  const b = browser();
  for (let i = 0; i < 6; i++) b.current.applications.push({ ...b.current.applications[0]!, id: 'additional-' + i });
  b.current.feedback.push(
    { id: 'old', applicationId: 'application-one', outcome: 'accepted', note: 'Earlier owner report', createdAt: '2026-10-20T01:00:00Z' },
    { id: 'new', applicationId: 'application-one', outcome: 'unknown', note: 'Latest result is uncertain', createdAt: '2026-10-20T02:00:00Z' },
  );
  await b.run('refresh()');
  assert.ok(b.get('nav-uses')); assert.ok(b.get('nav-learning'));
  await b.run("showView('uses')");
  assert.equal(b.get('home').hidden, true); assert.equal(b.get('uses').hidden, false);
  assert.equal(b.get('use-history').children.length, 7);
  assert.match(b.get('use-summary').textContent, /7.*结果.*未确认/);
  assert.equal(b.posts.length, 0);
});

test('workbench source-check metric and its drill-down exclude a status without matching proof', async () => {
  const b = browser(); b.current.experiences[0]!.status = 'source_verified'; await b.run('refresh()');
  const stat = b.descendants(b.get('stats')).find(e => e.attributes.get('aria-label') === '来源检查通过：0');
  assert.ok(stat); await stat.onclick!();
  assert.equal(b.get('library').hidden, false);
  assert.equal(b.get('library-list').children.some(e => e.tag === 'article'), false);
  assert.equal(b.current.experiences[0]!.status, 'source_verified'); assert.equal(b.posts.length, 0);
});

test('workbench navigation preserves an unsaved revision across reference and learning views', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = 'Keep my current draft';
  b.get('detail').listeners.get('input')!();
  await b.run("showView('uses')"); await b.run("showView('learning')");
  assert.equal(b.get('detail').hidden, false); assert.equal(b.control('处理策略'), strategy);
  assert.equal(strategy.value, 'Keep my current draft'); assert.match(b.get('message').textContent, /尚未保存/);
  assert.equal(b.posts.length, 0);
});

test('learning home renders untrusted titles as text and keeps technical editors off the default screen', async () => {
  const b = browser(); await b.run('refresh()');
  assert.equal(b.get('home').hidden, false); assert.equal(b.get('library').hidden, true); assert.equal(b.get('detail').hidden, true); assert.equal(b.get('records').open, false);
  assert.ok(b.descendants(b.get('recent')).some(e => e.tag === 'h3' && e.textContent === '转账失败时恢复余额'));
  assert.ok(b.descendants(b.get('recent')).some(e => e.tag === 'p' && e.textContent === b.current.experiences[0]!.title));
  assert.equal(b.descendants(b.get('recent')).some(e => ['input', 'select', 'textarea', 'pre'].includes(e.tag)), false);
  assert.ok(b.descendants(b.get('activity')).some(e => e.tag === 'h3' && e.textContent === '库存异常后数量不正确'));
  assert.ok(b.descendants(b.get('activity')).some(e => /任务结果.*确认/.test(e.textContent)));
  await b.run("openExperience('experience-one')");
  assert.ok(b.descendants(b.get('detail')).some(e => e.tag === 'h2' && e.textContent === '待检查的处理建议'));
  assert.ok(b.descendants(b.get('detail')).some(e => e.textContent === '当时在处理什么'));
  assert.equal(b.descendants(b.get('detail')).some(e => e.textContent === '来自一次真实修正'), false);
});

test('polling preserves a draft and its captured revision; a conflict never overwrites it', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = 'My unsaved strategy'; b.get('detail').listeners.get('input')!(); strategy.focus();
  b.current.experiences[0]!.revision = 2; await b.run('refresh()');
  assert.equal(b.control('处理策略'), strategy); assert.equal(strategy.value, 'My unsaved strategy'); assert.equal(b.get('detail-update').hidden, false); assert.equal(b.get('discard-edit').hidden, false);
  await b.click('保存为待验证版本'); assert.equal(b.posts.length, 1); assert.equal(b.posts[0]!.body.revision, 1); assert.equal(b.control('处理策略'), strategy); assert.equal(strategy.value, 'My unsaved strategy'); assert.match(b.get('message').textContent, /当前编辑已保留/);
});

test('experience reading starts with the source problem and keeps original machine text in a closed disclosure', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  assert.equal(b.get('detail-heading').textContent, '转账失败时恢复余额');
  const detail = b.descendants(b.get('detail'));
  const original = detail.find(e => e.tag === 'details' && e.children.some(c => c.tag === 'summary' && c.textContent === '查看处理方法原文'));
  assert.ok(original); assert.equal(original.open, false);
  assert.ok(b.descendants(original).some(e => e.textContent === b.current.experiences[0]!.strategy));
  assert.ok(detail.some(e => e.textContent === '当时在处理什么'));
  assert.ok(detail.some(e => e.textContent === '后来在哪里参考'));
  assert.equal(b.posts.length, 0);
});

test('a quiet learning center stays folded but an uncertain task has a visible route to its progress', async () => {
  const b = browser(); b.current.experiences[0]!.status = 'disabled';
  const task = { id: 'uncertain', title: '库存失败', status: 'waiting', summary: '正在等待材料。', next: '查看记录',
    steps: [{ label: '记录变化', state: 'done' }] };
  Object.assign(b.current, { learning: { automatic: false, checks: [], quota: null, tasks: [task] } });
  await b.run('refresh()'); assert.equal(b.get('learning-area').open, false);
  task.status = 'unknown'; task.summary = '结果尚不确定，未自动重跑。'; await b.run('refresh()');
  assert.equal(b.get('attention').hidden, false);
  assert.ok(b.descendants(b.get('attention')).some(e => e.textContent === task.summary));
  const open = b.descendants(b.get('attention')).find(e => e.tag === 'button' && e.textContent === '查看处理进度');
  assert.ok(open); await open.onclick!(); assert.equal(b.get('learning-area').open, true);
  assert.equal(b.posts.length, 0);
});

test('progress alerts navigate out of library or details while preserving an unsaved edit', async () => {
  const b = browser();
  Object.assign(b.current, { learning: { automatic: false, checks: [], quota: null, tasks: [{ id: 'uncertain', title: '库存失败', status: 'unknown', summary: '结果未知', next: '核对', steps: [] }] } });
  await b.run('refresh()');
  const follow = async () => { const control = b.descendants(b.get('attention')).find(e => e.tag === 'button' && e.textContent === '查看处理进度'); assert.ok(control); await control.onclick!(); };
  await b.run("showView('library')"); await follow();
  assert.equal(b.get('home').hidden, true); assert.equal(b.get('learning').hidden, false); assert.equal(b.get('learning-area').open, true);
  await b.run("openExperience('experience-one')"); await follow();
  assert.equal(b.get('learning').hidden, false); assert.equal(b.get('detail').hidden, true);
  await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = '不能丢失的草稿'; b.get('detail').listeners.get('input')!();
  await follow(); assert.equal(b.get('detail').hidden, false); assert.equal(b.control('处理策略'), strategy);
  assert.equal(strategy.value, '不能丢失的草稿'); assert.match(b.get('message').textContent, /尚未保存/);
  assert.equal(b.posts.length, 0);
});

test('unknown feedback submission retains its request ID and offline refresh marks existing data stale', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')"); b.control('反馈依据').value = 'Synthetic acceptance basis'; b.unknownWrites();
  await b.click('保存反馈'); await b.click('保存反馈'); assert.equal(b.posts.length, 2); assert.equal(b.posts[0]!.body.id, b.posts[1]!.body.id); assert.equal(b.posts[0]!.body.applicationId, 'application-one');
  const card = b.get('recent').children[0]; b.offline(); await b.run('refresh()'); assert.equal(b.get('recent').children[0], card); assert.equal(b.get('stale').hidden, false); assert.match(b.get('stale-text').textContent, /上次读取/);
});

test('processing history opens a candidate from home and cannot discard an existing draft', async () => {
  const b = browser(); await b.run('refresh()'); await b.clickRecordCandidate(); assert.equal(b.get('detail').hidden, false); assert.equal(b.get('home').hidden, true);
  const strategy = b.control('处理策略'); strategy.value = 'Keep this draft'; b.get('detail').listeners.get('input')!();
  await b.clickRecordCandidate(); assert.equal(b.control('处理策略'), strategy); assert.equal(strategy.value, 'Keep this draft'); assert.equal(b.get('discard-edit').hidden, false); assert.match(b.get('message').textContent, /尚未保存/);
});

test('negative feedback on an old application never claims that a newer version was disabled', async () => {
  const b = browser(); b.current.experiences[0]!.revision = 2; b.current.experiences[0]!.status = 'source_verified';
  b.current.feedback.push({ id: 'old-feedback', applicationId: 'application-one', outcome: 'rejected', note: 'Old application only', createdAt: '2026-10-20T01:00:00Z' });
  await b.run('refresh()'); let text = b.descendants(b.get('activity')).map(e => e.textContent).join('\n'); assert.match(text, /策略无效/); assert.doesNotMatch(text, /已停用/);
  b.current.feedback[0]!.outcome = 'counterexample'; await b.run('refresh()'); text = b.descendants(b.get('activity')).map(e => e.textContent).join('\n'); assert.match(text, /反例/); assert.doesNotMatch(text, /已停用/);
});

test('automatic progress is visible in plain language and unknown is never presented as learned', async () => {
  const b = browser(); const segments = [{ id: 'segment', taskId: 'source', state: 'qualifying', reason: 'verifying_candidate' }];
  Object.assign(b.current, { automaticEnabled: true, automaticSegments: segments }); await b.run('refresh()');
  let text = b.descendants(b.get('attention')).map(e => e.textContent).join('\n'); assert.match(text, /独立检查/);
  segments[0]!.state = 'unknown'; segments[0]!.reason = 'qualification_interrupted'; await b.run('refresh()');
  text = b.descendants(b.get('attention')).map(e => e.textContent).join('\n'); assert.match(text, /未自动重跑/); assert.doesNotMatch(text, /记下一条经验/);
});

test('learning center explains setup and each request, opens its candidate and preserves editing during progress updates', async () => {
  const b = browser();
  const progress = { version: 1, automatic: false, checks: [{ label: '允许后台验证修复', ready: true }], quota: { limit: 1, used: 1, remaining: 0, consistent: true },
    tasks: [{ id: 'progress-one', taskId: 'source', title: '<img src=x onerror=alert(1)>', status: 'waiting', summary: '正在等待 DSH 模型。', next: '保持对应 DSH 运行。', candidateId: 'experience-one',
      steps: [{ label: '记录变化', state: 'done' }, { label: '验证修复', state: 'done' }, { label: '提炼经验', state: 'pending' }, { label: '独立复核', state: 'pending' }] }] };
  Object.assign(b.current, { learning: progress }); await b.run('refresh()');
  assert.equal(b.get('learning-area').hidden, false); assert.match(b.get('learning-mode-title').textContent, /尚未开启/);
  assert.match(b.get('learning-quota').textContent, /新增提炼需要授权/);
  assert.ok(b.descendants(b.get('learning-checks')).some(e => e.textContent.includes('已占用 1 / 1')));
  assert.ok(b.descendants(b.get('learning-tasks')).some(e => e.tag === 'h3' && e.textContent === progress.tasks[0]!.title));
  b.get('learning-setup').open = true;
  const open = b.descendants(b.get('learning-tasks')).find(e => e.textContent === '查看这条经验 →')!;
  await open.onclick!(); assert.equal(b.get('detail').hidden, false);
  const strategy = b.control('处理策略'); strategy.value = 'Do not lose this edit'; b.get('detail').listeners.get('input')!(); strategy.focus();
  progress.automatic = true; progress.tasks[0]!.status = 'unknown'; progress.tasks[0]!.summary = '结果尚不确定，未自动重跑。';
  await b.run('refresh()'); assert.equal(b.get('learning-setup').open, true); assert.equal(b.control('处理策略'), strategy);
  assert.equal(strategy.value, 'Do not lose this edit'); assert.match(b.get('learning-mode-title').textContent, /自动记录已开启/);
  assert.ok(b.descendants(b.get('learning-tasks')).some(e => e.textContent.includes('未自动重跑')));
  assert.equal(b.posts.length, 0);
});
