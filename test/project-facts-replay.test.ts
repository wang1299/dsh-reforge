import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { evaluateProjectFacts, parseProjectFactCorpus, projectQueryBinding, projectFactEvaluationPolicyDigest } from '../src/project-facts-evaluation.js';
import { projectFilePort } from '../src/project-facts.js';

const root = fileURLToPath(new URL('../../', import.meta.url)); const read = (path: string) => readFile(join(root, path));
for (const partition of ['development', 'holdout'] as const) test('fixed ' + partition + ' schema-fact evidence replays every arm, source result and metric without ML', async () => {
  const corpus = parseProjectFactCorpus(await read('test/fixtures/project-facts-v1-cases.json'));
  const methodBytes = await read('compat/project-facts/method.json');
  const method = JSON.parse(methodBytes.toString('utf8')) as { sourceDirty: boolean; policyDigest: string; modelDigest: string;
    sourceDigests: Record<string, string>; dependencyLockDigests: Record<string, string> };
  assert.equal(method.sourceDirty, false); assert.equal(method.policyDigest, projectFactEvaluationPolicyDigest);
  for (const [path, expected] of Object.entries(method.sourceDigests)) assert.equal(digest(await read(path)), expected, path);
  // The matrix intentionally replaces the active lock with the declared SDK graph.
  assert(Object.values(method.dependencyLockDigests).includes(digest(await read('package-lock.json'))), 'Active host graph must be one of the two fixed locks');
  assert.equal((createRequire(import.meta.url)('ajv/package.json') as { version: string }).version, '8.20.0');
  assert.equal(digest(await read('compat/retrieval-embedding/model.json')), method.modelDigest);
  const bytes = await read(`test/fixtures/project-facts-v1-${partition}-vectors.json`);
  const snapshot = vectorSnapshotSchema.parse(JSON.parse(bytes.toString('utf8'))); assert.equal(snapshot.split, partition); assert.equal(snapshot.entries.length, 56);
  const vectors = snapshotEmbeddingPort(snapshot, { modelDigest: method.modelDigest, corpusDigest: digest(await read('test/fixtures/project-facts-v1-cases.json')), dimension: 384 });
  const identical = new Map<string, readonly number[]>();
  for (const q of corpus.queries.filter(q => q.split === partition)) {
    const value = vectors.embed({ namespace: partition + '/query', id: q.id, revision: 1, text: q.text });
    if (identical.has(q.text)) assert.deepEqual(value, identical.get(q.text)); else identical.set(q.text, value);
  }
  const parent = join(root, '.probe-work/t059-replay'); await mkdir(parent, { recursive: true }); const directory = await mkdtemp(join(parent, partition + '-'));
  for (const q of corpus.queries.filter(q => q.split === partition && q.source.available)) {
    const file = join(directory, q.source.path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, q.source.content);
  }
  const actual = evaluateProjectFacts(corpus, partition, vectors, q => projectFilePort(directory, projectQueryBinding(q)));
  const saved = JSON.parse((await read(`docs/evaluation/project-facts-v1-${partition}.json`)).toString('utf8')) as typeof actual & {
    methodDigest: string; vectorDigest: string; sourceDirty: boolean; sourceDigests: Record<string, string> };
  assert.equal(saved.sourceDirty, false); assert.equal(saved.methodDigest, digest(methodBytes)); assert.equal(saved.vectorDigest, digest(bytes));
  assert.deepEqual(saved.sourceDigests, method.sourceDigests);
  assert.deepEqual(actual, Object.fromEntries(Object.keys(actual).map(key => [key, saved[key as keyof typeof saved]])));
});
