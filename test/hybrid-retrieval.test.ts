import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cosine, embeddingTextDigest, snapshotEmbeddingPort } from '../src/embedding.js';
import { hybridSelection, rankHybrid } from '../src/hybrid-retrieval.js';
import { calibrateHybrid, calibrationGrid, hybridMetrics, parseHybridCorpus, validateHybridCorpus } from '../src/hybrid-evaluation.js';

const binding = { modelDigest: 'a'.repeat(64), corpusDigest: 'b'.repeat(64), dimension: 2 };
const snapshot = () => ({ schemaVersion: 1, ...binding, split: 'development',
  entries: [{ namespace: 'development/document', id: 'x', revision: 1, textDigest: embeddingTextDigest('hello'), vector: [1, 0] }],
  provenance: { engine: 'test', runtimeVersions: {}, inferenceSeconds: 0, texts: 1, forwardPasses: 1, paidHttpCalls: 0, precision: 'round7' } });
test('cosine is normalized, including negative direction; invalid vectors fail explicitly', () => {
  assert.equal(cosine([3, 0], [2, 0]), 1); assert.equal(cosine([1, 0], [0, 8]), 0);
  assert.equal(cosine([1, 0], [-3, 0]), -1);
  assert.equal(cosine([1e200, 0], [1e200, 0]), 1);
  for (const vector of [[], [0, 0], [NaN, 1], [Infinity, 0], [1]]) assert.throws(() => cosine(vector, [1, 0]));
});
test('rank diagnostics can credit zero-score ties even while post-gate recall is zero', () => {
  const candidates = ['a', 'b', 'c'].map(id => ({ id, score: 0, lexical: 0, dense: 0 }));
  const selection = hybridSelection(candidates, { minimumScore: 0.3, minimumMargin: 0, lexicalWeight: 0 });
  const result = hybridMetrics([{ id: 'q', family: 'test', kind: 'literal', query: 'test', relevantIds: ['b'], ineligibleIds: [], ...selection, candidates }]);
  assert.equal(result.positiveRecall, 0); assert.equal(result.recallAt3, 1); assert.equal(result.mrr, 0.5);
});
test('calibration accesses only development requests and retains the full preregistered grid', async () => {
  const corpus = parseHybridCorpus(await readFile('test/fixtures/retrieval-v3-cases.json'));
  const port = { embed(input: { namespace: string }) { assert(input.namespace.startsWith('development/')); return [1, 0]; } };
  const result = calibrateHybrid(corpus, port);
  assert.equal(result.denseGrid.length, 24); assert.equal(result.hybridGrid.length, 72);
  for (const [config, grid] of [[result.dense, result.denseGrid], [result.hybrid, result.hybridGrid]] as const) {
    assert(calibrationGrid.minimumScores.some(v => v === config.minimumScore));
    assert(calibrationGrid.minimumMargins.some(v => v === config.minimumMargin));
    assert(grid.find(row => JSON.stringify(row.config) === JSON.stringify(config))!.metrics.wrong <= result.wrongOfferCap);
  }
});
test('snapshot binds model, corpus, namespace, revision and exact text; copies prevent cache mutation', () => {
  const source = snapshot(); const port = snapshotEmbeddingPort(source, binding);
  const request = { namespace: 'development/document', id: 'x', revision: 1, text: 'hello' };
  source.entries[0]!.vector[0] = 0;
  const returned = port.embed(request) as number[]; returned[0] = 0;
  assert.deepEqual(port.embed(request), [1, 0]);
  for (const altered of [{ ...request, namespace: 'holdout/document' }, { ...request, revision: 2 }, { ...request, text: 'Hello' }]) {
    assert.throws(() => port.embed(altered));
  }
  assert.throws(() => snapshotEmbeddingPort(snapshot(), { ...binding, modelDigest: 'c'.repeat(64) }));
  assert.throws(() => snapshotEmbeddingPort(snapshot(), { ...binding, corpusDigest: 'c'.repeat(64) }));
  assert.throws(() => snapshotEmbeddingPort(snapshot(), { ...binding, dimension: 3 }));
  const duplicate = snapshot(); duplicate.entries.push(duplicate.entries[0]!);
  assert.throws(() => snapshotEmbeddingPort(duplicate, binding));
});
test('fusion gates weak lexical scores, reads eligible documents only, and resolves ties by ID', () => {
  const read: string[] = [];
  const port = { embed(input: { id: string }) { read.push(input.id); return [1, 0]; } };
  const ranked = rankHybrid({ id: 'q', text: 'nothing' }, [
    { id: 'z', revision: 1, title: 'alpha', strategy: 'beta' },
    { id: 'a', revision: 1, title: 'alpha', strategy: 'beta' },
  ], 'development', port, 0.35);
  assert.deepEqual(read, ['q', 'z', 'a']); assert.deepEqual(ranked.map(r => r.id), ['a', 'z']);
  assert.equal(ranked[0]!.lexical, 0); assert.equal(ranked[0]!.score, 0.65);
  assert.equal(hybridSelection(ranked, { lexicalWeight: 0.35, minimumScore: 0.3, minimumMargin: 0.025 }).reason, 'ambiguous_margin');
  assert.equal(hybridSelection(ranked, { lexicalWeight: 0.35, minimumScore: 0.7, minimumMargin: 0 }).reason, 'low_score');
  assert.equal(hybridSelection(ranked, { lexicalWeight: 0.35, minimumScore: 0.3, minimumMargin: 0 }).selected, 'a');
});
test('frozen corpus has balanced disjoint families and rejects split leakage', async () => {
  const corpus = parseHybridCorpus(await readFile('test/fixtures/retrieval-v3-cases.json'));
  const changed = structuredClone(corpus); changed.queries[0]!.split = 'holdout';
  assert.throws(() => validateHybridCorpus(changed));
  const reference = structuredClone(corpus); reference.queries[0]!.relevantIds = [corpus.experiences.find(e => e.split === 'holdout')!.id];
  assert.throws(() => validateHybridCorpus(reference));
});
