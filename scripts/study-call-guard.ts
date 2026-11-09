/** Offline transport boundary only. Intentionally has no fetch/endpoint/credential/default transport. */
import { z } from 'zod';
import { digest } from '../src/domain.js';
import { StudyCostLedger, studyCostPolicy as policy, studyUsageSchema, type StudyCallIdentity, type StudyCostBinding } from './study-cost-ledger.js';

const tokens = z.number().int().nonnegative().safe();
const feeFields = { service_tier: z.literal('standard').optional(),
  server_tool_use: z.object({ web_search_requests: z.literal(0).optional(), tool_search: z.literal(0).optional() }).strict().optional() };
const wireUsage = z.object({ input_tokens: tokens.max(policy.maxInput), output_tokens: tokens.max(policy.maxOutput),
  cache_read_input_tokens: tokens.max(policy.maxInput), cache_creation_input_tokens: z.literal(0), ...feeFields }).strict();
const text = z.object({ type: z.literal('text'), text: z.string() }).strict();
const requestSchema = z.object({ model: z.literal('deepseek-flash'), stream: z.literal(true), max_tokens: z.literal(2048),
  temperature: z.literal(0), thinking: z.object({ type: z.literal('disabled') }).strict(), system: z.union([z.string(), z.array(text)]),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string(), z.array(text)]) }).strict()).min(1).max(16),
  tools: z.array(z.never()).max(0).optional() }).strict();

/** JSON.parse otherwise silently chooses the last duplicated (possibly escaped) fee field. */
function uniqueJson(raw: string): unknown {
  let i = 0;
  const space = () => { while (/\s/.test(raw[i] ?? '') && i < raw.length) i++; };
  function string(): string {
    const start = i++; while (i < raw.length) { const c = raw[i++]; if (c === '\\') i++; else if (c === '"') return JSON.parse(raw.slice(start, i)) as string; }
    throw new Error('Unterminated JSON string');
  }
  function value(depth: number): void {
    if (depth > 32) throw new Error('JSON nesting limit'); space(); const c = raw[i];
    if (c === '"') { string(); return; }
    if (c === '{' || c === '[') {
      i++; space(); const end = c === '{' ? '}' : ']'; const keys = new Set<string>(); if (raw[i] === end) { i++; return; }
      for (;;) {
        space(); if (c === '{') {
          if (raw[i] !== '"') throw new Error('Object key required'); const key = string();
          if (keys.has(key)) throw new Error('Duplicate JSON field'); keys.add(key); space(); if (raw[i++] !== ':') throw new Error('JSON colon required');
        }
        value(depth + 1); space(); const next = raw[i++]; if (next === end) return; if (next !== ',') throw new Error('JSON separator required');
      }
    }
    const start = i; while (i < raw.length && !/[\s,}\]]/.test(raw[i]!)) i++;
    JSON.parse(raw.slice(start, i));
  }
  value(0); space(); if (i !== raw.length) throw new Error('Trailing JSON'); return JSON.parse(raw);
}

/** Strict complete text-only protocol; unknown provider formats stop rather than guess a cost. */
export function studyUsageReceipt(stream: string) {
  try {
    stream = stream.replaceAll('\r\n', '\n'); if (!stream.endsWith('\n\n') || Buffer.byteLength(stream) > policy.maxResponseBytes) return null;
    let started = false; let terminal = false; let stopped = false; let openBlock = false; let blocks = 0;
    let providerModel = ''; let final: { input: number; output: number } | null = null; let stopReason = '';
    for (const frame of stream.split(/\n\n+/).filter(s => s.trim())) {
      const lines = frame.split('\n'); if (lines.some(line => line && !line.startsWith('data:') && !line.startsWith('event:') && !line.startsWith(':'))) return null;
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()); if (!data.length) continue;
      const e = z.record(z.string(), z.unknown()).parse(uniqueJson(data.join('\n')));
      const names = lines.filter(line => line.startsWith('event:')).map(line => line.slice(6).trim());
      if (names.length > 1 || names.length === 1 && names[0] !== e.type) return null;
      if (stopped) return null;
      if (e.type === 'ping') { z.object({ type: z.literal('ping') }).strict().parse(e); continue; }
      if (e.type === 'message_start') {
        if (started || terminal) return null;
        const start = z.object({ type: z.literal('message_start'), message: z.object({
          id: z.string().optional(), type: z.literal('message').optional(), role: z.literal('assistant').optional(),
          model: z.literal(policy.model), content: z.array(z.never()).max(0).optional(),
          stop_reason: z.null().optional(), stop_sequence: z.null().optional(),
          usage: wireUsage.extend({ cache_read_input_tokens: tokens.max(policy.maxInput).optional(), cache_creation_input_tokens: z.literal(0).optional() }) }).strict() }).strict().parse(e);
        providerModel = start.message.model; started = true;
      } else if (e.type === 'content_block_start') {
        if (!started || terminal || openBlock) return null;
        z.object({ type: z.literal('content_block_start'), index: z.literal(blocks), content_block: text }).strict().parse(e); openBlock = true;
      } else if (e.type === 'content_block_delta') {
        if (!openBlock || terminal) return null;
        z.object({ type: z.literal('content_block_delta'), index: z.literal(blocks), delta: z.object({ type: z.literal('text_delta'), text: z.string() }).strict() }).strict().parse(e);
      } else if (e.type === 'content_block_stop') {
        if (!openBlock || terminal) return null;
        z.object({ type: z.literal('content_block_stop'), index: z.literal(blocks) }).strict().parse(e); openBlock = false; blocks++;
      } else if (e.type === 'message_delta') {
        if (!started || terminal || openBlock) return null;
        const end = z.object({ type: z.literal('message_delta'), delta: z.object({
          stop_reason: z.enum(['end_turn', 'max_tokens', 'stop_sequence']), stop_sequence: z.union([z.null(), z.string()]).optional() }).strict(), usage: wireUsage }).strict().parse(e);
        final = studyUsageSchema.parse({ input: end.usage.input_tokens + end.usage.cache_read_input_tokens, output: end.usage.output_tokens }); stopReason = end.delta.stop_reason; terminal = true;
      } else if (e.type === 'message_stop') {
        if (!terminal) return null; z.object({ type: z.literal('message_stop') }).strict().parse(e); stopped = true;
      } else return null;
    }
    return stopped && final ? { usage: final, providerModel, stopReason } : null;
  } catch { return null; }
}

export interface OfflineStudyTransport { kind: 'offline-fixture'; respond: (frozenRequest: string, signal: AbortSignal) => Promise<{ status: number; body: string }> }
export function studyWireRequest(request: unknown): string {
  const raw = JSON.stringify(requestSchema.parse(request));
  if (Buffer.byteLength(raw) > policy.maxRequestBytes) throw new Error('Study request too large');
  return raw;
}
interface GuardInput {
  ledger: StudyCostLedger; binding: StudyCostBinding; identity: StudyCallIdentity;
  checkFrozen: () => Promise<{ planDigest: string }>; transport: OfflineStudyTransport; signal?: AbortSignal; deadlineMs?: number;
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Study call cancelled')); }; signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export async function guardedOfflineStudyCall(input: GuardInput & { request: unknown }) {
  return guardWire(input, studyWireRequest(input.request));
}
export async function guardedOfflineWireCall(input: GuardInput & { wire: string }) {
  if (Buffer.byteLength(input.wire) > policy.maxRequestBytes) throw new Error('Study request too large');
  requestSchema.parse(uniqueJson(input.wire)); return guardWire(input, input.wire);
}
async function guardWire(input: GuardInput, raw: string) {
  if (input.transport.kind !== 'offline-fixture') throw new Error('Offline transport required');
  const binding = structuredClone(input.binding); const identity = structuredClone(input.identity);
  const ledger = input.ledger; const respond = input.transport.respond;
  if (digest(raw) !== identity.inputDigest) throw new Error('Study wire request mismatch');
  const deadline = z.number().int().min(1).max(120000).parse(input.deadlineMs ?? 10000);
  const controller = new AbortController(); const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), deadline); let id: string | undefined; let resolved = false;
  try {
    signal.throwIfAborted(); const frozen = await abortable(input.checkFrozen(), signal);
    if (frozen.planDigest !== binding.planDigest) throw new Error('Study freeze changed'); signal.throwIfAborted();
    id = ledger.reserve(binding, identity);
    const response = await abortable(respond(raw, signal), signal); signal.throwIfAborted();
    if (response.status !== 200) { ledger.hold(id, 'http_error'); resolved = true; throw new Error('Study HTTP receipt rejected'); }
    const receipt = studyUsageReceipt(response.body);
    if (!receipt) { ledger.hold(id, 'invalid_receipt'); resolved = true; throw new Error('Study usage receipt incomplete'); }
    ledger.settle(id, receipt.usage); resolved = true;
    if (receipt.usage.output > policy.requestedOutput) throw new Error('Study output limit exceeded');
    return { body: response.body, receipt, requestId: id, kind: 'offline-fixture' as const };
  } catch {
    if (id && !resolved) { try { ledger.hold(id, 'transport_unknown'); } catch { /* Failed writes leave the original committed reservation. */ } }
    throw new Error('Study call stopped; never replay automatically');
  } finally { clearTimeout(timer); }
}
