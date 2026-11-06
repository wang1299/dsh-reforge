import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rankText } from '../src/retrieval.js';
import { RetrievalRuntime, retrievalRuntimePolicy, type RetrievalAttempt } from '../src/retrieval-runtime.js';
import { parseRetrievalCorpus } from '../src/retrieval-evaluation.js';
import { panelState } from '../src/panel-api.js';
import { EvolveService } from '../src/service.js';
import { Store } from '../src/store.js';
import { startPanel } from '../src/panel.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';

test('runtime exactly preserves frozen rankings through queries, eligibility changes and repository/mode switches', async () => {
  const corpus = parseRetrievalCorpus(await readFile(new URL('../../test/fixtures/retrieval-v2-cases.json', import.meta.url)));
  const runtime = new RetrievalRuntime();
  for (const split of ['development', 'holdout'] as const) {
    for (const q of corpus.queries.filter(q => q.split === split)) {
      const bank = corpus.experiences.filter(e => e.split === split && !q.ineligibleIds.includes(e.id))
        .map(e => ({ ...e, revision: 1, verificationId: 'synthetic' }));
      assert.deepEqual(runtime.search(q.text, bank, split).matches, rankText(q.text, bank));
    }
  }
  const bank = [{ id: 'one', revision: 1, verificationId: 'proof', title: 'transaction rollback', strategy: 'restore balance' }];
  runtime.search('transaction rollback', bank, 'repo-a/evidence-v1');
  assert.equal(runtime.search('restore balance', bank, 'repo-a/evidence-v1').cache, 'hit');
  assert.equal(runtime.search('transaction rollback', bank, 'repo-b/evidence-v1').cache, 'rebuilt');
  assert.equal(runtime.search('transaction rollback', bank, 'repo-b/bm25-v1').cache, 'rebuilt');
  for (const changed of [{ ...bank[0]!, revision: 2 }, { ...bank[0]!, title: 'different title' },
    { ...bank[0]!, strategy: 'different strategy' }, { ...bank[0]!, verificationId: 'new-proof' }]) {
    assert.equal(runtime.search('transaction rollback', [changed], 'repo-b/bm25-v1').cache, 'rebuilt');
  }
  assert.equal(runtime.search('', [], 'repo-b/bm25-v1').cache, 'empty'); assert.equal(runtime.status().cache.documents, 0);
  assert.equal(runtime.search('transaction rollback', bank, 'repo-a/evidence-v1').cache, 'cold');
});

test('capacity bypass retains the complete legacy result set and discards the previous cache', () => {
  const runtime = new RetrievalRuntime();
  const document = { id: 'one', revision: 1, verificationId: null, title: 'transaction rollback', strategy: 'restore balance' };
  runtime.search('transaction rollback', [document], 'repo');
  const bank = Array.from({ length: retrievalRuntimePolicy.maxDocuments + 1 }, (_, i) => ({ ...document, id: String(i) }));
  const result = runtime.search('transaction rollback', bank, 'repo');
  assert.equal(result.cache, 'capacity_bypass'); assert.equal(result.matches.length, bank.length);
  assert.deepEqual(result.matches, rankText('transaction rollback', bank)); assert.equal(runtime.status().cache.documents, 0);
  const large = [{ ...document, strategy: 'a'.repeat(retrievalRuntimePolicy.maxTextBytes) }];
  assert.equal(runtime.search('transaction rollback', large, 'repo').cache, 'capacity_bypass');
  assert.equal(runtime.status().cache.bypasses, 2);
});

test('recent explanations own their nested data and remain bounded across many completed selections', () => {
  const runtime = new RetrievalRuntime();
  const attempt: RetrievalAttempt = { taskId: randomUUID(), mode: 'evidence-v1', completedAt: new Date().toISOString(), outcome: 'abstained', selectedId: null,
    selectedRevision: null, applicationId: null, candidatesConsidered: 0, eligibleCount: 0, omittedCandidates: 0, candidates: [], cache: 'empty', generation: 0,
    timings: { qualificationMs: 1, lookupMs: 0, buildMs: 0, queryMs: 0, selectionMs: 0, totalMs: 1 } };
  for (let i = 0; i < 30; i++) runtime.record({ ...attempt, taskId: String(i) });
  const status = runtime.status(); assert.equal(status.attempts.length, 8); assert.equal(status.omittedAttempts, 22);
  status.attempts[0]!.timings.totalMs = 999; assert.equal(runtime.status().attempts[0]!.timings.totalMs, 1);
  assert(Buffer.byteLength(JSON.stringify(runtime.status())) <= retrievalRuntimePolicy.maxProjectionBytes);
  const terms = Array.from({ length: 6 }, (_, i) => '界'.repeat(30) + i);
  const candidates = Array.from({ length: 5 }, () => ({ id: randomUUID(), revision: 1, title: '界'.repeat(80), reason: 'no_title_anchor' as const,
    textScore: 0.5, combinedScore: null, anchors: 6, titleTerms: terms, strategyTerms: terms }));
  for (let i = 0; i < 15; i++) runtime.record({ ...attempt, candidates, candidatesConsidered: 5 });
  assert(Buffer.byteLength(JSON.stringify(runtime.status())) <= retrievalRuntimePolicy.maxProjectionBytes);
  assert(runtime.status().attempts.length < 8, 'UTF-8 bytes, not character count, enforce the projection budget');
});

test('actual service decisions match legacy while authenticated projection reads are inert and instance-local', { timeout: 60000 }, async () => {
  const f = await verifiedRetrievalFixture(); const cached = f.createBank(7); const legacy = f.createBank(7, 'legacy');
  try {
    for (const [i, query] of ['transaction rollback exception', 'rollback transaction failure restore balance', 'transaction', 'unrelated layout'].entries()) {
      const a = cached.service.select(cached.service.begin('cached-' + i, query).id);
      const b = legacy.service.select(legacy.service.begin('legacy-' + i, query).id);
      assert.equal(a.experience?.id, b.experience?.id); assert.equal(a.experience?.revision, b.experience?.revision); assert.deepEqual(a.reasons, b.reasons);
    }
    assert.equal(cached.service.retrievalStatus().cache.builds, 1); assert.equal(cached.service.retrievalStatus().cache.hits, 3);
    const selected = cached.service.retrievalStatus().attempts.find(a => a.outcome === 'selected')!;
    assert.equal(selected.candidates[0]!.id, selected.selectedId); assert.equal(selected.omittedCandidates, 2);
    const before = JSON.stringify({ tasks: cached.store.tasks(), apps: cached.store.applications(), grants: cached.store.extraction.grants(), status: cached.service.retrievalStatus() });
    const first = panelState(cached.service).retrieval; first.attempts[0]!.candidates.length = 0;
    assert.deepEqual(panelState(cached.service).retrieval, cached.service.retrievalStatus());
    assert.equal(JSON.stringify({ tasks: cached.store.tasks(), apps: cached.store.applications(), grants: cached.store.extraction.grants(), status: cached.service.retrievalStatus() }), before);
    cached.service.select(selected.taskId); assert.deepEqual(cached.service.retrievalStatus(), JSON.parse(before).status);
    const serialized = JSON.stringify(cached.service.retrievalStatus()); assert(!serialized.includes(f.repo)); assert(!serialized.includes('"query":')); assert(!serialized.includes('plan.env'));
    const fresh = new EvolveService(cached.store, f.repo, f.policy); assert.equal(fresh.retrievalStatus().attempts.length, 0); assert.equal(fresh.retrievalStatus().cache.builds, 0);
  } finally { cached.store.close(); legacy.store.close(); f.store.close(); }
});

test('code/dependency changes and current owner feedback are rechecked before any cache hit', { timeout: 60000 }, async () => {
  const f = await verifiedRetrievalFixture(); const b = f.createBank(); let sequence = 0;
  const query = 'transaction rollback exception'; const choose = () => b.service.select(b.service.begin('check-' + sequence++, query).id);
  try {
    const first = choose(); assert(first.application); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'cold');
    choose(); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'hit');
    await writeFile(join(f.repo, 'contract.py'), 'TRANSACTION_POLICY = "changed"\n'); assert.equal(choose().experience, null);
    assert.equal(b.service.retrievalStatus().attempts[0]!.candidates[0]!.reason, 'code_condition_changed'); assert.equal(b.service.retrievalStatus().cache.documents, 0);
    await writeFile(join(f.repo, 'contract.py'), 'TRANSACTION_POLICY = "rollback-on-exception"\n'); assert(choose().experience);
    await writeFile(join(f.repo, 'requirements.txt'), 'dependency==2\n'); assert.equal(choose().experience, null);
    await writeFile(join(f.repo, 'requirements.txt'), '# standard-library-only fixture\n'); assert(choose().experience);
    b.service.feedback({ id: randomUUID(), applicationId: first.application.id, outcome: 'irrelevant', note: 'Synthetic owner context label', extraCost: null, humanRework: null });
    assert.equal(choose().experience, null); assert.equal(b.service.retrievalStatus().attempts[0]!.candidates[0]!.reason, 'owner_irrelevant_context');
    b.service.feedback({ id: randomUUID(), applicationId: first.application.id, outcome: 'accepted', note: 'Synthetic corrected owner label, not independent benefit evidence', extraCost: null, humanRework: null });
    const allowed = choose(); assert(allowed.experience); assert.match(allowed.application!.reason, /utility=0\.667/);
    choose(); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'hit');
    assert.equal(b.store.extraction.grants().length, 0);
  } finally { b.store.close(); f.store.close(); }
});

test('shared database revisions, missing provenance, disable and restore invalidate the live eligible snapshot', { timeout: 60000 }, async () => {
  const f = await verifiedRetrievalFixture(); const b = f.createBank(1, 'reuse', join(f.home, 'shared.sqlite')); const other = new Store(join(f.home, 'shared.sqlite'));
  const id = b.experiences[0]!.id; let sequence = 0;
  const choose = () => b.service.select(b.service.begin('external-' + sequence++, 'transaction rollback exception').id);
  try {
    assert(choose().experience); choose(); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'hit');
    const first = other.experience(id)!; const citations = other.citations(id, first.revision);
    other.putExperience({ ...first, revision: 2, title: 'revised transaction rollback exception' }, citations);
    assert.equal(choose().experience?.revision, 2); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'rebuilt');
    other.putExperience({ ...other.experience(id)!, revision: 3, strategy: 'Restore balance on failed transaction rollback exception' }, citations);
    assert.equal(choose().experience?.revision, 3); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'rebuilt');
    other.putExperience({ ...other.experience(id)!, revision: 4 }, []); assert.equal(choose().experience, null);
    assert.equal(b.service.retrievalStatus().attempts[0]!.candidates[0]!.reason, 'incomplete_fact_sources');
    other.putExperience({ ...other.experience(id)!, revision: 5 }, citations); assert(choose().experience);
    const owner = new EvolveService(other, f.repo, f.policy); owner.disable(id, 'Synthetic owner disable', 5); assert.equal(choose().experience, null);
    owner.restore(id, 1, 'Synthetic owner restore as candidate', 6); assert.equal(choose().experience, null);
    assert.equal(b.service.retrievalStatus().attempts[0]!.candidates[0]!.reason, 'candidate');
    const verified = await owner.verify(id); assert.equal(verified.status, 'source_verified');
    assert.equal(choose().experience?.revision, verified.revision); assert.equal(b.service.retrievalStatus().attempts[0]!.cache, 'cold');
  } finally { other.close(); b.store.close(); f.store.close(); }
});

test('HTTP explanations require owner authentication and polling cannot choose or spend', { timeout: 60000 }, async () => {
  const f = await verifiedRetrievalFixture(); const b = f.createBank(); const panel = await startPanel(b.service);
  try {
    b.service.select(b.service.begin('http-selection', 'transaction rollback exception').id);
    const before = JSON.stringify({ tasks: b.store.tasks(), apps: b.store.applications(), grants: b.store.extraction.grants(), retrieval: b.service.retrievalStatus() });
    assert.equal((await fetch(panel.origin + '/api/state')).status, 401);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(panel.origin + '/api/state', { headers: { Authorization: 'Bearer ' + panel.token } });
      assert.equal(response.status, 200); const state = await response.json() as { retrieval: unknown };
      assert.deepEqual(state.retrieval, b.service.retrievalStatus()); assert(!JSON.stringify(state.retrieval).includes(f.repo));
    }
    assert.equal(JSON.stringify({ tasks: b.store.tasks(), apps: b.store.applications(), grants: b.store.extraction.grants(), retrieval: b.service.retrievalStatus() }), before);
  } finally { await panel.close(); b.store.close(); f.store.close(); }
});
