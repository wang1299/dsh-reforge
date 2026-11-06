/** Real select/provenance/Git/SQLite chain over a fresh synthetic repair; never calls a model. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { git } from '../src/repository.js';
import { digest } from '../src/domain.js';
import { verifiedRetrievalFixture } from '../test/retrieval-fixture.js';

if (process.argv.length !== 2) throw new Error('Usage: live-retrieval-benchmark');
const root = fileURLToPath(new URL('../../', import.meta.url));
const privateWork = join(root, '.probe-work/t054-live-benchmark'); await mkdir(privateWork, { recursive: true });
const f = await verifiedRetrievalFixture(privateWork);
const workload = ['transaction rollback exception', 'transaction rollback exception with independent acceptance checks and regression tests',
  'rollback transaction failure restore balance', 'transaction', 'unrelated typography layout', 'restore balance',
  'transaction exception rollback', '修复 transaction rollback failure'];
const percentile = (values: number[], q: number): number => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]!;
const results = [];
try {
  for (const documents of [1, 10]) {
    const reuse = f.createBank(documents); const legacy = f.createBank(documents, 'legacy');
    const indexOnly = f.createBank(documents, 'reuse', ':memory:', 'per-experience');
    const invoke = (bank: typeof reuse, query: string, sequence: string) => {
      const task = bank.service.begin(sequence, query);
      const started = performance.now(); const selected = bank.service.select(task.id); const wallMs = performance.now() - started;
      const diagnostic = bank.service.retrievalStatus().attempts[0]!;
      assert(diagnostic); assert.equal(diagnostic.taskId, task.id);
      return { wallMs, selectedVariant: selected.experience ? bank.experiences.findIndex(e => e.id === selected.experience!.id) : null,
        selectedRevision: selected.experience?.revision ?? null, reasonsDigest: digest(JSON.stringify(selected.reasons)),
        textScores: diagnostic.candidates.map(c => c.textScore), combinedScores: diagnostic.candidates.map(c => c.combinedScore),
        cache: diagnostic.cache, timings: diagnostic.timings, scopeChecks: diagnostic.scopeChecks };
    };
    const comparable = (row: ReturnType<typeof invoke>) => ({ selectedVariant: row.selectedVariant, selectedRevision: row.selectedRevision,
      reasonsDigest: row.reasonsDigest, textScores: row.textScores, combinedScores: row.combinedScores });
    try {
      const cold = { legacy: invoke(legacy, workload[0]!, 'cold-legacy'), indexOnly: invoke(indexOnly, workload[0]!, 'cold-index-only'), reuse: invoke(reuse, workload[0]!, 'cold-reuse') };
      assert.deepEqual(comparable(cold.legacy), comparable(cold.reuse));
      assert.deepEqual(comparable(cold.legacy), comparable(cold.indexOnly));
      assert.equal(cold.legacy.scopeChecks?.snapshotPasses, documents + 1); assert.equal(cold.indexOnly.scopeChecks?.snapshotPasses, documents + 1);
      assert.equal(cold.reuse.scopeChecks?.snapshotPasses, 1); assert.equal(cold.reuse.scopeChecks?.conditionPathsChecked, 1);
      const samples: { repetition: number; queryIndex: number; legacy: ReturnType<typeof invoke>; indexOnly: ReturnType<typeof invoke>; reuse: ReturnType<typeof invoke> }[] = [];
      for (let repetition = 0; repetition < 2; repetition++) {
        for (const [i, query] of workload.entries()) {
          const sequence = repetition + '-' + i; const banks = { legacy, indexOnly, reuse };
          const arms = ['legacy', 'indexOnly', 'reuse'] as const; const offset = (i + repetition) % arms.length;
          const order = [...arms.slice(offset), ...arms.slice(0, offset)]; if (repetition % 2) order.reverse();
          const outputs = {} as Record<typeof arms[number], ReturnType<typeof invoke>>;
          for (const arm of order) outputs[arm] = invoke(banks[arm], query, arm + '-' + sequence);
          const old = outputs.legacy; const current = outputs.reuse;
          assert.deepEqual(comparable(old), comparable(current), 'Live-chain decision, score or reason changed');
          assert.deepEqual(comparable(old), comparable(outputs.indexOnly), 'Index-only decision drift');
          assert.equal(current.cache, 'hit');
          assert.equal(current.scopeChecks?.snapshotPasses, 1); assert.equal(old.scopeChecks?.snapshotPasses, documents + 1);
          samples.push({ repetition, queryIndex: i, ...outputs });
        }
      }
      const summary = (arm: 'legacy' | 'indexOnly' | 'reuse') => {
        const values = samples.map(s => s[arm].wallMs); const qualification = samples.map(s => s[arm].timings.qualificationMs);
        return { samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95),
          meanMs: values.reduce((a, b) => a + b, 0) / values.length,
          qualificationP50Ms: percentile(qualification, 0.5), queryP50Ms: percentile(samples.map(s => s[arm].timings.queryMs), 0.5) };
      };
      const old = summary('legacy'); const current = summary('reuse');
      results.push({ documents, exactDecisionsAndScores: true, cold, legacy: old, indexOnly: summary('indexOnly'), reuse: current,
        p50ReductionPercent: (1 - current.p50Ms / old.p50Ms) * 100,
        p95ReductionPercent: (1 - current.p95Ms / old.p95Ms) * 100,
        cache: reuse.service.retrievalStatus().cache, samples });
      assert.equal(reuse.store.extraction.grants().length, 0); assert.equal(legacy.store.extraction.grants().length, 0); assert.equal(indexOnly.store.extraction.grants().length, 0);
    } finally { reuse.store.close(); legacy.store.close(); indexOnly.store.close(); }
  }
  const sourcePaths = ['src/service.ts', 'src/repository.ts', 'src/retrieval-runtime.ts', 'src/retrieval.ts', 'src/retrieval-index.ts', 'test/retrieval-fixture.ts', 'scripts/live-retrieval-benchmark.ts'];
  process.stdout.write(JSON.stringify({ schemaVersion: 1, kind: 'synthetic-live-service-retrieval', modelCalls: 0,
    sourceCommit: git(root, ['rev-parse', 'HEAD']), sourceDirty: git(root, ['status', '--porcelain']).length > 0,
    sourceDigests: Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await readFile(join(root, path)))]))),
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model ?? 'unknown' },
    workload, workloadDigest: digest(JSON.stringify(workload)),
    method: 'Three arms: original per-experience scope reads/legacy text, index-only with per-experience reads, index plus request-local reads. One cold request per arm, then two repetitions x eight queries per arm, rotating interleaved order with second-round reversal, separate identical banks, equality outside timers. Wall time surrounds actual service.select including qualification/Git/SQLite/application and diagnostics. Task creation/panel serialization excluded. Nearest-rank percentiles.',
    limitations: ['One local run over 1/10 synthetic text variants of one independently verified repair; not production traffic or an independent strategy corpus.',
      'Original and reuse arms keep live evidence/scope/feedback checks; full-chain improvements may be negligible or negative.',
      'Legacy build work is included in query time; prepared index construction is separate. Cache only retains an unchanged eligible bank.',
      'No model, provider delivery, downstream task acceptance, token cost or financial benefit was evaluated.',
      'Sixteen warm observations per method/size are descriptive, not a robust tail-latency estimate.'], results }, null, 2) + '\n');
} finally { f.store.close(); }
