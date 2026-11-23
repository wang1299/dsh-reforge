import { z } from 'zod';
import { idSchema, relativePath, RevisionConflict, shaSchema, type Experience, type TestRun } from './domain.js';
import { verificationEvidence } from './evidence.js';
import { historicalProof } from './memory-review.js';
import { applicability, committedScopeMatches, git, gitBytes, snapshot } from './repository.js';
import type { EvolveService } from './service.js';
import { acceptanceDigest, passes, verifiedCases, verifyRepair } from './verification.js';

const selection = z.object({ expectedRevision: z.number().int().positive(), expectedCommit: shaSchema, expectedProof: idSchema }).strict();
type BlockReason = 'execution_untrusted' | 'manual_source_required' | 'source_incomplete' | 'dependencies_changed'
  | 'no_code_drift' | 'committed_conditions_required' | 'test_contract_changed' | 'unavailable';
const blocked = (reason: BlockReason) => ({ state: 'blocked' as const, reason });

// Fixed transition reasons fit the existing strict v9 records. They restrict generic
// verification only; a reason string never grants eligibility or repository execution.
const replayReasons = {
  pending: 'Owner requested independent replay after committed code drift',
  failed: 'Owner replay failed historical acceptance or regression requirements',
  verified: 'Owner replay passed historical acceptance and regression requirements',
};
export function assertOrdinaryVerificationAllowed(experience: Experience): void {
  if (Object.values(replayReasons).includes(experience.reason)) throw new Error('Owner must explicitly revise this maintenance version before ordinary verification or source changes');
}

function inspect(service: EvolveService, id: string) {
  if (!service.policy.trusted) return blocked('execution_untrusted');
  const experience = service.requireExperience(id);
  const task = service.requireTask(experience.sourceTaskId);
  service.store.assertLearningAllowed(task);
  if (task.state !== 'closed' || experience.status !== 'source_verified' || service.store.automatic.forTask(task.id)) {
    return blocked('manual_source_required');
  }
  const proof = historicalProof(service.store, experience);
  const provenance = service.provenance(experience);
  if (!proof || !provenance.complete || proof.environment.captureMethod || proof.baseCommit !== task.baseCommit
    || !verifiedCases(proof.base, proof.fixed) || !passes(proof.regression)) return blocked('source_incomplete');
  if (proof.commands[1]?.[3] !== service.policy.regressionPath) return blocked('test_contract_changed');
  const current = snapshot(service.root, Object.keys(experience.scope.requiredFiles));
  if (current.scope.repoId !== experience.scope.repoId) return blocked('source_incomplete');
  if (current.scope.dependencyDigest !== experience.scope.dependencyDigest || proof.environment.dependencyDigest !== current.scope.dependencyDigest
    || task.scope.dependencyDigest !== current.scope.dependencyDigest) return blocked('dependencies_changed');
  if (!applicability(experience.scope, current.scope)) return blocked('no_code_drift');
  if (git(service.root, ['status', '--porcelain', '--untracked-files=no'])
    || !committedScopeMatches(service.root, current.commit, current.scope)) return blocked('committed_conditions_required');
  git(service.root, ['merge-base', '--is-ancestor', proof.fixCommit, current.commit]);
  // Tree IDs pin every tracked file under the regression path, including same-name assertions.
  const regressionTree = (commit: string) => gitBytes(service.root, ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree',
    commit, '--', relativePath.parse(service.policy.regressionPath)]);
  const previousTree = regressionTree(proof.fixCommit);
  if (!previousTree.length || !previousTree.equals(regressionTree(current.commit))) return blocked('test_contract_changed');
  return { state: 'ready' as const, experience, proof, current, citations: provenance.citations,
    selection: { expectedRevision: experience.revision, expectedCommit: current.commit, expectedProof: proof.id } };
}

export async function previewRevalidation(service: EvolveService, id: string) {
  try {
    const plan = inspect(service, id);
    if (plan.state === 'blocked') return plan;
    if (await acceptanceDigest(service.policy.acceptanceDir) !== plan.proof.acceptanceDigest) return blocked('test_contract_changed');
    return { state: 'ready' as const, selection: plan.selection };
  } catch { return blocked('unavailable'); }
}

function retainsPassedCases(previous: TestRun, next: TestRun): boolean {
  const cases = new Map(next.cases.map(c => [c.id, c.status]));
  return cases.size === next.cases.length && new Set(previous.cases.map(c => c.id)).size === previous.cases.length
    && previous.cases.every(c => c.status !== 'passed' || cases.get(c.id) === 'passed');
}

export async function revalidateMemory(service: EvolveService, id: string, input: unknown, signal?: AbortSignal) {
  const selected = selection.parse(input);
  signal?.throwIfAborted();
  const preview = await previewRevalidation(service, id);
  if (preview.state === 'blocked') return preview;
  const claimed = service.store.transaction(() => {
    const plan = inspect(service, id);
    if (plan.state === 'blocked') return plan;
    if (plan.selection.expectedRevision !== selected.expectedRevision || plan.selection.expectedProof !== selected.expectedProof
      || plan.current.commit !== selected.expectedCommit) throw new RevisionConflict();
    signal?.throwIfAborted();
    const candidate: Experience = { ...plan.experience, revision: plan.experience.revision + 1, status: 'candidate', verificationId: null,
      scope: plan.current.scope, reason: replayReasons.pending, createdAt: new Date().toISOString() };
    service.store.putExperience(candidate, plan.citations);
    return { ...plan, candidate };
  });
  if (claimed.state === 'blocked') return claimed;
  const { proof, candidate } = claimed;
  try {
    const report = await verifyRepair(service.root, candidate.sourceTaskId, proof.baseCommit, selected.expectedCommit, service.policy, signal, proof.acceptanceDigest);
    return service.store.transaction(() => {
      signal?.throwIfAborted();
      const latest = service.requireExperience(id);
      if (latest.revision !== candidate.revision) throw new RevisionConflict();
      service.store.assertLearningAllowed(service.requireTask(candidate.sourceTaskId));
      const current = snapshot(service.root, Object.keys(candidate.scope.requiredFiles));
      const provenance = service.provenance(latest);
      if (!provenance.complete || current.commit !== selected.expectedCommit || applicability(candidate.scope, current.scope)
        || git(service.root, ['status', '--porcelain', '--untracked-files=no']) || !committedScopeMatches(service.root, current.commit, candidate.scope)
        || report.acceptanceDigest !== proof.acceptanceDigest || report.fixCommit !== current.commit
        || report.environment.dependencyDigest !== current.scope.dependencyDigest) throw new Error('Replay inputs changed');
      const failures = new Set(report.base.cases.filter(c => c.status === 'failed').map(c => c.id));
      if (report.verified && (!proof.base.cases.every(c => c.status !== 'failed' || failures.has(c.id))
        || !retainsPassedCases(proof.fixed, report.fixed) || !retainsPassedCases(proof.regression, report.regression))) {
        report.verified = false; report.reason = 'Historical acceptance failures or passing test coverage were not retained';
      }
      service.store.putVerification(report);
      service.store.putEvidence(verificationEvidence(report));
      const revision = candidate.revision + 1;
      service.store.putExperience({ ...candidate, revision, status: report.verified ? 'source_verified' : 'candidate',
        verificationId: report.id, reason: report.verified ? replayReasons.verified : replayReasons.failed, createdAt: new Date().toISOString() }, provenance.citations);
      return { state: report.verified ? 'verified' as const : 'failed' as const, revision, verificationId: report.id };
    });
  } catch (error) {
    if (error instanceof RevisionConflict) throw error;
    return { state: 'inconclusive' as const, candidateRevision: candidate.revision };
  }
}

/** Called only behind the local panel or native host's authenticated owner boundary. */
export async function memoryRevalidationRequest(service: EvolveService, path: string, method: string, input?: unknown, signal?: AbortSignal) {
  const match = /^\/api\/experience\/([^/]+)\/revalidation$/.exec(path);
  if (!match) return null;
  const id = idSchema.parse(match[1]);
  if (method === 'GET') return { status: 200, value: await previewRevalidation(service, id) };
  if (method !== 'POST') return { status: 405, value: { error: 'Method not supported' } };
  try { return { status: 200, value: await revalidateMemory(service, id, input, signal) }; }
  catch (error) {
    if (error instanceof RevisionConflict) return { status: 409, value: { error: 'Experience or commit changed' } };
    return { status: 400, value: { error: 'Cannot start the selected replay' } };
  }
}
