import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { Store } from './store.js';
import { applicability, snapshot } from './repository.js';
import { candidateSchema, digest, feedbackSchema, idSchema, redact, textSchema, RevisionConflict,
  type Application, type Candidate, type Evidence, type Experience, type Feedback, type Scope, type Task } from './domain.js';
import { verifyRepair, verifyWorkspaceRepair, type VerificationPolicy } from './verification.js';
import { AutomaticLearning } from './automatic-learning.js';
import { retrievalPolicy, type TextMatch } from './retrieval.js';
import { RetrievalRuntime, explanationTerms, type CandidateExplanation, type CandidateReason, type RetrievalStatus } from './retrieval-runtime.js';
import { contextKey, feedbackMemory, rankFeedback, type ContextEvidence } from './feedback-retrieval.js';
import { correctionEvidence, factProvenance, validateCitations, verificationEvidence } from './evidence.js';
import { EvidenceJobs } from './evidence-jobs.js';
import { ExtractionJobs, extractionMaterial } from './extraction.js';
import { modelFailureReasons, type ExtractionJob, type ExtractionPolicy } from './extraction-domain.js';

function cleanCandidate(value: unknown): Candidate {
  const item = candidateSchema.parse(value);
  return { ...item, title: redact(item.title, 160), strategy: redact(item.strategy),
    observedFacts: item.observedFacts.map((s) => redact(s)), inferences: item.inferences.map((s) => redact(s)),
    recommendations: item.recommendations.map((s) => redact(s)) };
}
export function similarity(query: string, text: string): number {
  const tokens = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) ?? []);
  const q = tokens(query); const t = tokens(text);
  if (!q.size) return 0;
  return [...q].filter((word) => t.has(word)).length / q.size;
}
export class EvolveService {
  get sharingEnabled(): boolean { return this.modelSharingAllowed; }
  get repositoryId(): string { return this.repoId; }
  readonly jobs: EvidenceJobs;
  readonly extraction: ExtractionJobs;
  readonly automatic: AutomaticLearning;
  private readonly repoId: string;
  constructor(readonly store: Store, readonly root: string, readonly policy: VerificationPolicy, backgroundVerification = false, extractionPolicy?: ExtractionPolicy, private readonly modelSharingAllowed = false, automaticLearning = false, private readonly retrievalRuntime = new RetrievalRuntime()) {
    if (automaticLearning && (!policy.trusted || !backgroundVerification || !extractionPolicy || !modelSharingAllowed)) throw new Error('Automatic learning requires explicit execution, background verification, sharing and extraction authorization');
    this.jobs = new EvidenceJobs(store, root, policy, backgroundVerification, verifyRepair, automaticLearning);
    this.repoId = snapshot(root).scope.repoId;
    this.extraction = new ExtractionJobs(store, root, extractionPolicy, automaticLearning);
    this.automatic = new AutomaticLearning(this, automaticLearning);
  }
  begin(sessionId: string, summary: string): Task {
    z.string().min(1).max(128).parse(sessionId); textSchema.parse(summary);
    return this.store.transaction(() => {
      this.store.automatic.lock(this.repoId);
      if (this.store.tasks().some((t) => t.sessionId === sessionId && t.state === 'open')) throw new Error('Session already has an open task');
      this.automatic.blockCapturesForManual();
      const current = snapshot(this.root);
      const task: Task = { schemaVersion: 1, id: randomUUID(), sessionId, summary: redact(summary),
        scope: current.scope, baseCommit: current.commit, state: 'open', createdAt: new Date().toISOString() };
      this.store.putTask(task); return task;
    });
  }
  requireTask(id: string, sessionId?: string): Task {
    const task = this.store.task(idSchema.parse(id));
    if (!task) throw new Error('Unknown task');
    if (sessionId !== undefined && task.sessionId !== sessionId) throw new Error('Task belongs to a different session');
    if (task.scope.repoId !== snapshot(this.root).scope.repoId) throw new Error('Task belongs to a different repository');
    return task;
  }
  finish(id: string): Task {
    const task = this.requireTask(id); if (task.state === 'closed') return task;
    const automatic = this.store.automatic.forTask(id);
    if (automatic && automatic.state !== 'queued') throw new Error('Automatic capture closes from the host boundary');
    const closed = { ...task, state: 'closed' as const };
    return this.store.transaction(() => {
      this.store.putTask(closed); const job = this.jobs.enqueue(closed); this.extraction.enqueue(closed, job.id); return closed;
    });
  }
  /** Owner-only append recovery. This queues work and never executes pytest or a model. */
  recoverEvidence(taskId: string, expectedJobId: string): ReturnType<EvidenceJobs['recover']> {
    const task = this.requireTask(taskId); if (task.state !== 'closed') throw new Error('Recovery requires a closed task');
    const policy = this.extraction.policy;
    if (!policy) throw new Error('Recovery requires the original extraction policy');
    return this.store.transaction(() => {
      this.store.lockTask(task.id); // First operation is a write, before any recovery read.
      const recovered = this.jobs.recover(task, expectedJobId, () => {
        const old = this.store.extraction.jobs().find(j => j.evidenceJobId === expectedJobId);
        const grant = this.store.extraction.grants().find(g => g.id === policy.grantId);
        if (!old || old.state !== 'blocked' || old.reason !== 'evidence_incomplete' || old.inputDigest !== null
          || old.candidateId !== null || old.usage !== null || old.policyDigest !== digest(JSON.stringify(policy))
          || !grant || grant.policyDigest !== old.policyDigest || grant.used !== 0 || grant.used >= grant.maxCalls) throw new Error('Extraction has started, changed or lacks unused authorization');
      });
      if (!this.store.extraction.jobs().some(j => j.evidenceJobId === recovered.id)) this.extraction.enqueue(task, recovered.id);
      return recovered;
    });
  }
  /** Owner-only fresh authorization. Unknown attempts and their grants are immutable. */
  reauthorizeExtraction(taskId: string, expectedJobId: string): ExtractionJob {
    const task = this.requireTask(taskId); const policy = this.extraction.policy;
    if (task.state !== 'closed' || !policy || !this.policy.trusted || !this.modelSharingAllowed) throw new Error('Reauthorization requires a closed task and current owner execution/model-sharing authorization');
    return this.store.transaction(() => {
      this.store.lockTask(task.id);
      const old = this.store.extraction.job(idSchema.parse(expectedJobId));
      if (!old || old.taskId !== task.id || old.repoId !== task.scope.repoId) throw new Error('Invalid original extraction');
      const links = this.store.extraction.reauthorizations();
      if (links.some(r => r.newJobId === old.id)) throw new Error('Reauthorization chains are prohibited');
      const link = links.find(r => r.originalJobId === old.id);
      if (link) {
        const existing = this.store.extraction.job(link.newJobId)!;
        if (existing.policyDigest !== digest(JSON.stringify(policy))) throw new Error('Existing reauthorization uses a different grant or policy');
        return existing;
      }
      const controls = (p: ExtractionPolicy): string => JSON.stringify({ ...p, grantId: '' });
      const grant = this.store.extraction.grants().find(g => g.id === old.policy.grantId);
      if (old.state !== 'unknown' || !modelFailureReasons.some(r => r === old.reason) || !old.inputDigest || old.candidateId !== null
        || old.policyDigest !== digest(JSON.stringify(old.policy)) || policy.grantId === old.policy.grantId || policy.maxCalls !== 1
        || controls(policy) !== controls(old.policy) || !grant || grant.used !== 1 || grant.maxCalls !== 1 || grant.policyDigest !== old.policyDigest
        || this.store.extraction.grants().some(g => g.id === policy.grantId)) throw new Error('Reauthorization requires an unknown attempt and a fresh single-call grant with unchanged controls');
      if (digest(extractionMaterial(this.store, this.root, old).text) !== old.inputDigest) throw new Error('Extraction material changed');
      return this.store.extraction.appendReauthorization(old, policy);
    });
  }
  observe(sessionId: string, eventId: string, kind: string, name?: string): void {
    const tasks = this.store.tasks().filter((t) => t.sessionId === sessionId && t.state === 'open');
    if (tasks.length !== 1) return; const task = tasks[0]!;
    if (task.scope.repoId !== this.repoId) return;
    this.store.event(redact(eventId, 200), task.id, new Date().toISOString(), {
      kind: redact(kind, 60), ...(name ? { tool: redact(name, 100) } : {}),
    });
  }
  correction(taskId: string, note: string): Evidence {
    const task = this.requireTask(taskId); if (task.state !== 'open') throw new Error('Task is closed');
    const evidence = correctionEvidence(task, redact(textSchema.parse(note)));
    this.store.transaction(() => {
      this.store.putEvidence(evidence);
      this.store.event(evidence.id, task.id, evidence.createdAt, { kind: 'explicit_correction', evidenceId: evidence.id });
    });
    return evidence;
  }
  propose(taskId: string, input: unknown, inputCitations: unknown = []): Experience {
    const task = this.requireTask(taskId); const item = cleanCandidate(input);
    const current = snapshot(this.root, item.requiredFiles);
    const result: Experience = {
      schemaVersion: 1, id: randomUUID(), revision: 1, sourceTaskId: task.id,
      title: item.title, strategy: item.strategy, observedFacts: item.observedFacts,
      inferences: item.inferences, recommendations: item.recommendations, scope: current.scope,
      status: 'candidate', verificationId: null, reason: 'Proposed; source evidence not verified', createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => this.store.putExperience(result, validateCitations(this.store, result, inputCitations)));
    return result;
  }
  facts(experience: Experience): { factIndex: number; factDigest: string }[] {
    return experience.observedFacts.map((fact, factIndex) => ({ factIndex, factDigest: digest(fact) }));
  }
  provenance(experience: Experience): ReturnType<typeof factProvenance> { return factProvenance(this.store, experience); }
  linkEvidence(id: string, expectedRevision: number, input: unknown): Experience {
    return this.store.transaction(() => {
      const old = this.requireExperience(id);
      if (old.revision !== expectedRevision) throw new RevisionConflict();
      const citations = validateCitations(this.store, old, input);
      const normalized = (items: typeof citations): string => JSON.stringify([...items].sort((a, b) => a.factIndex - b.factIndex || a.evidenceId.localeCompare(b.evidenceId)));
      if (normalized(citations) === normalized(this.store.citations(id, old.revision))) return old;
      if (old.status === 'source_verified' && this.provenance(old).complete) {
        throw new Error('Sources are locked for a verified experience with complete provenance; the owner must explicitly revise before changing sources');
      }
      const next: Experience = { ...old, revision: old.revision + 1,
        reason: 'Source references updated; citations do not certify claim semantics', createdAt: new Date().toISOString() };
      this.store.putExperience(next, citations); return next;
    });
  }
  async verify(experienceId: string, signal?: AbortSignal, expectedRevision?: number): Promise<Experience> {
    const experience = this.requireExperience(experienceId); const revision = experience.revision;
    if (expectedRevision !== undefined && revision !== expectedRevision) throw new RevisionConflict();
    const task = this.requireTask(experience.sourceTaskId);
    if (experience.status === 'disabled') throw new Error('Disabled experience must be revised before verification');
    const current = snapshot(this.root, Object.keys(experience.scope.requiredFiles));
    if (applicability(experience.scope, current.scope)) throw new Error('Candidate scope changed; revise before verification');
    const segment = this.store.automatic.forTask(task.id);
    const report = segment?.base && segment.fixed && this.automatic.snapshots
      ? await verifyWorkspaceRepair(this.root, task.id, segment.base, segment.fixed, this.automatic.snapshots, this.policy, signal)
      : await verifyRepair(this.root, task.id, task.baseCommit, current.commit, this.policy, signal);
    return this.store.transaction(() => {
      if (this.requireExperience(experienceId).revision !== revision) throw new Error('Experience changed during verification');
      if (segment?.fixed && !this.automatic.snapshots!.matches(segment.fixed)) throw new Error('Workspace changed during candidate verification');
      const citations = validateCitations(this.store, experience, this.store.citations(experienceId, revision));
      this.store.putVerification(report);
      this.store.putEvidence(verificationEvidence(report));
      const result: Experience = { ...experience, revision: revision + 1, verificationId: report.id,
        status: report.verified ? 'source_verified' : 'candidate', reason: report.reason, createdAt: new Date().toISOString() };
      this.store.putExperience(result, citations); return result;
    });
  }
  requireExperience(id: string): Experience {
    const value = this.store.experience(idSchema.parse(id)); if (!value) throw new Error('Unknown experience'); return value;
  }
  /** Current automatic candidates only. Reading is not review, acceptance or an application. */
  pendingCandidates(sessionId?: string, taskId?: string): { total: number; more: boolean; items: {
    experienceId: string; revision: number; taskId: string; summary: string; title: string; strategy: string; strategyTruncated: boolean;
  }[] } {
    if (taskId !== undefined) this.requireTask(taskId, sessionId);
    const tasks = new Map(this.store.tasks().filter(t => t.scope.repoId === this.repoId && (sessionId === undefined || t.sessionId === sessionId)
      && (taskId === undefined || t.id === taskId)).map(t => [t.id, t]));
    const experiences = new Map(this.store.experiences().map(e => [e.id, e]));
    const rows = this.store.extraction.jobs().filter(j => {
      const e = j.candidateId ? experiences.get(j.candidateId) : undefined;
      return j.repoId === this.repoId && j.state === 'candidate' && tasks.has(j.taskId) && e?.status === 'candidate'
        && e.scope.repoId === this.repoId && e.sourceTaskId === j.taskId;
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return { total: rows.length, more: rows.length > 10, items: rows.slice(0, 10).map(j => {
      const e = experiences.get(j.candidateId!)!;
      return { experienceId: e.id, revision: e.revision, taskId: j.taskId, summary: tasks.get(j.taskId)!.summary.slice(0, 160),
        title: e.title, strategy: e.strategy.slice(0, 512), strategyTruncated: e.strategy.length > 512 };
    }) };
  }
  select(taskId: string, mode: 'evidence-v1' | 'feedback-v1' | 'bm25-v1' = 'evidence-v1'): { application: Application | null; experience: Experience | null; reasons: string[] } {
    const started = performance.now();
    z.enum(['evidence-v1', 'feedback-v1', 'bm25-v1']).parse(mode);
    const task = this.requireTask(taskId); if (task.state !== 'open') throw new Error('Task is closed');
    if (this.store.applications().some((a) => a.taskId === task.id)) return { application: null, experience: null, reasons: ['already_applied_one_experience'] };
    const reasons: string[] = [];
    const bank = this.store.experiences();
    const excluded: CandidateExplanation[] = [];
    const explain = (experience: Experience, reason: CandidateReason, match?: { score: number; anchors: number }, combinedScore: number | null = null, alias?: string): CandidateExplanation => ({
      id: experience.id, revision: experience.revision, title: redact(experience.title, 80), reason,
      textScore: match?.score ?? null, combinedScore, anchors: match?.anchors ?? null,
      ...(match ? explanationTerms(task.summary, alias ?? experience.title, experience.strategy) : { titleTerms: [], strategyTerms: [] }),
    });
    const exclude = (experience: Experience, reason: CandidateReason): void => {
      if (experience.scope.repoId === this.repoId && excluded.length < 5) excluded.push(explain(experience, reason));
    };
    const eligible = new Map<string, { experience: Experience; scope: Scope }>();
    const ranked: { experience: Experience; score: number; textScore: number; utility: number; anchors: number; scope: Scope; evidence?: ContextEvidence }[] = [];
    for (const experience of bank) {
      if (experience.sourceTaskId === task.id) { reasons.push(experience.id + ':source_task'); exclude(experience, 'source_task'); continue; }
      if (experience.status !== 'source_verified') { reasons.push(experience.id + ':' + experience.status); exclude(experience, experience.status); continue; }
      const proof = experience.verificationId ? this.store.verification(experience.verificationId) : null;
      if (!proof?.verified || proof.sourceTaskId !== experience.sourceTaskId || proof.repoId !== experience.scope.repoId) {
        reasons.push(experience.id + ':missing_or_invalid_source_evidence'); exclude(experience, 'missing_or_invalid_source_evidence'); continue;
      }
      if (mode === 'evidence-v1') {
        const provenance = this.provenance(experience);
        if (!provenance.complete) { reasons.push(experience.id + ':incomplete_fact_sources:' + provenance.reasons.join(',')); exclude(experience, 'incomplete_fact_sources'); continue; }
      }
      let current;
      try { current = snapshot(this.root, Object.keys(experience.scope.requiredFiles)); }
      catch { reasons.push(experience.id + ':missing_code_condition'); exclude(experience, 'missing_code_condition'); continue; }
      const mismatch = applicability(experience.scope, current.scope);
      if (mismatch) { reasons.push(experience.id + ':' + mismatch); exclude(experience, mismatch.startsWith('code_condition_changed:') ? 'code_condition_changed' : mismatch as CandidateReason); continue; }
      eligible.set(experience.id, { experience, scope: current.scope });
    }
    const memory = mode !== 'bm25-v1' ? feedbackMemory(this.store, [...eligible.values()].map((e) => e.experience)) : new Map();
    for (const [id] of eligible) {
      const negative = memory.get(id)?.irrelevant.get(contextKey(task.summary));
      if (negative) { exclude(eligible.get(id)!.experience, 'owner_irrelevant_context'); eligible.delete(id); reasons.push(`${id}:owner_irrelevant_context; feedback=${negative.feedbackId}; application=${negative.applicationId}; task=${negative.taskId}`); }
    }
    const experiences = [...eligible.values()].map((e) => e.experience);
    const qualified = performance.now();
    const search = this.retrievalRuntime.search(task.summary, experiences, this.repoId + ':' + mode);
    const original: TextMatch[] = search.matches; const searched = performance.now();
    for (const m of original) if (m.reason) reasons.push(m.id + ':' + m.reason);
    const originalMatches = original.filter((m) => m.reason === null);
    const matches: { id: string; score: number; anchors: number; evidence?: ContextEvidence }[] = originalMatches.length || mode === 'bm25-v1'
      ? originalMatches : rankFeedback(task.summary, experiences, memory);
    for (const match of matches) {
      const { experience, scope } = eligible.get(match.id)!;
      const uses = new Set(this.store.applications().filter((a) => a.experienceId === experience.id && a.revision === experience.revision).map((a) => a.id));
      const latest = new Map<string, Feedback>();
      for (const feedback of this.store.feedback()) if (uses.has(feedback.applicationId) && feedback.outcome !== 'unknown') latest.set(feedback.applicationId, feedback);
      const feedback = [...latest.values()].filter((f) => f.outcome !== 'irrelevant');
      const utility = (feedback.filter((f) => f.outcome === 'accepted').length + 1) / (feedback.length + 2);
      ranked.push({ experience, score: 0.7 * match.score + 0.3 * utility, textScore: match.score, utility, anchors: match.anchors, scope,
        ...(match.evidence ? { evidence: match.evidence } : {}) });
    }
    ranked.sort((a, b) => b.score - a.score || a.experience.id.localeCompare(b.experience.id));
    const selected = ranked[0];
    const record = (application: Application | null): void => {
      const candidates: CandidateExplanation[] = [];
      if (selected) candidates.push(explain(selected.experience, selected.evidence ? 'owner_accepted_context' : 'original_text',
        { score: selected.textScore, anchors: selected.anchors }, selected.score, selected.evidence?.summary));
      for (const match of original) {
        if (candidates.length >= 5) break;
        if (match.id === selected?.experience.id) continue;
        candidates.push(explain(eligible.get(match.id)!.experience, match.reason ?? 'lower_combined_score', match,
          ranked.find(row => row.experience.id === match.id)?.score ?? null));
      }
      for (const row of excluded) if (candidates.length < 5) candidates.push(row);
      const considered = bank.filter(e => e.scope.repoId === this.repoId).length;
      const completed = performance.now();
      this.retrievalRuntime.record({ taskId: task.id, mode, completedAt: new Date().toISOString(),
        outcome: selected ? 'selected' : 'abstained', selectedId: selected?.experience.id ?? null,
        selectedRevision: selected?.experience.revision ?? null, applicationId: application?.id ?? null,
        candidatesConsidered: considered, eligibleCount: eligible.size, omittedCandidates: Math.max(0, considered - candidates.length), candidates,
        cache: search.cache, generation: search.generation,
        timings: { qualificationMs: qualified - started, lookupMs: search.lookupMs, buildMs: search.buildMs,
          queryMs: search.queryMs, selectionMs: completed - searched, totalMs: completed - started } });
    };
    if (!selected) { record(null); return { application: null, experience: null, reasons: reasons.length ? reasons : ['no_experiences'] }; }
    const application: Application = { id: randomUUID(), taskId: task.id, experienceId: selected.experience.id,
      revision: selected.experience.revision, reason: `Applicable code/dependency scope; ${mode}${mode === 'evidence-v1' ? ':complete_fact_sources; feedback-v1' : ''}; text=${retrievalPolicy.version}:${selected.textScore.toFixed(3)}; utility=${selected.utility.toFixed(3)}; anchors=${selected.anchors}; combined=${selected.score.toFixed(3)}`
        + (selected.evidence ? `; fallback_owner_accepted_inference; feedback=${selected.evidence.feedbackId}; application=${selected.evidence.applicationId}; task=${selected.evidence.taskId}` : '; original_text'), createdAt: new Date().toISOString() };
    this.store.putApplication(application);
    record(application);
    return { application, experience: selected.experience, reasons: [application.reason] };
  }
  /** Process-local, read-only projection; no task, model, verification or database operation. */
  retrievalStatus(): RetrievalStatus { return this.retrievalRuntime.status(); }
  feedback(input: Omit<Feedback, 'createdAt'>): Feedback {
    const existing = this.store.feedback().find((f) => f.id === input.id);
    const value = feedbackSchema.parse({ ...input, note: redact(input.note), createdAt: existing?.createdAt ?? new Date().toISOString() });
    const application = this.store.application(value.applicationId); if (!application) throw new Error('Unknown application');
    this.requireTask(application.taskId);
    return this.store.transaction(() => {
      const inserted = this.store.putFeedback(value);
      const current = this.requireExperience(application.experienceId);
      if (inserted && application.revision === current.revision && (value.outcome === 'rejected' || value.outcome === 'counterexample')) this.disable(application.experienceId, value.note);
      return value;
    });
  }
  revise(id: string, expectedRevision: number, input: unknown, reason: string, inputCitations: unknown = []): Experience {
    const previous = this.requireExperience(id);
    if (previous.revision !== expectedRevision) throw new RevisionConflict();
    const item = cleanCandidate(input);
    const current = snapshot(this.root, item.requiredFiles);
    const result: Experience = { ...previous, ...item, scope: current.scope,
      revision: previous.revision + 1, status: 'candidate', verificationId: null,
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    // Candidate input's requiredFiles is an input selector, not an extra persisted experience property.
    const { requiredFiles: _selectors, ...persisted } = result as Experience & { requiredFiles?: string[] };
    this.store.transaction(() => this.store.putExperience(persisted, validateCitations(this.store, persisted, inputCitations)));
    return persisted;
  }
  disable(id: string, reason: string, expectedRevision?: number): Experience {
    return this.store.transaction(() => {
    const previous = this.requireExperience(id);
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw new RevisionConflict();
    const next: Experience = { ...previous, revision: previous.revision + 1, status: 'disabled',
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    this.store.putExperience(next, this.store.citations(id, previous.revision)); return next;
    });
  }
  restore(id: string, revision: number, reason: string, expectedRevision?: number): Experience {
    return this.store.transaction(() => {
    const previous = this.requireExperience(id); const old = this.store.history(id).find((r) => r.revision === revision);
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw new RevisionConflict();
    if (!old) throw new Error('Unknown historical revision');
    const next: Experience = { ...old, revision: previous.revision + 1, status: 'candidate', verificationId: null,
      reason: redact(textSchema.parse(reason)), createdAt: new Date().toISOString() };
    this.store.putExperience(next, validateCitations(this.store, next, this.store.citations(id, old.revision))); return next;
    });
  }
}
