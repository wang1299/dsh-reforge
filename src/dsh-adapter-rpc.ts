import { basename } from 'node:path';
import { z } from 'zod';
import type { ConnectionRpcHandler, PeerScope, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { assertSupportedDshVersion } from './dsh-adapter-policy.js';
import type { EvolveService } from './service.js';
import { RevisionConflict } from './domain.js';
import { panelRequest } from './panel-api.js';
import { ownerInputRequest } from './owner-input-api.js';
import { OwnerInputError } from './owner-input-domain.js';
import type { OwnerTaskCarrier } from './owner-task-input.js';

export const nativePrefix = 'dsh-reforge-';
const infoSchema = z.object({ sessionId: z.string().min(1).max(200).optional() }).strict();
const requestSchema = z.object({ repositoryId: z.string().min(1).max(200), sessionId: z.string().min(1).max(128).optional(), path: z.string().max(250), method: z.enum(['GET', 'POST']), data: z.unknown().optional() }).strict();
const envelope = z.object({ type: z.literal('client-request'), rpcId: z.string().min(1).max(200), method: z.enum(['dsh-reforge-info', 'dsh-reforge-request']), payload: z.unknown() }).strict();

/** Exact SDK releases renamed the owner handle; never accept an identity from a payload. */
export function browserOwner(connection: HostConnectionHandle): PeerScope {
  const version = getDshRuntimeVersion(); assertSupportedDshVersion(version);
  const host = connection as HostConnectionHandle & { readonly operator?: PeerScope; readonly browserPeer?: PeerScope };
  const owner = version === '0.2.0-rc.2' ? host.operator : host.browserPeer;
  if (!owner || typeof owner.dispose !== 'function') throw new Error('DSH owner identity unavailable');
  return owner;
}

/** Exact routes retain the official authenticated shared /api carrier. */
export function mountNative(connection: HostConnectionHandle, handler: ConnectionRpcHandler): void {
  const operator = browserOwner(connection);
  for (const endpoint of ['info', 'request']) connection.fetch.register({
    path: '/api/' + nativePrefix + endpoint, methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return new Response('JSON required', { status: 415 });
      const reader = request.body?.getReader(); const parts: Uint8Array[] = []; let length = 0;
      try {
        if (reader) for (;;) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength; if (length > 32768) { await reader.cancel(); return new Response('Request too large', { status: 413 }); }
          parts.push(part.value);
        }
        const input = envelope.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
        if (input.method !== nativePrefix + endpoint) return new Response('Invalid endpoint', { status: 400 });
        const result = await handler(endpoint, input.payload, request.signal, operator);
        return Response.json({ type: 'server-response', rpcId: input.rpcId, result }, { headers: { 'Cache-Control': 'no-store' } });
      } catch { return new Response('Invalid request', { status: 400 }); }
      finally { reader?.releaseLock(); }
    },
  });
}

/** Connection owns authentication; only its actual operator object may use this channel. */
export function nativeHandler(service: EvolveService, operator: PeerScope, active: () => boolean, matchesSession: (id: string) => boolean,
  resolveCarrier: (id: string) => OwnerTaskCarrier | null = () => null): ConnectionRpcHandler {
  return async (endpoint, payload, signal, peer) => {
    const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message, details: {} } });
    if (!active() || signal.aborted) return fail('unavailable', '插件连接已结束，请重新打开。');
    if (peer !== operator) return fail('forbidden', '此操作需要 DSH 本机用户身份。');
    try {
      if (Buffer.byteLength(JSON.stringify(payload) ?? '') > 32768) return fail('invalid', '请求过大，请缩短内容。');
      if (endpoint === 'info') {
        const input = infoSchema.parse(payload);
        if (input.sessionId && !matchesSession(input.sessionId)) return fail('scope', '此对话不属于插件配置的仓库。');
        return { ok: true, value: { repositoryId: service.repositoryId, repositoryName: basename(service.root), version: 1 } };
      }
      if (endpoint !== 'request') return fail('not_found', '操作不可用。');
      const input = requestSchema.parse(payload);
      if (input.repositoryId !== service.repositoryId) return fail('scope', '仓库配置已变化，请重新打开经验界面。');
      if (input.sessionId && !matchesSession(input.sessionId)) return fail('scope', '此对话不属于插件配置的仓库。');
      const carrier = input.sessionId ? resolveCarrier(input.sessionId) : null;
      const reply = await ownerInputRequest(service, input.path, input.method, input.data, carrier) ?? panelRequest(service, input.path, input.method, input.data);
      if (reply.status !== 200) return fail(reply.status === 409 ? 'conflict' : 'not_found', reply.status === 409 ? '经验版本已变化，请载入最新记录后再保存。' : '操作不可用。');
      return { ok: true, value: reply.value };
    } catch (error) {
      if (error instanceof OwnerInputError) return fail(error.code, '未提交或状态尚未确认。请核对当前对话、来源文件和操作状态；未知结果请勿重新发送。');
      return fail(error instanceof RevisionConflict ? 'conflict' : 'invalid', error instanceof RevisionConflict ? '经验版本已变化，请载入最新记录后再保存。' : '未完成操作，请核对内容、来源与当前版本。');
    }
  };
}
