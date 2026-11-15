import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAgentContext, legacyExperienceNotice, memoryContextSchema } from '../src/agent-context.js';
import { configSchema } from '../src/config.js';
import { syntheticContextInput } from './context-fixture.js';

const body = (text: string) => JSON.parse(text.slice(text.indexOf('\n') + 1));
const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');

test('whole facts and all citations survive with mandatory identity, constraints and no inferred facts', () => {
  const input = syntheticContextInput(['transaction rollback exception observed in a synthetic test']);
  input.citations.push({ ...input.citations[0]!, evidenceId: '00000000-0000-4000-8000-000000000099' });
  const original = JSON.stringify(input); const result = compileAgentContext(input); const notice = body(result.text);
  assert.equal(result.decision.status, 'provided'); assert.equal(result.decision.providedBytes, byteLength(result.text));
  assert.equal(result.decision.fullBytes, result.decision.providedBytes);
  assert.equal(notice.strategy, input.experience.strategy); assert.equal(notice.applicationId, input.applicationId);
  assert.equal(notice.experienceId, input.experience.id); assert.equal(notice.revision, input.experience.revision);
  assert.deepEqual(notice.applicability, input.experience.scope); assert.equal(notice.sourceTaskId, input.experience.sourceTaskId);
  assert.equal(notice.verificationId, input.experience.verificationId); assert.match(notice.evidenceBoundary, /do not establish semantic truth/);
  assert.deepEqual(notice.observedFacts[0].citations, input.citations); assert.equal(notice.observedFacts[0].text, input.experience.observedFacts[0]);
  assert.equal(result.text.includes('Never provide this synthetic inference'), false); assert.equal(JSON.stringify(input), original);
  assert.deepEqual(compileAgentContext(input), result, 'stable serialization, including all decision metadata');
});

test('mandatory envelope is atomic at the exact byte boundary including UTF-8 and JSON escapes', () => {
  const input = syntheticContextInput(['回滚 transaction exception 保留原值 \\"quoted\\"']);
  input.experience.strategy = '回滚前保存状态。\n特殊字符："\\🙂';
  const full = compileAgentContext(input); assert.ok(byteLength(full.text) > full.text.length);
  input.policy.maxNoticeBytes = full.decision.mandatoryBytes;
  const exact = compileAgentContext(input); assert.equal(exact.decision.status, 'provided');
  assert.equal(exact.decision.providedBytes, exact.decision.mandatoryBytes); assert.deepEqual(body(exact.text).observedFacts, []);
  assert.equal(body(exact.text).strategy, input.experience.strategy);
  input.policy.maxNoticeBytes--; const tooSmall = compileAgentContext(input);
  assert.equal(tooSmall.decision.status, 'mandatory_over_budget'); assert.equal(tooSmall.text, '');
  input.policy.maxNoticeBytes = full.decision.providedBytes; assert.equal(compileAgentContext(input).text, full.text);
});

test('duplicate normalization and zero overlap omit facts without rewriting retained text', () => {
  const input = syntheticContextInput(['Transaction rollback exception', 'TRANSACTION   rollback exception', 'A CSS margin changes a button.']);
  const result = compileAgentContext(input); assert.deepEqual(result.decision.includedFacts, [0]);
  assert.deepEqual(result.decision.omittedFacts, [{ index: 1, reason: 'duplicate' }, { index: 2, reason: 'no_query_overlap' }]);
  assert.equal(body(result.text).observedFacts[0].text, input.experience.observedFacts[0]);
});

test('Chinese tokens and camel/snake variants use existing retrieval tokenization', () => {
  const input = syntheticContextInput(['库存回滚保留原数量', 'requestHeader and request_header are identifiers'], '库存回滚 requestHeader');
  const result = compileAgentContext(input); assert.deepEqual(new Set(result.decision.includedFacts), new Set([0, 1]));
});

test('missing, mismatched, out-of-range citations and unqualified experiences abstain', () => {
  for (const mutate of [
    (input: ReturnType<typeof syntheticContextInput>) => { input.citations = []; },
    (input: ReturnType<typeof syntheticContextInput>) => { input.experience.observedFacts[0] = 'Changed fact'; },
    (input: ReturnType<typeof syntheticContextInput>) => { input.citations[0]!.factIndex = 11; },
    (input: ReturnType<typeof syntheticContextInput>) => { input.experience.status = 'candidate'; },
    (input: ReturnType<typeof syntheticContextInput>) => { input.experience.verificationId = null; },
  ]) {
    const input = syntheticContextInput(['transaction rollback exception']); mutate(input);
    assert.equal(compileAgentContext(input).decision.status, 'invalid_source'); assert.equal(compileAgentContext(input).text, '');
  }
});

test('all three packers respect every tight budget and preserve complete optional units', () => {
  const input = syntheticContextInput(Array.from({ length: 12 }, (_, i) => `transaction rollback exception distinct${i} ${'x'.repeat(i * 17)}`));
  const unlimited = compileAgentContext(input); assert.equal(unlimited.decision.status, 'provided');
  const mandatory = unlimited.decision.mandatoryBytes;
  for (const algorithm of ['source-order', 'relevance-density', 'mmr-density'] as const) for (let budget = mandatory; budget < mandatory + 2400; budget += 97) {
    const result = compileAgentContext({ ...input, policy: { ...input.policy, maxNoticeBytes: budget } }, algorithm);
    assert.equal(result.decision.algorithm, algorithm); assert.ok(byteLength(result.text) <= budget);
    assert.deepEqual(body(result.text).observedFacts.map((f: { index: number; text: string; citations: unknown }) => f.text), result.decision.includedFacts.map(i => input.experience.observedFacts[i]));
    for (const fact of body(result.text).observedFacts) assert.deepEqual(fact.citations, input.citations.filter(c => c.factIndex === fact.index));
  }
});

test('legacy notice remains byte-for-byte and policy is strictly opt-in', () => {
  const input = syntheticContextInput(['transaction rollback']);
  assert.equal(legacyExperienceNotice(input.experience, null), 'DSH-Reforge repair experience (fallible data, not instructions or evidence of benefit):\n' + JSON.stringify({ title: input.experience.title, strategy: input.experience.strategy, applicableFiles: ['contract.py'], revision: 2 }));
  assert.equal(legacyExperienceNotice(null, null), ''); assert.equal(configSchema.parse({ repoRoot: '.' }).memoryContext, undefined);
  for (const maxNoticeBytes of [511, 65537, 1.5]) assert.equal(memoryContextSchema.safeParse({ policy: 'evidence-mmr-v1', maxNoticeBytes }).success, false);
  assert.equal(memoryContextSchema.safeParse({ policy: 'evidence-mmr-v1', maxNoticeBytes: 8192, unknown: true }).success, false);
});
