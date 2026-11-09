import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { studyReportExample } from '../src/study-report-example.js';

test('teaching example keeps fixed denominators, incomplete states and simulated accounting explicit', () => {
  const r = studyReportExample();
  assert.equal(r.scope, 'fixture'); assert.equal(r.sourceCommit, ''); assert.equal(r.complete, false);
  assert.equal(r.rows.length, 12); assert.equal(r.rows.flatMap(row => row.cells).length, 36);
  assert.equal(r.recorded, 18); assert.equal(r.attempted, 18); assert.equal(r.calls, 26); assert.equal(r.responses, 25);
  assert.equal(r.upper, 7000); assert.equal(r.held, 5_345_728);
  assert.deepEqual(r.arms.map(a => [a.first, a.final, a.failed, a.unknown, a.unattempted, a.rework, a.requests, a.upper, a.held]),
    [[3, 4, 2, 0, 6, 3, 9, 2520, 0], [3, 4, 2, 0, 6, 3, 9, 2520, 0], [3, 4, 1, 1, 6, 2, 8, 1960, 5_345_728]]);
  assert.equal(r.arms.reduce((n, a) => n + a.final + a.failed + a.unknown + a.unattempted, 0), 36);
  assert.deepEqual(r.timing, { elapsedMs: 90000, guardMs: 45000, providerMs: 25000, otherMs: 20000 });
});

test('example factory runs without imports or service capabilities and returns fresh projections', () => {
  const original = JSON.stringify(studyReportExample());
  assert.equal(JSON.stringify(new Script('(' + studyReportExample.toString() + ')()').runInNewContext({})), original);
  const altered = studyReportExample(); altered.arms[0]!.final = 99; altered.rows[0]!.cells[0]!.attempts.length = 0;
  assert.equal(JSON.stringify(studyReportExample()), original);
  assert(!/\bfetch\(|localStorage|sessionStorage|postMessage|\.request\(/.test(studyReportExample.toString()));
});
