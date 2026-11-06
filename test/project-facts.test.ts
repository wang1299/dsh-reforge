import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { projectSchemaFacts, projectFilePort, assessProjectCandidate } from '../src/project-facts.js';
import { schemaFactOracle } from '../scripts/project-facts-oracle.js';

const binding = { namespace: 'project/test', taskId: 'task', revision: 1 };
const candidate = { targetProperty: 'alias', allowedGoals: ['validate_payload'],
  contract: { schemaVersion: 1, requires: [{ field: 'field_required', oneOf: [false] }, { field: 'field_nullable', oneOf: [true] }], excludes: [] } };
const schema = (type: string | string[] = ['string', 'null'], required?: string[]) => ({ $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object', properties: { alias: { type, default: 'DO_NOT_DISCLOSE_ANNOTATIONS' }, version: { type: 'integer', default: 0 } },
  ...(required === undefined ? {} : { required }), additionalProperties: false });
function fixture(content = JSON.stringify(schema()), property = 'alias') {
  const bytes = Buffer.from(content); const request = { ...binding, path: 'schemas/input.schema.json', sha256: digest(bytes), property };
  const source = { ...binding, path: request.path, bytes }; const port = { read: () => source };
  return { request, source, port, read: () => projectSchemaFacts(request, binding, port) };
}

test('supported declarations agree with independent full-schema omission/null validation and bounded provenance', () => {
  for (const type of ['string', 'number', 'integer', 'boolean', 'object', 'array', ['string', 'integer'], ['number', 'integer'], 'null']) {
    for (const required of [undefined, ['version'], ['version', 'alias']]) {
      for (const nullable of [false, true]) {
        const base = Array.isArray(type) ? type : [type]; const declaration = [...new Set([...base, ...(nullable ? ['null'] : [])])];
        const content = JSON.stringify(schema(declaration.length === 1 ? declaration[0] : declaration, required));
        const result = fixture(content).read(); assert.equal(result.state, 'confirmed');
        assert.deepEqual(Object.fromEntries(result.observations.map(o => [o.field, o.value])), schemaFactOracle(content, 'alias'));
        assert.equal(result.observations[0]!.pointer, required ? '/required' : '');
        assert(result.observations.slice(1).every(o => o.pointer === '/properties/alias/type'));
        assert(!JSON.stringify(result).includes('DO_NOT_DISCLOSE_ANNOTATIONS'));
        assert.equal(result.observations.length, 3); assert.equal(result.context.facts.size, 3);
      }
    }
  }
});

test('unsupported constraints, dialects and secret/prototype names never silently supply partial facts', () => {
  for (const keyword of ['$ref', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'dependencies', 'patternProperties', 'minProperties', 'unevaluatedProperties']) {
    const document = { ...schema(), [keyword]: keyword === '$ref' ? 'https://example.invalid/never-fetch' : [] };
    const result = fixture(JSON.stringify(document)).read(); assert.equal(result.state, 'unknown'); assert.equal(result.context.facts.size, 0);
  }
  for (const extra of [{ enum: ['sample'] }, { const: null }, { minimum: 0 }, { minLength: 1 }, { properties: {} }, { format: 'email' }]) {
    const document = schema(); Object.assign(document.properties.alias, extra);
    assert.equal(fixture(JSON.stringify(document)).read().state, 'unknown');
  }
  for (const document of [{ ...schema(), $schema: 'https://json-schema.org/draft/2020-12/schema' },
    { ...schema(), required: ['absent'] }, { ...schema(), required: ['alias', 'alias'] },
    { ...schema(), properties: JSON.parse('{"constructor":{"type":"string"}}') },
    { ...schema(), properties: { api_key: { type: 'string' } } }]) assert.equal(fixture(JSON.stringify(document)).read().state, 'unknown');
  assert.equal(fixture(JSON.stringify(schema()), 'missing').read().context.problems[0], 'target_property_not_declared');
  for (const name of ['toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(fixture(JSON.stringify(schema()), name).read().context.problems[0], 'target_property_not_declared');
    const explicit = { ...schema(), properties: { [name]: { type: 'string' } } };
    assert.equal(fixture(JSON.stringify(explicit), name).read().state, 'confirmed');
  }
});

test('identity, revision, digest, JSON grammar and byte bounds are fresh and fail closed', () => {
  const f = fixture(); assert.equal(f.read().state, 'confirmed');
  for (const key of ['namespace', 'taskId', 'path'] as const) { const previous = f.source[key]; f.source[key] = 'other'; assert.equal(f.read().state, 'unknown'); f.source[key] = previous; }
  f.source.revision = 2; assert.equal(f.read().state, 'unknown'); f.source.revision = 1;
  f.source.bytes = Buffer.from('{}'); assert.equal(f.read().context.facts.size, 0);
  for (const text of ['{"type":"object","type":"array"}', '{"type":"object","\\u0074ype":"array"}', '{', ' '.repeat(8193)]) assert.equal(fixture(text).read().state, 'unknown');
  const invalid = fixture(); invalid.source.bytes = Buffer.from([0xc3, 0x28]); invalid.request.sha256 = digest(invalid.source.bytes); assert.equal(invalid.read().state, 'unknown');
  assert.equal(projectSchemaFacts(f.request, { ...binding, revision: 2 }, f.port).context.problems[0], 'source_binding_mismatch');
});

const root = fileURLToPath(new URL('../../.probe-work/t059-tests/', import.meta.url));
function filesystemFixture() {
  mkdirSync(root, { recursive: true }); const directory = mkdtempSync(join(root, 'schema-')); mkdirSync(join(directory, 'schemas'));
  const f = fixture(); writeFileSync(join(directory, f.request.path), f.source.bytes);
  return { ...f, directory, file: join(directory, f.request.path), adapter: projectFilePort(directory, binding) };
}
test('real file adapter reads only named bounded regular schemas, observes changes and never writes source', () => {
  const f = filesystemFixture(); const before = readFileSync(f.file); const read = () => projectSchemaFacts(f.request, binding, f.adapter);
  assert.equal(read().state, 'confirmed'); assert.deepEqual(readFileSync(f.file), before);
  writeFileSync(f.file, JSON.stringify(schema('string', ['alias']))); assert.equal(read().state, 'unknown');
  f.request.sha256 = digest(readFileSync(f.file)); assert.equal(read().observations[1]!.value, false);
  for (const path of ['../outside.schema.json', '/outside.schema.json', 'C:/outside.schema.json', '.probe-work/private.schema.json',
    '.git/config.schema.json', 'schemas/credentials.schema.json', 'schemas/input.json', 'node_modules/input.schema.json']) assert.equal(f.adapter.read({ ...f.request, path }), null);
  writeFileSync(f.file, 'x'.repeat(8193)); assert.equal(read().state, 'unknown');
});
test('file adapter refuses multi-hardlinks and symlinks/junctions instead of following their targets', t => {
  const f = filesystemFixture(); linkSync(f.file, join(f.directory, 'schemas/hard.schema.json'));
  assert.equal(f.adapter.read(f.request), null);
  const g = filesystemFixture(); const link = join(g.directory, 'linked');
  try { symlinkSync(join(g.directory, 'schemas'), link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Windows user lacks link privilege'); return; } throw error; }
  assert.equal(g.adapter.read({ ...g.request, path: 'linked/input.schema.json' }), null);
});

test('explicit goal checks are separately bound and do not invent intent or authenticate a caller', () => {
  const facts = fixture().read(); const goal = { ...binding, kind: 'validate_payload' };
  assert.equal(assessProjectCandidate(candidate, facts, binding, undefined, false).state, 'applicable');
  assert.equal(assessProjectCandidate(candidate, facts, binding, goal, true).goalCheck.state, 'confirmed');
  for (const input of [undefined, { ...goal, taskId: 'other' }, { ...goal, revision: 2 }, { ...goal, kind: 'model_says_success' }]) {
    const result = assessProjectCandidate(candidate, facts, binding, input, true); assert.equal(result.state, 'insufficient_information'); assert.equal(result.goalCheck.state, 'unknown');
  }
  assert.equal(assessProjectCandidate(candidate, facts, binding, { ...goal, kind: 'present_ui' }, true).reason, 'explicit_goal_mismatch');
  assert.equal(assessProjectCandidate({ ...candidate, targetProperty: 'other' }, facts, binding, goal, true).reason, 'target_property_mismatch');
  assert.equal(assessProjectCandidate({ ...candidate, allowedGoals: [] }, facts, binding, goal, true).state, 'insufficient_information');
  for (const expected of [{ ...binding, taskId: 'other' }, { ...binding, namespace: 'other/project' }, { ...binding, revision: 2 }]) {
    for (const useGoal of [false, true]) {
      const result = assessProjectCandidate(candidate, facts, expected, { ...expected, kind: 'validate_payload' }, useGoal);
      assert.equal(result.state, 'insufficient_information'); assert.equal(result.reason, 'project_fact_binding_mismatch'); assert.deepEqual(result.checks, []);
    }
  }
});

test('all preregistered manual reference facts match independent schema behavior before method scoring', () => {
  const corpus = JSON.parse(readFileSync(fileURLToPath(new URL('../../test/fixtures/project-facts-v1-cases.json', import.meta.url)), 'utf8')) as {
    queries: { id: string; targetProperty: string; source: { content: string }; manualFacts: Record<string, unknown> }[] };
  assert.equal(corpus.queries.length, 96);
  for (const q of corpus.queries) assert.deepEqual(schemaFactOracle(q.source.content, q.targetProperty), q.manualFacts, q.id);
});
