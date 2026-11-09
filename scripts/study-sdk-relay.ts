/** Shared actual SDK/loopback boundary for fixture and explicitly authorized provider studies. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DeepSeekAdapter, DeepSeekFileStore, DeepSeekUploadIndex, resolveAdapterOptions, type DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { digest } from '../src/domain.js';
import type { StudyCase } from './benefit-study-cases.js';
import { guardedStudyWireCall, type StudyCallTransport } from './study-call-guard.js';
import type { StudyCostBinding, StudyCostLedger } from './study-cost-ledger.js';
import type { StudyExecutionPort } from './study-bounded-python.js';
import { inspectStudyInput, type StudyControllerDriver, type TrackedStudyAdapter } from './study-controller-driver.js';

export interface StudySdkRelayInput {
  ledger: StudyCostLedger; binding: StudyCostBinding; trialIndex: number; item: StudyCase; memory: string | null;
  checkFrozen: () => Promise<{ planDigest: string }>; mode: 'offline' | 'live'; scope: 'fixture' | 'live';
  transportKind: StudyCallTransport['kind']; respond: (wire: string, signal: AbortSignal, round: number) => Promise<{ status: number; body: string }>;
  authorize?: () => Promise<void>; execution?: StudyExecutionPort; providerHttpRequests?: () => number;
}
export async function createStudySdkRelay(input: StudySdkRelayInput) {
  const live = input.mode === 'live';
  if (live) {
    assert(input.execution?.kind === 'bounded-study-v1' && input.authorize && input.providerHttpRequests);
    assert.equal(input.transportKind, input.scope === 'live' ? 'deepseek-provider' : 'provider-fixture');
  } else { assert.equal(input.scope, 'fixture'); assert.equal(input.transportKind, 'offline-fixture'); }
  const provider = live ? 'study-official-live' : 'study-official-offline';
  const route = '/study-' + randomUUID() + '/v1/messages'; const token = 'local-' + randomUUID(); let origin = ''; let active = false;
  const beforeProvider = input.providerHttpRequests?.() ?? 0;
  const counters = { loopbackRequests: 0, offlineTransportInvocations: 0, transportInvocations: 0, deniedRequests: 0,
    wireDigests: [] as string[], reservationIds: [] as string[] };
  const operations = new Set<Promise<void>>(); const controllers = new Set<AbortController>();
  let markDispatched!: () => void; const whenDispatched = new Promise<void>(done => { markDispatched = done; }); let adapter: TrackedStudyAdapter;
  const server = createServer((req, res) => {
    const operation = handle().finally(() => operations.delete(operation)); operations.add(operation);
    async function handle() {
      const fail = () => { if (!res.headersSent && !res.destroyed) { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"study_stopped"}'); } };
      if (req.headers.host !== new URL(origin).host || req.method !== 'POST' || req.url !== route || req.headers.authorization !== 'Bearer ' + token || active) {
        counters.deniedRequests++; req.resume(); fail(); return;
      }
      counters.loopbackRequests++; active = true; const controller = new AbortController(); controllers.add(controller);
      const cancel = () => { if (!res.writableFinished) controller.abort(); }; res.once('close', cancel); res.on('error', cancel);
      req.setTimeout(live ? 120000 : 10000, () => { controller.abort(); req.destroy(); });
      try {
        const parts: Buffer[] = []; let bytes = 0;
        for await (const value of req) { const part = Buffer.from(value as Uint8Array); bytes += part.length; assert(bytes <= 262144); parts.push(part); }
        const raw = Buffer.concat(parts); const wire = new TextDecoder('utf-8', { fatal: true }).decode(raw); assert(Buffer.from(wire).equals(raw));
        counters.wireDigests.push(digest(wire)); const round = adapter.round as 1 | 2;
        const result = await guardedStudyWireCall({ ledger: input.ledger, binding: input.binding,
          identity: { trialIndex: input.trialIndex, round, inputDigest: digest(wire) }, wire, checkFrozen: input.checkFrozen,
          requireAuthorization: input.authorize, signal: controller.signal, deadlineMs: live ? 120000 : 10000,
          transport: { kind: input.transportKind, respond: async (frozenWire, signal) => {
            assert.equal(frozenWire, wire); counters.transportInvocations++; if (!live) counters.offlineTransportInvocations++; markDispatched();
            return input.respond(frozenWire, signal, round);
          } } });
        counters.reservationIds.push(result.requestId); if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.end(result.body);
      } catch { fail(); }
      finally { res.off('close', cancel); res.off('error', cancel); controllers.delete(controller); active = false; }
    }
  });
  const close = async () => {
    for (const controller of controllers) controller.abort();
    const stopped = server.listening ? new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) : Promise.resolve();
    server.closeAllConnections(); await Promise.allSettled([...operations]); await stopped;
  };
  server.headersTimeout = 10000; server.requestTimeout = live ? 120000 : 10000;
  try {
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
    const connection = resolveAdapterOptions({ baseURL: origin + route.slice(0, -'/v1/messages'.length), thinking: 'disabled', reasoningEffort: 'off',
      maxTokens: 2048, defaultContextWindow: 1048576, streamIdleTimeoutMs: live ? 130000 : 15000,
      retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'deepseek-flash', contextWindow: 1048576, maxTokens: 2048 }] });
    assert(connection.retryPolicy.mode === 'normal'); assert.equal(connection.retryPolicy.maxRetries, 0);
    class TrackedAdapter extends DeepSeekAdapter {
      calls = 0; round = 0; readonly inputDigests: string[] = [];
      private async *tracked(options: GenerateOptions, stream: PreparedAdapterCall['stream']): AsyncIterable<StreamChunk> {
        assert.equal(this.calls, this.round - 1); this.calls++;
        this.inputDigests.push(inspectStudyInput(options, input.item, input.memory, this.round, provider, 'deepseek-flash')); yield* stream(options);
      }
      override async prepareCall(route: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
        const prepared = await super.prepareCall(route, model, signal); return { ...prepared, stream: options => this.tracked(options, prepared.stream) };
      }
      override stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.tracked(options, value => super.stream(value)); }
    }
    adapter = new TrackedAdapter({ options: () => connection,
      resolveAuth: async () => ({ headers: { Authorization: 'Bearer ' + token } }),
      resolveUserId: () => 'synthetic-study' as ReturnType<DeepSeekAdapterOptions['resolveUserId']>,
      resolveFiles: () => new DeepSeekFileStore({ index: new DeepSeekUploadIndex(join(input.ledger.root, 'unused-files-' + randomUUID() + '.json')),
        fetch: async () => { throw new Error('Study Files API is disabled'); } }), prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) });
    const httpRequests = () => (input.providerHttpRequests?.() ?? 0) - beforeProvider;
    const driver: StudyControllerDriver = live ? { kind: 'official-sdk-live', scope: input.scope, execution: input.execution!, httpRequests,
      provider: 'study-official-live', model: 'deepseek-flash', adapter }
      : { kind: 'official-sdk-offline', provider: 'study-official-offline', model: 'deepseek-flash', adapter };
    return { driver, whenDispatched, snapshot: () => ({ ...structuredClone(counters), providerHttpRequests: httpRequests() }), close };
  } catch (error) { await close(); throw error; }
}
