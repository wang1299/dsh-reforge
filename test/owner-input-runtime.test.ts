import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, createUserMessage, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { EvolveService } from '../src/service.js';
import { bindDsh } from '../src/dsh.js';
import { dshOwnerCarrier } from '../src/dsh-owner-input.js';
import { OwnerInputError } from '../src/owner-input-domain.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';
import type { OwnerTaskCarrier } from '../src/owner-task-input.js';
import { Store } from '../src/store.js';
import { fixture } from './fixture.js';
import { nativeHandler } from '../src/native-rpc.js';
import type { PeerScope } from '@deepseek-ai/dsh-client-connection';

const parent = fileURLToPath(new URL('../../.probe-work/t060-tests/', import.meta.url));
const sourcePath = 'contract.schema.json'; const text = 'database transaction rollback exception';
function schema(repo: string, nullable = false) {
  writeFileSync(join(repo, sourcePath), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
    properties: { state: { type: nullable ? ['object', 'null'] : 'object' } }, required: ['state'] }));
}
class InspectAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'owner intake zero HTTP'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== 'owner-offline' || options.model !== 'scripted' || this.calls.length >= 4) throw new Error('Unexpected route');
    this.calls.push(options);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Scripted transport probe; no task acceptance claim.' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Scripted transport probe; no task acceptance claim.' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
function notices(options: GenerateOptions): string[] {
  return options.messages.filter(m => m.role === 'user').flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
}
const code = (value: string) => (error: unknown) => error instanceof OwnerInputError && error.code === value;

test('actual official AgentLoop receives bound facts before reference; six runtime cases plus duplicate use one shared pytest proof', { timeout: 120000 }, async t => {
  mkdirSync(parent, { recursive: true }); const f = await verifiedRetrievalFixture(parent);
  try {
    for (const scenario of ['repair_matches', 'ui_goal', 'documentation_goal', 'contradictory_facts', 'source_changes_after_submit', 'experience_revision_changed', 'duplicate_submit']) {
      await t.test(scenario, async () => {
        schema(f.repo); const bank = f.createBank(); const service = new EvolveService(bank.store, f.repo, f.policy, false, undefined, true);
        const ctx = new Context(); const adapter = new InspectAdapter(); let release!: () => void;
        const admission = new Promise<void>(resolve => { release = resolve; });
        for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
        await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
        ctx.llm.registerAdapter(['owner-offline'], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
        await ctx.plugin({ name: 'owner-probe', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, true) }).await();
        ctx.on('agent/pre-step', async (_payload, next) => { await admission; return next(); }, { prepend: true });
        const sessionId = SessionId('owner-' + randomUUID());
        const handle = await ctx.agents.create({ sessionId, meta: { cwd: f.repo }, agentOptions: { provider: 'owner-offline', model: 'scripted', maxTokens: 512 } });
        try {
          const carrier = dshOwnerCarrier(ctx, service, String(sessionId), () => true)!;
          const preview = service.ownerInput.sourcePreview({ path: sourcePath, property: 'state' });
          const exp = bank.experiences[0]!;
          service.ownerInput.declare({ previewId: preview.previewId, experienceId: exp.id, experienceRevision: exp.revision,
            expectedGlobal: 0, expectedRule: 0, fields: ['field_nullable'], allowedGoals: ['repair_behavior'] });
          if (scenario === 'contradictory_facts') schema(f.repo, true);
          const goal = scenario === 'ui_goal' ? 'present_ui' : scenario === 'documentation_goal' ? 'generate_docs' : 'repair_behavior';
          const taskPreview = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text, goal }, carrier);
          const request = { instanceId: taskPreview.instanceId, previewId: taskPreview.previewId, idempotencyKey: randomUUID() };
          const submitted = await service.ownerInput.submit(request, carrier); assert.equal(submitted.phase, 'submitted');
          if (scenario === 'source_changes_after_submit') schema(f.repo, true);
          if (scenario === 'experience_revision_changed') {
            const changed = { ...exp, revision: exp.revision + 1 };
            bank.store.putExperience(changed, bank.store.citations(exp.id, exp.revision));
            assert.equal(service.provenance(changed).complete, true); assert.equal(bank.store.verification(changed.verificationId!)!.verified, true);
          }
          if (scenario === 'duplicate_submit') {
            const repeated = await service.ownerInput.submit(request, carrier); assert.equal(repeated.id, submitted.id);
            await assert.rejects(() => service.ownerInput.submit({ ...request, idempotencyKey: randomUUID() }, carrier));
          }
          release(); await handle.agent.whenIdle();
          assert.equal(adapter.calls.length, 1, 'An actual GenerateOptions is required; idle alone is insufficient');
          const first = notices(adapter.calls[0]!); const ownerNotice = first.find(s => s.startsWith('DSH-Reforge owner-confirmed'));
          assert.ok(ownerNotice); assert.ok(first.indexOf(text) < first.indexOf(ownerNotice));
          const provided = first.some(s => s.includes('Restore the original balance before raising'));
          const expected = scenario === 'repair_matches' || scenario === 'duplicate_submit'; assert.equal(provided, expected);
          const task = bank.store.tasks().find(task => task.sessionId === sessionId)!;
          assert.ok(task); assert.equal(task.state, 'closed'); assert.equal(bank.store.ownerInputs.classification(task), 'context_only');
          assert.equal(bank.store.applications().filter(a => a.taskId === task.id).length, expected ? 1 : 0);
          assert.equal(bank.store.learning.forTask(task.id), null); assert.equal(bank.store.extraction.jobs().filter(j => j.taskId === task.id).length, 0);
          const attempts = service.retrievalStatus().attempts; assert.equal(attempts.length, 1);
          if (scenario === 'experience_revision_changed') assert.equal(attempts[0]!.candidates[0]!.reason, 'owner_rule_stale');
          if (scenario === 'source_changes_after_submit') assert.match(ownerNotice, /"facts":null/);
          const receipt = service.ownerInput.state(carrier).receipts[0]!; assert.equal(receipt.phase, 'ended');
          assert.equal(receipt.reason, 'turn_ended_unverified');
        } finally { release(); await handle.dispose(); await ctx.fiber.dispose(); }
      });
    }
  } finally { f.store.close(); }
});

test('context-only task blocks legacy tools, enqueue/recovery and new manual task until actual end, then preserves ordinary sessions', { timeout: 60000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await verifiedRetrievalFixture(parent); const bank = f.createBank();
  const service = new EvolveService(bank.store, f.repo, f.policy, false, undefined, true); schema(f.repo);
  let sent: { id: string; text: string } | null = null;
  const carrier: OwnerTaskCarrier = { sessionId: 'owner-context', scopeKey: 'f'.repeat(64), assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent = { id, text }; } }; } };
  try {
    const preview = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', goal: 'repair_behavior', text: 'x'.repeat(900) }, carrier);
    const receipt = await service.ownerInput.submit({ instanceId: preview.instanceId, previewId: preview.previewId, idempotencyKey: randomUUID() }, carrier);
    service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, 1, [sent!]);
    const task = bank.store.tasks().find(t => t.sessionId === carrier.sessionId)!; assert.ok(task.summary.length <= 256);
    assert.throws(() => service.correction(task.id, 'synthetic correction'), code('owner_context_only'));
    assert.throws(() => service.propose(task.id, f.input), code('owner_context_only'));
    assert.throws(() => service.jobs.enqueue(task), code('owner_context_only'));
    assert.throws(() => service.extraction.enqueue(task, randomUUID()), code('owner_context_only'));
    service.finish(task.id); assert.equal(bank.store.learning.forTask(task.id), null);
    assert.throws(() => service.begin(carrier.sessionId, 'bypass after finish'), code('owner_context_only'));
    assert.throws(() => service.recoverEvidence(task.id, randomUUID()), code('owner_context_only'));
    assert.throws(() => service.reauthorizeExtraction(task.id, randomUUID()), code('owner_context_only'));
    // Even a synthetic experience directly inserted by a trusted test cannot bypass the source-task guard.
    const exp = { ...bank.experiences[0]!, id: randomUUID(), sourceTaskId: task.id, revision: 1, status: 'candidate' as const, verificationId: null };
    bank.store.putExperience(exp);
    assert.throws(() => service.linkEvidence(exp.id, 1, []), code('owner_context_only'));
    await assert.rejects(() => service.verify(exp.id), code('owner_context_only'));
    service.ownerInput.end(carrier.sessionId, 1);
    assert.equal(bank.store.ownerInputs.receipt(service.repositoryId, receipt.id)!.phase, 'ended');
    assert.equal(service.begin('ordinary-session', 'transaction rollback').state, 'open');
    assert.equal(service.begin(carrier.sessionId, 'ordinary later turn').state, 'open');
  } finally { bank.store.close(); f.store.close(); }
});

test('actual carrier blocks missing goal, unsupported/changed source, foreign session/peer/workspace, sharing, pending inbox and true maintenance before reserve', { timeout: 60000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); const store = new Store(':memory:'); schema(f.repo);
  const policy = { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 1000 };
  const service = new EvolveService(store, f.repo, policy, false, undefined, true); const ctx = new Context(); const adapter = new InspectAdapter();
  for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
  await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
  ctx.llm.registerAdapter(['owner-offline'], adapter); await ctx.plugin(AgentLoop, { agents: [] }).await();
  const a = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: f.repo }, agentOptions: { provider: 'owner-offline', model: 'scripted' } });
  const b = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: f.repo }, agentOptions: { provider: 'owner-offline', model: 'scripted' } });
  const foreign = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: f.home }, agentOptions: { provider: 'owner-offline', model: 'scripted' } });
  const carrier = () => dshOwnerCarrier(ctx, service, String(a.agent.id), () => true)!;
  const input = { path: sourcePath, property: 'state', text, goal: 'repair_behavior' };
  const prepare = () => service.ownerInput.taskPreview(input, carrier());
  const request = (p: ReturnType<typeof prepare>) => ({ instanceId: p.instanceId, previewId: p.previewId, idempotencyKey: randomUUID() });
  try {
    assert.throws(() => service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text }, carrier()));
    writeFileSync(join(f.repo, sourcePath), JSON.stringify({ allOf: [{ type: 'object' }] })); assert.throws(prepare, code('owner_source_unconfirmed')); schema(f.repo);
    const changed = prepare(); schema(f.repo, true); await assert.rejects(() => service.ownerInput.submit(request(changed), carrier()), code('owner_source_changed')); schema(f.repo);
    const wrong = prepare(); await assert.rejects(() => service.ownerInput.submit(request(wrong), dshOwnerCarrier(ctx, service, String(b.agent.id), () => true)), code('owner_conversation_changed'));
    assert.throws(() => service.ownerInput.taskPreview(input, dshOwnerCarrier(ctx, service, String(foreign.agent.id), () => true)), code('owner_repository_mismatch'));
    const blockedStore = new Store(':memory:'); const blocked = new EvolveService(blockedStore, f.repo, policy);
    try { assert.throws(() => blocked.ownerInput.taskPreview(input, carrier()), code('owner_sharing_disabled')); } finally { blockedStore.close(); }
    const operator = { dispose() {} } as PeerScope; const rpc = nativeHandler(service, operator, () => true, () => true, () => carrier());
    const reply = await rpc('request', { repositoryId: service.repositoryId, sessionId: String(a.agent.id), path: '/api/owner-input/task-preview', method: 'POST', data: input }, new AbortController().signal, { dispose() {} } as PeerScope);
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'forbidden');
    a.agent.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Known synthetic pending message' }] }), 'next-turn', false);
    assert.throws(prepare, code('owner_conversation_busy')); a.agent.inbox.clear();
    const p = prepare(); let release!: () => void; const hold = a.agent.runMaintenance(async () => new Promise<void>(resolve => { release = resolve; }));
    try {
      assert.equal(a.agent.status, 'idle'); assert.equal(a.agent.inbox.nextTurn.length, 0);
      await assert.rejects(() => service.ownerInput.submit(request(p), carrier()), code('owner_conversation_unavailable'));
    } finally { release(); await hold; }
    assert.equal(adapter.calls.length, 0); assert.equal(store.ownerInputs.receipts(service.repositoryId).length, 0);
    assert.equal(store.tasks().length, 0); assert.equal(store.learning.jobs().length, 0);
  } finally { await a.dispose(); await b.dispose(); await foreign.dispose(); await ctx.fiber.dispose(); store.close(); }
});
