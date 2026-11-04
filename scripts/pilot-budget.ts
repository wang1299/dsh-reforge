import { closeSync, existsSync, mkdirSync, openSync, readSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const pilotPolicy = Object.freeze({ cap: 10_000_000, reservation: 5_345_728, maxInput: 1_100_000,
  maxOutput: 393_216, requestedOutput: 2048, maxCalls: 32, maxRequestBytes: 262144, maxResponseBytes: 1048576,
  model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1/messages' });
const integer = z.number().int().nonnegative().safe();
const usageSchema = z.object({ input: integer.max(pilotPolicy.maxInput), output: integer.max(pilotPolicy.maxOutput) }).strict();
type Usage = z.infer<typeof usageSchema>;
const reasons = ['pending', 'complete', 'transport_or_timeout', 'http_error', 'invalid_receipt', 'cancelled', 'request_output_exceeded'] as const;
type Reason = typeof reasons[number];
const callSchema = z.object({ id: z.string().uuid(), createdAt: z.string().datetime(), charge: integer,
  usage: usageSchema.nullable(), reason: z.enum(reasons), httpStatus: z.number().int().min(100).max(599).nullable() }).strict();
const ledgerSchema = z.object({ schemaVersion: z.literal(1), policy: z.literal('t049-peak-bound-v1'), cap: z.literal(10_000_000),
  stopped: z.enum(reasons).nullable(), calls: z.array(callSchema).max(32) }).strict();

/** Independent experiment accounting. Never reads or migrates historical product/financial ledgers. */
export class PilotBudget {
  readonly state: z.infer<typeof ledgerSchema>;
  private readonly lock: number;
  private readonly db: DatabaseSync;
  private closed = false;
  private poisoned = false;
  private readonly fresh = new Set<string>();
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); this.lock = openSync(path + '.lock', 'wx', 0o600);
    let database: DatabaseSync | undefined;
    try {
      const fresh = !existsSync(path);
      if (!fresh) {
        const header = Buffer.alloc(100); const fd = openSync(path, 'r');
        try { if (readSync(fd, header, 0, header.length, 0) !== header.length) throw new Error('Invalid pilot database'); }
        finally { closeSync(fd); }
        if (header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0' || header.readUInt32BE(60) !== 1
          || header[18] !== 1 || header[19] !== 1) throw new Error('Not an existing pilot ledger; never migrate historical data');
      }
      database = new DatabaseSync(path); this.db = database;
      this.db.exec('PRAGMA synchronous=EXTRA; PRAGMA busy_timeout=1000;');
      if (this.db.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'delete'
        || this.db.prepare('PRAGMA synchronous').get()!.synchronous !== 3
        || this.db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('Pilot durability unavailable');
      this.db.exec('BEGIN IMMEDIATE');
      if (fresh) this.db.exec('CREATE TABLE pilot_ledger(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); PRAGMA user_version=1;');
      const row = fresh ? null : this.db.prepare('SELECT body FROM pilot_ledger WHERE id=1').get();
      if (!fresh && !row) throw new Error('Missing existing pilot state');
      this.state = row ? ledgerSchema.parse(JSON.parse(String(row.body)))
        : { schemaVersion: 1, policy: 't049-peak-bound-v1', cap: 10_000_000, stopped: null, calls: [] };
      if (this.state.calls.some(call => call.charge !== (call.usage ? call.usage.input * 2 + call.usage.output * 8 : pilotPolicy.reservation))
        || this.spent > pilotPolicy.cap || this.state.calls.some(call => call.usage ? !['complete', 'request_output_exceeded'].includes(call.reason) : call.reason === 'complete')) throw new Error('Invalid pilot accounting');
      if (fresh) this.db.prepare('INSERT INTO pilot_ledger VALUES(1,?)').run(JSON.stringify(this.state));
      this.db.exec('COMMIT');
    } catch (error) {
      try { database?.exec('ROLLBACK'); } catch { /* No active transaction. */ }
      database?.close(); closeSync(this.lock); unlinkSync(path + '.lock'); throw error;
    }
  }
  get spent(): number { return this.state.calls.reduce((sum, call) => sum + call.charge, 0); }
  private persist(): void {
    if (this.closed || this.poisoned) throw new Error('Pilot accounting unavailable');
    try {
      this.db.exec('BEGIN IMMEDIATE');
      if (this.db.prepare('UPDATE pilot_ledger SET body=? WHERE id=1').run(JSON.stringify(this.state)).changes !== 1) throw new Error('Missing pilot state');
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Keep the previously committed reservation. */ }
      this.poisoned = true; throw error;
    }
  }
  reserve(): string {
    if (this.closed || this.poisoned || this.state.stopped || this.state.calls.some(call => call.usage === null)
      || this.state.calls.length >= pilotPolicy.maxCalls || this.spent + pilotPolicy.reservation > pilotPolicy.cap) throw new Error('Pilot stopped or budget exhausted');
    const id = randomUUID(); this.state.calls.push({ id, createdAt: new Date().toISOString(), charge: pilotPolicy.reservation,
      usage: null, reason: 'pending', httpStatus: null }); this.persist(); this.fresh.add(id); return id;
  }
  settle(id: string, value: Usage, httpStatus = 200): void {
    const usage = usageSchema.parse(value); const call = this.state.calls.find(item => item.id === id);
    if (!call || call.usage || !this.fresh.has(id) || this.state.stopped || httpStatus !== 200) throw new Error('Unsettleable pilot call');
    const exceeded = usage.output > pilotPolicy.requestedOutput;
    const previous = { ...call }; const stopped = this.state.stopped;
    Object.assign(call, { usage, charge: usage.input * 2 + usage.output * 8, reason: exceeded ? 'request_output_exceeded' : 'complete', httpStatus });
    if (exceeded) this.state.stopped = 'request_output_exceeded';
    try { this.persist(); }
    catch (error) { Object.assign(call, previous); this.state.stopped = stopped; throw error; }
  }
  hold(id: string, reason: Exclude<Reason, 'complete' | 'pending' | 'request_output_exceeded'>, httpStatus: number | null): void {
    const call = this.state.calls.find(item => item.id === id);
    if (!call || call.usage || !this.fresh.has(id)) throw new Error('Unknown pilot reservation');
    call.reason = reason; call.httpStatus = httpStatus; this.state.stopped = reason; this.persist();
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); closeSync(this.lock); unlinkSync(this.path + '.lock'); } }
}

/** Official final cumulative usage is authoritative; raw content is never returned or stored here. */
export function pilotUsage(stream: string): Usage | null {
  try {
    stream = stream.replaceAll('\r\n', '\n');
    if (!stream.endsWith('\n\n')) return null;
    const feeFields = { service_tier: z.literal('standard').optional(),
      server_tool_use: z.object({ web_search_requests: z.literal(0).optional(), tool_search: z.literal(0).optional() }).strict().optional() };
    let started = false; let stopped = false; let terminal = false; let final: Usage | null = null;
    for (const frame of stream.split(/\n\n+/)) {
      const lines = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
      if (!lines.length) continue;
      const event = z.record(z.string(), z.unknown()).parse(JSON.parse(lines.join('\n')));
      if (stopped || event.type === 'error') return null;
      if (event.type !== 'message_delta' && event.usage !== undefined) return null;
      if (event.type === 'ping') continue;
      if (event.type === 'message_start') {
        if (started || terminal) return null;
        const message = z.record(z.string(), z.unknown()).parse(event.message);
        z.object({ input_tokens: integer.max(pilotPolicy.maxInput), output_tokens: integer.max(pilotPolicy.maxOutput),
          cache_read_input_tokens: integer.max(pilotPolicy.maxInput).optional(), cache_creation_input_tokens: z.literal(0).optional(), ...feeFields,
        }).strict().parse(message.usage);
        started = true;
      }
      else if (event.type === 'message_delta') {
        if (!started || terminal) return null;
        const delta = z.record(z.string(), z.unknown()).parse(event.delta);
        if (!['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'].includes(String(delta.stop_reason))) return null;
        const usage = z.object({ input_tokens: integer, output_tokens: integer, cache_read_input_tokens: integer,
          cache_creation_input_tokens: z.literal(0), ...feeFields,
        }).strict().parse(event.usage);
        final = usageSchema.parse({ input: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, output: usage.output_tokens }); terminal = true;
      } else if (event.type === 'message_stop') { if (!started || !terminal || event.usage !== undefined) return null; stopped = true; }
      else {
        if (!started || terminal || !['content_block_start', 'content_block_delta', 'content_block_stop'].includes(String(event.type))) return null;
        if (event.type === 'content_block_start') {
          const block = z.record(z.string(), z.unknown()).parse(event.content_block);
          if (!['text', 'tool_use'].includes(String(block.type))) return null;
        }
        if (event.type === 'content_block_delta') {
          const delta = z.record(z.string(), z.unknown()).parse(event.delta);
          if (!['text_delta', 'input_json_delta'].includes(String(delta.type))) return null;
        }
      }
    }
    return stopped && terminal ? final : null;
  } catch { return null; }
}

export async function startPilotRelay(budget: PilotBudget, options: {
  transport?: typeof fetch; beforeForward?: () => Promise<void>; inspect?: (request: Record<string, unknown>) => void;
} = {}): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const path = '/pilot-' + randomUUID() + '/v1/messages'; let origin = ''; let active = false;
  const operations = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    const operation = handle().finally(() => operations.delete(operation)); operations.add(operation);
    async function handle(): Promise<void> {
      const fail = (status: number): void => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"pilot_request_stopped"}'); } };
      if (req.headers.host !== new URL(origin).host || req.method !== 'POST' || req.url !== path || active) { fail(429); return; }
      active = true; let id: string | undefined; let httpStatus: number | null = null;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120000);
      const cancel = (): void => { if (!res.writableFinished) controller.abort(); }; res.once('close', cancel);
      try {
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const value of req) { const chunk = Buffer.from(value as Uint8Array); bytes += chunk.length;
          if (bytes > pilotPolicy.maxRequestBytes) throw new Error('Request limit'); chunks.push(chunk); }
        const raw = Buffer.concat(chunks); const body = z.record(z.string(), z.unknown()).parse(JSON.parse(raw.toString('utf8')));
        const allowed = ['model', 'stream', 'max_tokens', 'messages', 'system', 'thinking', 'temperature', 'top_p', 'stop_sequences', 'tools', 'tool_choice', 'metadata', 'output_config'];
        const names = ['fixture_write_source', 'evolve_begin_task', 'evolve_finish_task', 'evolve_record_correction', 'evolve_propose_experience', 'evolve_verify_experience', 'evolve_link_fact_evidence', 'evolve_list_candidates'];
        if (Object.keys(body).some(key => !allowed.includes(key)) || body.model !== pilotPolicy.model || body.stream !== true
          || body.max_tokens !== pilotPolicy.requestedOutput || !Array.isArray(body.messages)
          || /"type"\s*:\s*"(?:image|file|document|server_tool_use|web_search[^"\\]*)"/.test(raw.toString())
          || body.thinking !== undefined && JSON.stringify(body.thinking) !== '{"type":"disabled"}'
          || body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => {
            const t = tool as Record<string, unknown>; return !t || t.type !== undefined || !names.includes(String(t.name));
          }))) throw new Error('Pilot request policy');
        const auth = req.headers.authorization;
        if (!auth?.startsWith('Bearer ') || auth.length < 16) throw new Error('Credential header required');
        options.inspect?.(body); await options.beforeForward?.(); id = budget.reserve();
        const response = await (options.transport ?? fetch)(pilotPolicy.endpoint, { method: 'POST', body: raw,
          headers: { Authorization: auth, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
          redirect: 'error', signal: controller.signal });
        httpStatus = response.status;
        if (httpStatus !== 200 || !response.body) { budget.hold(id, 'http_error', httpStatus); fail(502); return; }
        const result: Buffer[] = []; let size = 0;
        for await (const value of response.body) { size += value.length; if (size > pilotPolicy.maxResponseBytes) throw new Error('Response limit'); result.push(Buffer.from(value)); }
        const data = Buffer.concat(result); const usage = pilotUsage(data.toString('utf8'));
        if (!usage) { budget.hold(id, 'invalid_receipt', httpStatus); fail(502); return; }
        controller.signal.throwIfAborted(); budget.settle(id, usage, httpStatus);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.end(data);
      } catch {
        if (id && !budget.state.calls.find(call => call.id === id)?.usage && !budget.state.stopped) {
          try { budget.hold(id, controller.signal.aborted ? 'cancelled' : 'transport_or_timeout', httpStatus); } catch { /* Durable reservation remains held on failure. */ }
        }
        fail(502);
      } finally { clearTimeout(timer); res.off('close', cancel); active = false; }
    }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No relay address');
  origin = `http://127.0.0.1:${address.port}`;
  return { baseURL: origin + path.slice(0, -'/v1/messages'.length), close: async () => {
    const stopped = new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    server.closeIdleConnections(); await Promise.allSettled([...operations]); await stopped;
  } };
}
