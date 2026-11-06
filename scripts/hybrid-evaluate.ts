import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { snapshotEmbeddingPort, vectorSnapshotSchema } from '../src/embedding.js';
import { calibrateHybrid, evaluateHybrid, frozenHybridCorpusDigest, parseHybridCorpus } from '../src/hybrid-evaluation.js';

const args = process.argv.slice(2);
if (args.length !== 1 || !['calibrate', 'development', 'holdout'].includes(args[0]!)) {
  throw new Error('Usage: hybrid-evaluate calibrate|development|holdout (fixed public synthetic files only)');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFile(join(root, path));
const corpus = parseHybridCorpus(await read('test/fixtures/retrieval-v3-cases.json'));
const manifestBytes = await read('compat/retrieval-embedding/model.json');
const model = JSON.parse(manifestBytes.toString('utf8')) as { dimension: number };
const partition = args[0] === 'holdout' ? 'holdout' : 'development';
const vectorPath = args[0] === 'calibrate' ? '.probe-work/t056/development-vectors.json' : `test/fixtures/retrieval-v3-${partition}-vectors.json`;
const vectorBytes = await read(vectorPath);
const snapshot = vectorSnapshotSchema.parse(JSON.parse(vectorBytes.toString('utf8')));
assert.equal(snapshot.split, partition);
assert.equal(snapshot.entries.length, 72); assert.equal(snapshot.provenance.texts, 72);
const port = snapshotEmbeddingPort(snapshot, { modelDigest: digest(manifestBytes), corpusDigest: frozenHybridCorpusDigest, dimension: model.dimension });
const sourcePaths = ['src/embedding.ts', 'src/hybrid-retrieval.ts', 'src/hybrid-evaluation.ts', 'src/retrieval.ts',
  'scripts/hybrid-evaluate.ts', 'scripts/retrieval-embedding.py'];
const sourceDigests = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await read(path))])));
const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const sourceCommit = git(['rev-parse', 'HEAD']);
const sourceDirty = git(['status', '--porcelain']).length > 0;
const output = join(root, '.probe-work/t056'); await mkdir(output, { recursive: true });
if (args[0] === 'calibrate') {
  const calibration = { ...calibrateHybrid(corpus, port), modelDigest: digest(manifestBytes), developmentVectorDigest: digest(vectorBytes),
    sourceCommit, sourceDirty, sourceDigests };
  await writeFile(join(output, 'calibration.json'), JSON.stringify(calibration, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ sourceCommit, sourceDirty, status: calibration.status, dense: calibration.dense,
    hybrid: calibration.hybrid, wrongOfferCap: calibration.wrongOfferCap }) + '\n');
  if (calibration.status !== 'admissible') process.exitCode = 2; // Both full grids are already persisted; do not run holdout.
} else {
  if (partition === 'holdout') assert(!sourceDirty, 'Commit frozen method/config before first holdout evaluation');
  const calibrationBytes = await read('compat/retrieval-embedding/calibration.json');
  const calibration = JSON.parse(calibrationBytes.toString('utf8')) as ReturnType<typeof calibrateHybrid> & {
    modelDigest: string; developmentVectorDigest: string; sourceDigests: Record<string, string>; sourceDirty: boolean };
  assert.equal(calibration.split, 'development'); assert.equal(calibration.dataDigest, frozenHybridCorpusDigest);
  assert(calibration.status === 'admissible' && calibration.dense && calibration.hybrid, 'Calibration failed; retain grids and stop before holdout');
  assert.equal(calibration.modelDigest, digest(manifestBytes)); assert(!calibration.sourceDirty, 'Calibration must use committed source');
  assert.deepEqual(calibration.sourceDigests, sourceDigests, 'Method changed after calibration; no silent retuning');
  assert.equal(calibration.developmentVectorDigest, digest(await read('test/fixtures/retrieval-v3-development-vectors.json')));
  const report = { ...evaluateHybrid(corpus, partition, port, { dense: calibration.dense, hybrid: calibration.hybrid }), sourceCommit, sourceDirty, sourceDigests,
    calibrationDigest: digest(calibrationBytes), modelDigest: digest(manifestBytes), vectorDigest: digest(vectorBytes),
    embedding: snapshot.provenance, environment: { node: process.version, platform: process.platform, arch: process.arch } };
  await writeFile(join(output, partition + '.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ split: partition, sourceCommit, groups: Object.fromEntries(Object.entries(report.groups).map(([name, group]) =>
    [name, { correct: group.correct, positives: group.positives, wrong: group.wrong, abstained: group.abstained, recallAt3: group.recallAt3, mrr: group.mrr }])) }) + '\n');
}
