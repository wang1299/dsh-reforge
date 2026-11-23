import { z } from 'zod';
import { idSchema, type Experience } from './domain.js';
import { factProvenance, type EvidenceReader } from './evidence.js';
import { applicability, requestScopeReader, snapshot } from './repository.js';

export const memoryReviewOptions = z.object({ after: idSchema.optional(), limit: z.number().int().min(1).max(50).default(50) }).strict();
export interface MemoryReviewReader extends EvidenceReader {
  page(repoId: string, after: string | undefined, limit: number): { total: number; experiences: Experience[]; more: boolean };
}
export type MemoryReviewState = 'source_scope_current' | 'needs_revalidation' | 'not_qualified' | 'unknown';
export interface MemoryReviewItem {
  experienceId: string; expectedRevision: number; state: MemoryReviewState;
  reason: 'source_and_scope_match' | 'candidate' | 'disabled' | 'invalid_source_evidence' | 'incomplete_fact_sources'
    | 'dependencies_changed' | 'code_condition_changed' | 'code_condition_unavailable';
  nextAction: 'none' | 'review_candidate' | 'review_disabled' | 'repair_sources' | 'revise_then_verify' | 'restore_environment_then_review';
}

/** A diagnostic, never an eligibility grant or an execution/authorization plan. */
export function reviewMemory(reader: MemoryReviewReader, root: string, input: z.input<typeof memoryReviewOptions> = {}) {
  const options = memoryReviewOptions.parse(input);
  const current = snapshot(root); const scopeReader = requestScopeReader(root, current);
  const page = reader.page(current.scope.repoId, options.after, options.limit);
  const items = page.experiences.map((experience): MemoryReviewItem => {
    if (experience.scope.repoId !== current.scope.repoId) throw new Error('Invalid review repository binding');
    const item = { experienceId: experience.id, expectedRevision: experience.revision };
    if (experience.status !== 'source_verified') return { ...item, state: 'not_qualified', reason: experience.status,
      nextAction: experience.status === 'candidate' ? 'review_candidate' : 'review_disabled' };
    const proof = experience.verificationId ? reader.verification(experience.verificationId) : null;
    if (!proof?.verified || proof.id !== experience.verificationId || proof.sourceTaskId !== experience.sourceTaskId || proof.repoId !== experience.scope.repoId) {
      return { ...item, state: 'not_qualified', reason: 'invalid_source_evidence', nextAction: 'repair_sources' };
    }
    if (!factProvenance(reader, experience).complete) return { ...item, state: 'not_qualified', reason: 'incomplete_fact_sources', nextAction: 'repair_sources' };
    let condition;
    try { condition = scopeReader.read(Object.keys(experience.scope.requiredFiles)); }
    catch { return { ...item, state: 'unknown', reason: 'code_condition_unavailable', nextAction: 'restore_environment_then_review' }; }
    const mismatch = applicability(experience.scope, condition.scope);
    if (mismatch) return { ...item, state: 'needs_revalidation',
      reason: mismatch === 'dependencies_changed' ? 'dependencies_changed' : 'code_condition_changed', nextAction: 'revise_then_verify' };
    return { ...item, state: 'source_scope_current', reason: 'source_and_scope_match', nextAction: 'none' };
  });
  return { format: 'dsh-reforge-memory-review-v1' as const, checkedAt: new Date().toISOString(), checkedCommit: current.commit,
    readOnly: true as const, tasksExecuted: 0 as const, modelRequests: 0 as const, authorizationIncreased: false as const,
    total: page.total, reviewed: items.length, more: page.more, nextCursor: page.more ? items.at(-1)!.experienceId : null,
    counts: Object.fromEntries((['source_scope_current', 'needs_revalidation', 'not_qualified', 'unknown'] as const)
      .map(state => [state, items.filter(item => item.state === state).length])), items,
    boundary: 'Source/scope checks only; no new test execution, task applicability, semantic truth or future-task benefit established.' };
}
export type MemoryReviewReport = ReturnType<typeof reviewMemory>;
