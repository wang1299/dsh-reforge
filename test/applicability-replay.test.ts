import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { evaluateApplicability, parseApplicabilityCorpus } from '../src/applicability-evaluation.js';

function close(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') { assert.equal(typeof actual, 'number'); assert(Math.abs((actual as number) - expected) < 1e-12); }
  else if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object'); assert.equal(Array.isArray(actual), Array.isArray(expected));
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const key of Object.keys(expected)) close((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]);
  } else assert.equal(actual, expected);
}
for (const partition of ['development', 'holdout'] as const) {
  test(`fixed ${partition} applicability vectors replay every assessment, choice and metric without ML`, async () => {
    const corpus = parseApplicabilityCorpus(await readFile('test/fixtures/applicability-v1-cases.json'));
    const vectors = await readFile(`test/fixtures/applicability-v1-${partition}-vectors.json`);
    const model = await readFile('compat/retrieval-embedding/model.json'); const methodBytes = await readFile('compat/applicability/method.json');
    const method = JSON.parse(methodBytes.toString('utf8')) as { sourceDirty: boolean; sourceDigests: Record<string, string> };
    const snapshot = vectorSnapshotSchema.parse(JSON.parse(vectors.toString('utf8')));
    const saved = JSON.parse(await readFile(`docs/evaluation/applicability-v1-${partition}.json`, 'utf8')) as ReturnType<typeof evaluateApplicability> & {
      sourceDirty: boolean; sourceDigests: Record<string, string>; vectorDigest: string; modelDigest: string; methodDigest: string };
    assert.equal(saved.sourceDirty, false); assert.equal(method.sourceDirty, false); assert.equal(saved.vectorDigest, digest(vectors));
    assert.equal(saved.modelDigest, digest(model)); assert.equal(saved.methodDigest, digest(methodBytes));
    assert.equal(snapshot.entries.length, 56); assert.equal(snapshot.provenance.texts, 52); assert.equal(snapshot.provenance.forwardPasses, 7);
    assert.equal(snapshot.split, partition); assert.deepEqual(saved.sourceDigests, method.sourceDigests);
    for (const [path, expected] of Object.entries(method.sourceDigests)) assert.equal(digest(await readFile(path)), expected, path);
    const port = snapshotEmbeddingPort(snapshot, { modelDigest: digest(model), corpusDigest: saved.dataDigest, dimension: 384 });
    const replay = evaluateApplicability(corpus, partition, port); close(replay.groups, saved.groups);
    assert.deepEqual(replay.policy, saved.policy); assert.equal(replay.policyDigest, saved.policyDigest); assert.deepEqual(replay.limitations, saved.limitations);
    for (const q of corpus.queries.filter(q => q.split === partition && q.kind === 'literal')) {
      const negative = corpus.queries.find(n => n.pairId === q.pairId && n.kind === 'hard_contradiction')!;
      const vector = (query: typeof q) => port.embed({ namespace: partition + '/query', id: query.id, revision: 1, text: query.text });
      assert.deepEqual(vector(q), vector(negative));
    }
    // Labels and evaluation-only fields must not alter either decision or its evidence.
    const relabeled = structuredClone(corpus);
    for (const query of relabeled.queries) { query.relevantIds = []; query.pairId = null; query.rationale = 'test-only relabeling'; query.kind = 'literal'; }
    const independent = evaluateApplicability(relabeled, partition, port);
    for (const [arm, group] of Object.entries(replay.groups)) {
      const decisions = (report: typeof group) => report.rows.map(r => ({ selected: r.selected, state: r.state, reason: r.reason, ranked: r.ranked, assessments: r.assessments }));
      assert.deepEqual(decisions(group), decisions(independent.groups[arm]!));
    }
  });
}
