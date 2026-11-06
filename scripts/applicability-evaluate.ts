import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { applicabilityPolicy, applicabilityPolicyDigest } from '../src/applicability.js';
import { evaluateApplicability, frozenApplicabilityCorpusDigest, parseApplicabilityCorpus } from '../src/applicability-evaluation.js';

const mode = process.argv[2];
if (process.argv.length !== 3 || !['freeze', 'development', 'holdout'].includes(mode!)) throw new Error('Usage: applicability-evaluate freeze|development|holdout (fixed public synthetic inputs only)');
const root = fileURLToPath(new URL('../../', import.meta.url)); const read = (path: string) => readFile(join(root, path));
const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const sourceCommit = git(['rev-parse', 'HEAD']); const sourceDirty = git(['status', '--porcelain']).length > 0;
assert(!sourceDirty, 'Commit fixed method/data/artifacts before evaluation');
const corpus = parseApplicabilityCorpus(await read('test/fixtures/applicability-v1-cases.json'));
const modelBytes = await read('compat/retrieval-embedding/model.json');
const sourcePaths = ['src/applicability.ts', 'src/applicability-evaluation.ts', 'scripts/applicability-evaluate.ts', 'scripts/applicability-embedding.py',
  'src/embedding.ts', 'src/hybrid-retrieval.ts', 'src/retrieval.ts', 'scripts/retrieval-embedding.py'];
const sourceDigests = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await read(path))])));
const method = { schemaVersion: 1, dataDigest: frozenApplicabilityCorpusDigest, modelDigest: digest(modelBytes),
  policy: applicabilityPolicy, policyDigest: applicabilityPolicyDigest, sourceCommit, sourceDirty, sourceDigests };
const output = join(root, '.probe-work/t057'); await mkdir(output, { recursive: true });
if (mode === 'freeze') {
  await writeFile(join(output, 'method.json'), JSON.stringify(method, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ sourceCommit, sourceDirty, policyDigest: applicabilityPolicyDigest, dataDigest: frozenApplicabilityCorpusDigest }) + '\n');
} else {
  const methodBytes = await read('compat/applicability/method.json'); const frozen = JSON.parse(methodBytes.toString('utf8')) as typeof method;
  for (const key of ['schemaVersion', 'dataDigest', 'modelDigest', 'policy', 'policyDigest', 'sourceDirty', 'sourceDigests'] as const) assert.deepEqual(method[key], frozen[key], 'Frozen method mismatch: ' + key);
  const vectorBytes = await read(`test/fixtures/applicability-v1-${mode}-vectors.json`);
  const snapshot = vectorSnapshotSchema.parse(JSON.parse(vectorBytes.toString('utf8')));
  assert.equal(snapshot.split, mode); assert.equal(snapshot.entries.length, 56); assert.equal(snapshot.provenance.texts, 52);
  const port = snapshotEmbeddingPort(snapshot, { modelDigest: method.modelDigest, corpusDigest: frozenApplicabilityCorpusDigest, dimension: 384 });
  for (const q of corpus.queries.filter(q => q.split === mode && q.kind === 'literal')) {
    const pair = corpus.queries.find(n => n.pairId === q.pairId && n.kind === 'hard_contradiction')!;
    const vector = (query: typeof q) => port.embed({ namespace: mode + '/query', id: query.id, revision: 1, text: query.text });
    assert.deepEqual(vector(q), vector(pair), 'Counterfactual text vectors must be identical');
  }
  const report = { ...evaluateApplicability(corpus, mode as 'development' | 'holdout', port), sourceCommit, sourceDirty, sourceDigests,
    modelDigest: method.modelDigest, methodDigest: digest(methodBytes), vectorDigest: digest(vectorBytes), embedding: snapshot.provenance,
    environment: { node: process.version, platform: process.platform, arch: process.arch } };
  await writeFile(join(output, mode + '.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ split: mode, sourceCommit, groups: Object.fromEntries(Object.entries(report.groups).map(([name, group]) =>
    [name, { correct: group.correct, positives: group.positives, wrong: group.wrong, abstained: group.abstained, precision: group.precision,
      correctRetention: group.correctRetention, states: group.states }])) }) + '\n');
}
