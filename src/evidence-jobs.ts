import { digest, redact, taskSchema, type Task, type Verification } from './domain.js';
import { snapshot, git } from './repository.js';
import { evidenceDigest, verificationEvidence } from './evidence.js';
import { verifyRepair, verifyWorkspaceRepair, type VerificationPolicy } from './verification.js';
import { WorkspaceSnapshots } from './workspace-snapshots.js';
import { automaticProofDigest } from './automatic-store.js';
import { evidenceInputSchema, LostJobLease, type EvidenceBundle, type EvidenceInput, type LearningJob } from './learning-domain.js';
import type { Store } from './store.js';

class InvalidSource extends Error {}
export class EvidenceJobs {
  get verificationEnabled(): boolean { return this.backgroundVerification; }
  private wake: (() => void) | null = null;
  private readonly repoId: string;
  constructor(private readonly store: Store, private readonly root: string, private readonly policy: VerificationPolicy,
    private readonly backgroundVerification = false, private readonly verifier = verifyRepair, private readonly automaticEnabled = false) { this.repoId = snapshot(root).scope.repoId; }
  private policyDigest(): string { return digest(JSON.stringify({ trusted: this.policy.trusted, python: this.policy.python,
    acceptanceDir: this.policy.acceptanceDir, regressionPath: this.policy.regressionPath, timeoutMs: this.policy.timeoutMs,
    backgroundVerification: this.backgroundVerification })); }
  enqueue(task: Task): LearningJob {
    this.store.assertLearningAllowed(task);
    const old = this.store.learning.forTask(task.id); if (old) return old;
    const current = snapshot(this.root);
    const segment = this.store.automatic.forTask(task.id);
    const privateStore = segment ? new WorkspaceSnapshots(this.store.automatic.snapshotDirectory!, this.root) : null;
    if (segment && (segment.state !== 'queued' || !segment.base || !segment.fixed || !privateStore!.matches(segment.fixed))) throw new Error('Invalid automatic repair snapshots');
    let repositoryState: EvidenceInput['repositoryState'] = 'clean'; let diff = ''; let diffTruncated = false;
    try {
      // For an automatic segment this describes the frozen immutable snapshot pair.
      repositoryState = segment ? 'clean' : git(this.root, ['status', '--porcelain', '--untracked-files=no']) ? 'dirty' : 'clean';
      const raw = segment ? privateStore!.diff(segment.base!.commit, segment.fixed!.commit) : git(this.root, ['diff', '--no-ext-diff', '--no-textconv', task.baseCommit, current.commit, '--', '*.py']);
      diffTruncated = raw.length > 8000; diff = redact(raw, 8000);
    } catch { repositoryState = 'unavailable'; }
    const sources = this.store.taskEvidence(task.id).filter(e => e.repoId === task.scope.repoId);
    const events = this.store.boundedObservations(task.id);
    const input: EvidenceInput = { schemaVersion: 1, taskId: task.id, repoId: task.scope.repoId,
      taskDigest: digest(JSON.stringify(taskSchema.parse(task))), baseCommit: task.baseCommit, fixCommit: segment?.fixed?.commit ?? current.commit,
      dependencyDigest: segment?.fixed?.dependencyDigest ?? current.scope.dependencyDigest, ...(segment ? { snapshotDigest: automaticProofDigest(segment) } : {}),
      mode: this.backgroundVerification && this.policy.trusted ? 'verify' : 'collect', policyDigest: this.policyDigest(),
      repositoryState, diff, diffTruncated, sources: sources.slice(-32).map(e => ({ id: e.id, kind: e.kind, digest: e.digest })),
      omittedSources: Math.max(0, sources.length - 32), observations: events.observations, omittedObservations: events.omitted };
    while (Buffer.byteLength(JSON.stringify(input)) > 128 * 1024 && input.observations.length) {
      input.observations.shift(); input.omittedObservations++;
    }
    const job = this.store.learning.enqueue(evidenceInputSchema.parse(input)); this.wake?.(); return job;
  }
  private validate(job: LearningJob): Verification[] {
    if (digest(JSON.stringify(evidenceInputSchema.parse(job.input))) !== job.inputDigest) throw new Error('Invalid frozen input');
    const task = this.store.task(job.input.taskId);
    if (!task || task.state !== 'closed' || task.scope.repoId !== job.input.repoId
      || digest(JSON.stringify(task)) !== job.input.taskDigest) throw new Error('Invalid closed task');
    this.store.assertTaskLearningAllowed(task);
    const segment = this.store.automatic.forTask(task.id);
    if (segment ? !segment.base || !segment.fixed || segment.repoId !== this.repoId || job.input.snapshotDigest !== automaticProofDigest(segment)
      || segment.base.commit !== job.input.baseCommit || segment.fixed.commit !== job.input.fixCommit : job.input.snapshotDigest !== undefined) throw new InvalidSource();
    const proofs: Verification[] = [];
    for (const ref of job.input.sources) {
      const source = this.store.evidence(ref.id);
      if (!source || source.kind !== ref.kind || source.taskId !== task.id || source.repoId !== job.input.repoId || source.digest !== ref.digest) throw new InvalidSource();
      const report = source.kind === 'verification' ? this.store.verification(source.verificationId) : null;
      try { if (evidenceDigest(source, report) !== ref.digest) throw new InvalidSource(); } catch { throw new InvalidSource(); }
      if (report && report.baseCommit === job.input.baseCommit && report.fixCommit === job.input.fixCommit
        && report.environment.dependencyDigest === job.input.dependencyDigest) proofs.push(report);
    }
    return proofs; // Frozen insertion order; a clock rollback cannot hide a later negative report.
  }
  recover(task: Task, expectedJobId: string, validateExtraction: () => void): LearningJob {
    this.store.assertLearningAllowed(task);
    const old = this.store.learning.job(expectedJobId);
    if (!old || old.input.taskId !== task.id || old.input.repoId !== this.repoId) throw new Error('Recovery source does not belong to task');
    return this.store.learning.appendRecovery(old.id, () => {
      const bundle = this.store.learning.bundle(old.id); const input = old.input;
      if (old.state !== 'succeeded' || old.effectStarted || !bundle || bundle.status !== 'incomplete'
        || bundle.inputDigest !== old.inputDigest || bundle.verificationId !== null || !bundle.reasons.includes('events_omitted')
        || !bundle.reasons.includes('no_source_verification') || bundle.reasons.some(r => r !== 'events_omitted' && r !== 'no_source_verification')
        || !input.omittedObservations || input.omittedSources || input.diffTruncated || input.repositoryState !== 'clean' || input.mode !== 'verify'
        || !this.backgroundVerification || !this.policy.trusted || input.policyDigest !== this.policyDigest()) throw new Error('Evidence state is not eligible for recovery');
      if (this.validate(old).length) throw new Error('Recovery cannot replace an existing source verification');
      const sources = this.store.taskEvidence(task.id);
      if (sources.length !== input.sources.length || sources.some(e => !input.sources.some(r => r.id === e.id && r.digest === e.digest))) throw new Error('Frozen sources changed');
      const current = snapshot(this.root);
      if (current.commit !== input.fixCommit || current.scope.dependencyDigest !== input.dependencyDigest
        || git(this.root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Repair version changed');
      validateExtraction();
    });
  }
  async runNext(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const leaseMs = Math.max(30000, this.policy.timeoutMs * 3 + 60000);
    const job = this.store.learning.claim(this.repoId, Date.now(), leaseMs); if (!job) return false;
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const heartbeat = setInterval(() => {
      try { if (!this.store.learning.renew(job.id, job.token!, Date.now(), leaseMs)) controller.abort(); }
      catch { controller.abort(); }
    }, Math.min(5000, Math.floor(leaseMs / 3)));
    heartbeat.unref();
    try {
      const input = job.input; const proofs = this.validate(job); let proof = proofs.at(-1) ?? null; let fresh: Verification | null = null;
      const reasons: EvidenceBundle['reasons'] = [];
      if (input.baseCommit === input.fixCommit) reasons.push('no_commit_change');
      if (input.repositoryState === 'dirty') reasons.push('dirty_tree');
      if (input.repositoryState === 'unavailable') reasons.push('capture_unavailable');
      if (input.omittedSources) reasons.push('sources_omitted');
      // Tool metadata is diagnostic, not a source of acceptance. Keep omission counts
      // in frozen input; only independent executable proof can establish repair success.
      if (input.diffTruncated) reasons.push('diff_truncated');
      const segment = this.store.automatic.forTask(input.taskId);
      if (segment && !this.automaticEnabled) reasons.push('policy_changed');
      if (!proof && !reasons.length && input.mode === 'verify') {
        if (!this.backgroundVerification || !this.policy.trusted || this.policyDigest() !== input.policyDigest) reasons.push('policy_changed');
        else {
          const current = snapshot(this.root);
          const privateStore = segment ? new WorkspaceSnapshots(this.store.automatic.snapshotDirectory!, this.root) : null;
          if (segment ? !privateStore!.matches(segment.fixed!) : current.commit !== input.fixCommit || current.scope.dependencyDigest !== input.dependencyDigest
            || git(this.root, ['status', '--porcelain', '--untracked-files=no'])) reasons.push('repository_changed');
          else {
            combined.throwIfAborted(); this.store.learning.beginVerification(job.id, job.token!, Date.now());
            fresh = segment ? await verifyWorkspaceRepair(this.root, input.taskId, segment.base!, segment.fixed!, privateStore!, this.policy, combined)
              : await this.verifier(this.root, input.taskId, input.baseCommit, input.fixCommit, this.policy, combined); proof = fresh;
            if (proof.sourceTaskId !== input.taskId || proof.repoId !== input.repoId || proof.baseCommit !== input.baseCommit
              || proof.fixCommit !== input.fixCommit || proof.environment.dependencyDigest !== input.dependencyDigest) throw new InvalidSource();
          }
        }
      }
      if (!proof) { reasons.push('no_source_verification'); if (input.mode === 'collect') reasons.push('execution_disabled'); }
      else if (!proof.verified) reasons.push('source_not_verified');
      combined.throwIfAborted(); this.validate(job);
      const bundle: EvidenceBundle = { schemaVersion: 1, id: job.id, inputDigest: job.inputDigest,
        verificationId: proof?.id ?? null, verificationDigest: proof ? digest(JSON.stringify(proof)) : null,
        status: reasons.length ? 'incomplete' : 'ready', reasons, createdAt: new Date().toISOString() };
      this.store.learning.complete(job.id, job.token!, Date.now(), bundle, () => {
        this.validate(job); // Recheck provenance while holding the atomic publication write transaction.
        if (fresh) { this.store.putVerification(fresh); this.store.putEvidence(verificationEvidence(fresh)); }
        return fresh;
      });
    } catch (error) {
      if (!(error instanceof LostJobLease)) this.store.learning.fail(job.id, job.token!, Date.now(), error instanceof InvalidSource
        ? 'invalid_source' : combined.aborted ? 'cancelled_local' : this.store.learning.job(job.id)?.effectStarted ? 'verification_error' : 'invalid_input');
    } finally { clearInterval(heartbeat); }
    return true;
  }
  /** Only adapters start a resident worker; core callers can explicitly runNext. */
  start(): () => Promise<void> {
    if (this.wake) throw new Error('Evidence worker already running');
    const lifetime = new AbortController(); let running: Promise<unknown> | null = null;
    const tick = (): void => {
      if (running || lifetime.signal.aborted) return;
      running = this.runNext(lifetime.signal).catch(() => { /* Fixed job status is the diagnostic; no raw error logging. */ }).finally(() => { running = null; });
    };
    this.wake = () => queueMicrotask(tick);
    const timer = setInterval(tick, 1000); timer.unref(); this.wake();
    return async () => { lifetime.abort(); clearInterval(timer); this.wake = null; await running; };
  }
}
