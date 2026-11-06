import assert from 'node:assert/strict';
import { z } from 'zod';
import { digest } from './domain.js';
import type { EmbeddingPort } from './embedding.js';
import { rankHybrid, hybridSelection, type HybridMatch } from './hybrid-retrieval.js';
import { applicabilityContractSchema, applicabilityPolicy, applicabilityPolicyDigest, assessApplicability, contractSourceRefSchema,
  readContractFacts, selectContractsOnly, selectWithContracts, type ApplicabilityState, type ContractCandidate, type ContractSourcePort } from './applicability.js';

const id = z.string().min(1).max(100); const split = z.enum(['development', 'holdout']);
export const applicabilityKinds = ['literal', 'cross_language', 'paraphrase', 'reverse_language', 'missing_positive', 'low_overlap',
  'hard_contradiction', 'insufficient_context', 'irrelevant_same_facts', 'conflicting_evidence', 'stale_evidence', 'no_applicable_candidate'] as const;
const corpusSchema = z.object({ schemaVersion: z.literal(4), kind: z.literal('author-synthetic-contract-applicability'),
  experiences: z.array(z.object({ id, revision: z.literal(1), split, family: id, title: z.string().min(1).max(300),
    strategy: z.string().min(1).max(2000), contract: applicabilityContractSchema }).strict()).length(16),
  queries: z.array(z.object({ id, split, family: id, kind: z.enum(applicabilityKinds), text: z.string().min(1).max(2000),
    relevantIds: z.array(id).max(1), sourceRefs: z.array(contractSourceRefSchema).min(1).max(2), pairId: id.nullable(),
    rationale: z.string().min(1).max(1000) }).strict()).length(96),
  sources: z.array(contractSourceRefSchema.extend({ content: z.string().min(1).max(8192) }).strict()).length(104),
}).strict();
export type ApplicabilityCorpus = z.infer<typeof corpusSchema>;
export const frozenApplicabilityCorpusDigest = '9946016730fc0c054b9ffaeb282d06854ba552a15cefd60ab9fc1b662d0ee3aa';
export function parseApplicabilityCorpus(bytes: Buffer): ApplicabilityCorpus {
  assert.equal(digest(bytes), frozenApplicabilityCorpusDigest, 'Frozen applicability corpus changed');
  return validateApplicabilityCorpus(JSON.parse(bytes.toString('utf8')));
}
export function validateApplicabilityCorpus(input: unknown): ApplicabilityCorpus {
  const corpus = corpusSchema.parse(input);
  assert.equal(new Set(corpus.experiences.map(e => e.id)).size, 16); assert.equal(new Set(corpus.queries.map(q => q.id)).size, 96);
  assert.equal(new Set(corpus.sources.map(s => s.path)).size, 104);
  for (const family of new Set(corpus.experiences.map(e => e.family))) {
    const bank = corpus.experiences.filter(e => e.family === family); const queries = corpus.queries.filter(q => q.family === family);
    assert.equal(bank.length, 2); assert.equal(queries.length, 12); assert.equal(new Set(queries.map(q => q.kind)).size, 12);
    assert.equal(new Set([...bank, ...queries].map(e => e.split)).size, 1); assert.equal(queries.filter(q => q.relevantIds.length).length, 6);
    const positive = queries.find(q => q.kind === 'literal')!; const negative = queries.find(q => q.kind === 'hard_contradiction')!;
    assert.equal(positive.text, negative.text); assert.equal(positive.pairId, negative.pairId); assert(positive.pairId);
    const a = JSON.parse(corpus.sources.find(s => s.path === positive.sourceRefs[0]!.path)!.content).facts as Record<string, unknown>;
    const b = JSON.parse(corpus.sources.find(s => s.path === negative.sourceRefs[0]!.path)!.content).facts as Record<string, unknown>;
    assert.equal(Object.keys(a).length, Object.keys(b).length); assert.equal(Object.keys(a).filter(k => a[k] !== b[k]).length, 1);
  }
  for (const q of corpus.queries) {
    assert(corpus.experiences.some(e => e.family === q.family && e.split === q.split));
    for (const relevant of q.relevantIds) assert(corpus.experiences.some(e => e.id === relevant && e.split === q.split && e.family === q.family));
    for (const ref of q.sourceRefs) {
      const source = corpus.sources.find(s => s.path === ref.path); assert(source);
      assert.equal(ref.namespace, q.split + '/contracts'); assert.equal(ref.taskId, q.id);
      for (const key of ['namespace', 'taskId', 'revision', 'sha256'] as const) assert.equal(ref[key], source[key]);
      assert.equal(digest(source.content) !== ref.sha256, q.kind === 'stale_evidence');
    }
  }
  for (const partition of ['development', 'holdout']) {
    assert.equal(corpus.experiences.filter(e => e.split === partition).length, 8);
    assert.equal(corpus.queries.filter(q => q.split === partition).length, 48);
    assert.equal(corpus.queries.filter(q => q.split === partition && q.relevantIds.length).length, 24);
  }
  return corpus;
}
export function syntheticContractPort(corpus: ApplicabilityCorpus): ContractSourcePort {
  return { read(ref) {
    const source = corpus.sources.find(s => s.path === ref.path && s.namespace === ref.namespace && s.taskId === ref.taskId && s.revision === ref.revision);
    return source ? { namespace: source.namespace, taskId: source.taskId, revision: source.revision, path: source.path, bytes: Buffer.from(source.content) } : null;
  } };
}
export interface ApplicabilityRow { id: string; family: string; kind: string; query: string; relevantIds: string[]; pairId: string | null;
  selected: string | null; state: ApplicabilityState; reason: string; ranked: HybridMatch[]; assessments: ContractCandidate[] }
export function applicabilityMetrics(rows: ApplicabilityRow[]) {
  const positives = rows.filter(r => r.relevantIds.length).length; const correct = rows.filter(r => r.selected && r.relevantIds.includes(r.selected)).length;
  const wrong = rows.filter(r => r.selected && !r.relevantIds.includes(r.selected)).length;
  const negativeWrong = rows.filter(r => !r.relevantIds.length && r.selected).length;
  return { queries: rows.length, positives, negatives: rows.length - positives, correct, wrong, negativeWrong,
    offered: correct + wrong, abstained: rows.length - correct - wrong, positiveRecall: positives ? correct / positives : null,
    precision: correct + wrong ? correct / (correct + wrong) : null, coverage: rows.length ? (correct + wrong) / rows.length : null,
    states: Object.fromEntries((['applicable', 'not_applicable', 'insufficient_information'] as const).map(state => [state, rows.filter(r => r.state === state).length])) };
}
export function evaluateApplicability(corpus: ApplicabilityCorpus, partition: 'development' | 'holdout', vectors: EmbeddingPort) {
  const bank = corpus.experiences.filter(e => e.split === partition); const sourcePort = syntheticContractPort(corpus);
  const rows: Record<'dense_only' | 'contracts_only' | 'dense_top3_contracts', ApplicabilityRow[]> = { dense_only: [], contracts_only: [], dense_top3_contracts: [] };
  for (const q of corpus.queries.filter(q => q.split === partition)) {
    // Decision inputs intentionally exclude relevance labels, kind, rationale and pair IDs.
    const ranked = rankHybrid({ id: q.id, text: q.text }, bank, partition, vectors, 0);
    const context = readContractFacts(q.sourceRefs, { namespace: partition + '/contracts', taskId: q.id, revision: 1 }, sourcePort);
    const assessments = bank.map(e => ({ id: e.id, assessment: assessApplicability(e.contract, context) }));
    const dense = hybridSelection(ranked, { lexicalWeight: 0, minimumScore: applicabilityPolicy.minimumScore, minimumMargin: applicabilityPolicy.minimumMargin });
    const decisions = { dense_only: { ...dense, state: (dense.selected ? 'applicable' : 'insufficient_information') as ApplicabilityState },
      contracts_only: selectContractsOnly(assessments), dense_top3_contracts: selectWithContracts(ranked, assessments) };
    for (const arm of Object.keys(rows) as (keyof typeof rows)[]) rows[arm].push({ id: q.id, family: q.family, kind: q.kind, query: q.text,
      relevantIds: [...q.relevantIds], pairId: q.pairId, ...decisions[arm], ranked: arm === 'contracts_only' ? [] : ranked,
      assessments: arm === 'dense_only' ? [] : arm === 'contracts_only' ? assessments : assessments.filter(a => ranked.slice(0, 3).some(r => r.id === a.id)) });
  }
  const denseCorrect = new Set(rows.dense_only.filter(r => r.selected && r.relevantIds.includes(r.selected)).map(r => r.id));
  const groups = Object.fromEntries(Object.entries(rows).map(([name, items]) => {
    const correct = items.filter(r => r.selected && r.relevantIds.includes(r.selected)); const retained = correct.filter(r => denseCorrect.has(r.id)).length;
    return [name, { ...applicabilityMetrics(items), retainedDenseCorrect: retained, denseCorrect: denseCorrect.size,
      correctRetention: denseCorrect.size ? retained / denseCorrect.size : null, lostDenseCorrect: denseCorrect.size - retained, newCorrect: correct.length - retained,
      byKind: Object.fromEntries(applicabilityKinds.map(kind => [kind, applicabilityMetrics(items.filter(r => r.kind === kind))])),
      byFamily: Object.fromEntries([...new Set(items.map(r => r.family))].map(family => [family, applicabilityMetrics(items.filter(r => r.family === family))])),
      evidenceProbes: applicabilityMetrics(items.filter(r => ['stale_evidence', 'conflicting_evidence'].includes(r.kind))),
      intentNegatives: applicabilityMetrics(items.filter(r => ['hard_contradiction', 'insufficient_context', 'irrelevant_same_facts', 'no_applicable_candidate'].includes(r.kind))),
      pairs: [...new Set(items.flatMap(r => r.pairId ? [r.pairId] : []))].map(pairId => {
        const pair = items.filter(r => r.pairId === pairId); const positive = pair.find(r => r.relevantIds.length)!;
        const negative = pair.find(r => !r.relevantIds.length)!;
        return { pairId, positiveSelected: positive.selected, negativeSelected: negative.selected,
          resolved: positive.selected !== null && positive.relevantIds.includes(positive.selected) && negative.selected === null };
      }), rows: items }];
  }));
  return { schemaVersion: 1, split: partition, dataDigest: frozenApplicabilityCorpusDigest, policy: applicabilityPolicy, policyDigest: applicabilityPolicyDigest,
    groups, limitations: ['Author-visible synthetic labels and correct authored structured task contracts; not external human blind data.',
      'Structured inputs are extra information: same-text pairs intentionally cannot be distinguished by dense-only; contracts-only isolates that advantage.',
      'Source hashes establish contract byte integrity, not real behavior, current source qualification, or natural-language extraction accuracy.',
      'States describe the inspected candidates, not proof about every possible experience; dense_only applicable is just score-gate status.',
      'No model task benefit, default DSH rollout, private Store access or paid API calls. Local neural computation is reported separately.'] };
}
