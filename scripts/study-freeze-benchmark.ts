/** Zero-network development benchmark. The serial oracle is never a production fallback. */
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { newStudyRoot } from './benefit-study-preflight.js';
import { freezeStudyRuntime, verifyStudyRuntime, type StudyFreezeRoot, type StudyRuntimeFreeze } from './study-runtime-freeze.js';
import { freezeStudyRuntime as serialFreeze, verifyStudyRuntime as serialVerify } from '../test/study-freeze-serial-fixture.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const serialSource = '2b3024b4183153fa282dbf759a3422a5ecd43e68a6fc4a6c619c6cf94dcbaa3d';
const stats = (samples: number[]) => { const s = [...samples].sort((a, b) => a - b); return { samplesMs: samples,
  p50Ms: s[Math.floor(s.length / 2)]!, observedMaxMs: s.at(-1)! }; };
const timed = async (run: () => Promise<unknown>) => { const began = performance.now(); await run(); return performance.now() - began; };
async function measurements(frozen: StudyRuntimeFreeze, full: boolean) {
  const serial: number[] = [], concurrent: number[] = [];
  // Both paths are warm; these are repeated local checks, not cold disk or model timings.
  await serialVerify(frozen, full); await verifyStudyRuntime(frozen, full);
  for (let pair = 0; pair < 5; pair++) {
    const baseline = async () => { serial.push(await timed(() => serialVerify(frozen, full))); };
    const candidate = async () => { concurrent.push(await timed(() => verifyStudyRuntime(frozen, full))); };
    if (pair % 2) { await candidate(); await baseline(); } else { await baseline(); await candidate(); }
  }
  const before = stats(serial), after = stats(concurrent);
  return { serial: before, concurrent: after, medianReductionPercent: (1 - after.p50Ms / before.p50Ms) * 100 };
}
async function compare(name: string, roots: StudyFreezeRoot[], critical: string[]) {
  const before = await serialFreeze(roots, critical), after = await freezeStudyRuntime(roots, critical);
  assert.deepEqual(after, before, 'Concurrent inventory must match the frozen serial manifest');
  const metadata = await measurements({ ...before, critical: [] }, false);
  const guard = await measurements(before, false);
  const full = { serialMs: await timed(() => serialVerify(before, true)), concurrentMs: await timed(() => verifyStudyRuntime(before, true)) };
  return { name, entries: before.entries.length, files: before.entries.filter(e => e.kind !== 'directory').length,
    directories: before.entries.filter(e => e.kind === 'directory').length, bytes: before.bytes, criticalFiles: before.critical.length,
    manifestDigest: digest(JSON.stringify(before)), manifestsEqual: true, metadataOnly: metadata, metadataAndCriticalBytes: guard, fullBytesSinglePair: full };
}
export async function benchmarkStudyFreeze() {
  assert.equal(process.version, 'v24.19.0');
  const sourceCommit = git(repository, ['rev-parse', 'HEAD']);
  assert.equal(git(repository, ['status', '--porcelain']), '', 'Benchmark a clean stable source commit');
  assert.equal(digest(await readFile(join(repository, 'test/study-freeze-serial-fixture.ts'))), serialSource, 'Serial oracle bytes changed');
  const root = await newStudyRoot(join(repository, '.probe-work/t067-freeze-benchmark'));
  const results = [];
  for (const count of [1000, 10000]) {
    const tree = join(root, 'tree-' + count); await mkdir(tree);
    for (let dir = 0; dir < count / 50; dir++) {
      const folder = join(tree, 'group-' + String(dir).padStart(4, '0')); await mkdir(folder);
      await Promise.all(Array.from({ length: 50 }, (_, file) => writeFile(join(folder, 'file-' + file + '.js'), 'export const value=' + (dir * 50 + file) + ';\n', { flag: 'wx' })));
    }
    results.push(await compare('synthetic-' + count, [{ name: 'synthetic', path: tree }], [join(tree, 'group-0000/file-0.js')]));
  }
  const tracked = git(repository, ['ls-files', '-z']).split('\0').filter(Boolean);
  const roots: StudyFreezeRoot[] = [{ name: 'public-checkout', path: repository, files: tracked },
    { name: 'compiled', path: join(repository, 'dist') }, { name: 'node-dependencies', path: join(repository, 'node_modules'), skip: ['.bin'] },
    { name: 'node-executable', path: dirname(process.execPath), files: [basename(process.execPath)] }];
  const critical = tracked.filter(p => /^(?:src|scripts|compat)\//.test(p)).map(p => join(repository, p));
  results.push(await compare('public-node-runtime', roots, [...critical, join(repository, 'package.json'), join(repository, 'package-lock.json'),
    join(repository, 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js')]));
  assert.equal(git(repository, ['rev-parse', 'HEAD']), sourceCommit); assert.equal(git(repository, ['status', '--porcelain']), '');
  const report = { schema: 1, kind: 'local-freeze-check-benchmark', sourceCommit,
    worktreeDirty: git(repository, ['status', '--porcelain']).length > 0, baselineCommit: '55d7089aa84640c293678266369b104216b5c57f',
    serialSourceSha256: serialSource, concurrencyLimit: 16, pairs: 5, node: process.version, platform: process.platform, arch: process.arch,
    availableParallelism: availableParallelism(), uvThreadpoolSize: /^[1-9][0-9]?$/.test(process.env.UV_THREADPOOL_SIZE ?? '4') ? Number(process.env.UV_THREADPOOL_SIZE ?? '4') : null,
    results, modelHttpRequests: 0, realModelBenefit: false,
    limitations: ['warm local repeated filesystem checks; not model inference, task quality or end-to-end study speed',
      'public-node-runtime excludes Python, vendor, candidate, source bank and OS; it is not a complete live study plan',
      'metadata-only timing omits critical hashes for profiling only; production guard continues critical byte verification',
      'five paired observations on one machine; maximum is an observed tail, not a general p95 claim'] };
  const path = join(root, 'freeze-benchmark.json'); await writeFile(path, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return { path, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'No custom root or credential options');
  const { path, report } = await benchmarkStudyFreeze();
  process.stdout.write(JSON.stringify({ result: relative(repository, path).replaceAll('\\', '/'), sourceCommit: report.sourceCommit,
    worktreeDirty: report.worktreeDirty, modelHttpRequests: 0, results: report.results }) + '\n');
}
