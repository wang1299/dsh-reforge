/** Complete scripted schedule only; a live endpoint and authorization are deliberately absent. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { createStudySourceBank, newStudyRoot, selectStudyReference } from './benefit-study-preflight.js';
import { rehearseBenefitTrial } from './benefit-trial-controller.js';
import { studyArms, studyCases, studyFixtureVersion, studySchedule, studySources, studySystem } from './benefit-study-cases.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export async function rehearseBenefitStudy(parent = join(repository, '.probe-work/t062-study-rehearsal'), python = process.env.EVOLVE_PYTHON ?? 'python') {
  const root = await newStudyRoot(parent); const began = Date.now();
  const paths = ['scripts/benefit-study-cases.ts', 'scripts/benefit-study-preflight.ts', 'scripts/benefit-trial-controller.ts', 'scripts/benefit-study-runner.ts'];
  const snapshot = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(join(repository, path)))])));
  const implementation = await snapshot(); const bank = await createStudySourceBank(root, python);
  const bankDigest = digest(JSON.stringify(bank.store.experiences())); const head = git(bank.repo, ['rev-parse', 'HEAD']);
  const index = await readFile(join(bank.repo, '.git/index'));
  try {
    type Trial = typeof studySchedule[number] & Omit<Awaited<ReturnType<typeof selectStudyReference>>, 'memory'> & {
      folder: string; result: Awaited<ReturnType<typeof rehearseBenefitTrial>>['result'];
    };
    const trials: Trial[] = [];
    const unresolvedTrials: { case: string; repeat: number; arm: string; reason: string }[] = [];
    let stoppedReason: string | null = null;
    for (const planned of studySchedule) {
      try {
        const item = studyCases.find(c => c.id === planned.case)!;
        // Selection and execution share this same freshly created source repository.
        await writeFile(join(bank.repo, 'target.py'), item.before);
        const selected = await selectStudyReference(bank.store, bank.repo, item, planned.arm, python);
        const trial = await rehearseBenefitTrial({ parent: root, projectRoot: bank.repo, item, memory: selected.memory, mode: 'repair_once', python });
        const { memory: _memory, ...selection } = selected;
        trials.push({ ...planned, ...selection, folder: relative(root, trial.root).split('\\').join('/'), result: trial.result });
        if (trial.result.firstPass || !trial.result.finalPass || trial.result.actualScriptedRequests !== 2
          || JSON.stringify(trial.result.attempts.map(a => a.status)) !== '["tests_failed","accepted"]') {
          stoppedReason = 'scripted_control_mismatch'; break;
        }
      } catch {
        unresolvedTrials.push({ ...planned, reason: 'controller_result_unavailable' }); stoppedReason = 'controller_incomplete'; break;
      }
    }
    const sourceBankUnchanged = digest(JSON.stringify(bank.store.experiences())) === bankDigest;
    const sourceHeadUnchanged = git(bank.repo, ['rev-parse', 'HEAD']) === head;
    const sourceIndexUnchanged = (await readFile(join(bank.repo, '.git/index'))).equals(index);
    const implementationUnchanged = JSON.stringify(await snapshot()) === JSON.stringify(implementation);
    if (!sourceBankUnchanged || !sourceHeadUnchanged || !sourceIndexUnchanged || !implementationUnchanged) stoppedReason ??= 'study_source_changed';
    const arms = Object.fromEntries(studyArms.map(arm => {
      const rows = trials.filter(t => t.arm === arm);
      return [arm, { planned: 12, recorded: rows.length, unresolved: unresolvedTrials.filter(r => r.arm === arm).length,
        recordedScriptedRequests: rows.reduce((n, r) => n + r.result.actualScriptedRequests, 0),
        initialAccepted: rows.filter(r => r.result.firstPass).length, finalAccepted: rows.filter(r => r.result.finalPass).length,
        reworkAttempts: rows.reduce((n, r) => n + r.result.actualReworkAttempts, 0), referencesProvided: rows.filter(r => r.result.referenceProvided).length,
        unknown: rows.filter(r => r.result.unknown).length }];
    }));
    const report = { kind: 'scripted-controller-schedule-rehearsal', schemaVersion: 1, fixtureVersion: studyFixtureVersion,
      fixtureDigest: digest(JSON.stringify({ studyCases, studySources })), scheduleDigest: digest(JSON.stringify(studySchedule)),
      systemDigest: digest(studySystem), implementation, sourceProofs: bank.proofs, schedule: studySchedule, arms, trials, unresolvedTrials,
      complete: !stoppedReason && trials.length === studySchedule.length, stoppedReason,
      plannedTrials: 36, recordedScriptedTrials: trials.length, notAttempted: 36 - trials.length - unresolvedTrials.length,
      actualScriptedRequests: unresolvedTrials.length ? null : trials.reduce((n, t) => n + t.result.actualScriptedRequests, 0),
      realTrialsStarted: 0, modelHttpRequests: 0, realModelBenefit: false, liveExecutionImplemented: false,
      sourceHeadUnchanged, sourceIndexUnchanged, sourceBankUnchanged, implementationUnchanged, elapsedMs: Date.now() - began,
      limitations: ['scripted original then authored reference is a controller oracle, never model benefit',
        'no model fees/token usage/rework savings are estimated', 'live transport, new durable accounting and fresh spending approval remain required',
        'source selection projected into a common request envelope; not a full Desktop/production-host comparison'] };
    await writeFile(join(root, 'controller-result.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    return { root, report };
  } finally { bank.store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== 'rehearse') throw new Error('Usage: node dist/scripts/benefit-study-runner.js rehearse (scripted zero HTTP only)');
  const { root, report } = await rehearseBenefitStudy();
  process.stdout.write(JSON.stringify({ report: join(root, 'controller-result.json'), kind: report.kind,
    complete: report.complete, stoppedReason: report.stoppedReason,
    recordedScriptedTrials: report.recordedScriptedTrials, actualScriptedRequests: report.actualScriptedRequests,
    realTrialsStarted: 0, modelHttpRequests: 0, realModelBenefit: false }) + '\n');
  if (!report.complete) process.exitCode = 1;
}
