import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStudyProposal, repairFeedback, rehearseBenefitTrial, type RehearsalMode } from '../scripts/benefit-trial-controller.js';
import { studyCases, studySources } from '../scripts/benefit-study-cases.js';
import { StudyValidationError, validateStudyCode } from '../scripts/benefit-study-preflight.js';
import { studyProjectSentinel, writeStudyTarget } from '../scripts/benefit-study-files.js';

test('proposal parser rejects self-report, markdown, extra keys, invalid/oversized shapes before execution', () => {
  assert.equal(parseStudyProposal('{"code":"def repair(): pass"}'), 'def repair(): pass');
  for (const text of ['Everything passed', '```json\n{"code":"x"}\n```', '{"code":"x","accepted":true}',
    '{"code":null}', '{"code":" "}', '[]', '{"code":"x","code":"y"}', '{"code":"x","\\u0063ode":"y"}',
    JSON.stringify({ code: 'x'.repeat(4097) }), ' '.repeat(8193)]) {
    assert.throws(() => parseStudyProposal(text), /invalid_output/);
  }
});

test('AST admission separates a confirmed code rejection from unavailable Python and rejects external-operation aliases', () => {
  const python = process.env.EVOLVE_PYTHON ?? 'python';
  for (const code of ['def repair(state):\n    persist = open\n    return persist("outside", "w")\n',
    'def repair(state):\n    return open\n', 'def repair(state):\n    dict = state\n    return dict\n']) {
    assert.throws(() => validateStudyCode(python, code), error => error instanceof StudyValidationError && error.kind === 'rejected');
  }
  assert.throws(() => validateStudyCode('not-an-installed-study-python-8d432a', studyCases[0]!.reference),
    error => error instanceof StudyValidationError && error.kind === 'unknown');
});

test('safe target replacement refuses existing hard links for both target and contract without changing the linked sentinel', async () => {
  const parent = fileURLToPath(new URL('../../.probe-work/t062-file-tests', import.meta.url)); await mkdir(parent, { recursive: true });
  for (const name of ['target.py', 'contract.py']) {
    const owner = await mkdtemp(join(parent, 'hardlink-')); const project = join(owner, 'project'); await mkdir(project);
    const outside = join(owner, 'outside.py'); const value = name === 'contract.py' ? studyProjectSentinel : 'preserve external synthetic content\n';
    await writeFile(outside, value); await link(outside, join(project, name));
    if (name !== 'contract.py') await writeFile(join(project, 'contract.py'), studyProjectSentinel);
    await assert.rejects(writeStudyTarget(owner, project, studyCases[0]!.reference), /link|non-regular/);
    assert.equal(await readFile(outside, 'utf8'), value);
  }
});

test('safe target replacement refuses a symbolic target without changing its external sentinel', async t => {
  const parent = fileURLToPath(new URL('../../.probe-work/t062-file-tests', import.meta.url)); await mkdir(parent, { recursive: true });
  const owner = await mkdtemp(join(parent, 'symlink-')); const project = join(owner, 'project'); await mkdir(project);
  const outside = join(owner, 'outside.py'); await writeFile(outside, 'preserve external synthetic content\n');
  await writeFile(join(project, 'contract.py'), studyProjectSentinel);
  try { await symlink(outside, join(project, 'target.py'), 'file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Windows user lacks symlink privilege'); return; } throw error; }
  await assert.rejects(writeStudyTarget(owner, project, studyCases[0]!.reference), /link|non-regular/);
  assert.equal(await readFile(outside, 'utf8'), 'preserve external synthetic content\n');
});

test('repair feedback is bounded structured status and never retries an accepted or unknown execution', () => {
  const feedback = repairFeedback('tests_failed', { passed: false, cases: [{ id: 'test_contract_edge', status: 'failed' }] });
  assert(feedback.includes('test_contract_edge')); assert(!feedback.includes('assert '));
  for (const status of ['accepted', 'execution_unknown', 'transport_unknown'] as const) assert.throws(() => repairFeedback(status, null), /not an automatic retry/);
  const bounded = repairFeedback('tests_failed', { passed: false, cases: Array.from({ length: 100 }, () => ({ id: 'x'.repeat(2000), status: 'failed' as const })) });
  assert(bounded.length < 1500);
});

test('study execution CLI cannot enable a live endpoint or accept extra options', () => {
  const cli = fileURLToPath(new URL('../scripts/benefit-study-runner.js', import.meta.url));
  for (const args of [[], ['live'], ['rehearse', '--live']]) assert.throws(() => execFileSync(process.execPath, [cli, ...args], { windowsHide: true, stdio: 'ignore' }));
});

test('trial project override rejects sibling repositories before writing their target', async () => {
  const parent = fileURLToPath(new URL('../../.probe-work/t062-path-tests', import.meta.url)); await mkdir(parent, { recursive: true });
  const foreign = await mkdtemp(join(parent, 'foreign-')); await writeFile(join(foreign, 'target.py'), 'preserve this synthetic file\n');
  const owned = await mkdtemp(join(parent, 'owned-'));
  await assert.rejects(rehearseBenefitTrial({ parent: owned, projectRoot: foreign, item: studyCases[0]!, memory: null, mode: 'first_pass' }), /freshly created/);
  assert.equal(await readFile(join(foreign, 'target.py'), 'utf8'), 'preserve this synthetic file\n');
});

test('actual official AgentLoop and external pytest distinguish accepted repair, bounded rework, false claims, unsafe code and unknown transport', { timeout: 120000 }, async t => {
  const originalFetch = globalThis.fetch; globalThis.fetch = (() => { throw new Error('controller rehearsal must not use HTTP'); }) as typeof fetch;
  const parent = fileURLToPath(new URL('../../.probe-work/t062-tests', import.meta.url));
  const item = studyCases[0]!; const rows = [];
  const expected: Record<RehearsalMode, string[]> = {
    first_pass: ['accepted'], repair_once: ['tests_failed', 'accepted'], unchanged: ['tests_failed', 'tests_failed'],
    self_report: ['invalid_output', 'invalid_output'], forbidden_code: ['invalid_code', 'invalid_code'], interrupted: ['transport_unknown'],
  };
  try {
    for (const [mode, statuses] of Object.entries(expected)) {
      const memory = mode === 'repair_once' ? JSON.stringify({ title: studySources[0]!.title, strategy: studySources[0]!.strategy }) : null;
      const { root, result } = await rehearseBenefitTrial({ parent, item, memory, mode: mode as RehearsalMode });
      assert.deepEqual(result.attempts.map(a => a.status), statuses);
      assert.equal(result.actualAttempts, statuses.length); assert.equal(result.actualScriptedRequests, statuses.length);
      assert.equal(result.actualReworkAttempts, statuses.length - 1);
      assert.equal(result.firstPass, mode === 'first_pass'); assert.equal(result.finalPass, ['first_pass', 'repair_once'].includes(mode));
      assert.equal(result.unknown, mode === 'interrupted'); assert.equal(result.realModelBenefit, false); assert.equal(result.modelHttpRequests, 0);
      assert.equal(result.referenceProvided, memory !== null);
      if (['self_report', 'forbidden_code', 'interrupted'].includes(mode)) {
        assert(result.attempts.every(a => !a.executionAttempted && a.tests === null));
        assert.equal(await readFile(join(root, 'project/target.py'), 'utf8'), item.before);
      }
      const saved = await readFile(join(root, 'trial-result.json'), 'utf8');
      assert.deepEqual(JSON.parse(saved), result); assert(!saved.includes(item.reference)); assert(!saved.includes('Everything is fixed'));
      rows.push({ mode, statuses, requests: result.actualScriptedRequests, rework: result.actualReworkAttempts });
    }
    t.diagnostic(JSON.stringify({ kind: 'scripted_controller_only', cases: rows, realModelBenefit: false, modelHttpRequests: 0 }));
  } finally { globalThis.fetch = originalFetch; }
});

test('a missing validator after a complete model response becomes unknown with one request, no execution and no repair attempt', async () => {
  const parent = fileURLToPath(new URL('../../.probe-work/t062-tests', import.meta.url));
  const { root, result } = await rehearseBenefitTrial({ parent, item: studyCases[0]!, memory: null, mode: 'first_pass', python: 'not-an-installed-study-python-8d432a' });
  assert.deepEqual(result.attempts.map(a => a.status), ['execution_unknown']); assert.equal(result.actualScriptedRequests, 1);
  assert.equal(result.actualReworkAttempts, 0); assert.equal(result.finalPass, false); assert.equal(result.unknown, true);
  assert.equal(result.attempts[0]!.executionAttempted, false); assert.equal(result.attempts[0]!.tests, null);
  assert.equal(await readFile(join(root, 'project/target.py'), 'utf8'), studyCases[0]!.before);
});
