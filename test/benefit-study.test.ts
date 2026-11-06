import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { studyArms, studyCases, studyFixtureVersion, studySchedule, studySources, studyTaskInput } from '../scripts/benefit-study-cases.js';
import { prepareBenefitStudy, validateStudyCode } from '../scripts/benefit-study-preflight.js';
import { digest } from '../src/domain.js';

const python = process.env.EVOLVE_PYTHON ?? 'python';
test('new study schedule balances all arms, repeats and positions; model tasks exclude test/reference answers', () => {
  assert.equal(studySchedule.length, 36); assert.equal(new Set(studyCases.map(c => c.id)).size, 6);
  for (const arm of studyArms) {
    assert.equal(studySchedule.filter(r => r.arm === arm).length, 12);
    for (const position of [0, 1, 2]) assert.equal(studySchedule.filter((r, i) => r.arm === arm && i % 3 === position).length, 4);
  }
  for (const item of studyCases) {
    for (const repeat of [1, 2]) assert.deepEqual(new Set(studySchedule.filter(r => r.case === item.id && r.repeat === repeat).map(r => r.arm)), new Set(studyArms));
    for (const arm of studyArms) assert.equal(new Set(studySchedule.flatMap((row, i) => row.case === item.id && row.arm === arm ? [i % 3] : [])).size, 2);
    const input = studyTaskInput(item); assert(input.includes(item.before));
    assert(!input.includes(item.reference)); assert(!input.includes(item.wrong)); assert(!input.includes(item.checks));
    for (const wrong of Object.values(item.additionalWrong ?? {})) assert(!input.includes(wrong));
    assert.equal(item.entry, 'repair'); assert(studySources.some(s => s.id === item.family));
  }
});

test('pre-live fixture revision preserves the complete original v1 and identifies strengthened controls', async () => {
  assert.equal(studyFixtureVersion, 'benefit-fixtures-v1.1');
  const original = await readFile(fileURLToPath(new URL('../../test/fixtures/benefit-study-v1.ts.txt', import.meta.url)));
  assert.equal(digest(original), 'b0530361486e13cb994cf3ad1475eea34835b56f90c8460b90b1fdc605a21b3a');
  assert.equal(studyCases.reduce((n, item) => n + Object.keys(item.additionalWrong ?? {}).length, 0), 5);
});

test('study function admission rejects external operations and unbounded syntax before Python execution', () => {
  for (const code of ['import os\ndef repair(): pass', 'def repair():\n    open("outside", "w")',
    'def repair(value):\n    return value.__class__', 'def repair(value):\n    while True: pass',
    'def repair(value):\n    return eval(value)', 'def repair(value):\n    return value.system("anything")',
    'def repair(value):\n    for i in range(99999999): pass', 'def repair(value):\n    return value\n' + '#'.repeat(4096)]) {
    assert.throws(() => validateStudyCode(python, code), /invalid_bounded_study_function/);
  }
});

test('CLI refuses live/unknown arguments and preparation outside the ignored repository directory', async () => {
  const cli = fileURLToPath(new URL('../scripts/benefit-study-preflight.js', import.meta.url));
  for (const args of [[], ['live'], ['prepare', '--live']]) assert.throws(() => execFileSync(process.execPath, [cli, ...args], { windowsHide: true, stdio: 'ignore' }));
  await assert.rejects(prepareBenefitStudy(fileURLToPath(new URL('../../outside-study', import.meta.url)), python), /must stay inside/);
});

test('fresh preparation verifies three independent source repairs, six discriminating controls and 18 actual scripted inputs with HTTP disabled', { timeout: 180000 }, async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('No HTTP is allowed in benefit preparation'); }) as typeof fetch;
  try {
    const { root, report } = await prepareBenefitStudy(fileURLToPath(new URL('../../.probe-work/t061-tests', import.meta.url)), python);
    assert.equal(report.sourceProofs.length, 3); assert.equal(new Set(report.sourceProofs.map(p => p.experienceId)).size, 3);
    assert.equal(new Set(report.sourceProofs.map(p => p.verificationId)).size, 3);
    assert.equal(new Set(report.sourceProofs.map(p => p.acceptanceDigest)).size, 3); assert.equal(report.controls.length, 6);
    for (const control of report.controls) {
      const item = studyCases.find(c => c.id === control.case)!;
      assert.equal(control.outcomes.length, 3 + Object.keys(item.additionalWrong ?? {}).length);
      assert(control.outcomes.every(o => o.passed === (o.variant === 'reference')));
      assert(control.outcomes.every(o => o.cases.length >= 2 && o.cases.every(c => c.status !== 'skipped' && c.status !== 'error')));
    }
    assert.equal(report.exposure.length, 18); assert(report.exposure.every(e => e.actualScriptedRequests === 1 && e.commonTaskPresent && e.realModelAcceptance === null));
    assert(report.exposure.filter(e => e.arm === 'none').every(e => !e.referencePresent && !e.selectedId && !e.applicationRecorded));
    for (const row of report.exposure) assert.equal(row.referencePresent, !!row.selectedId);
    for (const item of studyCases) {
      const rows = report.exposure.filter(e => e.case === item.id);
      assert.equal(new Set(rows.map(e => e.commonPromptDigest)).size, 1);
      assert.equal(new Set(rows.map(e => e.commonSystemDigest)).size, 1);
      assert.equal(rows[0]!.commonPromptDigest, digest(studyTaskInput(item)));
    }
    assert.equal(report.realTrialsStarted, 0); assert.equal(report.paidHttpCalls, 0); assert.equal(report.futureBenefitProven, false);
    assert.equal(report.spendingAuthorized, false); assert.equal(report.liveExecutionImplemented, false);
    assert.deepEqual(JSON.parse(await readFile(root + '/preparation.json', 'utf8')), report);
    t.diagnostic(JSON.stringify({ fixtureDigest: report.fixtureDigest, methodDigest: report.methodDigest,
      sourceProofs: 3, targetControls: report.controls.map(c => ({ case: c.case, statuses: c.outcomes.map(o => o.passed) })),
      exposure: report.exposure.map(e => ({ case: e.case, arm: e.arm, provided: e.referencePresent, reason: e.reason,
        agreesWithAuthoredLabel: e.selectionAgreesWithAuthoredLabel })), paidHttpCalls: 0, realModelBenefit: false }));
  } finally { globalThis.fetch = originalFetch; }
});
