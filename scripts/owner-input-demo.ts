/** Local synthetic bridge harness + actual AgentLoop. Never reads a user profile or uses HTTP models. */
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import type { PeerScope } from '@deepseek-ai/dsh-client-connection';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvolveService } from '../src/service.js';
import { bindDsh } from '../src/dsh.js';
import { dshOwnerCarrier } from '../src/dsh-owner-input.js';
import { nativeHandler } from '../src/native-rpc.js';
import { renderPanel } from '../src/panel-view.js';
import { startPanel } from '../src/panel.js';
import { verifiedRetrievalFixture } from '../test/retrieval-fixture.js';

if (process.argv.length !== 2) throw new Error('Usage: node dist/scripts/owner-input-demo.js');
const work = fileURLToPath(new URL('../../.probe-work/owner-input-demo/', import.meta.url)); mkdirSync(work, { recursive: true });
const fixture = await verifiedRetrievalFixture(work); const bank = fixture.createBank();
writeFileSync(join(fixture.repo, 'contract.schema.json'), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
  properties: { state: { type: 'object' } }, required: ['state'] }));
const service = new EvolveService(bank.store, fixture.repo, fixture.policy, false, undefined, true);
class Offline extends LlmAdapter {
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'owner demo zero HTTP'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== 'owner-demo-offline' || options.model !== 'scripted') throw new Error('Demo route refused');
    const owner = options.messages.filter(m => m.role === 'user').flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
    const notice = owner.findLast(t => t.startsWith('DSH-Reforge owner-confirmed')) ?? '';
    process.stdout.write(JSON.stringify({ event: 'actual_scripted_model_input', scope: 'latest_plugin_notice_not_full_history', ownerFacts: !!notice,
      experience: notice.includes('DSH-Reforge repair experience'), paidHttpCalls: 0, taskAcceptance: 'not_evaluated' }) + '\n');
    const text = '零费用流程演练已结束。这里只验证输入与参考送达，没有执行修复，也没有验收任务成功。';
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
const ctx = new Context();
for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
ctx.llm.registerAdapter(['owner-demo-offline'], new Offline()); await ctx.plugin(AgentLoop, { agents: [] }).await();
await ctx.plugin({ name: 'owner-demo', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, true) }).await();
const handle = await ctx.agents.create({ sessionId: SessionId('owner-input-demo'), meta: { cwd: fixture.repo }, agentOptions: { provider: 'owner-demo-offline', model: 'scripted', maxTokens: 512 } });
const operator = { dispose() {} } as PeerScope;
const rpc = nativeHandler(service, operator, () => true, id => id === String(handle.agent.id), id => dshOwnerCarrier(ctx, service, id, () => true));
const token = randomBytes(32).toString('hex'); let origin = '';
const panel = await startPanel(service);
const server = createServer((request, response) => { void (async () => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
  if (request.method === 'GET' && request.url === '/') {
    const child = renderPanel('owner-demo', { channel: 'owner-demo', parentOrigin: origin });
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reforge 零费用原生桥演练</title><style>body{margin:0;font:14px system-ui;background:#f4f6fa;color:#182433}header{padding:12px 20px;background:#fff;border-bottom:1px solid #dce1e7}iframe{border:0;width:100%;height:calc(100vh - 100px)}button{padding:6px 12px}</style><header><strong>合成工程 · 实际 AgentLoop · 零HTTP模型</strong><p>原生桥演练页，使用合成用户身份，不是桌面 DSH 登录。Schema：contract.schema.json；字段：state。</p><button id="theme">切换演练主题</button></header><iframe sandbox="allow-scripts" title="原生经验工作台"></iframe><script>
const frame=document.querySelector('iframe');frame.srcdoc=${JSON.stringify(child).replaceAll('<', '\\u003c')};const token=location.hash.slice(1);history.replaceState(null,'','/');let dark=false;
document.getElementById('theme').onclick=()=>{dark=!dark;frame.contentWindow.postMessage({channel:'owner-demo',type:'theme',appearance:{dark,fontSize:14,background:dark?'#182433':'#ffffff',surface:dark?'#131c28':'#f4f6fa',text:dark?'#e7edf4':'#182433',muted:dark?'#a9b4c4':'#596579',border:dark?'#334155':'#dce1e7',accent:dark?'#8ab9f1':'#206bc4',success:dark?'#80dbaa':'#176b47',warning:dark?'#f1c271':'#855000',danger:dark?'#ff9ba5':'#a53143'}},'*');};
window.addEventListener('message',async event=>{const r=event.data;if(event.source!==frame.contentWindow||event.origin!=='null'||r?.channel!=='owner-demo')return;try{const res=await fetch('/bridge',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({repositoryId:${JSON.stringify(service.repositoryId)},sessionId:'owner-input-demo',path:r.path,method:r.method,data:r.data})});const result=await res.json();frame.contentWindow.postMessage({channel:'owner-demo',id:r.id,ok:result.ok,...(result.ok?{value:result.value}:{message:result.error.message})},'*');}catch{frame.contentWindow.postMessage({channel:'owner-demo',id:r.id,ok:false,message:'演练回执中断，请核对，不会自动重试'},'*');}});</script>`;
    response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(html); return;
  }
  if (request.method !== 'POST' || request.url !== '/bridge' || request.headers.origin !== origin || request.headers.authorization !== 'Bearer ' + token || request.headers['content-type'] !== 'application/json') { response.writeHead(403).end(); return; }
  const chunks: Buffer[] = []; let size = 0;
  for await (const data of request) { const part = Buffer.from(data as Uint8Array); size += part.length; if (size > 32768) { response.writeHead(413).end(); return; } chunks.push(part); }
  const result = await rpc('request', JSON.parse(Buffer.concat(chunks).toString()), new AbortController().signal, operator);
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
})().catch(() => { if (!response.headersSent) response.writeHead(400); response.end(); }); });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address();
if (!address || typeof address === 'string') throw new Error('No local demo address'); origin = 'http://127.0.0.1:' + address.port;
process.stdout.write(JSON.stringify({ nativeHarness: origin + '/#' + token, standalone: panel.url, syntheticWorkspace: fixture.repo,
  sharedPytestProofs: 1, paidHttpCalls: 0, benefitEvaluated: false }) + '\n');
process.once('SIGINT', () => { void (async () => { await panel.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await handle.dispose(); await ctx.fiber.dispose(); fixture.store.close(); process.exit(0); })(); });
