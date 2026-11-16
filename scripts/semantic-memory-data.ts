import { z } from 'zod';
import { digest, textSchema } from '../src/domain.js';
import { semanticAnchors } from '../src/semantic-memory.js';
import { syntheticContextInput } from '../test/context-fixture.js';
import { assertVector } from '../src/embedding.js';
import type { SemanticPort } from '../src/semantic-memory.js';

const id = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const family = z.object({ id, split: z.enum(['development', 'holdout']), title: z.string().min(1).max(160), strategy: textSchema,
  facts: z.array(z.object({ text: textSchema, facet: z.string().min(1).max(32).nullable() }).strict()).min(1).max(12),
  queries: z.array(z.object({ id, text: textSchema, language: z.enum(['en','zh']), kind: z.enum(['repair','documentation','contradiction']), applicable: z.boolean(), relevantFacts: z.array(z.number().int().min(0).max(11)).max(12), reason: textSchema }).strict()).length(6),
  contract: z.object({ original: z.string().min(1).max(10000), reference: z.string().min(1).max(10000), counterexample: z.string().min(1).max(10000), acceptance: z.string().min(1).max(10000) }).strict() }).strict();
export const semanticCorpusSchema = z.object({ schema: z.literal(1), created: z.literal('2026-11-16'), boundary: textSchema,
  intentAnchors: z.object({ repair: z.literal(semanticAnchors.repair), nonRepair: z.literal(semanticAnchors.nonRepair) }).strict(), families: z.array(family).length(12) }).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const f of value.families) {
    for (const key of [f.id, ...f.queries.map(q => q.id)]) { if (ids.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate family/query identity' }); ids.add(key); }
    if (f.queries.filter(q => q.applicable).length !== 2) ctx.addIssue({ code: 'custom', message: 'Expected two positives per family' });
    for (const language of ['en','zh']) for (const kind of ['repair','documentation','contradiction']) if (f.queries.filter(q=>q.language===language && q.kind===kind).length!==1) ctx.addIssue({code:'custom',message:'Expected balanced language/type strata'});
    for (const q of f.queries) if (new Set(q.relevantFacts).size !== q.relevantFacts.length || q.relevantFacts.some(i => !f.facts[i]?.facet) || (!q.applicable && q.relevantFacts.length)) ctx.addIssue({ code: 'custom', message: 'Invalid fact labels' });
  }
  for (const split of ['development', 'holdout']) if (value.families.filter(f => f.split === split).length !== 6) ctx.addIssue({ code: 'custom', message: 'Unbalanced family split' });
});
export type SemanticCorpus = z.infer<typeof semanticCorpusSchema>;
export type SemanticFamily = SemanticCorpus['families'][number];
export type SemanticQuery = SemanticFamily['queries'][number];
export function semanticInput(family: SemanticFamily, query: SemanticQuery) {
  const input = syntheticContextInput(family.facts.map(f => f.text), query.text);
  input.experience.title = family.title; input.experience.strategy = family.strategy;
  input.experience.scope.requiredFiles = { 'task.py': digest(family.contract.reference) };
  return input;
}
export const semanticNamespace = (f: SemanticFamily) => f.split + '/' + f.id;
export function semanticRequests(corpus: SemanticCorpus, split: 'development' | 'holdout') {
  return corpus.families.filter(f => f.split === split).flatMap(f => {
    const input = semanticInput(f, f.queries[0]!); const ns = semanticNamespace(f);
    return [{ namespace: ns + '/document', id: input.experience.id, revision: input.experience.revision, text: f.title + '\n' + f.strategy },
      ...f.facts.map((fact, i) => ({ namespace: ns + '/fact', id: String(i), revision: input.experience.revision, text: fact.text })),
      ...f.queries.map(q => ({ namespace: ns + '/query', id: q.id, revision: 1, text: q.text })),
      ...Object.entries(semanticAnchors).map(([id, text]) => ({ namespace: ns + '/intent', id, revision: 1, text }))];
  });
}
/** Every expected input, including all negatives, must be present before any quality scoring. */
export function assertSemanticRequests(corpus: SemanticCorpus, split: 'development' | 'holdout', port: SemanticPort): number {
  const requests=semanticRequests(corpus,split);
  for(const request of requests)assertVector(port.embed(request),port.dimension);
  return requests.length;
}
