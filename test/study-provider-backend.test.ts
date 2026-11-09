import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { StudyAuthority, type StudyPlanLocator } from '../scripts/study-authority.js';
import { StudyCostLedger, studyCostPolicy } from '../scripts/study-cost-ledger.js';
import { createStudyProviderBackend, studyProviderEndpoint } from '../scripts/study-provider-backend.js';
import { guardedStudyWireCall, studyWireRequest } from '../scripts/study-call-guard.js';
import { sdkFixtureStream } from '../scripts/study-offline-sdk.js';
import { studyCases } from '../scripts/benefit-study-cases.js';

const parent = fileURLToPath(new URL('../../.probe-work/t065-provider-tests', import.meta.url));
const key = 'synthetic-provider-key-not-real';
const wire = studyWireRequest({ model: 'deepseek-flash', stream: true, temperature: 0, max_tokens: 2048,
  thinking: { type: 'disabled' }, system: 'synthetic', messages: [{ role: 'user', content: 'synthetic task' }] });
async function fixture() {
  const authority = StudyAuthority.fixture(await newStudyRoot(parent)); await authority.initialize();
  const root = await newStudyRoot(join(authority.root, 'preparations')); const binding = { studyId: randomUUID(), planDigest: digest('synthetic fixture plan') };
  const locator: StudyPlanLocator = { schema: 1, scope: 'fixture', authorityRoot: authority.root, root, binding, expiresAt: new Date(Date.now() + 60000).toISOString() };
  StudyCostLedger.create(root, binding).close(); await authority.register(locator); await authority.approve(locator, 10_000_000, true, async () => {});
  return { ...await authority.openApproved(locator, async () => {}), binding };
}
test('provider backend requires a committed reservation and forwards only exact approved wire to its fixed endpoint', async () => {
  const f = await fixture(); let sends = 0;
  const backend = createStudyProviderBackend({ ...f, scope: 'fixture', key, fetch: async (url, init) => {
    sends++; assert.equal(String(url), studyProviderEndpoint); assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'POST'); assert.equal(init?.body, wire);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + key); assert.equal(f.ledger.state.calls[0]!.usage, null);
    return new Response(sdkFixtureStream(studyCases[0]!, 'first_pass', 1), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    await assert.rejects(backend.transport.respond(wire, new AbortController().signal)); assert.equal(sends, 0);
    const result = await guardedStudyWireCall({ ledger: f.ledger, binding: f.binding, identity: { trialIndex: 0, round: 1, inputDigest: digest(wire) }, wire,
      transport: backend.transport, requireAuthorization: backend.authorize, checkFrozen: async () => ({ planDigest: f.binding.planDigest }) });
    assert.equal(result.kind, 'provider-fixture'); assert.equal(sends, 1); assert.equal(f.ledger.summary.settledUpperBound, 460);
    assert.equal(backend.snapshot().providerHttpRequests, 0); assert.equal(backend.snapshot().fixtureHttpRequests, 1);
    assert(!JSON.stringify(f.ledger.state).includes(key)); assert(!JSON.stringify(backend.snapshot()).includes(key));
  } finally { f.ledger.close(); }
});
test('one lease cannot replay a reserved request through another backend instance', async () => {
  const f = await fixture(); let sends = 0;
  const options = { ...f, scope: 'fixture' as const, key, fetch: async () => { sends++; return new Response(sdkFixtureStream(studyCases[0]!, 'first_pass', 1), { headers: { 'content-type': 'text/event-stream' } }); } };
  try {
    f.ledger.reserve(f.binding, { trialIndex: 0, round: 1, inputDigest: digest(wire) });
    await createStudyProviderBackend(options).transport.respond(wire, new AbortController().signal);
    await assert.rejects(createStudyProviderBackend(options).transport.respond(wire, new AbortController().signal)); assert.equal(sends, 1);
  } finally { f.ledger.close(); }
});
test('cancelled or Key-bearing provider bodies never settle or enter SDK output', async () => {
  for (const mode of ['cancelled', 'echo-key', 'oversize'] as const) {
    const f = await fixture(); let sends = 0;
    const backend = createStudyProviderBackend({ ...f, scope: 'fixture', key, fetch: async () => {
      sends++; const body = mode === 'cancelled' ? new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
        : mode === 'echo-key' ? sdkFixtureStream(studyCases[0]!, 'first_pass', 1).replace('msg_synthetic', key) : 'x'.repeat(studyCostPolicy.maxResponseBytes + 1);
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
      await assert.rejects(guardedStudyWireCall({ ledger: f.ledger, binding: f.binding, identity: { trialIndex: 0, round: 1, inputDigest: digest(wire) }, wire,
        transport: backend.transport, requireAuthorization: backend.authorize, checkFrozen: async () => ({ planDigest: f.binding.planDigest }), deadlineMs: 50 }));
      assert.equal(sends, 1); assert.equal(f.ledger.summary.phase, 'unknown'); assert.equal(f.ledger.summary.unknownReserved, studyCostPolicy.reservation);
      assert.equal(f.ledger.summary.settledUpperBound, 0); assert(!JSON.stringify(f.ledger.state).includes(key));
    } finally { f.ledger.close(); }
  }
});
test('a fixture lease cannot use the live network or omit its approval callback', async () => {
  const f = await fixture();
  try {
    const backend = createStudyProviderBackend({ ...f, scope: 'live', key });
    await assert.rejects(backend.transport.respond(wire, new AbortController().signal));
    await assert.rejects(guardedStudyWireCall({ ledger: f.ledger, binding: f.binding, identity: { trialIndex: 0, round: 1, inputDigest: digest(wire) }, wire,
      transport: backend.transport, checkFrozen: async () => ({ planDigest: f.binding.planDigest }) }));
    assert.equal(backend.snapshot().networkAttempts, 0); assert.equal(f.ledger.summary.calls, 0);
  } finally { f.ledger.close(); }
});

test('split and Unicode-escaped Keys, including nested proposal JSON, are rejected before SDK delivery', async () => {
  const sample = sdkFixtureStream(studyCases[0]!, 'first_pass', 1);
  const data = (text: string) => 'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) + '\n\n';
  const replaceText = (replacement: string) => sample.replace(/data: \{"type":"content_block_delta"[^\n]+\n\n/, replacement);
  const encoded = [...key].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const cases = [replaceText(data(key.slice(0, 12)) + data(key.slice(12))),
    replaceText(data(key).replace(key, encoded)),
    replaceText(data('{"code":"' + encoded + '"}'))];
  for (const body of cases) {
    assert(!body.includes(key)); const f = await fixture();
    const backend = createStudyProviderBackend({ ...f, scope: 'fixture', key,
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) });
    try {
      await assert.rejects(guardedStudyWireCall({ ledger: f.ledger, binding: f.binding, identity: { trialIndex: 0, round: 1, inputDigest: digest(wire) }, wire,
        transport: backend.transport, requireAuthorization: backend.authorize, checkFrozen: async () => ({ planDigest: f.binding.planDigest }) }));
      assert.equal(f.ledger.summary.phase, 'unknown'); assert.equal(f.ledger.summary.unknownReserved, studyCostPolicy.reservation);
      assert.equal(backend.snapshot().completedBodies, 0); assert(!JSON.stringify(f.ledger.state).includes(key));
    } finally { f.ledger.close(); }
  }
});
