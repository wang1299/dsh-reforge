import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digest } from '../src/domain.js';
import { assessApplicability, readContractFacts, selectContractsOnly, selectWithContracts,
  type ApplicabilityAssessment, type ApplicabilityState, type ContractSourcePort } from '../src/applicability.js';
import { parseApplicabilityCorpus, validateApplicabilityCorpus } from '../src/applicability-evaluation.js';
const expected = { namespace: 'toy/contracts', taskId: 'q', revision: 1 };
const contract = { schemaVersion: 1, requires: [{ field: 'mode', oneOf: ['read'] }], excludes: [{ field: 'disabled', oneOf: [true] }] };
function fixture(text = JSON.stringify({ schemaVersion: 1, facts: { mode: 'read', disabled: false } })) {
  const ref = { ...expected, path: 'contracts/q.json', sha256: digest(text) };
  const source = { ...expected, path: ref.path, bytes: Buffer.from(text) };
  const port: ContractSourcePort = { read: () => source };
  return { ref, source, port, read: () => readContractFacts([ref], expected, port) };
}
test('verified requires/excludes yield three states and bounded source references', () => {
  const good = fixture(); const result = assessApplicability(contract, good.read());
  assert.equal(result.state, 'applicable'); assert.equal(result.checks.length, 2);
  assert.equal(result.checks[0]!.sources[0]!.sha256, good.ref.sha256);
  assert.equal(assessApplicability(contract, fixture('{"schemaVersion":1,"facts":{"mode":"write","disabled":false}}').read()).state, 'not_applicable');
  assert.equal(assessApplicability(contract, fixture('{"schemaVersion":1,"facts":{"mode":"read","disabled":true}}').read()).state, 'not_applicable');
  assert.equal(assessApplicability(contract, fixture('{"schemaVersion":1,"facts":{"mode":"read"}}').read()).state, 'insufficient_information');
  assert.equal(assessApplicability(undefined, good.read()).state, 'insufficient_information');
  assert.equal(assessApplicability({ schemaVersion: 1, requires: [], excludes: [] }, good.read()).state, 'insufficient_information');
});
test('identity/revision/hash changes and unavailable sources cannot supply trusted facts', () => {
  for (const patch of [{ namespace: 'other/contracts' }, { taskId: 'other' }, { revision: 2 }, { path: 'contracts/other.json' }, { bytes: Buffer.from('{}') }]) {
    const f = fixture(); Object.assign(f.source, patch);
    assert.equal(assessApplicability(contract, f.read()).state, 'insufficient_information');
  }
  const f = fixture();
  assert(readContractFacts([{ ...f.ref, revision: 2 }], expected, f.port).problems.length);
  assert(readContractFacts([f.ref], expected, { read() { throw new Error('sensitive transport details'); } }).problems.includes('source_unavailable'));
  assert(readContractFacts([f.ref], expected, { read: () => null }).problems.length);
  f.source.bytes = Buffer.from('{"schemaVersion":1,"facts":{"mode":"write"}}');
  assert.equal(assessApplicability(contract, f.read()).state, 'insufficient_information'); // fresh read, not cached old facts
});
test('duplicate/escaped keys, wrong scalar types, secret fields and oversized JSON fail closed', () => {
  for (const text of ['{"schemaVersion":1,"facts":{"mode":"write","mode":"read"}}',
    '{"schemaVersion":1,"facts":{"mode":"write","\\u006dode":"read"}}',
    '{"schemaVersion":1,"facts":{"mode":{"nested":"read"}}}', '{"schemaVersion":1,"facts":{"api_key":"credential"}}',
    '{"schemaVersion":1,"facts":{"constructor":"read"}}', ' '.repeat(8193)]) {
    assert.equal(assessApplicability(contract, fixture(text).read()).state, 'insufficient_information');
  }
  assert.equal(assessApplicability(contract, fixture('{"schemaVersion":1,"facts":{"mode":true,"disabled":false}}').read()).state, 'not_applicable');
});
test('agreeing sources retain provenance; conflicting observations remain unknown; stale bundle is invalid', () => {
  const a = fixture(); const b = fixture('{"schemaVersion":1,"facts":{"mode":"write","disabled":false}}');
  const ref = { ...b.ref, path: 'contracts/second.json' }; const source = { ...b.source, path: ref.path };
  const port: ContractSourcePort = { read: r => r.path === a.ref.path ? a.source : source };
  const result = assessApplicability(contract, readContractFacts([a.ref, ref], expected, port));
  assert.equal(result.state, 'insufficient_information'); assert.equal(result.checks[0]!.result, 'conflicting');
  source.bytes = a.source.bytes; ref.sha256 = a.ref.sha256;
  assert.equal(assessApplicability(contract, readContractFacts([a.ref, ref], expected, port)).state, 'applicable');
  ref.sha256 = '0'.repeat(64);
  assert.equal(assessApplicability(contract, readContractFacts([a.ref, ref], expected, port)).state, 'insufficient_information');
  assert(readContractFacts([a.ref, a.ref], expected, port).problems.length);
});
const assessment = (state: ApplicabilityState): ApplicabilityAssessment => ({ state, reason: 'toy', contractDigest: null, checks: [] });
const candidate = (id: string, state: ApplicabilityState) => ({ id, assessment: assessment(state) });
const ranks = [0.8, 0.7, 0.6, 0.59].map((score, i) => ({ id: String(i), score, lexical: 0, dense: score }));
test('pure contracts isolate one confirmed match without claiming unknown alternatives are false', () => {
  assert.equal(selectContractsOnly([candidate('0', 'applicable'), candidate('1', 'insufficient_information')]).selected, '0');
  assert.equal(selectContractsOnly([candidate('0', 'applicable'), candidate('1', 'applicable')]).selected, null);
  assert.equal(selectContractsOnly([candidate('0', 'not_applicable')]).state, 'not_applicable');
  assert.equal(selectContractsOnly([]).selected, null);
});
test('top3 gate blocks higher unknowns, skips known contradictions, retains original competitors and never searches rank4', () => {
  assert.equal(selectWithContracts(ranks, [candidate('0', 'insufficient_information'), candidate('1', 'applicable')]).reason, 'higher_ranked_unknown');
  assert.equal(selectWithContracts(ranks, [candidate('0', 'not_applicable'), candidate('1', 'applicable')]).selected, '1');
  assert.equal(selectWithContracts(ranks, [candidate('0', 'not_applicable'), candidate('1', 'not_applicable'), candidate('2', 'applicable')]).reason, 'ambiguous_original_margin');
  assert.equal(selectWithContracts(ranks, ['0', '1', '2'].map(id => candidate(id, 'not_applicable')).concat(candidate('3', 'applicable'))).selected, null);
  assert.equal(selectWithContracts([{ ...ranks[0]!, score: 0 }], [candidate('0', 'applicable')]).reason, 'low_score');
  assert.equal(selectWithContracts([], []).reason, 'empty_bank');
  assert.equal(selectWithContracts([{ ...ranks[0]!, score: NaN }], [candidate('0', 'applicable')]).reason, 'invalid_ranking');
  assert.equal(selectWithContracts([ranks[1]!, ranks[0]!], [candidate('1', 'applicable')]).selected, null);
});
test('frozen data has disjoint families, verified source references and paired one-fact changes', async () => {
  const corpus = parseApplicabilityCorpus(await readFile('test/fixtures/applicability-v1-cases.json'));
  const changed = structuredClone(corpus); changed.queries[0]!.split = 'holdout';
  assert.throws(() => validateApplicabilityCorpus(changed));
  const cross = structuredClone(corpus); cross.queries[0]!.sourceRefs[0]!.taskId = 'another';
  assert.throws(() => validateApplicabilityCorpus(cross));
});
