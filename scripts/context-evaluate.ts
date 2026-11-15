import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { compileAgentContext, legacyExperienceNotice, type ContextPacking } from '../src/agent-context.js';
import { syntheticContextInput } from '../test/context-fixture.js';

interface ContextCase { id: string; split: 'development' | 'evaluation'; query: string; optionalBytes: number; facts: { text: string; facet: string | null }[] }
interface Dataset { schema: 1; boundary: string; cases: ContextCase[] }
/** Offline selection labels only; no network, model, store, or acceptance inference. */
export function evaluateContext() {
  const raw = readFileSync(new URL('../../test/fixtures/context-packing-v1.json', import.meta.url), 'utf8');
  const dataset = JSON.parse(raw) as Dataset;
  const methods: ContextPacking[] = ['source-order', 'relevance-density', 'mmr-density'];
  const cases = dataset.cases.filter(c => c.split === 'evaluation').map(c => {
    const input = syntheticContextInput(c.facts.map(f => f.text), c.query);
    const unlimited = compileAgentContext(input);
    input.policy.maxNoticeBytes = unlimited.decision.mandatoryBytes + c.optionalBytes;
    const availableFacets = new Set(c.facts.flatMap(f => f.facet ? [f.facet] : [])).size;
    const results = methods.map(method => {
      const result = compileAgentContext(input, method); const selected = result.decision.includedFacts;
      const selectedFacets = selected.flatMap(i => c.facts[i]!.facet ? [c.facts[i]!.facet!] : []);
      const provided = JSON.parse(result.text.slice(result.text.indexOf('\n') + 1)) as { observedFacts: { index: number; text: string; citations: unknown }[] };
      const citationBindingValid = provided.observedFacts.every(f => f.text === input.experience.observedFacts[f.index]
        && JSON.stringify(f.citations) === JSON.stringify(input.citations.filter(c => c.factIndex === f.index)));
      return { method, providedBytes: result.decision.providedBytes, budgetExceeded: result.decision.providedBytes > input.policy.maxNoticeBytes,
        includedFacts: selected, selectedCount: selected.length, distinctFacets: new Set(selectedFacets).size, availableFacets,
        irrelevantFacts: selected.filter(i => c.facts[i]!.facet === null).length,
        repeatedFacetFacts: selectedFacets.length - new Set(selectedFacets).size, citationBindingValid, omissions: result.decision.omittedFacts };
    });
    return { id: c.id, budgetBytes: input.policy.maxNoticeBytes, fullEnvelopeBytes: unlimited.decision.fullBytes,
      fullEnvelopeOverBudget: unlimited.decision.fullBytes > input.policy.maxNoticeBytes,
      legacyBytes: Buffer.byteLength(legacyExperienceNotice(input.experience, null), 'utf8'), results };
  });
  const summary = methods.map(method => {
    const rows = cases.map(c => c.results.find(r => r.method === method)!);
    return { method, cases: rows.length, providedBytes: rows.reduce((sum, r) => sum + r.providedBytes, 0),
      budgetViolations: rows.filter(r => r.budgetExceeded).length, selectedFacts: rows.reduce((sum, r) => sum + r.selectedCount, 0),
      distinctFacets: rows.reduce((sum, r) => sum + r.distinctFacets, 0), availableFacets: rows.reduce((sum, r) => sum + r.availableFacets, 0),
      irrelevantFacts: rows.reduce((sum, r) => sum + r.irrelevantFacts, 0), repeatedFacetFacts: rows.reduce((sum, r) => sum + r.repeatedFacetFacts, 0),
      citationBindingFailures: rows.filter(r => !r.citationBindingValid).length };
  });
  return { schema: 1, kind: 'synthetic-context-packing-v1', datasetSha256: createHash('sha256').update(raw).digest('hex'), boundary: dataset.boundary,
    developmentCases: dataset.cases.filter(c => c.split === 'development').length,
    evaluationCases: cases.length, fullEnvelopeBytes: cases.reduce((sum, c) => sum + c.fullEnvelopeBytes, 0), fullEnvelopeOverBudgetCases: cases.filter(c => c.fullEnvelopeOverBudget).length,
    paidHttpCalls: 0, realModelBenefitMeasured: false, summary, cases };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(JSON.stringify(evaluateContext(), null, 2) + '\n');
