/** Synthetic UI/parser controls only. No provider, ledger or evidence claim. */
import { studyArms, studySchedule } from '../scripts/benefit-study-cases.js';

export function studyReportFixture(options: { attempted?: number; unknownAt?: number; missingAt?: number; fixture?: boolean } = {}) {
  const attempted = options.attempted ?? 36;
  const scope = options.fixture ? 'fixture' : 'live';
  const trials = studySchedule.slice(0, attempted).flatMap((s, index) => {
    if (index === options.missingAt) return [];
    const failed = s.case === 'delivery_batch', unknown = index === options.unknownAt;
    const referenceProvided = s.arm !== 'none' && (s.arm === 'plain' || s.case !== 'required_deadline');
    const attempts = Array.from({ length: failed && !unknown ? 2 : 1 }, (_, round) => ({ round: round + 1,
      status: unknown ? 'execution_unknown' : failed ? 'invalid_code' : 'accepted', executionAttempted: !failed && !unknown,
      actualRequests: 1, actualSdkRequests: 1, actualScriptedRequests: 0,
      tests: failed || unknown ? null : { passed: true, tests: 2, failures: 0, errors: 0, skipped: 0, timedOut: false, exitCode: 0,
        cases: [{ id: 'synthetic_1', status: 'passed' }, { id: 'synthetic_2', status: 'passed' }] } }));
    return [{ ...s, index, referenceProvided, result: { case: s.case, kind: scope === 'live' ? 'real-provider-repair-trial' : 'live-path-fixture-repair-trial',
      referenceProvided, attempts, firstPass: !failed && !unknown, finalPass: !failed && !unknown, unknown,
      actualAttempts: attempts.length, actualReworkAttempts: attempts.length - 1, actualScriptedRequests: 0, actualSdkRequests: attempts.length } }];
  });
  const receipts = studySchedule.slice(0, attempted).map((s, index) => ({ ...s, index,
    resultRecorded: index !== options.missingAt, countsComplete: true,
    failureReason: index === options.missingAt ? 'controller_result_unavailable' : null,
    observedSdkRequests: trials.find(t => t.index === index)?.result.attempts.length ?? 0 }));
  const arms = Object.fromEntries(studyArms.map(arm => {
    const rows = trials.filter(t => t.arm === arm), entered = receipts.filter(t => t.arm === arm);
    const firstAccepted = rows.filter(t => t.result.firstPass).length, finalAccepted = rows.filter(t => t.result.finalPass).length;
    const requests = rows.reduce((n, t) => n + t.result.attempts.length, 0);
    return [arm, { planned: 12, attempted: entered.length, recorded: rows.length, notAttempted: 12 - entered.length,
      unresolved: entered.filter(t => t.failureReason || rows.find(r => r.index === t.index)?.result.unknown).length,
      firstAccepted, finalAccepted, firstPassRate: firstAccepted / 12, finalPassRate: finalAccepted / 12,
      knownFailed: rows.filter(t => !t.result.finalPass && !t.result.unknown).length,
      invalidAttempts: rows.flatMap(t => t.result.attempts).filter(t => t.status === 'invalid_code').length,
      referencesProvided: rows.filter(t => t.referenceProvided).length,
      reworkAttempts: rows.reduce((n, t) => n + t.result.actualReworkAttempts, 0), observedSdkRequests: requests, sdkRequests: requests,
      knownPeakUpperMicroCny: requests * 280, unknownHeldMicroCny: 0, usage: { input: requests * 100, output: requests * 10 } }];
  }));
  const calls = receipts.reduce((n, r) => n + r.observedSdkRequests, 0);
  const complete = attempted === 36 && options.unknownAt === undefined && options.missingAt === undefined;
  return { schema: 1, kind: scope === 'live' ? 'real-provider-benefit-study' : 'live-path-provider-fixture-study', scope,
    sourceCommit: 'a'.repeat(40), simulatedAmountsOnly: scope === 'fixture', complete, frozenUnchanged: true,
    stoppedReason: complete ? null : 'synthetic_stop', plannedTrials: 36, attemptedTrials: attempted, recordedTrials: trials.length,
    notAttempted: 36 - attempted, trials, receipts, arms, counts: { networkAttempts: calls, providerHttpRequests: scope === 'live' ? calls : 0,
      fixtureHttpRequests: scope === 'fixture' ? calls : 0, completedBodies: calls }, durableReservations: calls,
    financial: { phase: complete ? 'completed' : 'incomplete', calls, cap: 10_000_000, settledUpperBound: calls * 280, unknownReserved: 0 } };
}
