import { digest, type Experience, type FactCitation } from '../src/domain.js';
import type { MemoryContextPolicy } from '../src/agent-context.js';

/** Pure serialization fixtures: synthetic IDs/digests, not independently verified source evidence. */
export function syntheticContextInput(facts: string[], query = 'transaction rollback exception') {
  facts = facts.map(fact => fact.trim());
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const experience: Experience = { schemaVersion: 1, id: uuid(1), revision: 2, sourceTaskId: uuid(2),
    title: 'Synthetic rollback context', strategy: 'Restore prior state before raising; validate against the current contract.',
    observedFacts: facts, inferences: ['Never provide this synthetic inference as an observed fact.'], recommendations: [],
    scope: { repoId: digest('synthetic repository'), dependencyDigest: digest('synthetic dependencies'), requiredFiles: { 'contract.py': digest('synthetic contract') } },
    status: 'source_verified', reason: 'Synthetic schema fixture only', verificationId: uuid(3), createdAt: '2026-11-15T00:00:00.000Z' };
  const citations: FactCitation[] = facts.map((text, factIndex) => ({ factIndex, factDigest: digest(text), evidenceId: uuid(10 + factIndex), evidenceDigest: digest('synthetic evidence ' + factIndex) }));
  return { experience, citations, applicationId: uuid(4), query, policy: { policy: 'evidence-mmr-v1', maxNoticeBytes: 65536 } as MemoryContextPolicy };
}
