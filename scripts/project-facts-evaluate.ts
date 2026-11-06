import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { evaluateProjectFacts, frozenProjectFactCorpusDigest, parseProjectFactCorpus, projectFactEvaluationPolicy,
  projectFactEvaluationPolicyDigest, projectQueryBinding } from '../src/project-facts-evaluation.js';
import { projectFilePort } from '../src/project-facts.js';
import { schemaFactOracle } from './project-facts-oracle.js';

const mode = process.argv[2];
if (process.argv.length !== 3 || !['freeze', 'development', 'holdout'].includes(mode!)) throw new Error('Usage: project-facts-evaluate freeze|development|holdout (fixed public synthetic inputs only)');
const root = fileURLToPath(new URL('../../', import.meta.url)); const read = (path: string) => readFile(join(root, path));
const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
const sourceCommit = git(['rev-parse', 'HEAD']); const sourceDirty = git(['status', '--porcelain']).length > 0;
assert(!sourceDirty, 'Commit fixed method/data/artifacts before evaluation');
const corpus = parseProjectFactCorpus(await read('test/fixtures/project-facts-v1-cases.json'));
// Schema/reference validation is independent of projection and decision scoring.
for (const q of corpus.queries) assert.deepEqual(schemaFactOracle(q.source.content, q.targetProperty), q.manualFacts, q.id);
const modelBytes = await read('compat/retrieval-embedding/model.json');
const sourcePaths = ['src/project-facts.ts', 'src/project-facts-evaluation.ts', 'scripts/project-facts-evaluate.ts', 'scripts/project-facts-embedding.py',
  'scripts/project-facts-oracle.ts', 'src/applicability.ts', 'src/applicability-evaluation.ts', 'src/embedding.ts', 'src/hybrid-retrieval.ts',
  'src/retrieval.ts', 'scripts/retrieval-embedding.py', 'compat/dsh-0.2.1-rc.5.lock.json'];
const sourceDigests = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await read(path))])));
const installedOracle = createRequire(import.meta.url)('ajv/package.json') as { version: string };
assert.equal(installedOracle.version, '8.20.0', 'Independent oracle version must match its fixed dev dependency');
const dependencyLockDigests = { '0.2.0-rc.2': digest(await read('package-lock.json')), '0.2.1-rc.5': digest(await read('compat/dsh-0.2.1-rc.5.lock.json')) };
const method = { schemaVersion: 1, dataDigest: frozenProjectFactCorpusDigest, modelDigest: digest(modelBytes),
  policy: projectFactEvaluationPolicy, policyDigest: projectFactEvaluationPolicyDigest, oracleVersion: 'ajv-8.20.0/no-data-mutation', dependencyLockDigests, sourceCommit, sourceDirty, sourceDigests };
const output = join(root, '.probe-work/t059'); await mkdir(output, { recursive: true });
if (mode === 'freeze') {
  await writeFile(join(output, 'method.json'), JSON.stringify(method, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ sourceCommit, sourceDirty, dataDigest: frozenProjectFactCorpusDigest, policyDigest: projectFactEvaluationPolicyDigest, oracleArtifacts: corpus.queries.length }) + '\n');
} else {
  const methodBytes = await read('compat/project-facts/method.json'); const frozen = JSON.parse(methodBytes.toString('utf8')) as typeof method;
  for (const key of ['schemaVersion', 'dataDigest', 'modelDigest', 'policy', 'policyDigest', 'oracleVersion', 'dependencyLockDigests', 'sourceDirty', 'sourceDigests'] as const) assert.deepEqual(method[key], frozen[key], 'Frozen method mismatch: ' + key);
  const vectorBytes = await read(`test/fixtures/project-facts-v1-${mode}-vectors.json`);
  const snapshot = vectorSnapshotSchema.parse(JSON.parse(vectorBytes.toString('utf8')));
  assert.equal(snapshot.split, mode); assert.equal(snapshot.entries.length, 56);
  const vectors = snapshotEmbeddingPort(snapshot, { modelDigest: method.modelDigest, corpusDigest: frozenProjectFactCorpusDigest, dimension: 384 });
  const identical = new Map<string, readonly number[]>();
  for (const q of corpus.queries.filter(q => q.split === mode)) {
    const value = vectors.embed({ namespace: mode + '/query', id: q.id, revision: 1, text: q.text });
    if (identical.has(q.text)) assert.deepEqual(value, identical.get(q.text), 'Identical source text must share inferred vectors');
    else identical.set(q.text, value);
  }
  const sources = await mkdtemp(join(output, 'sources-'));
  for (const q of corpus.queries.filter(q => q.split === mode && q.source.available)) {
    const file = join(sources, q.source.path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, q.source.content);
  }
  const report = { ...evaluateProjectFacts(corpus, mode as 'development' | 'holdout', vectors, q => projectFilePort(sources, projectQueryBinding(q))),
    sourceCommit, sourceDirty, sourceDigests, modelDigest: method.modelDigest, methodDigest: digest(methodBytes), vectorDigest: digest(vectorBytes),
    embedding: snapshot.provenance, oracle: { artifacts: corpus.queries.length, omissionNullProbes: corpus.queries.length * 2, version: method.oracleVersion,
      declarationTypeCheck: 'independent source-declaration inspection, distinct from omission/null behavior' },
    environment: { node: process.version, platform: process.platform, arch: process.arch } };
  await writeFile(join(output, mode + '.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ split: mode, sourceCommit, groups: Object.fromEntries(Object.entries(report.groups).map(([name, group]) =>
    [name, { correct: group.correct, positives: group.positives, wrong: group.wrong, abstained: group.abstained, precision: group.precision, vsDense: group.vsDense }])),
    extraction: { supported: report.extraction.supported, queries: report.extraction.queries, factsChecked: report.extraction.factsChecked, factsAgree: report.extraction.factsAgree,
      unknownReasons: report.extraction.unknownReasons }, contributions: report.contributions }) + '\n');
}
