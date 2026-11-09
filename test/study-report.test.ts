import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { parseStudyReport } from '../src/study-report.js';
import { renderPanel } from '../src/panel-view.js';
import { studyReportFixture } from './study-report-fixture.js';

test('local report projection keeps fixed denominators, distinguishes actual/fixture and omits private fields', () => {
  const raw = { ...studyReportFixture(), credentials: 'DO_NOT_DISPLAY', binding: { id: 'PRIVATE_GRANT' },
    sourcePath: 'PRIVATE_PATH', modelText: '<img src=x onerror=alert(1)>' };
  const view = parseStudyReport(JSON.stringify(raw));
  assert.deepEqual(view.arms.map(a => [a.first, a.final, a.failed, a.unknown, a.unattempted, a.rework, a.requests]),
    Array.from({ length: 3 }, () => [10, 10, 2, 0, 0, 2, 14]));
  assert.equal(view.rows.length, 12); assert.equal(view.calls, 42); assert.equal(view.responses, 42);
  assert.equal(view.upper, 11760); assert.equal(view.scope, 'live');
  assert(!/DO_NOT_DISPLAY|PRIVATE_|<img|binding|modelText/.test(JSON.stringify(view)));
  assert.equal(view.rows.find(r => r.case === 'delivery_batch')!.cells[0]!.attempts[0]!.admission, null);
  const fixture = parseStudyReport(JSON.stringify(studyReportFixture({ fixture: true })));
  assert.equal(fixture.scope, 'fixture');
});

test('partial reports preserve unknown and unattempted rows including missing controller results', () => {
  for (const options of [{ attempted: 4, unknownAt: 3 }, { attempted: 4, missingAt: 3 }]) {
    const view = parseStudyReport(JSON.stringify(studyReportFixture(options)));
    assert.equal(view.complete, false); assert.equal(view.attempted, 4);
    assert.equal(view.arms.reduce((n, a) => n + a.unknown, 0), 1);
    assert.equal(view.arms.reduce((n, a) => n + a.unattempted, 0), 32);
    assert.equal(view.arms.reduce((n, a) => n + a.final, 0), 3);
    assert.equal(view.rows.flatMap(r => r.cells).length, 36);
  }
});

test('report reader rejects contradictory aggregates, duplicate rows, fake success, malformed diagnostics and oversized input', () => {
  const rejects = (mutate: (r: ReturnType<typeof studyReportFixture>) => void) => {
    const r = studyReportFixture(); mutate(r); assert.throws(() => parseStudyReport(JSON.stringify(r)), /^Error: study_report_invalid$/);
  };
  rejects(r => { r.arms.none!.finalAccepted++; });
  rejects(r => { r.arms.plain!.firstPassRate = 1; });
  rejects(r => { r.financial.settledUpperBound++; });
  rejects(r => { r.arms.reforge!.usage.output++; });
  rejects(r => { r.trials[1] = r.trials[0]!; });
  rejects(r => { r.receipts[1]!.case = 'private-source'; });
  rejects(r => { r.trials[0]!.result.attempts[0]!.status = 'invalid_code'; });
  rejects(r => { r.trials[0]!.result.attempts[0]!.tests!.skipped = 1; });
  rejects(r => { Object.assign(r.trials[0]!.result.attempts[0]!, { admission: { schema: 1, rule: 'attribute', node: 'PRIVATE_NAME' } }); });
  rejects(r => { r.counts.providerHttpRequests = 0; r.counts.networkAttempts = 0; r.counts.completedBodies = 0; });
  rejects(r => { r.counts.fixtureHttpRequests = 1; });
  rejects(r => { r.sourceCommit = '<script>alert(1)</script>'; });
  for (const input of ['', '{}', '[]', 'null', ' '.repeat(1048577), JSON.stringify({ ...studyReportFixture(), pad: '中'.repeat(350000) })]) {
    assert.throws(() => parseStudyReport(input), /study_report_invalid/);
  }
});

test('finite admission metadata survives projection while legacy reasons stay unknown', () => {
  const r = studyReportFixture(); const a = r.trials.find(t => t.case === 'delivery_batch')!.result.attempts[0]!;
  Object.assign(a, { admission: { schema: 1, rule: 'unsupported_syntax', node: 'Set' } });
  const view = parseStudyReport(JSON.stringify(r));
  const attempts = view.rows.find(t => t.case === 'delivery_batch')!.cells[0]!.attempts;
  assert.deepEqual(attempts[0]!.admission, { schema: 1, rule: 'unsupported_syntax', node: 'Set' });
  assert.equal(attempts[1]!.admission, null);
});

test('shipped standalone and native pages contain a self-contained report reader under existing CSP', () => {
  for (const bridge of [undefined, { channel: 'synthetic', parentOrigin: 'http://127.0.0.1:5555' }]) {
    const html = renderPanel('testnonce', bridge);
    assert.match(html, /id="nav-study"/); assert.match(html, /aria-controls="study"/);
    assert.match(html, /文件只在本页内存中解析/); assert.match(html, /本页未独立核对/);
    assert.doesNotThrow(() => new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!));
    // The isolated reader has no backend port. Existing unrelated panel polling stays outside it.
    const reader = html.slice(html.indexOf('function installStudyReport('), html.indexOf("})($('study'),readStudyReport);"));
    assert(!/\bfetch\(|localStorage|sessionStorage|innerHTML|postMessage|\.request\(/.test(reader));
  }
});
