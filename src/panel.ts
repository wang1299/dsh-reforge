import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { EvolveService } from './service.js';
import { redact, RevisionConflict } from './domain.js';
import { renderPanel } from './panel-view.js';
import { panelRequest } from './panel-api.js';
import { memoryRevalidationRequest } from './memory-revalidation.js';
import { ownerInputRequest } from './owner-input-api.js';
import { OwnerInputError } from './owner-input-domain.js';
import { ownerInputErrorMessage } from './owner-input-copy.js';

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); size += chunk.length;
    if (size > 32768) throw new Error('Request body exceeds 32 KiB'); chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function startPanel(service: EvolveService): Promise<{ url: string; origin: string; token: string; close: () => Promise<void> }> {
  try { service.ownerInput.recover(); } catch { /* Keep the diagnostics page available without resetting owner metadata. */ }
  const token = randomBytes(32).toString('hex'); let origin = '';
  const server = createServer((request, response) => { void handle(request, response); });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown): void => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.headers.host !== new URL(origin).host) { send(403, { error: 'Invalid local host' }); return; }
      const path = request.url ?? '/';
      if (path === '/' && request.method === 'GET') {
        const nonce = randomBytes(16).toString('hex');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(renderPanel(nonce)); return;
      }
      const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { send(401, { error: 'Local access token required' }); return; }
      if (request.method === 'POST' && (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json')) { send(403, { error: 'Same-origin JSON required' }); return; }
      const value = request.method === 'POST' ? await body(request) : undefined;
      const method = request.method ?? 'GET';
      const abort = new AbortController();
      response.once('close', () => abort.abort());
      const reply = await memoryRevalidationRequest(service, path, method, value, abort.signal)
        ?? await ownerInputRequest(service, path, method, value) ?? panelRequest(service, path, method, value); send(reply.status, reply.value);
    } catch (error) { send(error instanceof RevisionConflict ? 409 : 400, { error: error instanceof OwnerInputError
      ? ownerInputErrorMessage(error.code) : redact(error instanceof Error ? error.message : 'Invalid request', 1000),
      ...(error instanceof OwnerInputError ? { code: error.code } : {}) }); }
  }
  await new Promise<void>((resolveStart, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveStart); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local address');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, token, url: origin + '/#token=' + token,
    close: () => new Promise<void>((resolveClose, reject) => { server.close((error) => error ? reject(error) : resolveClose()); server.closeAllConnections(); }) };
}
