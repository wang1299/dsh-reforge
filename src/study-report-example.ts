import type { ReportArm, ReportCell, ReportStatus, StudyReportView } from './study-report.js';

/** Predefined teaching projection, not a report, source receipt or live study. Self-contained in the browser. */
export function studyReportExample(): StudyReportView {
  const cases = ['preferences_patch', 'role_batch', 'outbox_receipt', 'delivery_batch', 'nullable_deadline', 'required_deadline'];
  const arms: ReportArm[] = ['none', 'plain', 'reforge'];
  const rows = cases.flatMap(id => [1, 2].map(repeat => ({ case: id, repeat, cells: arms.map((arm): ReportCell => {
    if (repeat === 2) return { arm, case: id, repeat, outcome: 'unattempted', firstPass: false, reference: false, attempts: [] };
    const statuses: ReportStatus[] = id === 'delivery_batch' ? ['invalid_code', 'invalid_code']
      : id === 'outbox_receipt' ? ['tests_failed', 'accepted']
      : id === 'required_deadline' ? arm === 'reforge' ? ['transport_unknown'] : ['tests_failed', 'tests_failed'] : ['accepted'];
    const attempts = statuses.map((status, i) => ({ round: i + 1, status, executed: status === 'accepted' || status === 'tests_failed',
      admission: status === 'invalid_code' ? { schema: 1 as const, rule: 'unsupported_syntax' as const, node: 'Set' as const } : null }));
    return { arm, case: id, repeat, attempts, firstPass: statuses[0] === 'accepted',
      reference: arm === 'plain' || (arm === 'reforge' && id !== 'required_deadline'),
      outcome: statuses.at(-1) === 'transport_unknown' ? 'unknown' : statuses.at(-1) === 'accepted' ? 'accepted' : 'failed' };
  }) })));
  const summaries = arms.map(arm => {
    const cells = rows.flatMap(r => r.cells).filter(c => c.arm === arm), attempted = cells.filter(c => c.attempts.length).length;
    const requests = cells.reduce((n, c) => n + c.attempts.length, 0), unknown = cells.filter(c => c.outcome === 'unknown').length;
    return { arm, attempted, first: cells.filter(c => c.firstPass).length, final: cells.filter(c => c.outcome === 'accepted').length,
      failed: cells.filter(c => c.outcome === 'failed').length, unknown, unattempted: 12 - attempted,
      rework: cells.reduce((n, c) => n + Math.max(0, c.attempts.length - 1), 0), references: cells.filter(c => c.reference).length,
      requests, upper: (requests - unknown) * 280, held: unknown * 5_345_728 };
  });
  const calls = summaries.reduce((n, a) => n + a.requests, 0);
  return { scope: 'fixture', sourceCommit: '', complete: false, frozenUnchanged: true, attempted: 18, recorded: 18,
    calls, responses: calls - 1, upper: summaries.reduce((n, a) => n + a.upper, 0), held: 5_345_728,
    timing: { elapsedMs: 90000, guardMs: 45000, providerMs: 25000, otherMs: 20000 }, arms: summaries, rows };
}
