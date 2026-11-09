/** Frozen synthetic schedule through actual official SDK and loopback; no live command or owner grant. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { createStudySourceBank, newStudyRoot, selectStudyReference } from './benefit-study-preflight.js';
import { executeBenefitTrial } from './benefit-trial-controller.js';
import { writeStudyTarget } from './benefit-study-files.js';
import { studyArms, studyCases, studyFixtureVersion, studySchedule, studySources, studySystem } from './benefit-study-cases.js';
import { createOfflineSdkDriver } from './study-offline-sdk.js';
import { StudyCostLedger, studyCostPolicy } from './study-cost-ledger.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export async function rehearseOfficialStudy(parent = join(repository, '.probe-work/t064-sdk-rehearsal'), python = process.env.EVOLVE_PYTHON ?? 'python') {
  assert.equal(git(repository, ['status', '--porcelain']), '', 'Commit study code before freezing a rehearsal');
  const root = await newStudyRoot(parent); const began = Date.now();
  const scripts = ['benefit-study-cases', 'benefit-study-preflight', 'benefit-study-files', 'benefit-trial-controller',
    'study-controller-driver', 'study-offline-sdk', 'study-call-guard', 'study-cost-ledger', 'study-official-runner', 'pilot-fixtures'];
  const sourcePaths = ['package.json', 'package-lock.json', 'tsconfig.json', ...scripts.map(n => 'scripts/' + n + '.ts'),
    ...(await readdir(join(repository, 'src'))).filter(n => n.endsWith('.ts')).map(n => 'src/' + n)].sort();
  const executionPaths = [...scripts.map(n => 'dist/scripts/' + n + '.js'), 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js',
    ...(await readdir(join(repository, 'dist/src'))).filter(n => n.endsWith('.js')).map(n => 'dist/src/' + n)].sort();
  const hashes = async (paths: string[]) => Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(join(repository, path)))])));
  const implementation = await hashes(sourcePaths); const execution = await hashes(executionPaths);
  const runtime = { node: process.version,
    python: execFileSync(python, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 128 }).trim(),
    sdk: Object.fromEntries(await Promise.all(['dsh-agent', 'dsh-agent-loop', 'dsh-llm', 'dsh-llm-deepseek'].map(async name =>
      [name, (JSON.parse(await readFile(join(repository, 'node_modules/@deepseek-ai', name, 'package.json'), 'utf8')) as { version: string }).version]))) };
  const bank = await createStudySourceBank(root, python);
  try {
    const bankDigest = digest(JSON.stringify(bank.store.experiences())); const head = git(bank.repo, ['rev-parse', 'HEAD']);
    const index = await readFile(join(bank.repo, '.git/index'));
    const plan = { kind: 'synthetic-official-sdk-wire-plan', sourceCommit: git(repository, ['rev-parse', 'HEAD']),
      fixtureVersion: studyFixtureVersion, fixtureDigest: digest(JSON.stringify({ studyCases, studySources })),
      scheduleDigest: digest(JSON.stringify(studySchedule)), systemDigest: digest(studySystem), implementation, execution, runtime,
      policy: studyCostPolicy, sourceBankDigest: bankDigest, sourceHead: head, sourceIndexDigest: digest(index) };
    const binding = { studyId: randomUUID(), planDigest: digest(JSON.stringify(plan)) };
    await writeFile(join(root, 'offline-plan.json'), JSON.stringify({ ...plan, binding }, null, 2), { flag: 'wx', mode: 0o600 });
    const ledger = StudyCostLedger.create(root, binding);
    try {
      ledger.approve(binding, 10_000_000, digest('T064 synthetic approval fixture; not an owner grant'));
      const checkFrozen = async () => {
        assert.deepEqual(await hashes(sourcePaths), implementation); assert.deepEqual(await hashes(executionPaths), execution);
        assert.equal(digest(JSON.stringify(bank.store.experiences())), bankDigest); assert.equal(git(bank.repo, ['rev-parse', 'HEAD']), head);
        assert((await readFile(join(bank.repo, '.git/index'))).equals(index)); return { planDigest: binding.planDigest };
      };
      type Trial = typeof studySchedule[number] & { folder: string; referenceProvided: boolean;
        selection: Omit<Awaited<ReturnType<typeof selectStudyReference>>, 'memory'>;
        result: Awaited<ReturnType<typeof executeBenefitTrial>>['result']; wire: ReturnType<Awaited<ReturnType<typeof createOfflineSdkDriver>>['snapshot']> };
      const trials: Trial[] = []; const unresolved: { index: number; reason: string }[] = []; let stoppedReason: string | null = null;
      for (const [trialIndex, planned] of studySchedule.entries()) {
        try {
          const item = studyCases.find(c => c.id === planned.case)!; await writeStudyTarget(root, bank.repo, item.before);
          const selected = await selectStudyReference(bank.store, bank.repo, item, planned.arm, python);
          const sdk = await createOfflineSdkDriver({ ledger, binding, trialIndex, item, memory: selected.memory, mode: 'repair_once', checkFrozen });
          try {
            const trial = await executeBenefitTrial({ parent: root, projectRoot: bank.repo, item, memory: selected.memory, mode: 'repair_once', python }, sdk.driver);
            const { memory: _memory, ...selection } = selected;
            const wire = sdk.snapshot(); trials.push({ ...planned, selection, folder: relative(root, trial.root).split('\\').join('/'),
              referenceProvided: selected.memory !== null, result: trial.result, wire });
            if (JSON.stringify(trial.result.attempts.map(a => a.status)) !== '["tests_failed","accepted"]'
              || trial.result.actualSdkRequests !== 2 || wire.loopbackRequests !== 2 || wire.offlineTransportInvocations !== 2
              || wire.providerHttpRequests !== 0 || wire.deniedRequests !== 0) { stoppedReason = 'official_sdk_control_mismatch'; break; }
          } finally { await sdk.close(); }
        } catch { unresolved.push({ index: trialIndex, reason: 'controller_result_unavailable' }); stoppedReason = 'controller_incomplete'; break; }
      }
      let frozenUnchanged = true; try { await checkFrozen(); } catch { frozenUnchanged = false; stoppedReason ??= 'study_freeze_changed'; }
      const complete = !stoppedReason && trials.length === 36;
      if (ledger.state.phase === 'started') ledger.finish(complete);
      const financial = ledger.summary; const calls = ledger.state.calls;
      const arms = Object.fromEntries(studyArms.map(arm => {
        const rows = trials.filter(t => t.arm === arm); return [arm, { planned: 12, recorded: rows.length,
          referencesProvided: rows.filter(r => r.referenceProvided).length,
          sdkRequests: rows.reduce((n, r) => n + r.result.actualSdkRequests, 0), loopbackRequests: rows.reduce((n, r) => n + r.wire.loopbackRequests, 0),
          initialAccepted: rows.filter(r => r.result.firstPass).length, finalAccepted: rows.filter(r => r.result.finalPass).length }];
      }));
      const report = { kind: 'official-sdk-loopback-schedule-rehearsal', schemaVersion: 1, plan, binding, complete, stoppedReason,
        plannedTrials: 36, recordedTrials: trials.length, unresolved, notAttempted: 36 - trials.length - unresolved.length,
        arms, trials, recordedLoopbackRequests: trials.reduce((n, t) => n + t.wire.loopbackRequests, 0),
        durableReservations: calls.length, rawWireDigests: calls.map(c => c.inputDigest), financial, frozenUnchanged,
        realTrialsStarted: 0, providerHttpRequests: 0, realModelBenefit: false, liveExecutionImplemented: false,
        simulatedAmountsOnly: true, elapsedMs: Date.now() - began,
        limitations: ['authored original then reference is a synthetic control, never measured model benefit',
          'loopback HTTP is real local traffic; provider HTTP and real charges are zero',
          'manifest includes official SDK entry but is not a complete live transitive-dependency freeze',
          'trusted fixed-path owner grant, real network cancellation, code isolation and fresh budget remain required'] };
      await writeFile(join(root, 'sdk-wire-result.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
      return { root, report };
    } finally { ledger.close(); }
  } finally { bank.store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== 'offline-wire') throw new Error('Usage: node dist/scripts/study-official-runner.js offline-wire');
  const { root, report } = await rehearseOfficialStudy();
  process.stdout.write(JSON.stringify({ report: join(root, 'sdk-wire-result.json'), kind: report.kind, complete: report.complete,
    recordedTrials: report.recordedTrials, recordedLoopbackRequests: report.recordedLoopbackRequests, durableReservations: report.durableReservations,
    providerHttpRequests: 0, realModelBenefit: false, simulatedAmountsOnly: true }) + '\n');
  if (!report.complete) process.exitCode = 1;
}
