import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCustomerForm } from '../scripts/customer-form.js';
import { Script } from 'node:vm';

test('public customer-form example verifies real versions in a fresh isolated run without model grants', async () => {
  const app = await startCustomerForm();
  const post = (path: string, value: unknown = {}, extra: Record<string, string> = {}) => fetch(app.origin + path, {
    method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(value),
  });
  const input = { draft: { name: '演示客户', phone: '000-0000', note: '不要丢失的合成备注' }, fail: true };
  try {
    assert.match(app.home, /[\\/]\.probe-work[\\/]customer-form-/);
    assert.equal((await fetch(app.origin)).status, 200);
    assert.equal((await post('/api/correct', {}, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await post('/api/fix')).status, 409);
    assert.equal((await post('/api/save', { ...input, arbitraryPath: '..' })).status, 400);
    assert.equal((await post('/api/correct', { note: 'unbounded replacement is not accepted' })).status, 400);
    assert.equal((await post('/api/correct', { overflow: 'x'.repeat(17000) })).status, 413);
    const failed = await post('/api/save', input); assert.equal(failed.status, 503);
    assert.deepEqual((await failed.json() as { draft: unknown }).draft, {});
    assert.equal((await post('/api/correct')).status, 200);
    assert.equal((await post('/api/correct')).status, 409);
    assert.equal((await post('/api/fix')).status, 200);
    const repaired = await post('/api/save', input); assert.equal(repaired.status, 503);
    assert.deepEqual((await repaired.json() as { draft: unknown }).draft, input.draft);
    const success = await post('/api/save', { ...input, fail: false }); assert.equal(success.status, 200);
    assert.deepEqual((await success.json() as { draft: unknown }).draft, {});
    const verification = await post('/api/verify'); assert.equal(verification.status, 200);
    const result = await verification.json() as {
      verified: boolean; experienceCount: number; modelCalls: number;
      report: { base: { failures: number }; fixed: { tests: number; failures: number }; regression: { tests: number; failures: number } };
    };
    assert.equal(result.verified, true); assert.equal(result.experienceCount, 1); assert.equal(result.modelCalls, 0);
    assert.equal(result.report.base.failures, 2);
    assert.equal(result.report.fixed.tests, 2); assert.equal(result.report.fixed.failures, 0);
    assert.equal(result.report.regression.tests, 3); assert.equal(result.report.regression.failures, 0);
    assert.equal((await post('/api/verify')).status, 409);
    const recorded = JSON.parse(await readFile(join(app.home, 'result.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(recorded.sourceVerified, true); assert.equal(recorded.applications, 0); assert.equal(recorded.feedback, 0);
    assert.equal(recorded.futureBenefit, 'not_evaluated');
    const db = new DatabaseSync(join(app.home, 'data', 'evolve.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT count(*) AS n FROM extraction_grants').get()!.n, 0); }
    finally { db.close(); }
    const next = await startCustomerForm();
    try {
      assert.notEqual(next.home, app.home);
      const initial = await (await fetch(next.origin + '/api/state')).json() as { fixed: boolean; experienceCount: number };
      assert.equal(initial.fixed, false); assert.equal(initial.experienceCount, 0);
    } finally { await next.close(); }
  } finally { await app.close(); }
});

test('failed customer-form verification retains candidate and renders actual failures instead of all-passed claims', async () => {
  const app = await startCustomerForm();
  const post = (path: string) => fetch(app.origin + path, { method: 'POST',
    headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: '{}' });
  try {
    await post('/api/correct'); await post('/api/fix');
    await writeFile(join(app.home, 'acceptance', 'test_unmet.py'), 'def test_unmet_requirement():\n    assert False, "synthetic unmet requirement"\n');
    const result = await (await post('/api/verify')).json() as { verified: boolean; checks: { text: string; kind: string }[] };
    assert.equal(result.verified, false);
    assert.match(result.checks[1]!.text, /1 失败/); assert.equal(result.checks[1]!.kind, 'fail');
    assert.equal((await post('/api/verify')).status, 409);
    const elements = new Map<string, Record<string, unknown>>();
    const document = { getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, {}); return elements.get(id)!;
    } };
    const html = await (await fetch(app.origin)).text();
    new Script(html.match(/<script>([\s\S]*?)<\/script>/)![1]! + '\nrender(' + JSON.stringify(result) + ');')
      .runInNewContext({ document, fetch: () => new Promise(() => {}) });
    assert.match(String(elements.get('workflow-stage')!.textContent), /未通过或结果未知/);
    assert.match(String(elements.get('proofs')!.innerHTML), /1 失败/);
    assert.doesNotMatch(String(elements.get('proofs')!.innerHTML), /number ok">2\/3/);
    assert.equal(elements.get('verify')!.disabled, true);
  } finally { await app.close(); }
});
