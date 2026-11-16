import { compileAgentContext } from '../src/agent-context.js';
import { planSemanticMemory, type SemanticPolicy, type SemanticPort } from '../src/semantic-memory.js';
import { semanticInput, semanticNamespace, type SemanticCorpus } from './semantic-memory-data.js';

export type SemanticMethod = 'source-order' | 'mmr-density' | 'cosine-gate' | 'intent-gate';
export function evaluateSemantic(corpus: SemanticCorpus, split: 'development' | 'holdout', port: SemanticPort, method: SemanticMethod, policy?: SemanticPolicy) {
  const rows = corpus.families.filter(f => f.split === split).flatMap(f => f.queries.map(q => {
    const input = semanticInput(f, q); const mandatory = compileAgentContext({ ...input, allowedFacts: [] }, 'source-order');
    input.policy.maxNoticeBytes = mandatory.decision.mandatoryBytes + 1000;
    const result = method === 'source-order' || method === 'mmr-density' ? compileAgentContext(input, method)
      : planSemanticMemory(input, { port, policy: policy!, namespace: semanticNamespace(f), queryId: q.id });
    const packing = 'packing' in result.decision ? result.decision.packing ?? mandatory.decision : result.decision;
    const provided = result.text !== ''; const indices = provided ? packing.includedFacts : [];
    const relevant = indices.filter(i => q.relevantFacts.includes(i)); const facets = new Set(relevant.map(i => f.facts[i]!.facet));
    const availableFacets = new Set(q.relevantFacts.map(i => f.facts[i]!.facet)).size;
    const units = provided ? (JSON.parse(result.text.slice(result.text.indexOf('\n') + 1)) as { observedFacts: { index: number; text: string; citations: unknown }[] }).observedFacts : [];
    return { id: q.id, family: f.id, language:q.language, kind:q.kind, applicable: q.applicable, provided, reason: result.decision.status,
      includedFacts: indices, correctOffer: provided && q.applicable && relevant.length > 0, wrongOffer: provided && !q.applicable,
      missed: q.applicable && (!provided || relevant.length === 0), positiveWithoutRelevantFact:provided && q.applicable && relevant.length===0, relevantFacets: facets.size, availableFacets,
      irrelevantPositiveFacts: q.applicable ? indices.length - relevant.length : 0,
      budgetBytes: input.policy.maxNoticeBytes, providedBytes: Buffer.byteLength(result.text),
      budgetViolation: Buffer.byteLength(result.text) > input.policy.maxNoticeBytes,
      citationBindingFailure: units.some(unit => unit.text !== input.experience.observedFacts[unit.index]
        || JSON.stringify(unit.citations) !== JSON.stringify(input.citations.filter(c => c.factIndex === unit.index))),
      semantic: 'packing' in result.decision ? result.decision : null };
  }));
  return { method, split, queries: rows.length, positives: rows.filter(r => r.applicable).length, negatives: rows.filter(r => !r.applicable).length,
    offered: rows.filter(r => r.provided).length, correct: rows.filter(r => r.correctOffer).length, wrong: rows.filter(r => r.wrongOffer).length,
    missed: rows.filter(r => r.missed).length, positiveWithoutRelevantFact:rows.filter(r=>r.positiveWithoutRelevantFact).length,
    strata:['en','zh'].flatMap(language=>['repair','documentation','contradiction'].map(kind=>({language,kind,
      queries:rows.filter(r=>r.language===language&&r.kind===kind).length,correct:rows.filter(r=>r.language===language&&r.kind===kind&&r.correctOffer).length,
      wrong:rows.filter(r=>r.language===language&&r.kind===kind&&r.wrongOffer).length,missed:rows.filter(r=>r.language===language&&r.kind===kind&&r.missed).length}))),
    relevantFacets: rows.reduce((n,r) => n + r.relevantFacets,0), availableFacets: rows.reduce((n,r) => n+r.availableFacets,0),
    irrelevantPositiveFacts: rows.reduce((n,r) => n+r.irrelevantPositiveFacts,0), bytes: rows.reduce((n,r)=>n+r.providedBytes,0),
    budgetViolations: rows.filter(r => r.budgetViolation).length, citationBindingFailures: rows.filter(r=>r.citationBindingFailure).length, rows };
}
export function calibrateSemantic(corpus: SemanticCorpus, port: SemanticPort) {
  const minimumCorrect = Math.ceil(corpus.families.filter(f=>f.split === 'development').flatMap(f=>f.queries).filter(q=>q.applicable).length * 0.75);
  const arms = (['cosine-gate','intent-gate'] as const).map(method => {
    const grid: { policy: SemanticPolicy; correct: number; wrong: number; facets: number; irrelevant: number; admissible: boolean }[] = [];
    for (const minimumDocument of [0.25,0.35,0.45,0.55,0.65]) for (const minimumFact of [0.25,0.4,0.55]) for (const minimumIntentMargin of method === 'intent-gate' ? [0,0.05,0.1] : [0]) {
      const policy: SemanticPolicy = { version: 'local-semantic-v1', modelDigest: port.modelDigest, minimumDocument,minimumFact,
        intent: method === 'intent-gate' ? 'contrastive' : 'none',minimumIntentMargin };
      const report = evaluateSemantic(corpus,'development',port,method,policy);
      grid.push({policy,correct:report.correct,wrong:report.wrong,facets:report.relevantFacets,irrelevant:report.irrelevantPositiveFacts,
        admissible:report.correct >= minimumCorrect && report.budgetViolations === 0 && report.citationBindingFailures === 0});
    }
    const ranked = grid.map((row,index)=>({...row,index})).filter(row=>row.admissible).sort((a,b)=>a.wrong-b.wrong || b.facets-a.facets || a.irrelevant-b.irrelevant || b.correct-a.correct || a.index-b.index);
    return {method,policy:ranked[0]?.policy ?? null,grid};
  });
  return {status:arms.every(a=>a.policy) ? 'admissible' : 'no_admissible_config', minimumCorrect,arms};
}
