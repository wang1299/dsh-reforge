/** Fixed 36-trial protocol. Fixtures use this entire path with a mandatory fake provider. */
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { digest } from '../src/domain.js';
import { studyArms, studyCases, studySchedule } from './benefit-study-cases.js';
import { selectStudyReference } from './benefit-study-preflight.js';
import { writeStudyTarget } from './benefit-study-files.js';
import { executeBenefitTrial } from './benefit-trial-controller.js';
import { restoreStudyBank } from './study-bank-snapshot.js';
import { StudyAuthority, writeExclusiveStudyJson } from './study-authority.js';
import { boundedStudyExecution } from './study-bounded-python.js';
import { pricingDocumentDigest, readLiveStudyPlan, verifyLiveStudyPlan } from './study-live-plan.js';
import { createStudyProviderBackend } from './study-provider-backend.js';
import { createStudySdkRelay } from './study-sdk-relay.js';
import { sdkFixtureStream, type SdkFixtureMode } from './study-offline-sdk.js';
import { withStudyGit } from './study-git.js';

type TrialResult = Awaited<ReturnType<typeof executeBenefitTrial>>;
type Relay = Awaited<ReturnType<typeof createStudySdkRelay>>;
type Planned = typeof studySchedule[number];
interface Receipt extends Planned {
  index: number; resultRecorded: boolean; countsComplete: boolean; failureReason: string | null;
  observedSdkRequests: number; wire: ReturnType<Relay['snapshot']> | null;
}
interface Recorded extends Planned { index: number; folder: string; referenceProvided: boolean; result: TrialResult['result'] }
type Input = { authority: StudyAuthority; root: string; digest: string }
  & ({ scope: 'live' } | { scope: 'fixture'; mode: SdkFixtureMode | 'qualification' });

export class StudyKeyMissing extends Error { constructor() { super('Set DSH_REFORGE_STUDY_KEY locally after approval; never send it in chat.'); } }
export async function executePreparedStudy(input: Input) {
  return withStudyGit(() => executeFrozenStudy(input));
}
async function executeFrozenStudy(input: Input) {
  assert.equal(input.authority.scope, input.scope);
  const { plan, locator } = await readLiveStudyPlan(input.authority, input.root); assert.equal(input.digest, locator.binding.planDigest);
  try { await lstat(join(plan.root, 'study-result.json')); throw new Error('This study already has an execution result'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await verifyLiveStudyPlan(input.authority, plan, true);
  assert.equal(await pricingDocumentDigest(input.scope), plan.pricingDocumentDigest, 'Provider price document changed; do not spend under this plan');
  const { ledger, lease } = await input.authority.openApproved(locator, () => verifyLiveStudyPlan(input.authority, plan, true));
  let bank: Awaited<ReturnType<typeof restoreStudyBank>> | undefined;
  try {
    // This is the only credential read. Approval and all frozen bytes were checked first.
    let key: string;
    if (input.scope === 'live') { key = process.env.DSH_REFORGE_STUDY_KEY ?? ''; delete process.env.DSH_REFORGE_STUDY_KEY; if (!key) throw new StudyKeyMissing(); }
    else key = 'synthetic-only-study-key';
    let fixtureItem = studyCases[0]!; let fixtureRound = 0; let fixtureIndex = 0;
    const backend = input.scope === 'live' ? createStudyProviderBackend({ scope: 'live', lease, ledger, binding: locator.binding, key })
      : createStudyProviderBackend({ scope: 'fixture', lease, ledger, binding: locator.binding, key,
        fetch: async (_url, options) => {
          assert(options?.signal && !options.signal.aborted);
          if (input.mode === 'unresponsive') return new Promise<never>((_done, reject) => {
            const signal = options.signal!; const abort = () => reject(new Error('Fixture cancelled'));
            signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
          });
          const mode = input.mode === 'qualification' ? fixtureIndex === 0 ? 'first_pass' : fixtureIndex === 1 ? 'unchanged' : 'repair_once' : input.mode;
          return new Response(sdkFixtureStream(fixtureItem, mode, fixtureRound), {
            status: input.mode === 'http_error' ? 503 : 200, headers: { 'content-type': 'text/event-stream' } });
        } });
    key = ''; bank = await restoreStudyBank(plan.bank.snapshot, plan.bank.snapshotDigest);
    assert.equal(digest(JSON.stringify(bank.experiences())), plan.bank.experienceDigest);
    const execution = boundedStudyExecution(plan.python.executable, plan.vendor, join(plan.root, 'execution-temp'));
    const began = Date.now(); let schemaDigest = plan.bank.initialSchemaDigest; let frozenUnchanged = true; let stoppedReason: string | null = null;
    let guardMs = 0; let providerMs = 0;
    const receipts: Receipt[] = []; const trials: Recorded[] = []; const entered = new Set<number>();
    const checkFrozen = async () => {
      const start = Date.now();
      try {
        assert.equal(digest(JSON.stringify(bank!.experiences())), plan.bank.experienceDigest);
        await verifyLiveStudyPlan(input.authority, plan, false, schemaDigest); return { planDigest: locator.binding.planDigest };
      } finally { guardMs += Date.now() - start; }
    };
    for (const [index, planned] of studySchedule.entries()) {
      entered.add(index); let sdk: Relay | undefined; let trial: TrialResult | undefined;
      const receipt: Receipt = { ...planned, index, resultRecorded: false, countsComplete: true, failureReason: null, observedSdkRequests: 0, wire: null };
      try {
        const item = studyCases.find(c => c.id === planned.case)!; fixtureItem = item; fixtureIndex = index;
        await writeStudyTarget(plan.bank.root, plan.bank.repo, item.before);
        const selected = await selectStudyReference(bank, plan.bank.repo, item, planned.arm, plan.python.executable);
        schemaDigest = digest(await readFile(join(plan.bank.repo, 'context.schema.json')));
        assert.deepEqual({ ...planned, ...selected, schemaDigest }, plan.selections[index], 'Actual reference selection changed');
        await checkFrozen();
        sdk = await createStudySdkRelay({ ledger, binding: locator.binding, trialIndex: index, item, memory: selected.memory,
          checkFrozen, mode: 'live', scope: input.scope, execution, authorize: backend.authorize,
          transportKind: backend.transport.kind, providerHttpRequests: () => backend.snapshot().providerHttpRequests,
          respond: async (wire, signal, round) => {
            fixtureRound = round; const start = Date.now();
            try { return await backend.transport.respond(wire, signal); } finally { providerMs += Date.now() - start; }
          } });
        trial = await executeBenefitTrial({ parent: plan.root, projectRoot: plan.bank.repo, projectOwner: plan.bank.root, item, memory: selected.memory,
          mode: input.scope === 'live' ? 'real-provider' : input.mode, python: plan.python.executable }, sdk.driver);
        receipt.resultRecorded = true;
      } catch { receipt.failureReason = sdk ? 'controller_result_unavailable' : 'pre_controller_failure'; }
      finally {
        if (sdk) {
          receipt.observedSdkRequests = sdk.driver.adapter.calls;
          try { await sdk.close(); } catch { receipt.countsComplete = false; receipt.failureReason ??= 'driver_cleanup_unknown'; }
          receipt.wire = sdk.snapshot();
        }
        receipts.push(receipt);
      }
      if (trial) {
        trials.push({ ...planned, index, folder: relative(plan.root, trial.root).replaceAll('\\', '/'), referenceProvided: plan.selections[index]!.memory !== null, result: trial.result });
        if (trial.result.unknown) stoppedReason = 'trial_unknown';
      }
      if (receipt.failureReason) stoppedReason ??= receipt.failureReason;
      if (ledger.state.phase !== 'started') stoppedReason ??= 'financial_boundary_stopped';
      if (stoppedReason) break;
    }
    try { await verifyLiveStudyPlan(input.authority, plan, true, schemaDigest); assert.equal(digest(JSON.stringify(bank.experiences())), plan.bank.experienceDigest); }
    catch { frozenUnchanged = false; stoppedReason ??= 'study_freeze_changed'; }
    const complete = trials.length === 36 && receipts.length === 36 && !stoppedReason;
    if (ledger.state.phase === 'started') ledger.finish(complete);
    const calls = ledger.state.calls; const counts = backend.snapshot();
    const arms = Object.fromEntries(studyArms.map(arm => {
      const rows = trials.filter(t => t.arm === arm); const attempts = receipts.filter(t => t.arm === arm);
      const indices = new Set([...entered].filter(i => studySchedule[i]!.arm === arm));
      const armCalls = calls.filter(c => indices.has(c.trialIndex)); const firstAccepted = rows.filter(t => t.result.firstPass).length; const finalAccepted = rows.filter(t => t.result.finalPass).length;
      return [arm, { planned: 12, attempted: indices.size, recorded: rows.length, notAttempted: 12 - indices.size,
        unresolved: attempts.filter(a => a.failureReason || rows.find(t => t.index === a.index)?.result.unknown).length,
        firstAccepted, finalAccepted, firstPassRate: firstAccepted / 12, finalPassRate: finalAccepted / 12,
        knownFailed: rows.filter(t => !t.result.finalPass && !t.result.unknown).length,
        invalidAttempts: rows.flatMap(t => t.result.attempts).filter(a => ['invalid_code', 'invalid_output'].includes(a.status)).length,
        referencesProvided: rows.filter(t => t.referenceProvided).length, reworkAttempts: rows.reduce((n, t) => n + t.result.actualReworkAttempts, 0),
        observedSdkRequests: attempts.reduce((n, a) => n + a.observedSdkRequests, 0),
        sdkRequests: attempts.every(a => a.countsComplete) ? attempts.reduce((n, a) => n + a.observedSdkRequests, 0) : null,
        recordedDurationMs: rows.reduce((n, t) => n + t.result.durationMs, 0),
        knownPeakUpperMicroCny: armCalls.filter(c => c.usage).reduce((n, c) => n + c.charge, 0),
        unknownHeldMicroCny: armCalls.filter(c => !c.usage).reduce((n, c) => n + c.charge, 0),
        usage: { input: armCalls.reduce((n, c) => n + (c.usage?.input ?? 0), 0), output: armCalls.reduce((n, c) => n + (c.usage?.output ?? 0), 0) } }];
    }));
    const paired = studyCases.flatMap(item => [1, 2].map(repeat => ({ case: item.id, repeat,
      arms: Object.fromEntries(studyArms.map(arm => { const row = trials.find(t => t.case === item.id && t.repeat === repeat && t.arm === arm);
        return [arm, row ? { firstPass: row.result.firstPass, finalPass: row.result.finalPass, unknown: row.result.unknown,
          attempts: row.result.actualAttempts, durationMs: row.result.durationMs } : null]; })) })));
    const report = { schema: 1, kind: input.scope === 'live' ? 'real-provider-benefit-study' : 'live-path-provider-fixture-study', scope: input.scope,
      binding: locator.binding, sourceCommit: plan.sourceCommit, complete, stoppedReason, frozenUnchanged,
      plannedTrials: 36, attemptedTrials: entered.size, recordedTrials: trials.length, notAttempted: 36 - entered.size,
      arms, paired, trials, receipts, counts, financial: ledger.summary, durableReservations: calls.length,
      rawWireDigests: calls.map(c => c.inputDigest), elapsedMs: Date.now() - began, guardMs, providerMs,
      realModelBenefit: null, simulatedAmountsOnly: input.scope === 'fixture',
      limitations: ['six author-visible synthetic tasks repeated twice; not blind external tasks or independent users',
        'source verification is separate from downstream performance; failures and missing trials remain in denominators',
        'peak-price token accounting is a conservative upper estimate, not the provider invoice or an account hard cap',
        'model alias and temperature zero do not guarantee immutable backend weights or identical outputs',
        'resource limits and AST admission are not a general-purpose OS sandbox; owner and OS are trusted',
        'fixture rates are protocol controls and cannot be used as measured model improvement'] };
    await writeExclusiveStudyJson(join(plan.root, 'study-result.json'), report); return { root: plan.root, report };
  } finally { bank?.close(); ledger.close(); }
}
