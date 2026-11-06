import assert from 'node:assert/strict';
import { z } from 'zod';
import { digest } from './domain.js';
import type { EmbeddingPort } from './embedding.js';
import { rankHybrid, hybridSelection } from './hybrid-retrieval.js';
import { applicabilityContractSchema, applicabilityPolicy, selectWithContracts, type ApplicabilityState, type ContractSourcePort } from './applicability.js';
import { applicabilityMetrics, type ApplicabilityRow } from './applicability-evaluation.js';
import { assessProjectCandidate, projectSchemaFacts, projectSchemaPath, projectFactRequestSchema, projectFactPolicy,
  type ProjectFacts, type TaskBinding, type ProjectCandidateAssessment } from './project-facts.js';

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/); const split = z.enum(['development', 'holdout']);
export const projectFactKinds = ['literal', 'cross_language', 'alternate_positive', 'low_overlap', 'unsupported_positive', 'missing_goal_positive',
  'single_fact_negative', 'ui_goal', 'missing_source', 'stale_source', 'enum_negative', 'docs_goal'] as const;
const factsSchema = z.object({ field_required: z.boolean(), field_nullable: z.boolean(),
  field_type: z.enum(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'union']) }).strict();
const corpusSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('author-synthetic-project-schema-facts'), note: z.string().max(1000),
  experiences: z.array(z.object({ id, split, artifact: id, revision: z.literal(1), targetProperty: projectFactRequestSchema.shape.property,
    allowedGoals: z.array(z.enum(projectFactPolicy.goals)).min(1).max(4), title: z.string().min(1).max(300), strategy: z.string().min(1).max(2000),
    contract: applicabilityContractSchema }).strict()).length(16),
  queries: z.array(z.object({ id, split, artifact: id, kind: z.enum(projectFactKinds), text: z.string().min(1).max(2000),
    targetProperty: projectFactRequestSchema.shape.property, goal: z.enum(projectFactPolicy.goals).nullable(),
    source: z.object({ path: projectSchemaPath, content: z.string().min(1).max(8192), available: z.boolean(), binding: z.enum(['current', 'stale']) }).strict(),
    manualFacts: factsSchema, relevantIds: z.array(id).max(1), rationale: z.string().min(1).max(1000), pairId: id.nullable() }).strict()).length(96),
}).strict();
export type ProjectFactCorpus = z.infer<typeof corpusSchema>;
export type ProjectFactQuery = ProjectFactCorpus['queries'][number];
export const frozenProjectFactCorpusDigest = '44b0990bbc0e168666640a7c6ecb72625233bf9d49f1750c8fcdcb09b4955454';
export function validateProjectFactCorpus(input: unknown): ProjectFactCorpus {
  const c = corpusSchema.parse(input);
  assert.equal(new Set(c.queries.map(q => q.id)).size, 96); assert.equal(new Set(c.experiences.map(e => e.id)).size, 16);
  assert.equal(new Set(c.queries.map(q => q.source.path)).size, 96);
  for (const artifact of new Set(c.queries.map(q => q.artifact))) {
    const queries = c.queries.filter(q => q.artifact === artifact); const bank = c.experiences.filter(e => e.artifact === artifact);
    assert.equal(queries.length, 12); assert.equal(bank.length, 2); assert.equal(new Set(queries.map(q => q.kind)).size, 12);
    assert.equal(new Set([...queries, ...bank].map(r => r.split)).size, 1); assert.equal(queries.filter(q => q.relevantIds.length).length, 6);
    assert.equal(new Set([...queries, ...bank].map(r => r.targetProperty)).size, 1);
    const literal = queries.find(q => q.kind === 'literal')!;
    for (const kind of ['single_fact_negative', 'ui_goal']) {
      const paired = queries.find(q => q.kind === kind)!; assert.equal(paired.text, literal.text); assert.equal(paired.pairId, literal.pairId);
      if (kind === 'single_fact_negative') {
        assert.equal(Object.keys(literal.manualFacts).filter(k => literal.manualFacts[k as keyof typeof literal.manualFacts] !== paired.manualFacts[k as keyof typeof paired.manualFacts]).length, 1);
        assert.equal(paired.goal, literal.goal);
      } else { assert.deepEqual(paired.manualFacts, literal.manualFacts); assert.equal(paired.source.content, literal.source.content); assert.notEqual(paired.goal, literal.goal); }
    }
  }
  for (const q of c.queries) {
    assert.equal(q.source.available, q.kind !== 'missing_source'); assert.equal(q.source.binding === 'stale', q.kind === 'stale_source');
    for (const relevant of q.relevantIds) assert(c.experiences.some(e => e.id === relevant && e.split === q.split && e.artifact === q.artifact));
  }
  for (const part of ['development', 'holdout']) { assert.equal(c.queries.filter(q => q.split === part).length, 48); assert.equal(c.queries.filter(q => q.split === part && q.relevantIds.length).length, 24); }
  const devProperties = new Set(c.queries.filter(q => q.split === 'development').map(q => q.targetProperty));
  assert(c.queries.filter(q => q.split === 'holdout').every(q => !devProperties.has(q.targetProperty)));
  return c;
}
export function parseProjectFactCorpus(bytes: Buffer): ProjectFactCorpus {
  assert.equal(digest(bytes), frozenProjectFactCorpusDigest, 'Frozen project-fact corpus changed'); return validateProjectFactCorpus(JSON.parse(bytes.toString('utf8')));
}
export const projectFactEvaluationPolicy = { version: 'schema-facts-five-arms-v1', retrieval: applicabilityPolicy, projection: projectFactPolicy,
  manualSourceGate: 'same-fresh-binding-and-bounded-json-as-automatic', targetPropertyInput: 'explicit-extra-input', goalInput: 'explicit-extra-input',
  manualReference: 'author-facts-independently-validated-before-scoring', localFactsSharedAcrossArms: true } as const;
export const projectFactEvaluationPolicyDigest = digest(JSON.stringify(projectFactEvaluationPolicy));
export const projectFactArms = ['dense_only', 'manual_facts', 'auto_facts', 'auto_facts_goal', 'manual_facts_goal'] as const;
export function projectQueryBinding(q: Pick<ProjectFactQuery, 'id' | 'split'>): TaskBinding { return { namespace: q.split + '/schemas', taskId: q.id, revision: 1 }; }
function manualReference(auto: ProjectFacts, facts: ProjectFactQuery['manualFacts']): ProjectFacts {
  // Only the fixed corpus/oracle supplies this extra information; never a production fallback.
  if (!auto.bindingVerified || !auto.source || auto.context.problems.includes('invalid_project_source_json')) return auto;
  return { ...auto, state: 'confirmed', observations: [], context: { problems: [],
    facts: new Map(Object.entries(facts).map(([name, value]) => [name, { values: [value], sources: [{ ...auto.source! }] }])) } };
}
export interface ProjectFactRow extends ApplicabilityRow {
  targetProperty: string; goalInput: string | null;
  projection: Pick<ProjectFacts, 'state' | 'bindingVerified' | 'source' | 'targetProperty' | 'observations'> & { problems: readonly string[] };
  factInput: 'none' | 'automatic' | 'author_reference_checked_by_independent_oracle';
  goalChecks: { id: string; goalCheck: ProjectCandidateAssessment['goalCheck'] }[];
}
export function evaluateProjectFacts(c: ProjectFactCorpus, partition: 'development' | 'holdout', vectors: EmbeddingPort,
  sourcePort: (q: ProjectFactQuery) => ContractSourcePort) {
  const bank = c.experiences.filter(e => e.split === partition); const rows = Object.fromEntries(projectFactArms.map(a => [a, [] as ProjectFactRow[]])) as Record<(typeof projectFactArms)[number], ProjectFactRow[]>;
  const extraction: { id: string; state: string; bindingVerified: boolean; problems: readonly string[]; checked: number; agreement: number }[] = [];
  const byField = Object.fromEntries(projectFactPolicy.fields.map(field => [field, { queries: 0, projected: 0, agree: 0 }]));
  for (const q of c.queries.filter(q => q.split === partition)) {
    const expected = projectQueryBinding(q); const request = { ...expected, path: q.source.path, property: q.targetProperty,
      sha256: q.source.binding === 'stale' ? '0'.repeat(64) : digest(q.source.content) };
    // The projection receives only operational source/target inputs, never labels, kind or manual facts.
    const auto = projectSchemaFacts(request, expected, sourcePort(q)); const manual = manualReference(auto, q.manualFacts);
    const ranked = rankHybrid({ id: q.id, text: q.text }, bank, partition, vectors, 0);
    for (const arm of projectFactArms) {
      const isManual = arm.startsWith('manual_'); const useGoal = arm.endsWith('_goal'); const context = isManual ? manual : auto;
      const goal = q.goal === null ? undefined : { ...expected, kind: q.goal };
      const assessments = arm === 'dense_only' ? [] : bank.map(e => ({ id: e.id, assessment: assessProjectCandidate({ targetProperty: e.targetProperty,
        allowedGoals: e.allowedGoals, contract: e.contract }, context, expected, goal, useGoal) }));
      const dense = hybridSelection(ranked, { lexicalWeight: 0, minimumScore: applicabilityPolicy.minimumScore, minimumMargin: applicabilityPolicy.minimumMargin });
      const decision = arm === 'dense_only' ? { ...dense, state: (dense.selected ? 'applicable' : 'insufficient_information') as ApplicabilityState } : selectWithContracts(ranked, assessments);
      const top = assessments.filter(a => ranked.slice(0, 3).some(r => r.id === a.id));
      rows[arm].push({ id: q.id, family: q.artifact, kind: q.kind, query: q.text, relevantIds: [...q.relevantIds], pairId: q.pairId,
        targetProperty: q.targetProperty, goalInput: useGoal ? q.goal : null, ...decision, ranked, assessments: top,
        factInput: arm === 'dense_only' ? 'none' : isManual ? 'author_reference_checked_by_independent_oracle' : 'automatic',
        projection: { state: auto.state, bindingVerified: auto.bindingVerified, source: auto.source, targetProperty: auto.targetProperty,
          observations: auto.observations, problems: auto.context.problems }, goalChecks: top.map(a => ({ id: a.id, goalCheck: a.assessment.goalCheck })) });
    }
    // Reference labels are used only after all five decisions, for measurement.
    extraction.push({ id: q.id, state: auto.state, bindingVerified: auto.bindingVerified, problems: auto.context.problems,
      checked: auto.observations.length, agreement: auto.observations.filter(o => o.value === q.manualFacts[o.field]).length });
    for (const field of projectFactPolicy.fields) {
      const count = byField[field]!; count.queries++; const observation = auto.observations.find(o => o.field === field);
      if (observation) { count.projected++; if (observation.value === q.manualFacts[field]) count.agree++; }
    }
  }
  const correctIds = (items: ProjectFactRow[]) => new Set(items.filter(r => r.selected && r.relevantIds.includes(r.selected)).map(r => r.id));
  const changes = (before: ProjectFactRow[], after: ProjectFactRow[]) => {
    const a = correctIds(before); const b = correctIds(after); const retained = [...a].filter(id => b.has(id));
    return { baselineCorrect: a.size, retained: retained.length, retention: a.size ? retained.length / a.size : null,
      lost: [...a].filter(id => !b.has(id)), gained: [...b].filter(id => !a.has(id)) };
  };
  const groups = Object.fromEntries(projectFactArms.map(arm => { const items = rows[arm]; return [arm, {
    ...applicabilityMetrics(items), vsDense: changes(rows.dense_only, items),
    byKind: Object.fromEntries(projectFactKinds.map(kind => [kind, applicabilityMetrics(items.filter(r => r.kind === kind))])),
    evidenceProbes: applicabilityMetrics(items.filter(r => ['missing_source', 'stale_source'].includes(r.kind))),
    semanticNegatives: applicabilityMetrics(items.filter(r => ['single_fact_negative', 'ui_goal', 'enum_negative', 'docs_goal'].includes(r.kind))),
    pairs: [...new Set(items.flatMap(r => r.pairId ? [r.pairId] : []))].map(pairId => {
      const related = items.filter(r => r.pairId === pairId); const literal = related.find(r => r.kind === 'literal')!;
      return { pairId, literalSelected: literal.selected, flips: Object.fromEntries(['single_fact_negative', 'ui_goal'].map(kind => {
        const negative = related.find(r => r.kind === kind)!; return [kind, { selected: negative.selected,
          resolved: literal.selected !== null && literal.relevantIds.includes(literal.selected) && negative.selected === null }]; })) };
    }), rows: items }]; }));
  return { schemaVersion: 1, split: partition, dataDigest: frozenProjectFactCorpusDigest, policy: projectFactEvaluationPolicy,
    policyDigest: projectFactEvaluationPolicyDigest, groups, contributions: { automaticVsManual: changes(rows.manual_facts, rows.auto_facts),
      explicitGoalVsAutomatic: changes(rows.auto_facts, rows.auto_facts_goal), automaticVsManualWithGoal: changes(rows.manual_facts_goal, rows.auto_facts_goal) },
    extraction: { queries: extraction.length, bound: extraction.filter(r => r.bindingVerified).length, supported: extraction.filter(r => r.state === 'confirmed').length,
      factsChecked: extraction.reduce((n, r) => n + r.checked, 0), factsAgree: extraction.reduce((n, r) => n + r.agreement, 0),
      byField, unknownReasons: Object.fromEntries([...new Set(extraction.flatMap(r => r.problems))].map(reason => [reason, extraction.filter(r => r.problems.includes(reason)).length])), rows: extraction },
    limitations: ['Author-visible synthetic schema/artifact holdout within a previously seen JSON presence/null domain, not external blind data.',
      'Target property and explicit goal are extra caller inputs; same-text controlled flips are not improved language understanding.',
      'Manual reference facts are independently validated extra information and share source integrity gates; unsupported auto facts remain unknown.',
      'Schema declarations do not establish program behavior, live source qualification, automatic goal extraction or downstream Agent benefit.',
      'One projection is shared across arms; no service latency claim. Default DSH, private data, grants and ledgers are untouched; paid API calls0.'] };
}
