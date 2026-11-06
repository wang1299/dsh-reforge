import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { digest } from './domain.js';
import type { EmbeddingPort } from './embedding.js';
import { hybridSelection, rankHybrid, type HybridConfig, type HybridMatch } from './hybrid-retrieval.js';
import { rankText, retrievalPolicyDigest } from './retrieval.js';

const split = z.enum(['development', 'holdout']);
const id = z.string().min(1).max(100);
export const hybridKinds = ['literal', 'cross_language', 'paraphrase', 'cross_language_context', 'reverse_language',
  'hard_negative', 'unrelated_context', 'ambiguous', 'stale', 'other_repo'] as const;
const corpusSchema = z.object({ schemaVersion: z.literal(3), kind: z.literal('author-curated-synthetic-relevance'),
  experiences: z.array(z.object({ id, revision: z.literal(1), split, family: id, title: z.string().min(1).max(300),
    strategy: z.string().min(1).max(2000) }).strict()).length(24),
  queries: z.array(z.object({ id, split, family: id, kind: z.enum(hybridKinds), text: z.string().min(1).max(4000),
    relevantIds: z.array(id).max(1), ineligibleIds: z.array(id).max(1), rationale: z.string().min(1).max(1000) }).strict()).length(120),
}).strict();
export type HybridCorpus = z.infer<typeof corpusSchema>;
export const frozenHybridCorpusDigest = 'ae6a132ac1658a218e5770989246608ed7ab9ba5b766b751123958dd017db5ea';
export function parseHybridCorpus(bytes: Buffer): HybridCorpus {
  assert.equal(digest(bytes), frozenHybridCorpusDigest, 'Frozen v3 corpus changed');
  return validateHybridCorpus(JSON.parse(bytes.toString('utf8')));
}
export function validateHybridCorpus(input: unknown): HybridCorpus {
  const corpus = corpusSchema.parse(input);
  assert.equal(new Set(corpus.experiences.map(e => e.id)).size, 24);
  assert.equal(new Set(corpus.queries.map(q => q.id)).size, 120);
  assert.equal(new Set(corpus.queries.map(q => q.text.normalize('NFKC').toLowerCase())).size, 120);
  const families = new Set(corpus.experiences.map(e => e.family)); assert.equal(families.size, 12);
  for (const family of families) {
    const bank = corpus.experiences.filter(e => e.family === family); const queries = corpus.queries.filter(q => q.family === family);
    assert.equal(bank.length, 2); assert.equal(queries.length, 10); assert.equal(new Set(queries.map(q => q.kind)).size, 10);
    assert.equal(new Set([...bank, ...queries].map(item => item.split)).size, 1, 'Family split leakage');
    assert.equal(queries.filter(q => q.relevantIds.length).length, 5);
  }
  for (const q of corpus.queries) {
    assert(families.has(q.family));
    for (const reference of [...q.relevantIds, ...q.ineligibleIds]) assert(corpus.experiences.some(e => e.id === reference && e.split === q.split));
    assert(!q.relevantIds.some(reference => q.ineligibleIds.includes(reference)));
  }
  for (const partition of ['development', 'holdout']) {
    assert.equal(corpus.experiences.filter(e => e.split === partition).length, 12);
    assert.equal(corpus.queries.filter(q => q.split === partition).length, 60);
    assert.equal(corpus.queries.filter(q => q.split === partition && q.relevantIds.length).length, 30);
  }
  return corpus;
}
export interface HybridRow { id: string; family: string; kind: string; query: string; relevantIds: string[]; ineligibleIds: string[];
  selected: string | null; reason: string; candidates: HybridMatch[] }
export function hybridMetrics(rows: HybridRow[]) {
  const positives = rows.filter(r => r.relevantIds.length).length;
  const correct = rows.filter(r => r.selected !== null && r.relevantIds.includes(r.selected)).length;
  const wrong = rows.filter(r => r.selected !== null && !r.relevantIds.includes(r.selected)).length;
  const negativeWrong = rows.filter(r => !r.relevantIds.length && r.selected !== null).length;
  const positiveRows = rows.filter(r => r.relevantIds.length);
  const recall3 = positiveRows.filter(r => r.candidates.slice(0, 3).some(c => r.relevantIds.includes(c.id))).length;
  const reciprocalRank = positiveRows.reduce((total, r) => {
    const index = r.candidates.findIndex(c => r.relevantIds.includes(c.id)); return total + (index < 0 ? 0 : 1 / (index + 1));
  }, 0);
  return { queries: rows.length, positives, negatives: rows.length - positives, correct, wrong, negativeWrong,
    abstained: rows.length - correct - wrong, positiveRecall: positives ? correct / positives : null,
    precision: correct + wrong ? correct / (correct + wrong) : null, recallAt3: positives ? recall3 / positives : null,
    mrr: positives ? reciprocalRank / positives : null };
}
export function prepareHybridEvaluation(corpus: HybridCorpus, partition: 'development' | 'holdout', port: EmbeddingPort) {
  const bank = corpus.experiences.filter(e => e.split === partition); const queries = corpus.queries.filter(q => q.split === partition);
  const lexicalWeightRanks = new Map<number, HybridRow[]>(); const timing: Record<string, number> = {};
  let start = performance.now();
  const baseline: HybridRow[] = queries.map(q => {
    const ranked = rankText(q.text, bank.filter(e => !q.ineligibleIds.includes(e.id)));
    const selected = ranked.find(r => r.reason === null)?.id ?? null;
    return { ...q, query: q.text, selected, reason: selected ? 'offered' : 'bm25_gate',
      candidates: ranked.map(r => ({ id: r.id, score: r.score, lexical: r.reason === null ? r.score : 0, dense: 0 })) };
  });
  timing.bm25Milliseconds = performance.now() - start;
  function evaluate(config: HybridConfig): HybridRow[] {
    let rows = lexicalWeightRanks.get(config.lexicalWeight);
    if (!rows) {
      start = performance.now();
      rows = queries.map(q => ({ ...q, query: q.text, selected: null, reason: 'unselected',
        candidates: rankHybrid(q, bank.filter(e => !q.ineligibleIds.includes(e.id)), partition, port, config.lexicalWeight) }));
      timing['weight' + config.lexicalWeight + 'Milliseconds'] = performance.now() - start;
      lexicalWeightRanks.set(config.lexicalWeight, rows);
    }
    return rows.map(row => ({ ...row, ...hybridSelection(row.candidates, config) }));
  }
  return { baseline, evaluate, timing };
}
export const calibrationGrid = { minimumScores: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8], minimumMargins: [0, 0.025, 0.05, 0.1],
  lexicalWeights: [0.15, 0.35, 0.55] } as const;
export function calibrateHybrid(corpus: HybridCorpus, port: EmbeddingPort) {
  const prepared = prepareHybridEvaluation(corpus, 'development', port); const baseline = hybridMetrics(prepared.baseline);
  const grid = (weights: readonly number[]) => weights.flatMap(lexicalWeight => calibrationGrid.minimumScores.flatMap(minimumScore =>
    calibrationGrid.minimumMargins.map(minimumMargin => {
      const config = { lexicalWeight, minimumScore, minimumMargin }; return { config, metrics: hybridMetrics(prepared.evaluate(config)) };
    })));
  const select = (rows: ReturnType<typeof grid>) => {
    const qualified = rows.filter(r => r.metrics.wrong <= baseline.wrong).sort((a, b) => b.metrics.correct - a.metrics.correct
      || a.metrics.wrong - b.metrics.wrong || b.config.minimumMargin - a.config.minimumMargin
      || b.config.minimumScore - a.config.minimumScore || a.config.lexicalWeight - b.config.lexicalWeight);
    assert(qualified[0], 'No calibrated configuration satisfies wrong-offer cap'); return qualified[0].config;
  };
  const denseGrid = grid([0]); const hybridGrid = grid(calibrationGrid.lexicalWeights);
  return { schemaVersion: 1, dataDigest: frozenHybridCorpusDigest, baselinePolicyDigest: retrievalPolicyDigest,
    split: 'development' as const, wrongOfferCap: baseline.wrong, dense: select(denseGrid), hybrid: select(hybridGrid),
    denseGrid, hybridGrid };
}
export function evaluateHybrid(corpus: HybridCorpus, partition: 'development' | 'holdout', port: EmbeddingPort,
  config: { dense: HybridConfig; hybrid: HybridConfig }) {
  const prepared = prepareHybridEvaluation(corpus, partition, port);
  const groups = Object.fromEntries(Object.entries({ bm25: prepared.baseline, dense: prepared.evaluate(config.dense), hybrid: prepared.evaluate(config.hybrid) })
    .map(([name, rows]) => [name, { ...hybridMetrics(rows), byKind: Object.fromEntries(hybridKinds.map(kind => [kind, hybridMetrics(rows.filter(r => r.kind === kind))])),
      byFamily: Object.fromEntries([...new Set(rows.map(r => r.family))].map(family => [family, hybridMetrics(rows.filter(r => r.family === family))])),
      negativeSemantic: hybridMetrics(rows.filter(r => ['hard_negative', 'unrelated_context', 'ambiguous'].includes(r.kind))),
      negativeEligibility: hybridMetrics(rows.filter(r => ['stale', 'other_repo'].includes(r.kind))), rows }]));
  return { schemaVersion: 1, split: partition, dataDigest: frozenHybridCorpusDigest, baselinePolicyDigest: retrievalPolicyDigest,
    config, groups, scoringMilliseconds: prepared.timing,
    timingBoundary: 'one local rank pass per arm; precomputed vectors; excludes embedding/loading; dense arm also computes unused BM25 for diagnostics, not optimized standalone vector latency',
    rankingMetricBoundary: 'Recall@3/MRR use all eligible candidates before score/margin gates, including zero-score/ID ties; positiveRecall measures correct offers after gates',
    limitations: ['Author-visible synthetic relevance labels, not external human blind labels.',
      'Eligibility labels are declared; stale/foreign probes do not demonstrate semantic rejection.',
      'Retrieval quality is not downstream task improvement, cost saving or source verification.',
      'Offline prototype only; default DSH BM25 unchanged. Paid API calls: zero; local embedding computation reported separately.'] };
}
