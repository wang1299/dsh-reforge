import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { renderPanel } from '../src/panel-view.js';
import type { RetrievalStatus } from '../src/retrieval-runtime.js';
import { studyReportFixture } from './study-report-fixture.js';

// A small DOM port exercises the shipped client, including real event callbacks.
// Layout, native controls and accessibility are separately checked in a browser.
function browser() {
  class Element {
    id = ''; value = ''; hidden = false; open = false; disabled = false; className = ''; type = '';
    dataset: Record<string, string> = {};
    files: { size: number; text(): Promise<string> }[] = [];
    private ownText = '';
    get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.ownText = value; this.children = []; }
    children: Element[] = []; attributes = new Map<string, string>(); listeners = new Map<string, () => void>();
    onclick?: () => Promise<void> | void; onchange?: () => void; oninput?: () => void;
    classList = { toggle: (_name: string, _value: boolean) => undefined };
    constructor(readonly tag: string) { elements.push(this); }
    set innerHTML(_value: string) { throw new Error('Untrusted HTML insertion is forbidden'); }
    append(...children: Element[]) { if (this.tag === 'select' && this.children.length === 0 && children[0]?.tag === 'option') this.value = children[0].value; this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.ownText = ''; this.children = children; }
    querySelectorAll(selector: string): Element[] { const tags = selector.split(','); return this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]).filter(child => tags.includes(child.tag)); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    closest(_selector?: string): Element | null { return null; }
    focus() { document.activeElement = this; }
    scrollIntoView() { /* no layout in this port */ }
  }
  const elements: Element[] = [];
  const html = renderPanel('unit-test-nonce'); const markup = html.slice(0, html.indexOf('<script'));
  for (const match of markup.matchAll(/id="([^"]+)"/g)) { const element = new Element('static'); element.id = match[1]!; }
  const get = (id: string) => elements.findLast(e => e.id === id)!;
  get('filter').value = 'all'; get('records').open = false;
  const document = {
    body: new Element('body'),
    activeElement: null as Element | null, hidden: false, getElementById: get, createElement: (tag: string) => new Element(tag), createElementNS: (_ns: string, tag: string) => new Element(tag), addEventListener: () => undefined,
  };
  const exp = { id: 'experience-one', revision: 1, status: 'candidate', title: '<img src=x onerror=alert(1)>', strategy: 'Restore the prior state', observedFacts: ['A correction was recorded'], inferences: [], recommendations: [], scope: { repoId: 'repo', requiredFiles: { 'ledger.py': 'a'.repeat(64) } }, sourceTaskId: 'source', verificationId: null, createdAt: '2026-10-20T00:00:00Z' };
  const current = { experiences: [exp], tasks: [{ id: 'source', summary: '转账失败时恢复余额' }, { id: 'target', summary: '库存异常后数量不正确' }], applications: [{ id: 'application-one', taskId: 'target', experienceId: exp.id, revision: 1, createdAt: exp.createdAt }], feedback: [] as { id: string; applicationId: string; outcome: string; note: string; createdAt: string }[], evidence: [{ id: 'source-evidence', taskId: 'source', repoId: 'repo', kind: 'correction', note: 'restore balance', digest: 'd' }], verifications: {}, histories: { [exp.id]: [exp] }, provenance: { [exp.id]: { 1: { complete: false, facts: [{ factIndex: 0, factDigest: 'f' }], citations: [] } } }, learningJobs: [{ id: 'job-one', state: 'succeeded', input: { taskId: 'source', baseCommit: 'a'.repeat(40), fixCommit: 'b'.repeat(40), sources: [], observations: [] } }], evidenceBundles: [], extractionJobs: [{ id: 'extraction-one', evidenceJobId: 'job-one', state: 'candidate', reason: 'extracted', candidateId: exp.id, policy: { provider: 'offline', model: 'fixture' } }], extractionGrants: [] };
  const posts: { path: string; body: Record<string, unknown> }[] = [], reads: string[] = [];
  let offline = false; let postStatus = 409; let postHold: Promise<void> | null = null; let readHold: Promise<void> | null = null;
  const context = createContext({ document, TextEncoder, URLSearchParams, Intl, Date, JSON, crypto: { randomUUID }, location: { hash: '#token=fixture', pathname: '/' }, history: { replaceState: () => undefined }, setInterval: () => undefined,
    fetch: async (path: string, init: { method: string; body?: string }) => {
      if (init.method !== 'POST') reads.push(path);
      if (offline) throw new Error('Synthetic offline');
      if (init.method === 'POST') { posts.push({ path, body: JSON.parse(init.body!) as Record<string, unknown> }); if (postHold) await postHold; if (postStatus === 0) throw new Error('Synthetic interrupted response'); return { ok: postStatus === 200, json: async () => ({ error: 'Experience changed; refresh before editing' }) }; }
      if (readHold) await readHold;
      return { ok: true, json: async () => structuredClone(current) };
    },
  });
  new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!).runInContext(context);
  const run = async (code: string) => { await new Promise<void>(resolve => setImmediate(resolve)); await new Script(code).runInContext(context) as Promise<void>; };
  const descendants = (root: Element): Element[] => root.children.flatMap(e => [e, ...descendants(e)]);
  const control = (label: string) => descendants(get('detail')).find(e => e.attributes.get('aria-label') === label)!;
  const click = async (text: string) => { const control = descendants(get('detail')).find(e => e.tag === 'button' && e.textContent === text); assert.ok(control); await control.onclick!(); };
  const clickRecordCandidate = async () => { const button = descendants(get('evidence-jobs')).find(e => e.tag === 'button' && e.textContent === '查看候选经验'); assert.ok(button); await button.onclick!(); };
  return { get, current, posts, reads, run, control, click, clickRecordCandidate, descendants, offline: () => { offline = true; }, unknownWrites: () => { postStatus = 0; }, acknowledgeWrites: () => { postStatus = 200; },
    holdWrites: () => { let release!: () => void; postHold = new Promise<void>(done => { release = done; }); return () => { postHold = null; release(); }; },
    holdReads: () => { let release!: () => void; readHold = new Promise<void>(done => { release = done; }); return () => { readHold = null; release(); }; } };
}

test('the first report opens a clearly synthetic example without a file, network or product-state writes', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("showView('study')");
  const before = JSON.stringify(b.current), reads = [...b.reads]; b.offline();
  await b.get('study-report-example').onclick!();
  assert.equal(b.get('study-report-content').hidden, false);
  assert.match(b.get('study').textContent, /内置合成示例/); assert.match(b.get('study').textContent, /未读取文件或运行任务/);
  assert.match(b.get('study').textContent, /预制模拟金额，未产生费用/); assert.match(b.get('study').textContent, /18 \/ 36 已记录/);
  assert.match(b.get('study').textContent, /12 \/ 36 通过/); assert.match(b.get('study').textContent, /示例未知占额 ¥5.345728/);
  assert(b.descendants(b.get('study')).filter(e => e.className === 'study-attempt').every(e => e.textContent.startsWith('示例 第 ') && e.textContent.includes('示例设定：')));
  assert(!/本机文件已通过|文件标记：|源码 aaaa/.test(b.get('study').textContent));
  const filter = b.get('study-report-filter'); filter.value = 'unknown'; filter.onchange!();
  assert.match(b.get('study').textContent, /显示 1 \/ 12 组同题配对/);
  filter.value = 'unattempted'; filter.onchange!(); assert.match(b.get('study').textContent, /显示 6 \/ 12 组同题配对/);
  const clear = b.descendants(b.get('study')).find(e => e.tag === 'button' && e.textContent === '清除本页报告')!;
  await clear.onclick!(); assert.equal(b.get('study-report-content').hidden, true);
  assert(!b.get('study').textContent.includes('5.345728')); assert(!b.get('study').textContent.includes('内置合成示例'));
  assert.deepEqual(b.reads, reads); assert.equal(b.posts.length, 0); assert.equal(JSON.stringify(b.current), before);
});

test('example selection defeats late file success or failure; imported labels cannot impersonate the built-in example', async () => {
  for (const lateFailure of [false, true]) {
    const b = browser(); await b.run('refresh()'); await b.run("showView('study')");
    const file = b.get('study-report-file'); let finish!: (value: string) => void, reject!: (reason: Error) => void;
    file.files = [{ size: 100, text: () => new Promise((resolve, fail) => { finish = resolve; reject = fail; }) }];
    const pending = file.onchange!(); await b.get('study-report-example').onclick!();
    const text = JSON.stringify({ ...studyReportFixture(), origin: 'example', builtIn: true });
    if (lateFailure) reject(new Error('Synthetic late read')); else finish(text);
    await pending;
    assert.match(b.get('study').textContent, /内置合成示例/); assert(!b.get('study').textContent.includes('无法读取'));
    file.files = [{ size: Buffer.byteLength(text), text: async () => text }]; await file.onchange!();
    assert.match(b.get('study').textContent, /文件标记：真实模型请求 · 本机文件 · 源码 aaaaaaaaaaaa/);
    assert.match(b.get('study').textContent, /本机文件已通过结构一致性检查/);
    assert(!b.get('study').textContent.includes('内置合成示例')); assert(!b.get('study').textContent.includes('示例未知占额'));
    assert.equal(b.posts.length, 0);
  }
});

test('report import, filter, polling and clear stay local and preserve all denominator rows', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("showView('study')");
  const file = b.get('study-report-file'), text = JSON.stringify(studyReportFixture());
  file.files = [{ size: Buffer.byteLength(text), text: async () => text }]; await file.onchange!();
  assert.equal(b.get('study-report-content').hidden, false);
  assert.match(b.get('study').textContent, /30 \/ 36 通过/); assert.match(b.get('study').textContent, /旧记录未保存具体准入原因/);
  const filter = b.get('study-report-filter'); filter.value = 'failed'; filter.onchange!();
  assert.match(b.get('study').textContent, /显示 2 \/ 12 组同题配对/);
  await b.run('refresh()'); assert.equal(filter.value, 'failed');
  assert.match(b.get('study').textContent, /显示 2 \/ 12 组同题配对/);
  assert.equal(b.get('home').hidden, true); assert.equal(b.get('overview').hidden, true);
  const clear = b.descendants(b.get('study')).find(e => e.tag === 'button' && e.textContent === '清除本页报告')!;
  await clear.onclick!(); assert.equal(b.get('study-report-content').hidden, true); assert.equal(file.value, '');
  assert.equal(b.posts.length, 0);
});

test('clearing a pending report prevents its late read from restoring private data; malformed input removes the old view', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("showView('study')");
  const file = b.get('study-report-file'); let release!: (s: string) => void;
  file.files = [{ size: 100, text: () => new Promise(resolve => { release = resolve; }) }];
  const reading = file.onchange!();
  const clear = b.descendants(b.get('study')).find(e => e.tag === 'button' && e.textContent === '清除本页报告')!;
  await clear.onclick!(); release(JSON.stringify(studyReportFixture())); await reading;
  assert.equal(b.get('study-report-content').hidden, true);
  file.files = [{ size: 20, text: async () => '{"private":"<img>"}' }]; await file.onchange!();
  assert.equal(b.get('study-report-content').hidden, true); assert.match(b.get('study').textContent, /无法读取/);
  assert(!b.get('study').textContent.includes('<img>')); assert.equal(b.posts.length, 0);
});

test('timing stays a local disclosure, explains provider boundaries and clears its projected values', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("showView('study')");
  const file = b.get('study-report-file'), text = JSON.stringify({ ...studyReportFixture(), elapsedMs: 416521, guardMs: 320755, providerMs: 49500 });
  file.files = [{ size: Buffer.byteLength(text), text: async () => text }]; await file.onchange!();
  assert.match(b.get('study').textContent, /运行检查320.8 秒 · 77.0%/);
  assert.match(b.get('study').textContent, /请求与完整响应49.5 秒 · 11.9%/);
  assert.match(b.get('study').textContent, /不等于纯模型推理/);
  const clear = b.descendants(b.get('study')).find(e => e.tag === 'button' && e.textContent === '清除本页报告')!;
  await clear.onclick!(); assert(!b.get('study').textContent.includes('320.8')); assert(!b.get('study').textContent.includes('文件标记'));
  assert.equal(b.posts.length, 0);
});

test('a pending save locks editing, blocks duplicate submissions and keeps the captured view until acknowledged', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = 'Keep this submitted draft'; b.get('detail').listeners.get('input')!();
  const save = b.descendants(b.get('detail')).find(e => e.tag === 'button' && e.textContent === '保存为待验证版本')!;
  const release = b.holdWrites(); b.acknowledgeWrites(); const request = save.onclick!();
  assert.equal(save.disabled, true); assert.equal(save.getAttribute('aria-busy'), 'true'); assert.equal(strategy.disabled, true);
  await b.run("showView('uses');openExperience('experience-one')"); await save.onclick!();
  assert.equal(b.posts.length, 1); assert.equal(b.get('detail').hidden, false); assert.equal(b.control('处理策略'), strategy);
  release(); await request;
  assert.match(b.get('message').textContent, /已保存/); assert.equal(save.getAttribute('aria-busy'), 'false'); assert.equal(strategy.disabled, false);
});

test('workbench explains selected and abstained attempts as text, survives polling and performs no writes', async () => {
  const b = browser();
  const data: RetrievalStatus = { version: 1, lifetime: 'service-instance', policy: 'bm25-v1', omittedAttempts: 3,
    cache: { documents: 1, builds: 1, hits: 1, bypasses: 0 }, attempts: [{
      taskId: 'target', mode: 'evidence-v1', completedAt: '2026-11-06T00:00:00Z', outcome: 'selected', selectedId: 'experience-one', selectedRevision: 1,
      applicationId: 'application-one', candidatesConsidered: 1, eligibleCount: 1, omittedCandidates: 0,
      candidates: [{ id: 'experience-one', revision: 1, title: '<img src=x onerror=alert(1)>', reason: 'original_text', textScore: 0.5, combinedScore: 0.5, anchors: 2,
        titleTerms: ['rollback'], strategyTerms: ['<script>'] }], cache: 'hit', generation: 1,
      timings: { qualificationMs: 100, lookupMs: 1, buildMs: 0, queryMs: 2, selectionMs: 1, totalMs: 104 },
    }] };
  (b.current as typeof b.current & { retrieval: RetrievalStatus }).retrieval = data;
  await b.run('refresh()'); await b.run("showView('uses')");
  const root = b.get('retrieval-history'); assert.match(root.textContent, /已选中参考/); assert.match(root.textContent, /送达、采用和结果仍需分别核对/);
  assert.match(root.textContent, /<img src=x/); assert.equal(b.descendants(root).some(e => e.tag === 'img' || e.tag === 'script'), false);
  assert.match(root.textContent, /复用相同合格库/); assert.match(b.get('retrieval-summary').textContent, /更早的 3 条/);
  const fold = b.descendants(root).find(e => e.tag === 'details')!; fold.open = true;
  data.attempts[0]!.timings.totalMs = 105; await b.run('refresh()');
  assert.equal(b.descendants(root).find(e => e.tag === 'details')!.open, true);
  data.attempts[0]!.outcome = 'abstained'; data.attempts[0]!.candidates[0]!.reason = 'code_condition_changed'; await b.run('refresh()');
  assert.match(root.textContent, /本次未选中/); assert.match(root.textContent, /相关代码已变化/); assert.equal(b.posts.length, 0);
});

function decisionFixture() {
  const b = browser();
  const attempt = (taskId: string, outcome: 'selected' | 'abstained', reason: 'original_text' | 'code_condition_changed', time: string): RetrievalStatus['attempts'][number] => ({
    taskId, mode: 'evidence-v1', completedAt: time, outcome, selectedId: outcome === 'selected' ? 'experience-one' : null,
    selectedRevision: outcome === 'selected' ? 1 : null, applicationId: null, candidatesConsidered: 1, eligibleCount: outcome === 'selected' ? 1 : 0, omittedCandidates: 0,
    candidates: [{ id: 'experience-one', revision: 1, title: 'rollback example', reason, textScore: 0.5, combinedScore: 0.5, anchors: 2, titleTerms: ['rollback'], strategyTerms: [] }],
    cache: 'hit', generation: 1, timings: { qualificationMs: 2, lookupMs: 1, buildMs: 0, queryMs: 1, selectionMs: 1, totalMs: 5 },
  });
  const data: RetrievalStatus = { version: 1, lifetime: 'service-instance', policy: 'bm25-v1', omittedAttempts: 0,
    cache: { documents: 1, builds: 1, hits: 1, bypasses: 0 }, attempts: [attempt('target', 'abstained', 'code_condition_changed', '2026-11-06T02:00:00Z'),
      attempt('older', 'selected', 'original_text', '2026-11-06T01:00:00Z')] };
  b.current.tasks.push({ id: 'older', summary: 'Older selected task' });
  (b.current as typeof b.current & { retrieval: RetrievalStatus }).retrieval = data;
  const rows = () => b.descendants(b.get('retrieval-history')).filter(e => e.className === 'inspector-row');
  const selected = () => rows().find(e => e.getAttribute('aria-pressed') === 'true')!;
  return { ...b, data, attempt, rows, selected };
}
test('decision inspector filters locally and preserves a chosen older attempt through polling', async () => {
  const b = decisionFixture(); await b.run('refresh()'); await b.run("showView('uses')");
  assert.equal(b.rows().length, 2); assert.match(b.selected().textContent, /库存异常/);
  await b.rows().find(e => e.textContent.includes('Older'))!.onclick!(); b.selected().focus();
  b.data.attempts.unshift(b.attempt('newest', 'abstained', 'code_condition_changed', '2026-11-06T03:00:00Z'));
  b.current.tasks.push({ id: 'newest', summary: 'Newer changed task' }); await b.run('refresh()');
  assert.match(b.selected().textContent, /Older/);
  b.get('retrieval-filter').value = 'selected'; await b.get('retrieval-filter').onchange!(); assert.equal(b.rows().length, 1);
  b.get('retrieval-search').value = 'no such request'; await b.get('retrieval-search').oninput!();
  assert.match(b.get('retrieval-history').textContent, /没有匹配/);
  const clear = b.descendants(b.get('retrieval-history')).find(e => e.tag === 'button' && e.textContent === '清除筛选')!;
  await clear.onclick!(); assert.equal(b.rows().length, 3); assert.match(b.selected().textContent, /Older/); assert.equal(b.posts.length, 0);
  await b.run("if(document.activeElement?.id!=='retrieval-search')throw new Error('clear filter lost search focus')");
});
for (const focus of ['row', 'candidate', 'summary'] as const) test(`evicted decisions recover an owned ${focus} focus within retained scope`, async () => {
  const b = decisionFixture(); await b.run('refresh()'); await b.run("showView('uses')");
  const target = focus === 'row' ? b.selected() : b.descendants(b.get('retrieval-history')).find(e => focus === 'candidate'
    ? e.tag === 'button' && e.textContent === '查看当前经验' : e.tag === 'summary')!;
  target.focus(); b.data.attempts.shift(); await b.run('refresh()');
  assert.match(b.selected().textContent, /Older/); assert.match(b.get('retrieval-summary').textContent, /已离开保留范围/);
  await b.run("if(document.activeElement?.getAttribute('aria-pressed')!=='true')throw new Error('row focus lost')");
  assert.equal(b.posts.length, 0);
});
test('default candidate action is visible without a disclosure and truncated reasons stay qualified', async () => {
  const b = decisionFixture(); await b.run('refresh()'); await b.run("showView('uses')");
  const open = b.descendants(b.get('retrieval-history')).find(e => e.tag === 'button' && e.textContent === '查看当前经验')!;
  assert(open); await open.onclick!(); assert.equal(b.get('detail').hidden, false); assert.equal(b.posts.length, 0);
  await b.run("showView('uses')"); b.data.attempts[0]!.omittedCandidates = 4; b.data.attempts[0]!.candidatesConsidered = 5; await b.run('refresh()');
  assert.match(b.get('retrieval-history').textContent, /无法据此概括全部原因/); assert.match(b.get('retrieval-history').textContent, /另有 4 条候选未展开/);
});

test('an acknowledged write followed by an offline read preserves the draft and warns that the record must be checked', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = 'Do not lose this after a read failure'; b.get('detail').listeners.get('input')!();
  const release = b.holdWrites(); b.acknowledgeWrites(); const request = b.click('保存为待验证版本');
  b.offline(); release(); await request;
  assert.equal(b.control('处理策略'), strategy); assert.equal(strategy.disabled, false); assert.equal(b.get('discard-edit').hidden, false);
  assert.match(b.get('message').textContent, /请求已返回.*读取.*核对/); assert.doesNotMatch(b.get('message').textContent, /^已保存/);
  assert.equal(b.posts.length, 1); assert.equal(b.posts[0]!.body.revision, 1);
});

test('manual refresh exposes its pending state and keeps an edited detail intact', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  const strategy = b.control('处理策略'); strategy.value = 'Current unsaved text'; b.get('detail').listeners.get('input')!();
  const release = b.holdReads(); const request = b.get('refresh').onclick!();
  assert.equal(b.get('refresh').disabled, true); assert.equal(b.get('refresh').getAttribute('aria-busy'), 'true');
  release(); await request;
  assert.equal(b.get('refresh').disabled, false); assert.equal(b.get('refresh').getAttribute('aria-busy'), 'false');
  assert.equal(b.control('处理策略'), strategy); assert.match(b.get('message').textContent, /未保存编辑/); assert.equal(b.posts.length, 0);
});

test('an earlier manual refresh cannot replace a pending save notice with a success notice', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("openExperience('experience-one')");
  b.control('处理策略').value = 'Submitted while a read was pending'; b.get('detail').listeners.get('input')!();
  const releaseRead = b.holdReads(); const refresh = b.get('refresh').onclick!();
  const releaseWrite = b.holdWrites(); b.acknowledgeWrites(); const save = b.click('保存为待验证版本');
  releaseRead(); await refresh;
  assert.match(b.get('message').textContent, /正在保存/); assert.equal(b.get('message').getAttribute('data-tone'), 'busy');
  releaseWrite(); await save; assert.match(b.get('message').textContent, /已保存/); assert.equal(b.posts.length, 1);
});

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

test('workbench builds a reference snapshot once, including hundreds of application versions and latest outcomes', async () => {
  const b = browser();
  for (let i = 0; i < 600; i++) {
    const application = { ...b.current.applications[0]!, id: 'reference-' + i, revision: i % 2 + 1 };
    b.current.applications.push(application);
    b.current.feedback.push({ id: 'feedback-' + i, applicationId: application.id, outcome: 'accepted', note: 'Synthetic owner report', createdAt: '2026-10-20T01:00:00Z' });
  }
  await b.run('refresh()'); await b.run("showView('uses')");
  assert.equal(b.get('use-history').children.length, 601);
  assert.match(b.get('use-summary').textContent, /601.*1 条结果尚未确认/);
  await b.run("const firstReferences=referenceItems();if(firstReferences!==referenceItems())throw Error('Snapshot was unnecessarily rebuilt');");
  b.current.feedback.push({ id: 'new-unknown', applicationId: 'reference-0', outcome: 'unknown', note: 'Uncertain latest report', createdAt: '2026-10-20T02:00:00Z' });
  await b.run('refresh()'); assert.match(b.get('use-summary').textContent, /2 条结果尚未确认/);
  assert.equal(b.posts.length, 0);
});

test('workbench restores focus to a reference action after a changed polling snapshot', async () => {
  const b = browser(); await b.run('refresh()'); await b.run("showView('uses')");
  const first = b.descendants(b.get('use-history')).find(e => e.tag === 'button')!;
  let observedSelector = '';
  first.closest = (selector?: string) => { observedSelector = selector ?? ''; return b.get('use-history'); };
  // The DOM port resolves the newly rebuilt action rather than retaining the old node.
  Object.assign(b.get('use-history'), { querySelector: () => b.descendants(b.get('use-history')).find(e => e.tag === 'button') });
  first.focus(); b.current.experiences[0]!.revision = 2; await b.run('refresh()');
  assert.match(observedSelector, /\.use-history/);
  const replacement = b.descendants(b.get('use-history')).find(e => e.tag === 'button')!;
  assert.notEqual(first, replacement);
  await b.run("if(document.activeElement?.getAttribute('data-focus-key')!=='application-one')throw Error('Reference focus was lost');");
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

test('the overview metrics stay on home and cannot reappear over the library during polling', async () => {
  const b = browser(); await b.run('refresh()'); assert.equal(b.get('overview').hidden, false);
  await b.run("showView('library')"); assert.equal(b.get('overview').hidden, true);
  await b.run('refresh()'); assert.equal(b.get('overview').hidden, true);
  await b.run("showView('home')"); assert.equal(b.get('overview').hidden, false);
});

test('page context follows navigation and detail, while a blocked draft navigation preserves its heading and refresh action', async () => {
  const b = browser(); await b.run('refresh()');
  assert.equal(b.get('view-title').textContent, '经验概览');
  await b.run("showView('library')"); assert.equal(b.get('view-title').textContent, '经验库');
  await b.run("openExperience('experience-one')"); assert.equal(b.get('view-title').hidden, true);
  assert.equal(b.get('refresh').hidden, false); assert.equal(b.get('detail-heading').textContent, '转账失败时恢复余额');
  b.control('处理策略').value = 'Keep the same detail'; b.get('detail').listeners.get('input')!();
  await b.run("showView('learning')"); assert.equal(b.get('view-title').hidden, true);
  assert.equal(b.get('detail-heading').textContent, '转账失败时恢复余额');
  await b.click('放弃未保存编辑'); await b.run("showView('uses')");
  assert.equal(b.get('view-title').hidden, false); assert.equal(b.get('view-title').textContent, '参考记录'); assert.equal(b.posts.length, 0);
});

test('an empty workbench routes to setup and recording without implying that experience already exists', async () => {
  const b = browser(); b.current.experiences.length = 0; b.current.applications.length = 0;
  await b.run('refresh()'); assert.match(b.get('overview-next').textContent, /先留下第一条经验/);
  assert.doesNotMatch(b.get('overview-next').textContent, /查看已经留下的经验/);
  const route = b.descendants(b.get('overview-next')).find(e => e.tag === 'button')!; await route.onclick!();
  assert.equal(b.get('learning').hidden, false); assert.equal(b.posts.length, 0);
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
