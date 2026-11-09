import { studyAdmissionContract, type StudyAdmissionDiagnostic } from './study-admission-contract.js';

export type ReportArm = 'none' | 'plain' | 'reforge';
export type ReportStatus = 'accepted' | 'tests_failed' | 'invalid_output' | 'invalid_code' | 'execution_unknown' | 'transport_unknown';
export interface ReportAttempt { round: number; status: ReportStatus; executed: boolean; admission: StudyAdmissionDiagnostic | null }
export interface ReportCell {
  arm: ReportArm; case: string; repeat: number; outcome: 'accepted' | 'failed' | 'unknown' | 'unattempted';
  firstPass: boolean; reference: boolean; attempts: ReportAttempt[];
}
export interface ReportArmSummary {
  arm: ReportArm; attempted: number; first: number; final: number; failed: number; unknown: number; unattempted: number;
  rework: number; references: number; requests: number; upper: number; held: number;
}
export interface StudyReportView {
  scope: 'live' | 'fixture'; sourceCommit: string; complete: boolean; frozenUnchanged: boolean;
  attempted: number; recorded: number; calls: number; responses: number; upper: number; held: number;
  arms: ReportArmSummary[]; rows: { case: string; repeat: number; cells: ReportCell[] }[];
}

/** Pure, bounded allowlist projection. Structure consistency is NOT independent evidence verification. */
export function parseStudyReport(text: string): StudyReportView {
  const fail = (): never => { throw new Error('study_report_invalid'); };
  if (new TextEncoder().encode(text).length > 1048576) fail();
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const arr = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
  const num = (v: unknown, max = 2_000_000_000): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : fail();
  const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : fail();
  const equal = (a: unknown, b: unknown) => { if (a !== b) fail(); };
  let json: unknown; try { json = JSON.parse(text); } catch { fail(); }
  const r = obj(json); equal(r.schema, 1);
  if (r.scope !== 'live' && r.scope !== 'fixture') fail();
  const scope = r.scope as 'live' | 'fixture';
  equal(r.kind, scope === 'live' ? 'real-provider-benefit-study' : 'live-path-provider-fixture-study');
  equal(r.simulatedAmountsOnly, scope === 'fixture');
  if (typeof r.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(r.sourceCommit)) fail();
  equal(r.plannedTrials, 36);
  const complete = bool(r.complete), frozenUnchanged = bool(r.frozenUnchanged);
  const cases = ['preferences_patch', 'role_batch', 'outbox_receipt', 'delivery_batch', 'nullable_deadline', 'required_deadline'];
  const arms: ReportArm[] = ['none', 'plain', 'reforge'];
  const orders: ReportArm[][] = [['none', 'plain', 'reforge'], ['plain', 'reforge', 'none'], ['reforge', 'none', 'plain'],
    ['none', 'reforge', 'plain'], ['reforge', 'plain', 'none'], ['plain', 'none', 'reforge']];
  const schedule = [1, 2].flatMap(repeat => cases.flatMap((id, i) => {
    const o = orders[i]!; return (repeat === 1 ? o : [o[1]!, o[2]!, o[0]!]).map(arm => ({ case: id, repeat, arm }));
  }));
  const receipts = arr(r.receipts, 36), trials = arr(r.trials, 36);
  equal(r.attemptedTrials, receipts.length); equal(r.recordedTrials, trials.length); equal(r.notAttempted, 36 - receipts.length);
  const match = (row: Record<string, unknown>, index: number) => {
    equal(row.index, index); const expected = schedule[index]!;
    equal(row.case, expected.case); equal(row.repeat, expected.repeat); equal(row.arm, expected.arm);
  };
  receipts.forEach((raw, i) => { const row = obj(raw); match(row, i); bool(row.resultRecorded); bool(row.countsComplete);
    num(row.observedSdkRequests, 2); if (row.failureReason !== null && typeof row.failureReason !== 'string') fail(); });
  const byIndex = new Map<number, ReportCell>();
  const requestsByArm = new Map(arms.map(arm => [arm, 0]));
  receipts.forEach(raw => { const row = obj(raw); const arm = row.arm as ReportArm;
    requestsByArm.set(arm, requestsByArm.get(arm)! + num(row.observedSdkRequests, 2)); });
  const statuses: ReportStatus[] = ['accepted', 'tests_failed', 'invalid_output', 'invalid_code', 'execution_unknown', 'transport_unknown'];
  const contract = studyAdmissionContract();
  let previousIndex = -1;
  for (const raw of trials) {
    const row = obj(raw), index = num(row.index, 35); match(row, index);
    if (index <= previousIndex || index >= receipts.length) fail(); previousIndex = index;
    const receipt = obj(receipts[index]); equal(receipt.resultRecorded, true);
    const t = obj(row.result), attempts = arr(t.attempts, 2); if (!attempts.length) fail();
    equal(t.case, row.case); equal(t.kind, scope === 'live' ? 'real-provider-repair-trial' : 'live-path-fixture-repair-trial');
    const reference = bool(row.referenceProvided); equal(t.referenceProvided, reference);
    if (row.arm === 'none' && reference) fail();
    const projected = attempts.map((raw, i): ReportAttempt => {
      const a = obj(raw); equal(a.round, i + 1); if (!statuses.includes(a.status as ReportStatus)) fail();
      const status = a.status as ReportStatus, executed = bool(a.executionAttempted);
      const requests = num(a.actualRequests, 1); equal(a.actualSdkRequests, requests); equal(a.actualScriptedRequests, 0);
      if (i && !['tests_failed', 'invalid_code', 'invalid_output'].includes(obj(attempts[i - 1]).status as string)) fail();
      if (['accepted', 'tests_failed'].includes(status)) {
        equal(executed, true); equal(requests, 1); const tests = obj(a.tests);
        equal(tests.passed, status === 'accepted');
        const checks = arr(tests.cases, 8); if (!checks.length) fail();
        const outcomes = checks.map(c => obj(c).status);
        equal(tests.skipped, 0); equal(tests.timedOut, false); equal(tests.tests, checks.length);
        equal(tests.failures, outcomes.filter(s => s === 'failed').length); equal(tests.errors, outcomes.filter(s => s === 'error').length);
        if (status === 'accepted') equal(tests.exitCode, 0);
        if (status === 'accepted' && outcomes.some(s => s !== 'passed')) fail();
        if (status === 'tests_failed' && (!outcomes.some(s => s === 'failed' || s === 'error') || outcomes.some(s => !['passed', 'failed', 'error'].includes(s as string)))) fail();
      }
      if (['invalid_output', 'invalid_code', 'transport_unknown'].includes(status)) { equal(executed, false); equal(a.tests, null); }
      if (status !== 'transport_unknown') equal(requests, 1);
      const admission = a.admission === undefined ? null : contract.read(a.admission);
      if (a.admission !== undefined && (!admission || status !== 'invalid_code')) fail();
      return { round: i + 1, status, executed, admission };
    });
    const firstPass = projected[0]!.status === 'accepted', finalPass = projected.at(-1)!.status === 'accepted';
    const unknown = projected.some(a => a.status.endsWith('_unknown'));
    equal(t.firstPass, firstPass); equal(t.finalPass, finalPass); equal(t.unknown, unknown);
    equal(t.actualAttempts, projected.length); equal(t.actualReworkAttempts, projected.length - 1);
    equal(t.actualSdkRequests, attempts.reduce<number>((n, a) => n + num(obj(a).actualSdkRequests, 1), 0));
    equal(t.actualScriptedRequests, 0); equal(t.actualSdkRequests, receipt.observedSdkRequests);
    byIndex.set(index, { ...schedule[index]!, firstPass, reference, attempts: projected,
      outcome: unknown || !receipt.countsComplete || receipt.failureReason !== null ? 'unknown' : finalPass ? 'accepted' : 'failed' });
  }
  receipts.forEach((raw, i) => equal(obj(raw).resultRecorded, byIndex.has(i)));
  const cells: ReportCell[] = schedule.map((s, index) => byIndex.get(index) ?? ({ ...s, firstPass: false, reference: false, attempts: [],
    outcome: index < receipts.length ? 'unknown' : 'unattempted' }));
  const summaries = arms.map((arm): ReportArmSummary => {
    const group = cells.filter(c => c.arm === arm), a = obj(obj(r.arms)[arm]);
    const first = group.filter(c => c.firstPass).length, final = group.filter(c => c.attempts.at(-1)?.status === 'accepted').length;
    const attempted = group.filter(c => c.outcome !== 'unattempted').length, recorded = group.filter(c => c.attempts.length).length;
    const knownFailed = group.filter(c => c.attempts.length && c.attempts.at(-1)!.status !== 'accepted' && !c.attempts.some(a => a.status.endsWith('_unknown'))).length;
    const groupReceipts = receipts.map(obj).filter(c => c.arm === arm);
    const unresolved = groupReceipts.filter(c => c.failureReason || byIndex.get(num(c.index, 35))?.attempts.some(a => a.status.endsWith('_unknown'))).length;
    const rework = group.reduce((n, c) => n + Math.max(0, c.attempts.length - 1), 0), references = group.filter(c => c.reference).length;
    const requests = requestsByArm.get(arm)!;
    for (const [key, value] of Object.entries({ planned: 12, attempted, recorded, notAttempted: 12 - attempted, unresolved,
      firstAccepted: first, finalAccepted: final, firstPassRate: first / 12, finalPassRate: final / 12,
      knownFailed, invalidAttempts: group.flatMap(c => c.attempts).filter(a => ['invalid_code', 'invalid_output'].includes(a.status)).length,
      referencesProvided: references, reworkAttempts: rework, observedSdkRequests: requests,
      sdkRequests: groupReceipts.every(c => c.countsComplete) ? requests : null })) equal(a[key], value);
    const upper = num(a.knownPeakUpperMicroCny), held = num(a.unknownHeldMicroCny), usage = obj(a.usage);
    equal(upper, num(usage.input) * 2 + num(usage.output) * 8);
    return { arm, attempted, first, final, failed: group.filter(c => c.outcome === 'failed').length,
      unknown: group.filter(c => c.outcome === 'unknown').length, unattempted: 12 - attempted, rework, references, requests, upper, held };
  });
  const counts = obj(r.counts), financial = obj(r.financial), calls = num(financial.calls, 72), responses = num(counts.completedBodies, 72);
  const http = num(counts.providerHttpRequests, 72) + num(counts.fixtureHttpRequests, 72);
  equal(scope === 'live' ? counts.fixtureHttpRequests : counts.providerHttpRequests, 0);
  equal(counts.networkAttempts, http); equal(r.durableReservations, calls);
  if (responses > http || http > calls || http > summaries.reduce((n, a) => n + a.requests, 0)) fail();
  const upper = summaries.reduce((n, a) => n + a.upper, 0), held = summaries.reduce((n, a) => n + a.held, 0);
  equal(financial.settledUpperBound, upper); equal(financial.unknownReserved, held);
  if (!['unapproved', 'prepared', 'started', 'completed', 'incomplete', 'unknown'].includes(financial.phase as string)) fail();
  if (held % 5_345_728 || held / 5_345_728 > calls || calls - held / 5_345_728 > responses) fail();
  if (calls > summaries.reduce((n, a) => n + a.requests, 0)) fail();
  if (upper + held > num(financial.cap) || (held > 0 && calls === 0)) fail();
  if (complete) {
    equal(receipts.length, 36); equal(trials.length, 36); equal(r.stoppedReason, null); equal(frozenUnchanged, true);
    equal(financial.phase, 'completed'); equal(held, 0);
    equal(http, calls); equal(responses, calls); equal(calls, summaries.reduce((n, a) => n + a.requests, 0));
    if (cells.some(c => c.outcome === 'unknown')) fail();
  }
  return { scope, sourceCommit: r.sourceCommit as string, complete, frozenUnchanged, attempted: receipts.length, recorded: trials.length,
    calls, responses, upper, held, arms: summaries, rows: cases.flatMap(id => [1, 2].map(repeat => ({ case: id, repeat,
      cells: arms.map(arm => cells.find(c => c.case === id && c.repeat === repeat && c.arm === arm)!) }))) };
}
