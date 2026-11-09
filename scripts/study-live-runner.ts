/** No build on inspect/authorize/live: rebuilding would invalidate the frozen executable identities. */
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newStudyRoot } from './benefit-study-preflight.js';
import { studyCostPolicy, StudyCostLedger } from './study-cost-ledger.js';
import { StudyAuthority, writeExclusiveStudyJson } from './study-authority.js';
import { prepareLiveStudy, readLiveStudyPlan, verifyLiveStudyPlan } from './study-live-plan.js';
import { executePreparedStudy, StudyKeyMissing } from './study-live-executor.js';
import { studyRepository } from './study-owned-path.js';

export function parseStudyCommand(args: string[]) {
  const [command, ...rest] = args; assert(command && ['prepare', 'inspect', 'authorize', 'live', 'qualify'].includes(command), 'Unknown study command');
  const fields = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!; assert(['--plan', '--digest', '--cap-cny', '--acknowledge-paid-calls'].includes(flag) && !fields.has(flag), 'Unknown or repeated study option');
    if (flag === '--acknowledge-paid-calls') fields.set(flag, 'true');
    else { const value = rest[++i]; assert(value && !value.startsWith('--')); fields.set(flag, value); }
  }
  const required = command === 'authorize' ? ['--plan', '--digest', '--cap-cny', '--acknowledge-paid-calls'] : command === 'live' ? ['--plan', '--digest'] : command === 'inspect' ? ['--plan'] : [];
  assert.deepEqual([...fields.keys()].sort(), required.sort(), 'This command requires its exact options');
  const plan = fields.get('--plan'); if (plan) assert.match(plan, /^run-[A-Za-z0-9_-]+$/);
  const hash = fields.get('--digest'); if (hash) assert.match(hash, /^[a-f0-9]{64}$/);
  let cap: number | undefined; const amount = fields.get('--cap-cny');
  if (amount) { assert.match(amount, /^(?:0|[1-9]\d?)(?:\.\d{1,6})?$/); const [whole, fraction = ''] = amount.split('.'); cap = Number(BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'))); assert(cap > 0 && cap <= studyCostPolicy.maxCap); }
  return { command, plan, digest: hash, cap };
}
export function studyPlanSummary(plan: Awaited<ReturnType<typeof prepareLiveStudy>>['plan'], locator: Awaited<ReturnType<typeof prepareLiveStudy>>['locator']) {
  return { scope: plan.scope, plan: plan.root, digest: locator.binding.planDigest, expiresAt: plan.expiresAt, sourceCommit: plan.sourceCommit,
    plannedTrials: 36, maxRequests: 72, controlsPassed: plan.controls.count, python: plan.python.version, sourceProofs: plan.bank.proofs.length,
    candidateSha256: plan.candidate.sha256, frozenEntries: plan.freeze.entries.length, frozenBytes: plan.freeze.bytes,
    suggestedCapCny: 10, maximumReservationCny: studyCostPolicy.reservation / 1000000,
    warning: 'No spending authorization is created by prepare. A missing or unknown receipt stops the study and keeps its full reservation.' };
}
export async function qualifyLiveStudy(npmCli: string) {
  const fixture = await newStudyRoot(join(studyRepository, '.probe-work/t065-live-path-fixture'));
  const authority = StudyAuthority.fixture(join(fixture, 'authority')); const prepared = await prepareLiveStudy(authority, npmCli);
  const { plan, locator } = await readLiveStudyPlan(authority, prepared.plan.root);
  const unapproved = StudyCostLedger.inspect(plan.root, locator.binding); assert.equal(unapproved.phase, 'unapproved');
  await authority.approve(locator, 10000000, true, () => verifyLiveStudyPlan(authority, plan, true));
  const outcome = await executePreparedStudy({ scope: 'fixture', authority, root: plan.root, digest: locator.binding.planDigest, mode: 'qualification' });
  const { report } = outcome; assert(report.complete && report.frozenUnchanged); assert.equal(report.durableReservations, 71);
  assert.equal(report.counts.providerHttpRequests, 0); assert.equal(report.counts.fixtureHttpRequests, 71);
  assert(report.trials.every(t => JSON.stringify(t.result.attempts.map(a => a.status)) === (t.index === 0 ? '["accepted"]' : t.index === 1 ? '["tests_failed","tests_failed"]' : '["tests_failed","accepted"]')));
  const receipt = { ...studyPlanSummary(plan, locator), result: join(plan.root, 'study-result.json'), complete: report.complete,
    recordedTrials: report.recordedTrials, fixtureHttpRequests: report.counts.fixtureHttpRequests, providerHttpRequests: 0, durableReservations: report.durableReservations,
    simulatedAmountsOnly: true, realModelBenefit: false };
  await writeExclusiveStudyJson(join(fixture, 'qualification.json'), receipt); return receipt;
}
export async function mainStudyCommand(args: string[]) {
  const options = parseStudyCommand(args); const authority = StudyAuthority.live();
  if (options.command === 'prepare' || options.command === 'qualify') {
    const npmCli = process.env.npm_execpath; assert(npmCli && resolve(npmCli) === npmCli, 'Use the corresponding npm script');
    if (options.command === 'qualify') return qualifyLiveStudy(npmCli);
    const { plan, locator } = await prepareLiveStudy(authority, npmCli); return studyPlanSummary(plan, locator);
  }
  const root = join(authority.root, 'preparations', options.plan!); const { plan, locator } = await readLiveStudyPlan(authority, root);
  if (options.command === 'inspect') return { ...studyPlanSummary(plan, locator), financial: StudyCostLedger.inspect(root, locator.binding) };
  assert.equal(options.digest, locator.binding.planDigest, 'Use the exact reviewed plan digest');
  if (options.command === 'authorize') return authority.approve(locator, options.cap!, true, () => verifyLiveStudyPlan(authority, plan, true));
  const { report } = await executePreparedStudy({ scope: 'live', authority, root, digest: locator.binding.planDigest });
  return { result: join(root, 'study-result.json'), complete: report.complete, recordedTrials: report.recordedTrials, counts: report.counts, financial: report.financial, realModelBenefit: null };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await mainStudyCommand(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write(error instanceof StudyKeyMissing ? error.message + '\n' : 'Study stopped. Inspect the selected plan and bounded ledger; no automatic retry is allowed.\n'); process.exitCode = 1; }
}
