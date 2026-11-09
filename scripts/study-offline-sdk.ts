/** Actual official SDK to a loopback-only synthetic service. No provider endpoint or Key. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DeepSeekAdapter, DeepSeekFileStore, DeepSeekUploadIndex, resolveAdapterOptions, type DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { digest } from '../src/domain.js';
import type { StudyCase } from './benefit-study-cases.js';
import { guardedOfflineWireCall } from './study-call-guard.js';
import type { StudyCostBinding, StudyCostLedger } from './study-cost-ledger.js';
import { inspectStudyInput, type StudyControllerDriver, type TrackedStudyAdapter } from './study-controller-driver.js';

export const sdkFixtureModes = ['first_pass', 'repair_once', 'unchanged', 'self_report', 'forbidden_code', 'http_error', 'truncated', 'unresponsive'] as const;
export type SdkFixtureMode = typeof sdkFixtureModes[number];
const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
export function sdkFixtureStream(item: StudyCase, mode: SdkFixtureMode, round: number): string {
  const text = mode === 'self_report' ? 'The task is complete and all tests pass.'
    : JSON.stringify({ code: mode === 'forbidden_code' ? 'def repair(state):\n    return open("outside", "w")\n'
      : mode === 'first_pass' || mode === 'repair_once' && round === 2 ? item.reference : item.before });
  const body = event({ type: 'message_start', message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'deepseek-flash',
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } } })
    + event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    + event({ type: 'content_block_stop', index: 0 })
    + event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } })
    + event({ type: 'message_stop' });
  return mode === 'truncated' ? body.slice(0, -1) : body;
}

export async function createOfflineSdkDriver(input: { ledger: StudyCostLedger; binding: StudyCostBinding; trialIndex: number;
  item: StudyCase; memory: string | null; mode: SdkFixtureMode; checkFrozen: () => Promise<{ planDigest: string }> }) {
  assert(sdkFixtureModes.includes(input.mode));
  const route = '/study-' + randomUUID() + '/v1/messages'; const token = 'offline-' + randomUUID(); let origin = ''; let active = false;
  const counters = { loopbackRequests: 0, offlineTransportInvocations: 0, deniedRequests: 0, providerHttpRequests: 0,
    wireDigests: [] as string[], reservationIds: [] as string[] };
  const operations = new Set<Promise<void>>(); const controllers = new Set<AbortController>();
  let markDispatched!: () => void; const whenDispatched = new Promise<void>(done => { markDispatched = done; });
  let adapter: TrackedStudyAdapter;
  const server = createServer((req, res) => {
    const operation = handle().finally(() => operations.delete(operation)); operations.add(operation);
    async function handle(): Promise<void> {
      const fail = () => { if (!res.headersSent && !res.destroyed) { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"offline_study_stopped"}'); } };
      if (req.headers.host !== new URL(origin).host || req.method !== 'POST' || req.url !== route
        || req.headers.authorization !== 'Bearer ' + token || active) { counters.deniedRequests++; req.resume(); fail(); return; }
      counters.loopbackRequests++; active = true; const controller = new AbortController(); controllers.add(controller);
      const cancel = () => { if (!res.writableFinished) controller.abort(); }; res.once('close', cancel); res.on('error', cancel);
      req.setTimeout(10000, () => { controller.abort(); req.destroy(); });
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const value of req) { const chunk = Buffer.from(value as Uint8Array); size += chunk.length;
          if (size > 262144) throw new Error('Study request limit'); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks); const wire = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        assert(Buffer.from(wire).equals(bytes), 'Decoding must preserve exact SDK wire bytes'); counters.wireDigests.push(digest(wire));
        const result = await guardedOfflineWireCall({ ledger: input.ledger, binding: input.binding,
          identity: { trialIndex: input.trialIndex, round: adapter.round as 1 | 2, inputDigest: digest(wire) }, wire,
          checkFrozen: input.checkFrozen, signal: controller.signal, deadlineMs: 10000,
          transport: { kind: 'offline-fixture', respond: async (frozenWire, signal) => {
            assert.equal(frozenWire, wire, 'SDK wire bytes must not be normalized or rewritten'); counters.offlineTransportInvocations++; markDispatched();
            if (input.mode === 'unresponsive') return new Promise<never>((_done, reject) => {
              const abort = () => reject(new Error('Synthetic pending transport cancelled'));
              signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
            });
            return { status: input.mode === 'http_error' ? 503 : 200, body: sdkFixtureStream(input.item, input.mode, adapter.round) };
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
  server.headersTimeout = 10000; server.requestTimeout = 10000;
  try {
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
  const connection = resolveAdapterOptions({ baseURL: origin + route.slice(0, -'/v1/messages'.length), thinking: 'disabled', reasoningEffort: 'off',
    maxTokens: 2048, defaultContextWindow: 1048576, streamIdleTimeoutMs: 15000,
    retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'deepseek-flash', contextWindow: 1048576, maxTokens: 2048 }] });
  assert(connection.retryPolicy.mode === 'normal'); assert.equal(connection.retryPolicy.maxRetries, 0);
  class TrackedAdapter extends DeepSeekAdapter {
    calls = 0; round = 0; readonly inputDigests: string[] = [];
    private async *tracked(options: GenerateOptions, stream: PreparedAdapterCall['stream']): AsyncIterable<StreamChunk> {
      assert.equal(this.calls, this.round - 1, 'Exactly one official SDK attempt per round'); this.calls++;
      this.inputDigests.push(inspectStudyInput(options, input.item, input.memory, this.round, 'study-official-offline', 'deepseek-flash'));
      yield* stream(options);
    }
    override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
      const prepared = await super.prepareCall(provider, model, signal);
      return { ...prepared, stream: options => this.tracked(options, prepared.stream) };
    }
    override stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.tracked(options, value => super.stream(value)); }
  }
  adapter = new TrackedAdapter({ options: () => connection,
    resolveAuth: async () => ({ headers: { Authorization: 'Bearer ' + token } }),
    resolveUserId: () => 'synthetic-study' as ReturnType<DeepSeekAdapterOptions['resolveUserId']>,
    resolveFiles: () => new DeepSeekFileStore({ index: new DeepSeekUploadIndex(join(input.ledger.root, 'unused-files-' + randomUUID() + '.json')),
      fetch: async () => { throw new Error('Study Files API is disabled'); } }),
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) });
  const driver: StudyControllerDriver = { kind: 'official-sdk-offline', provider: 'study-official-offline', model: 'deepseek-flash', adapter };
  return { driver, whenDispatched, snapshot: () => structuredClone(counters), close };
  } catch (error) { await close(); throw error; }
}
