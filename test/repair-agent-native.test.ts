import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repairDemo } from '../scripts/repair-agent-demo.js';

for (const scenario of ['happy', 'replan', 'self_report', 'unknown'] as const) {
  test('actual native tools and independent Python acceptance: ' + scenario, { timeout: 150000 }, async () => {
    const { root, report } = await repairDemo(scenario);
    assert.equal(report.realModel, false); assert.equal(report.benefitEvaluated, false); assert.equal(report.providerHttpCalls, 0);
    assert.equal(report.sourceProofs.length, 3); assert(report.sourceProofs.every(p => p.baseRejected && p.fixedPassed && p.regressionPassed));
    assert.equal(report.memorySelected, true);
    const accepted = scenario === 'happy' || scenario === 'replan'; assert.equal(report.controller.accepted, accepted);
    assert.equal(report.nativeToolCalls, { happy: 5, replan: 10, self_report: 0, unknown: 3 }[scenario]);
    assert.equal(report.scriptedRequests, report.nativeToolCalls + 1);
    if (accepted) {
      assert(report.providedMemoryRequests > 0); assert.equal(report.projectionChecks, report.nativeToolCalls);
      assert(report.largestProjectionBytes > 0 && report.largestProjectionBytes <= 8192);
      assert.equal(report.controller.reason, 'independent_acceptance');
      assert.equal(report.controller.revision, scenario === 'happy' ? 1 : 2);
    } else assert.equal(report.controller.reason, scenario === 'unknown' ? 'execution_unknown' : 'incomplete_turn');
    const text = await readFile(join(root, 'report.json'), 'utf8');
    for (const forbidden of ['def repair', '"messages"', '"code"', root, '"goal"', '"content"', '"expectedDigest"']) assert(!text.includes(forbidden));
  });
}
