/** The only paid endpoint. Key remains inside this closure and never enters SDK messages or child environment. */
import assert from 'node:assert/strict';
import { digest } from '../src/domain.js';
import { requireStudyLease, type StudyAuthorizationLease } from './study-authority.js';
import { studyCostPolicy, type StudyCostBinding, type StudyCostLedger } from './study-cost-ledger.js';
import { validateStudyWire, type StudyCallTransport } from './study-call-guard.js';

export const studyProviderEndpoint = 'https://api.deepseek.com/anthropic/v1/messages';
const dispatched = new WeakMap<StudyAuthorizationLease, Set<string>>();
interface Common { lease: StudyAuthorizationLease; ledger: StudyCostLedger; binding: StudyCostBinding; key: string }
type ProviderInput = Common & ({ scope: 'live' } | { scope: 'fixture'; fetch: typeof fetch });
export function createStudyProviderBackend(input: ProviderInput) {
  assert(['live', 'fixture'].includes(input.scope));
  assert(input.key.length >= 16 && input.key.length <= 512 && /^[\x21-\x7e]+$/.test(input.key), 'Configure the study Key locally');
  if (input.scope === 'live') assert(!('fetch' in input), 'Live transport cannot replace its network implementation');
  else assert.equal(typeof input.fetch, 'function');
  const { lease, ledger, binding, key, scope } = input; const fetcher = scope === 'fixture' ? input.fetch : fetch;
  if (!dispatched.has(lease)) dispatched.set(lease, new Set());
  const counts = { networkAttempts: 0, providerHttpRequests: 0, fixtureHttpRequests: 0, observedResponseBytes: 0, completedBodies: 0 };
  const transport: StudyCallTransport = { kind: scope === 'live' ? 'deepseek-provider' : 'provider-fixture', respond: async (wire, signal) => {
    await requireStudyLease(lease, ledger, binding, scope); signal.throwIfAborted(); validateStudyWire(wire);
    assert(!wire.includes(key), 'Credential must not appear in model input');
    const state = ledger.state; const call = state.calls.at(-1);
    assert(state.phase === 'started' && call && call.reason === 'reserved' && !call.usage && call.inputDigest === digest(wire), 'Durable reservation required before provider HTTP');
    const sent = dispatched.get(lease)!; assert(!sent.has(call.id), 'Never replay a provider reservation'); sent.add(call.id);
    counts.networkAttempts++; if (scope === 'live') counts.providerHttpRequests++; else counts.fixtureHttpRequests++;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = () => { if (reader) void reader.cancel().catch(() => {}); };
    try {
      const response = await fetcher(studyProviderEndpoint, { method: 'POST', body: wire, redirect: 'error', signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' } });
      if (response.status !== 200 || !response.body) { await response.body?.cancel(); return { status: response.status === 200 ? 502 : response.status, body: '' }; }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) { await response.body.cancel(); throw new Error('Unexpected provider response type'); }
      reader = response.body.getReader(); signal.addEventListener('abort', abort, { once: true }); signal.throwIfAborted();
      const parts: Uint8Array[] = []; let bytes = 0;
      for (;;) { const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break;
        bytes += chunk.value.byteLength; counts.observedResponseBytes += chunk.value.byteLength;
        if (bytes > studyCostPolicy.maxResponseBytes) throw new Error('Provider response limit'); parts.push(chunk.value); }
      const raw = Buffer.concat(parts); const body = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      assert(Buffer.from(body).equals(raw), 'Provider response bytes changed while decoding'); assert(!body.includes(key), 'Credential in provider response');
      counts.completedBodies++; return { status: 200, body };
    } catch { throw new Error('Study provider request unavailable'); }
    finally { signal.removeEventListener('abort', abort); try { await reader?.cancel(); } catch { /* Response already closed. */ } }
  } };
  return { transport, authorize: () => requireStudyLease(lease, ledger, binding, scope), snapshot: () => ({ ...counts }) };
}
