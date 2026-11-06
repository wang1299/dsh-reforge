import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateProjectFacts, parseProjectFactCorpus, projectQueryBinding, type ProjectFactCorpus } from '../src/project-facts-evaluation.js';
import { projectFilePort } from '../src/project-facts.js';

test('frozen artifact holdout is separated and retains missing-goal positives and both controlled flips', () => {
  const c = parseProjectFactCorpus(readFileSync(fileURLToPath(new URL('../../test/fixtures/project-facts-v1-cases.json', import.meta.url))));
  assert.equal(c.queries.filter(q => q.kind === 'missing_goal_positive' && q.relevantIds.length && q.goal === null).length, 8);
  for (const pairId of new Set(c.queries.flatMap(q => q.pairId ? [q.pairId] : []))) assert.equal(c.queries.filter(q => q.pairId === pairId).length, 3);
});

function toy() {
  const content = JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { alias: { type: ['string', 'null'] } } });
  const prototype = { id: 'toy', split: 'development' as const, artifact: 'toy-artifact', kind: 'literal' as const, text: 'Toy payload repair.', targetProperty: 'alias',
    goal: 'validate_payload' as const, source: { path: 'schemas/toy.schema.json', content, available: true, binding: 'current' as const },
    manualFacts: { field_required: false, field_nullable: true, field_type: 'string' as const }, relevantIds: ['toy-reminder'], rationale: 'Toy only, not quality evaluation.', pairId: null };
  const c: ProjectFactCorpus = { schemaVersion: 1, kind: 'author-synthetic-project-schema-facts', note: 'Small unit fixture; not the preregistered evaluation.',
    experiences: [{ id: 'toy-reminder', split: 'development', artifact: 'toy-artifact', revision: 1, targetProperty: 'alias', allowedGoals: ['validate_payload'], title: 'Toy', strategy: 'Toy',
      contract: { schemaVersion: 1, requires: [{ field: 'field_nullable', oneOf: [true] }], excludes: [] } }],
    queries: [prototype,
      { ...prototype, id: 'toy-unsupported', kind: 'unsupported_positive', source: { ...prototype.source, path: 'schemas/unsupported.schema.json', content: content.slice(0, -1) + ',"allOf":[{}]}' } },
      { ...prototype, id: 'toy-ui', kind: 'ui_goal', goal: 'present_ui', relevantIds: [], pairId: null },
      { ...prototype, id: 'toy-no-goal', kind: 'missing_goal_positive', goal: null },
      { ...prototype, id: 'toy-missing', kind: 'missing_source', source: { ...prototype.source, path: 'schemas/missing.schema.json', available: false }, relevantIds: [] },
      { ...prototype, id: 'toy-stale', kind: 'stale_source', source: { ...prototype.source, binding: 'stale' }, relevantIds: [] }] };
  const parent = fileURLToPath(new URL('../../.probe-work/t059-tests/', import.meta.url)); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, 'evaluation-'));
  for (const q of c.queries) { q.source.path = 'schemas/' + q.id + '.schema.json'; if (q.source.available) { const file = join(root, q.source.path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, q.source.content); } }
  return { c, port: (q: ProjectFactCorpus['queries'][number]) => projectFilePort(root, projectQueryBinding(q)),
    vectors: { embed: (input: { namespace: string }) => input.namespace.endsWith('/document') ? [1, 0] : [0.8, 0.6] } };
}
test('toy five-arm comparison isolates unsupported facts, explicit goals and the shared source-integrity gate', () => {
  const f = toy(); const report = evaluateProjectFacts(f.c, 'development', f.vectors, f.port);
  const picks = (arm: keyof typeof report.groups) => report.groups[arm]!.rows.map(r => [r.id, r.selected]);
  assert.deepEqual(picks('auto_facts_goal'), [['toy', 'toy-reminder'], ['toy-unsupported', null], ['toy-ui', null], ['toy-no-goal', null], ['toy-missing', null], ['toy-stale', null]]);
  assert.equal(report.groups.manual_facts!.rows.find(r => r.id === 'toy-unsupported')!.selected, 'toy-reminder');
  assert.equal(report.groups.auto_facts!.rows.find(r => r.id === 'toy-ui')!.selected, 'toy-reminder');
  assert.equal(report.groups.manual_facts_goal!.rows.find(r => r.id === 'toy-ui')!.selected, null);
  for (const arm of ['manual_facts', 'auto_facts', 'auto_facts_goal', 'manual_facts_goal']) assert(report.groups[arm]!.rows.filter(r => ['toy-missing', 'toy-stale'].includes(r.id)).every(r => r.selected === null));
  assert.deepEqual(report.contributions.explicitGoalVsAutomatic.lost, ['toy-no-goal']);
  assert.equal(report.extraction.factsAgree, report.extraction.factsChecked);
});
test('toy labels and rationale affect measurements only, never rankings or decisions', () => {
  const f = toy(); const before = evaluateProjectFacts(f.c, 'development', f.vectors, f.port);
  const changed = structuredClone(f.c); for (const q of changed.queries) { q.relevantIds = []; q.rationale = 'Different answer labels.'; }
  const after = evaluateProjectFacts(changed, 'development', f.vectors, f.port);
  for (const arm of Object.keys(before.groups)) assert.deepEqual(after.groups[arm]!.rows.map(r => [r.selected, r.reason, r.ranked, r.assessments]), before.groups[arm]!.rows.map(r => [r.selected, r.reason, r.ranked, r.assessments]));
});
