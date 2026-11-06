import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, citeFact } from './fixture.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { RetrievalRuntime } from '../src/retrieval-runtime.js';

/** A real synthetic pytest repair. Variants share its proof, not independent strategy validation. */
export async function verifiedRetrievalFixture(parent?: string) {
  const f = await fixture(parent); const store = new Store(':memory:');
  const policy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 };
  const service = new EvolveService(store, f.repo, policy);
  const task = service.begin('retrieval-source', 'transaction rollback exception');
  const fact = 'Failure changed the balance'; const correction = service.correction(task.id, fact);
  const input = { title: 'transaction rollback exception', strategy: 'Restore the original balance before raising the failed transaction exception.',
    observedFacts: [fact], inferences: [], recommendations: [], requiredFiles: ['contract.py'] };
  const candidate = service.propose(task.id, input, [citeFact(correction, fact)]);
  await f.fix(); const experience = await service.verify(candidate.id);
  assert.equal(experience.status, 'source_verified'); service.finish(task.id);
  const bankIds: string[] = [];
  const createBank = (count = 1, execution: 'reuse' | 'legacy' = 'reuse', path = ':memory:') => {
    const target = new Store(path);
    for (const task of store.tasks()) target.putTask(task);
    for (const evidence of store.evidenceRecords()) target.putEvidence(evidence);
    target.putVerification(store.verification(experience.verificationId!)!);
    const experiences = Array.from({ length: count }, (_, i) => {
      bankIds[i] ??= randomUUID();
      const row = { ...experience, id: bankIds[i]!, revision: 1,
        title: experience.title + ' fixture' + i, reason: 'Synthetic text variant sharing one verified repair; not independent strategy evidence' };
      target.putExperience(row, store.citations(experience.id, experience.revision)); return row;
    });
    const owner = new EvolveService(target, f.repo, policy, false, undefined, false, false, new RetrievalRuntime(execution));
    return { store: target, service: owner, experiences };
  };
  return { ...f, store, service, policy, input, experience, createBank };
}
