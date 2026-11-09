/** Current extended-graph regression, distinct from the immutable T059 original ML experiment. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { evaluateProjectFacts, parseProjectFactCorpus, projectQueryBinding, projectFactEvaluationPolicyDigest } from '../src/project-facts-evaluation.js';
import { projectFilePort } from '../src/project-facts.js';
import { schemaFactOracle } from './project-facts-oracle.js';

const root = fileURLToPath(new URL('../../', import.meta.url)); const read = (path: string) => readFile(join(root, path));
interface LockGraph { lockfileVersion: number; packages: Record<string, Record<string, unknown>> }
const installingFlags = new Set(['dev', 'devOptional', 'peer']);
export function assertLegacyGraphPreserved(original: LockGraph, current: LockGraph) {
  assert.equal(original.lockfileVersion, 3); assert.equal(current.lockfileVersion, 3);
  const legacyRoot = original.packages['']!; const nextRoot = current.packages['']!;
  assert.deepEqual(Object.keys(nextRoot).sort(), Object.keys(legacyRoot).sort());
  for (const [field, value] of Object.entries(legacyRoot)) if (field !== 'devDependencies') assert.deepEqual(nextRoot[field], value, 'Root graph metadata drift: ' + field);
  const before = legacyRoot.devDependencies as Record<string, string>; const after = nextRoot.devDependencies as Record<string, string>;
  for (const [name, version] of Object.entries(before)) assert.equal(after[name], version, 'Existing root dependency drift: ' + name);
  assert.deepEqual(Object.keys(after).filter(name => !(name in before)), ['@deepseek-ai/dsh-llm-deepseek']);
  assert.equal(after['@deepseek-ai/dsh-llm-deepseek'], after['@deepseek-ai/dsh-llm']);
  const metadata = (pkg: Record<string, unknown>) => Object.fromEntries(Object.entries(pkg).filter(([key]) => !installingFlags.has(key)));
  for (const [path, pkg] of Object.entries(original.packages)) if (path) {
    assert(current.packages[path], 'Missing legacy dependency: ' + path);
    assert.deepEqual(metadata(current.packages[path]!), metadata(pkg), 'Existing package metadata drift: ' + path);
  }
  return { legacyPackageCount: Object.keys(original.packages).length - 1,
    addedPackages: Object.keys(current.packages).filter(path => !(path in original.packages)) };
}

async function inputs() {
  const methodBytes = await read('compat/project-facts/method.json');
  const method = JSON.parse(methodBytes.toString('utf8')) as { sourceDirty: boolean; policyDigest: string; modelDigest: string; dataDigest: string;
    sourceDigests: Record<string, string>; dependencyLockDigests: Record<string, string> };
  assert.equal(method.sourceDirty, false); assert.equal(method.policyDigest, projectFactEvaluationPolicyDigest);
  const archived = (version: string) => 'compat/project-facts/locks/dsh-' + version + '.lock.json';
  for (const [version, expected] of Object.entries(method.dependencyLockDigests)) assert.equal(digest(await read(archived(version))), expected, 'Historical lock bytes changed');
  for (const [path, expected] of Object.entries(method.sourceDigests)) {
    const historicalPath = path === 'compat/dsh-0.2.1-rc.5.lock.json' ? archived('0.2.1-rc.5') : path;
    assert.equal(digest(await read(historicalPath)), expected, 'Historical method source drift: ' + path);
  }
  const active = JSON.parse((await read('package-lock.json')).toString('utf8')) as LockGraph;
  const activeVersion = String(active.packages['node_modules/@deepseek-ai/dsh-llm']?.version);
  assert(['0.2.0-rc.2', '0.2.1-rc.5'].includes(activeVersion));
  const activeReceipt = assertLegacyGraphPreserved(JSON.parse((await read(archived(activeVersion))).toString('utf8')) as LockGraph, active);
  const rc5Receipt = assertLegacyGraphPreserved(JSON.parse((await read(archived('0.2.1-rc.5'))).toString('utf8')) as LockGraph,
    JSON.parse((await read('compat/dsh-0.2.1-rc.5.lock.json')).toString('utf8')) as LockGraph);
  assert.equal((createRequire(import.meta.url)('ajv/package.json') as { version: string }).version, '8.20.0');
  assert.equal(digest(await read('compat/retrieval-embedding/model.json')), method.modelDigest);
  return { methodBytes, method, dependencyReceipt: { kind: 'current-extended-graph-regression', activeVersion,
    activeLockDigest: digest(await read('package-lock.json')), historicalLockDigests: method.dependencyLockDigests, active: activeReceipt, rc5: rc5Receipt } };
}

export async function replayCurrentProjectFacts(partition: 'development' | 'holdout') {
  const { methodBytes, method, dependencyReceipt } = await inputs();
  const corpusBytes = await read('test/fixtures/project-facts-v1-cases.json'); assert.equal(digest(corpusBytes), method.dataDigest);
  const corpus = parseProjectFactCorpus(corpusBytes);
  for (const q of corpus.queries) assert.deepEqual(schemaFactOracle(q.source.content, q.targetProperty), q.manualFacts, q.id);
  const bytes = await read(`test/fixtures/project-facts-v1-${partition}-vectors.json`);
  const snapshot = vectorSnapshotSchema.parse(JSON.parse(bytes.toString('utf8'))); assert.equal(snapshot.split, partition); assert.equal(snapshot.entries.length, 56);
  const vectors = snapshotEmbeddingPort(snapshot, { modelDigest: method.modelDigest, corpusDigest: digest(await read('test/fixtures/project-facts-v1-cases.json')), dimension: 384 });
  const identical = new Map<string, readonly number[]>();
  for (const q of corpus.queries.filter(q => q.split === partition)) {
    const value = vectors.embed({ namespace: partition + '/query', id: q.id, revision: 1, text: q.text });
    if (identical.has(q.text)) assert.deepEqual(value, identical.get(q.text)); else identical.set(q.text, value);
  }
  const parent = join(root, '.probe-work/t059-current-graph-replay'); await mkdir(parent, { recursive: true }); const directory = await mkdtemp(join(parent, partition + '-'));
  for (const q of corpus.queries.filter(q => q.split === partition && q.source.available)) {
    const file = join(directory, q.source.path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, q.source.content);
  }
  const actual = evaluateProjectFacts(corpus, partition, vectors, q => projectFilePort(directory, projectQueryBinding(q)));
  const saved = JSON.parse((await read(`docs/evaluation/project-facts-v1-${partition}.json`)).toString('utf8')) as typeof actual & {
    methodDigest: string; vectorDigest: string; sourceDirty: boolean; sourceDigests: Record<string, string> };
  assert.equal(saved.sourceDirty, false); assert.equal(saved.methodDigest, digest(methodBytes)); assert.equal(saved.vectorDigest, digest(bytes));
  assert.deepEqual(saved.sourceDigests, method.sourceDigests);
  assert.deepEqual(actual, Object.fromEntries(Object.keys(actual).map(key => [key, saved[key as keyof typeof saved]])));
  return { partition, matched: true, methodDigest: digest(methodBytes), vectorDigest: digest(bytes), dependencyReceipt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node dist/scripts/project-facts-current-replay.js');
  const partitions = []; for (const partition of ['development', 'holdout'] as const) partitions.push(await replayCurrentProjectFacts(partition));
  process.stdout.write(JSON.stringify({ kind: 'current-extended-graph-regression', matched: true, partitions,
    historicalMlExperimentReexecuted: false, modelHttpRequests: 0 }) + '\n');
}
