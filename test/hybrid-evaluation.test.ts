import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { calibrateHybrid, evaluateHybrid, parseHybridCorpus } from '../src/hybrid-evaluation.js';

for (const partition of ['development', 'holdout'] as const) {
  test(`published ${partition} vectors replay all metrics, choices and scores without a neural dependency`, async () => {
    const corpus = parseHybridCorpus(await readFile('test/fixtures/retrieval-v3-cases.json'));
    const model = await readFile('compat/retrieval-embedding/model.json');
    const calibrationBytes = await readFile('compat/retrieval-embedding/calibration.json');
    const calibration = JSON.parse(calibrationBytes.toString('utf8')) as ReturnType<typeof calibrateHybrid> & {
      modelDigest: string; developmentVectorDigest: string; sourceDigests: Record<string, string> };
    const vectorBytes = await readFile(`test/fixtures/retrieval-v3-${partition}-vectors.json`);
    const snapshot = vectorSnapshotSchema.parse(JSON.parse(vectorBytes.toString('utf8')));
    const saved = JSON.parse(await readFile(`docs/evaluation/retrieval-v3-${partition}.json`, 'utf8')) as ReturnType<typeof evaluateHybrid> & {
      vectorDigest: string; calibrationDigest: string; modelDigest: string; sourceDirty: boolean;
      sourceDigests: Record<string, string>; embedding: typeof snapshot.provenance };
    assert.equal(snapshot.entries.length, 72); assert.equal(snapshot.split, partition);
    assert.equal(saved.vectorDigest, digest(vectorBytes)); assert.equal(saved.calibrationDigest, digest(calibrationBytes));
    assert.equal(saved.modelDigest, digest(model)); assert.equal(saved.sourceDirty, false);
    assert.deepEqual(saved.embedding, snapshot.provenance);
    for (const [path, expected] of Object.entries(calibration.sourceDigests)) assert.equal(digest(await readFile(path)), expected, path);
    assert.deepEqual(saved.sourceDigests, calibration.sourceDigests);
    assert(calibration.dense && calibration.hybrid && calibration.status === 'admissible');
    const port = snapshotEmbeddingPort(snapshot, { modelDigest: digest(model), corpusDigest: saved.dataDigest, dimension: 384 });
    const replay = evaluateHybrid(corpus, partition, port, { dense: calibration.dense, hybrid: calibration.hybrid });
    assert.equal(replay.rankingMetricBoundary, saved.rankingMetricBoundary);
    assert.equal(replay.timingBoundary, saved.timingBoundary);
    for (const [name, actual] of Object.entries(replay.groups)) {
      const { rows: expectedRows, ...expectedMetrics } = saved.groups[name]!;
      const { rows, ...metrics } = actual; assert.deepEqual(metrics, expectedMetrics);
      assert.equal(rows.length, expectedRows.length);
      for (const [i, row] of rows.entries()) {
        const { candidates, ...fields } = row; const { candidates: expected, ...expectedFields } = expectedRows[i]!;
        assert.deepEqual(fields, expectedFields); assert.equal(candidates.length, expected.length);
        for (const [j, candidate] of candidates.entries()) {
          assert.equal(candidate.id, expected[j]!.id); assert(!row.ineligibleIds.includes(candidate.id));
          for (const score of ['score', 'lexical', 'dense'] as const) assert(Math.abs(candidate[score] - expected[j]![score]) < 1e-12);
        }
      }
    }
    if (partition === 'development') {
      const recalibrated = calibrateHybrid(corpus, port);
      for (const key of Object.keys(recalibrated) as (keyof typeof recalibrated)[]) assert.deepEqual(recalibrated[key], calibration[key]);
      assert.equal(calibration.developmentVectorDigest, digest(vectorBytes));
    }
  });
}
