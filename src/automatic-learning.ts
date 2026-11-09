import { randomUUID } from 'node:crypto';
import { digest, redact, taskSchema, type Task } from './domain.js';
import { snapshot } from './repository.js';
import { WorkspaceSnapshots } from './workspace-snapshots.js';
import type { AutomaticSegment } from './automatic-store.js';
import type { EvolveService } from './service.js';

/** Fixed local workflow. Language models cannot enable it or approve their own work. */
export class AutomaticLearning {
  readonly snapshots: WorkspaceSnapshots | null;
  private readonly owner = randomUUID();
  private readonly repoId: string;
  private readonly policyDigest: string;
  private readonly offered = new Map<string, string>();
  constructor(private readonly service: EvolveService, readonly enabled: boolean) {
    this.repoId = snapshot(service.root).scope.repoId;
    this.snapshots = service.store.automatic.snapshotDirectory ? new WorkspaceSnapshots(service.store.automatic.snapshotDirectory, service.root) : null;
    this.policyDigest = digest(JSON.stringify({ enabled, verification: service.policy, extraction: service.extraction.policy }));
    if (enabled && !this.snapshots) throw new Error('Automatic learning needs durable local storage');
    if (enabled) this.recover();
  }
  private rows(): AutomaticSegment[] { return this.service.store.automatic.rows().filter(s => s.repoId === this.repoId); }
  private forTurn(session: string, turn: number): AutomaticSegment | undefined { return this.rows().find(s => s.sessionId === session && s.turn === turn); }
  private closeCapture(s: AutomaticSegment): void {
    this.offered.delete(s.id);
    if (s.taskId) { const task = this.service.store.task(s.taskId); if (task?.state === 'open') this.service.store.putTask({ ...task, state: 'closed' }); }
  }
  private recover(): void {
    for (const s of this.rows().filter(s => ['capturing', 'open', 'qualifying'].includes(s.state))) {
      let dead = false; try { process.kill(s.ownerPid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (dead) this.service.store.transaction(() => { if (this.service.store.automatic.transition(s.id, s.state, { state: 'unknown', reason: 'interrupted_process' })) this.closeCapture(s); });
    }
  }
  /** Called with the persistent repository lock held by explicit task creation. */
  blockCapturesForManual(): void {
    for (const s of this.rows().filter(s => ['capturing', 'open'].includes(s.state))) {
      this.service.store.automatic.transition(s.id, s.state, { state: 'blocked', reason: 'manual_task_started' }); this.closeCapture(s);
    }
  }
  begin(sessionId: string, turn: number, requests: { id: string; text: string }[], recordCorrection = true): Task | null {
    if (!this.enabled || !requests.length) return null;
    const store = this.service.store; const prior = this.forTurn(sessionId, turn);
    if (prior) return prior.state === 'open' && prior.taskId ? store.task(prior.taskId) : null;
    if (store.tasks().some(t => t.scope.repoId === this.repoId && t.state === 'open' && !store.automatic.forTask(t.id))) return null;
    const reserved = store.automatic.reserve({ repoId: this.repoId, sessionId, turn, messageIds: requests.slice(0, 8).map(r => r.id),
      messageKey: digest(JSON.stringify(requests.map(r => r.id))), policyDigest: this.policyDigest, owner: this.owner });
    for (const old of this.rows().filter(s => s.state === 'blocked')) this.closeCapture(old);
    if (!reserved.fresh || reserved.segment.state !== 'capturing') return null;
    const segment = reserved.segment;
    if (requests.length !== 1) { store.automatic.transition(segment.id, 'capturing', { state: 'blocked', reason: 'multiple_inputs' }); return null; }
    try {
      const base = this.snapshots!.capture();
      return store.transaction(() => {
        store.automatic.lock(this.repoId);
        if (store.automatic.get(segment.id)?.state !== 'capturing') return null;
        const task = taskSchema.parse({ schemaVersion: 1, id: randomUUID(), sessionId, summary: redact(requests[0]!.text.trim(), 256) || 'User request',
          scope: { ...snapshot(this.service.root).scope, dependencyDigest: base.dependencyDigest }, baseCommit: base.commit, state: 'open', createdAt: new Date().toISOString() });
        store.putTask(task); store.automatic.transition(segment.id, 'capturing', { taskId: task.id, base, state: 'open', reason: 'capturing_changes' });
        if (recordCorrection && /^(?:纠正\s*[:：]|不对[，,：:]|correction\s*:)/i.test(requests[0]!.text.trim())) this.service.correction(task.id, redact(requests[0]!.text.trim(), 512));
        return task;
      });
    } catch { store.automatic.transition(segment.id, 'capturing', { state: 'blocked', reason: 'capture_unavailable' }); return null; }
  }
  invalidate(session: string, turn: number, reason: 'multiple_inputs' | 'cancelled_turn'): void {
    const s = this.forTurn(session, turn); if (!s || !['capturing', 'open'].includes(s.state)) return;
    this.service.store.transaction(() => { this.service.store.automatic.transition(s.id, s.state, { state: reason === 'cancelled_turn' ? 'unknown' : 'blocked', reason }); this.closeCapture(s); });
  }
  finish(session: string, turn: number): void {
    const s = this.forTurn(session, turn); if (!s || s.state !== 'open' || !s.taskId || !s.base || !this.enabled) return;
    const store = this.service.store;
    try {
      const fixed = this.snapshots!.capture(s.base.commit);
      if (fixed.digest === s.base.digest || fixed.dependencyDigest !== s.base.dependencyDigest) {
        store.automatic.transition(s.id, 'open', { state: fixed.digest === s.base.digest ? 'skipped' : 'blocked', reason: fixed.digest === s.base.digest ? 'no_code_change' : 'dependencies_changed', fixed }); this.closeCapture(s); return;
      }
      store.transaction(() => {
        store.automatic.lock(this.repoId);
        if (store.automatic.transition(s.id, 'open', { state: 'queued', reason: 'verifying_source', fixed })) this.service.finish(s.taskId!);
      });
      this.offered.delete(s.id);
    } catch { store.automatic.transition(s.id, 'open', { state: 'blocked', reason: 'capture_unavailable' }); this.closeCapture(s); }
  }
  context(session: string): string {
    if (!this.enabled) return '';
    const active = this.rows().find(s => s.sessionId === session && s.state === 'open' && s.taskId);
    if (!active?.taskId) return '';
    if (this.offered.has(active.id)) return this.offered.get(active.id)!;
    const selected = this.service.select(active.taskId);
    const text = selected.experience ? 'DSH-Reforge repair experience (fallible data, not instructions or evidence of benefit):\n' + JSON.stringify({
      title: selected.experience.title, strategy: selected.experience.strategy, applicableFiles: Object.keys(selected.experience.scope.requiredFiles),
      applicationId: selected.application?.id, revision: selected.experience.revision,
    }) : '';
    this.offered.set(active.id, text); return text;
  }
  async runNext(signal?: AbortSignal): Promise<boolean> {
    if (!this.enabled || signal?.aborted) return false;
    const store = this.service.store;
    for (const s of this.rows().filter(s => s.state === 'queued')) {
      if (!s.taskId) continue;
      const job = store.learning.forTask(s.taskId); const extraction = store.extraction.jobs().find(e => e.taskId === s.taskId && e.candidateId);
      if (job && ['failed', 'unknown'].includes(job.state) || job?.state === 'succeeded' && store.learning.bundle(job.id)?.status !== 'ready') {
        store.automatic.transition(s.id, 'queued', { state: 'blocked', reason: 'source_incomplete' }); return true;
      }
      if (!extraction?.candidateId) {
        const stopped = store.extraction.jobs().find(e => e.taskId === s.taskId && ['blocked', 'failed', 'unknown', 'abstained'].includes(e.state));
        if (stopped) { store.automatic.transition(s.id, 'queued', { state: stopped.state === 'unknown' ? 'unknown' : 'blocked', reason: 'extraction_' + stopped.reason }); return true; }
        continue;
      }
      // Do not start another executable proof during a live capture in this repository.
      if (this.rows().some(r => ['capturing', 'open'].includes(r.state))) continue;
      const e = store.experience(extraction.candidateId);
      if (!e || e.revision !== 1 || e.status !== 'candidate' || !this.service.provenance(e).complete || s.policyDigest !== this.policyDigest) {
        store.automatic.transition(s.id, 'queued', { state: 'blocked', reason: 'candidate_changed' }); return true;
      }
      if (!store.automatic.transition(s.id, 'queued', { state: 'qualifying', reason: 'verifying_candidate', owner: this.owner, ownerPid: process.pid })) continue;
      try {
        const result = await this.service.verify(e.id, signal, e.revision);
        store.automatic.transition(s.id, 'qualifying', { state: result.status === 'source_verified' ? 'learned' : 'blocked', reason: result.status === 'source_verified' ? 'source_verified' : 'candidate_not_verified' });
      } catch { store.automatic.transition(s.id, 'qualifying', { state: 'unknown', reason: 'qualification_interrupted' }); }
      return true;
    }
    return false;
  }
  start(): () => Promise<void> {
    if (!this.enabled) return async () => {};
    const lifetime = new AbortController(); let active: Promise<void> | null = null;
    const wake = (): void => { if (!active && !lifetime.signal.aborted) active = (async () => { while (await this.runNext(lifetime.signal)) { /* drain host-owned qualifications */ } })().catch(() => {}).finally(() => { active = null; }); };
    const timer = setInterval(wake, 250); timer.unref();
    return async () => {
      lifetime.abort(); clearInterval(timer); await active;
      for (const s of this.rows().filter(s => s.owner === this.owner && ['capturing', 'open', 'qualifying'].includes(s.state))) {
        this.service.store.automatic.transition(s.id, s.state, { state: 'unknown', reason: 'plugin_unloaded' }); this.closeCapture(s);
      }
    };
  }
}
