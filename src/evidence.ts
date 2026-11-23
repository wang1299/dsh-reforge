import { randomUUID } from 'node:crypto';
import { digest, evidenceSchema, factCitationsSchema, type Evidence, type Experience, type FactCitation, type Task, type Verification } from './domain.js';
import type { Store } from './store.js';

export type EvidenceReader = Pick<Store, 'task' | 'evidence' | 'verification' | 'citations'>;

/** Stable fields only. A reference validates provenance, not the semantic truth of a claim. */
export function evidenceDigest(evidence: Evidence, proof?: Verification | null): string {
  const common = { schemaVersion: evidence.schemaVersion, id: evidence.id, taskId: evidence.taskId,
    repoId: evidence.repoId, createdAt: evidence.createdAt, kind: evidence.kind };
  if (evidence.kind === 'correction') return digest(JSON.stringify({ ...common, note: evidence.note }));
  if (!proof || proof.id !== evidence.verificationId || proof.sourceTaskId !== evidence.taskId || proof.repoId !== evidence.repoId) throw new Error('Evidence verification source is missing or belongs to another task/repository');
  return digest(JSON.stringify({ ...common, verificationId: evidence.verificationId, verificationDigest: digest(JSON.stringify(proof)) }));
}
export function correctionEvidence(task: Task, note: string): Evidence {
  const item = evidenceSchema.parse({ schemaVersion: 1, id: randomUUID(), taskId: task.id, repoId: task.scope.repoId,
    kind: 'correction', note, digest: '0'.repeat(64), createdAt: new Date().toISOString() });
  return { ...item, digest: evidenceDigest(item) };
}
export function verificationEvidence(proof: Verification): Evidence {
  const item = evidenceSchema.parse({ schemaVersion: 1, id: proof.id, taskId: proof.sourceTaskId, repoId: proof.repoId,
    kind: 'verification', verificationId: proof.id, digest: '0'.repeat(64), createdAt: proof.createdAt });
  return { ...item, digest: evidenceDigest(item, proof) };
}
export function validateCitations(store: EvidenceReader, experience: Experience, input: unknown): FactCitation[] {
  const citations = factCitationsSchema.parse(input);
  const task = store.task(experience.sourceTaskId);
  if (!task || task.scope.repoId !== experience.scope.repoId) throw new Error('Citation source task/repository mismatch');
  for (const item of citations) {
    const fact = experience.observedFacts[item.factIndex];
    if (fact === undefined || digest(fact) !== item.factDigest) throw new Error('Citation fact index or digest does not match this revision');
    const source = store.evidence(item.evidenceId);
    if (!source) throw new Error('Citation evidence is missing');
    if (source.taskId !== task.id || source.repoId !== task.scope.repoId) throw new Error('Citation evidence belongs to another task/repository');
    const actual = evidenceDigest(source, source.kind === 'verification' ? store.verification(source.verificationId) : null);
    if (actual !== source.digest || item.evidenceDigest !== actual) throw new Error('Citation evidence digest mismatch');
  }
  return citations;
}
export function factProvenance(store: EvidenceReader, experience: Experience): { complete: boolean; reasons: string[]; citations: FactCitation[] } {
  try {
    const citations = validateCitations(store, experience, store.citations(experience.id, experience.revision));
    const covered = new Set(citations.map((c) => c.factIndex));
    const reasons = experience.observedFacts.flatMap((_, i) => covered.has(i) ? [] : ['missing_fact_source:' + i]);
    return { complete: reasons.length === 0, reasons, citations };
  } catch {
    return { complete: false, reasons: ['invalid_fact_sources'], citations: [] };
  }
}
