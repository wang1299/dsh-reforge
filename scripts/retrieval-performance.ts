/** Local repeated-query measurements, separate from retrieval relevance and Agent benefit. */
import assert from 'node:assert/strict';
import { cpus, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { digest } from '../src/domain.js';
import { rankText, retrievalPolicyDigest } from '../src/retrieval.js';
import { prepareTextIndex } from '../src/retrieval-index.js';
import { parseRetrievalCorpus } from '../src/retrieval-evaluation.js';

if (process.argv.length !== 2) throw new Error('Usage: retrieval-performance');
const corpus = parseRetrievalCorpus(await readFile(new URL('../../test/fixtures/retrieval-v2-cases.json', import.meta.url)));
const workload = ['atomic file replacement', 'explicit zero defaults', 'tenant identity request parameters',
  'idempotency key completed result', 'unique timestamp identifier cursor', '解析文件关闭句柄', 'unmatched vocabulary xyz', ''];
const percentile = (values: number[], quantile: number): number => [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1]!;
const summarize = (values: number[]) => ({ samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95),
  meanMs: values.reduce((a, b) => a + b, 0) / values.length, rawMs: values });
const results = [];
for (const size of [1000, 10000]) {
  const bank = Array.from({ length: size }, (_, i) => {
    const source = corpus.experiences[i % corpus.experiences.length]!;
    return { id: 'synthetic-' + String(i).padStart(5, '0'), title: source.title + ' fixture' + i, strategy: source.strategy };
  });
  const buildStart = performance.now(); const index = prepareTextIndex(bank); const buildMs = performance.now() - buildStart;
  for (const query of workload) assert.deepEqual(index.rank(query), rankText(query, bank), 'Warmup semantic mismatch');
  const rebuildMs: number[] = []; const reusedMs: number[] = [];
  for (let repetition = 0; repetition < 4; repetition++) {
    for (const [i, query] of workload.entries()) {
      let oldResult; let newResult;
      const old = () => { const start = performance.now(); oldResult = rankText(query, bank); rebuildMs.push(performance.now() - start); };
      const prepared = () => { const start = performance.now(); newResult = index.rank(query); reusedMs.push(performance.now() - start); };
      if ((i + repetition) % 2) { prepared(); old(); } else { old(); prepared(); }
      assert.deepEqual(newResult, oldResult, 'Measured semantic mismatch');
    }
  }
  const rebuild = summarize(rebuildMs); const reused = summarize(reusedMs);
  results.push({ documents: size, warmupQueriesPerMethod: workload.length, measuredQueriesPerMethod: workload.length * 4,
    allResultsIdentical: true, buildMs, rebuild, reused, p50Speedup: rebuild.p50Ms / reused.p50Ms,
    p95ReductionPercent: (1 - reused.p95Ms / rebuild.p95Ms) * 100,
    estimatedBreakEvenQueries: rebuild.meanMs > reused.meanMs ? Math.ceil(buildMs / (rebuild.meanMs - reused.meanMs)) : null });
}
process.stdout.write(JSON.stringify({ schemaVersion: 1, kind: 'local-repeated-query-performance', modelCalls: 0,
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: release(),
    cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, totalMemoryGiB: Number((totalmem() / 1024 ** 3).toFixed(1)) },
  policyDigest: retrievalPolicyDigest, workloadDigest: digest(JSON.stringify(workload)), workload,
  method: '8 warmup queries per method, 4 repetitions x 8 queries, interleaved order, full ranked-output equality outside timers; nearest-rank percentiles',
  limitations: ['One machine and one run with synthetic repeated-query traffic; not production latency or a portable speed guarantee.',
    'Prepared-index build cost is separate; each old query includes rebuilding. Reuse requires an unchanged eligible corpus.',
    'Includes full-result allocation and sorting; excludes source/scope verification, I/O, model and UI latency.',
    'The break-even count is an estimate from this run, not a production promise.'], results }, null, 2) + '\n');
