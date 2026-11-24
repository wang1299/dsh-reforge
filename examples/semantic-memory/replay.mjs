import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest } from '../../dist/src/domain.js';
import { semanticSnapshotPort } from '../../dist/src/semantic-memory.js';
import { assertSemanticRequests, semanticCorpusSchema } from '../../dist/scripts/semantic-memory-data.js';
import { evaluateSemantic } from '../../dist/scripts/semantic-memory-evaluation.js';

// Reuse the recorded holdout and its frozen policies. No Git checkout or model download is needed.
const read = file => readFileSync(new URL('../../' + file, import.meta.url));
const corpusBytes = read('test/fixtures/semantic-memory-v1.json');
const vectors = read('test/fixtures/semantic-memory-v1-holdout-vectors.json');
const model = read('compat/retrieval-embedding/model.json');
const calibration = read('compat/semantic-memory/calibration.json');
const original = JSON.parse(read('docs/evaluation/semantic-memory-v1-holdout.json'));
assert.equal(original.corpusDigest, digest(corpusBytes));
assert.equal(original.vectorDigest, digest(vectors));
assert.equal(original.modelDigest, digest(model));
assert.equal(original.calibrationDigest, digest(calibration));
const corpus = semanticCorpusSchema.parse(JSON.parse(corpusBytes));
const port = semanticSnapshotPort(JSON.parse(vectors), {
  modelDigest: original.modelDigest, corpusDigest: original.corpusDigest, dimension: JSON.parse(model).dimension
});
assert.equal(assertSemanticRequests(corpus, 'holdout', port), 84);
const { arms } = JSON.parse(calibration);
const results = ['source-order', 'mmr-density', 'cosine-gate', 'intent-gate'].map(method =>
  evaluateSemantic(corpus, 'holdout', port, method, arms.find(arm => arm.method === method)?.policy));
assert.deepEqual(results, original.results);
console.table(results.map(({ method, queries, correct, wrong, missed }) => ({ method, queries, correct, wrong, missed })));
console.log('Replayed every recorded holdout decision. Model API calls: 0.');
