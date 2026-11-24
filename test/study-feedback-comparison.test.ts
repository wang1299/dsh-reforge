import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compareStudyFeedback, rewriteOwnProposal } from '../scripts/study-feedback-comparison.js';

const parent = fileURLToPath(new URL('../../.probe-work/fb-tests', import.meta.url));
test('script rewrites only the recognized identity expression in its own proposal', () => {
  const proposal = 'def repair(rows):\n    return [k for k in rows]\n';
  const diagnostic = { schema: 1, rule: 'unsupported_syntax', node: 'ListComp' } as const;
  assert.equal(rewriteOwnProposal(proposal, null), proposal);
  assert.equal(rewriteOwnProposal(proposal, { ...diagnostic, node: 'other' }), proposal);
  assert.equal(rewriteOwnProposal(proposal, { ...diagnostic, rule: 'attribute' }), proposal);
  const different = proposal.replace('[k for', '[v for');
  assert.equal(rewriteOwnProposal(different, diagnostic), different);
  assert.equal(rewriteOwnProposal(proposal, diagnostic), 'def repair(rows):\n    return rows\n');
});

test('paired Agent requests isolate the diagnostic and independent pytest distinguishes syntax from behavior', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request'); });
  const { path, report } = await compareStudyFeedback(parent);
  assert.equal(report.qualified, true);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(report.modelHttpRequests, 0);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), report);
  assert.deepEqual(report.totals.generic, { trials: 4, retries: 3, secondPass: 0, finalPass: 1, scriptedRequests: 7, executions: 1, unknown: 0 });
  assert.deepEqual(report.totals.specific, { trials: 4, retries: 3, secondPass: 1, finalPass: 2, scriptedRequests: 7, executions: 3, unknown: 0 });
  for (const { scenario, generic, specific } of report.pairs) {
    assert.equal(generic.inputs[0], specific.inputs[0]);
    assert.deepEqual(generic.attempts[0], specific.attempts[0]);
    if (scenario === 'first_pass') {
      assert.equal(generic.retry, null);
      assert.equal(specific.retry, null);
    } else {
      assert.equal(generic.retry?.diagnostic, null);
      assert.deepEqual(specific.retry?.diagnostic, specific.attempts[0]?.admission);
      assert.equal(generic.inputs[1], specific.retry?.commonInputDigest);
      assert.notEqual(generic.inputs[1], specific.inputs[1]);
      assert.equal(generic.attempts[0]?.executed, false);
    }
  }
  const semantic = report.pairs.find(p => p.scenario === 'marks_before_send')!.specific.attempts[1]!;
  assert.deepEqual(semantic.cases.filter(c => c.status === 'failed').map(c => c.id), ['test_partial_success_is_kept_and_failure_retries']);
});

test('unavailable validator stays unknown, gives no retry and invalidates the comparison', async () => {
  const { report } = await compareStudyFeedback(parent, 'dsh-reforge-intentionally-missing-python');
  assert.equal(report.qualified, false);
  for (const arm of ['generic', 'specific'] as const) {
    assert.equal(report.totals[arm]!.unknown, 4);
    assert.equal(report.totals[arm]!.retries, 0);
    assert.equal(report.totals[arm]!.finalPass, 0);
    assert(report.pairs.every(p => !p.qualifies && p[arm].attempts[0]?.status === 'execution_unknown'));
  }
});
