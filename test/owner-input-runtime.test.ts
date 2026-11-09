import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { dshOwnerCarrier } from '../src/dsh-adapter-owner-input.js';
import { OwnerInputError } from '../src/owner-input-domain.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';
import type { OwnerTaskCarrier } from '../src/owner-task-input.js';
import { Store } from '../src/store.js';
import { fixture } from './fixture.js';
import { nativeHandler } from '../src/native-rpc.js';
import type { PeerScope } from '@deepseek-ai/dsh-client-connection';
import { extractionMaterial } from '../src/extraction.js';

const parent = fileURLToPath(new URL('../../.probe-work/t060-tests/', import.meta.url));
const sourcePath = 'contract.schema.json'; const text = 'database transaction rollback exception';
function schema(repo: string, nullable = false) {
  writeFileSync(join(repo, sourcePath), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
    properties: { state: { type: nullable ? ['object', 'null'] : 'object' } }, required: ['state'] }));
}
class InspectAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  constructor(private readonly defaults = false) { super(); }
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, ...(this.defaults ? { defaultMaxTokens: 8192 } : {}) }; }
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
  const preregistered = JSON.parse(readFileSync(fileURLToPath(new URL('../../test/fixtures/owner-intake-v1-cases.json', import.meta.url)), 'utf8')) as { cases: { id: string; stage: string; expected: string }[] };
  const runtime = new Map(preregistered.cases.filter(c => c.stage === 'runtime').map(c => [c.id, c]));
  const paired: { id: string; expectedProvided: boolean; legacySelectorSelected: boolean; currentNoticeProvided: boolean }[] = [];
  try {
    for (const scenario of ['repair_matches', 'ui_goal', 'documentation_goal', 'contradictory_facts', 'source_changes_after_submit', 'experience_revision_changed', 'duplicate_submit', 'existing_conversation_defaults', 'request_model_changed', 'rules_changed_before_submit']) {
      await t.test(scenario, async () => {
        schema(f.repo); const bank = f.createBank(); const service = new EvolveService(bank.store, f.repo, f.policy, false, undefined, true);
        const ctx = new Context(); const adapter = new InspectAdapter(scenario === 'existing_conversation_defaults'); let release!: () => void; let holdAdmission = false;
        const admission = new Promise<void>(resolve => { release = resolve; });
        for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
        await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
        ctx.llm.registerAdapter(['owner-offline'], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
        await ctx.plugin({ name: 'owner-probe', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, true) }).await();
        ctx.on('agent/pre-step', async (_payload, next) => { if (holdAdmission) await admission; return next(); }, { prepend: true });
        const sessionId = SessionId('owner-' + randomUUID());
        const handle = await ctx.agents.create({ sessionId, meta: { cwd: f.repo }, agentOptions: { provider: 'owner-offline', model: 'scripted', ...(scenario === 'existing_conversation_defaults' ? {} : { maxTokens: 512 }) } });
        try {
          if (scenario === 'existing_conversation_defaults') {
            handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Known synthetic warmup' }] })); await handle.agent.whenIdle();
            assert.equal(adapter.calls.length, 1); assert.equal(handle.agent.session.requestHeader()!.config.maxTokens, 8192);
            assert.equal(handle.agent.session.requestHeader()!.adapterDefaults?.maxTokens, true);
          }
          const carrier = dshOwnerCarrier(ctx, service, String(sessionId), () => true)!;
          const preview = service.ownerInput.sourcePreview({ path: sourcePath, property: 'state' });
          const exp = bank.experiences[0]!;
          service.ownerInput.declare({ previewId: preview.previewId, experienceId: exp.id, experienceRevision: exp.revision,
            expectedGlobal: 0, expectedRule: 0, fields: ['field_nullable'], allowedGoals: ['repair_behavior'] });
          if (scenario === 'contradictory_facts') schema(f.repo, true);
          const goal = scenario === 'ui_goal' ? 'present_ui' : scenario === 'documentation_goal' ? 'generate_docs' : 'repair_behavior';
          let taskPreview = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text, goal }, carrier);
          holdAdmission = true;
          if (scenario === 'rules_changed_before_submit') {
            const nextSource = service.ownerInput.sourcePreview({ path: sourcePath, property: 'state' });
            service.ownerInput.declare({ previewId: nextSource.previewId, experienceId: exp.id, experienceRevision: exp.revision,
              expectedGlobal: 1, expectedRule: 1, fields: ['field_nullable'], allowedGoals: ['repair_behavior'] });
            await assert.rejects(() => service.ownerInput.submit({ instanceId: taskPreview.instanceId, previewId: taskPreview.previewId, idempotencyKey: randomUUID() }, carrier), code('owner_rules_changed'));
            assert.equal(bank.store.ownerInputs.receipts(service.repositoryId).length, 0); assert.equal(adapter.calls.length, 0);
            assert.equal(bank.store.tasks().filter(t => t.sessionId === sessionId).length, 0);
            assert.equal(handle.agent.status, 'idle'); assert.equal(handle.agent.inbox.nextTurn.length, 0); assert.equal(handle.agent.inbox.nextStep.length, 0);
            taskPreview = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text, goal }, carrier);
          }
          const request = { instanceId: taskPreview.instanceId, previewId: taskPreview.previewId, idempotencyKey: randomUUID() };
          const submitted = await service.ownerInput.submit(request, carrier); assert.equal(submitted.phase, 'submitted');
          if (scenario === 'source_changes_after_submit') schema(f.repo, true);
          if (scenario === 'request_model_changed') ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: 'changed-after-confirmation' }));
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
          if (scenario === 'duplicate_submit') await assert.rejects(() => service.ownerInput.submit({ ...request, idempotencyKey: randomUUID() }, carrier), code('owner_preview_expired'));
          if (scenario === 'request_model_changed') {
            assert.equal(adapter.calls.length, 0, 'A changed actual request must stop before the adapter');
            assert.equal(service.ownerInput.state(carrier).receipts[0]!.phase, 'unknown'); return;
          }
          assert.equal(adapter.calls.length, scenario === 'existing_conversation_defaults' ? 2 : 1, 'An actual GenerateOptions is required; idle alone is insufficient');
          const first = notices(adapter.calls.at(-1)!); const ownerNotice = first.find(s => s.startsWith('DSH-Reforge owner-confirmed'));
          assert.ok(ownerNotice); assert.ok(first.indexOf(text) < first.indexOf(ownerNotice));
          const provided = ownerNotice.includes('Restore the original balance before raising');
          const expected = ['repair_matches', 'duplicate_submit', 'existing_conversation_defaults', 'rules_changed_before_submit'].includes(scenario); assert.equal(provided, expected);
          const frozen = runtime.get(scenario);
          if (frozen) {
            const baseline = f.createBank();
            try {
              if (scenario === 'experience_revision_changed') {
                const old = baseline.experiences[0]!; baseline.store.putExperience({ ...old, revision: 2 }, baseline.store.citations(old.id, old.revision));
              }
              const task = baseline.service.begin('baseline-' + scenario, text); const selected = baseline.service.select(task.id);
              paired.push({ id: scenario, expectedProvided: frozen.expected === 'provided', legacySelectorSelected: !!selected.experience, currentNoticeProvided: provided });
            } finally { baseline.store.close(); }
          }
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
    assert.equal(runtime.size, 6); assert.equal(paired.length, 6);
    const legacyViolations = paired.filter(p => !p.expectedProvided && p.legacySelectorSelected).length;
    const currentViolations = paired.filter(p => !p.expectedProvided && p.currentNoticeProvided).length;
    const retained = paired.filter(p => p.expectedProvided && p.legacySelectorSelected && p.currentNoticeProvided).length;
    assert.equal(legacyViolations, 5); assert.equal(currentViolations, 0); assert.equal(retained, 1);
    t.diagnostic(JSON.stringify({ kind: 'author_visible_owner_rule_workflow_pairing', cases: paired, legacyConfirmationRuleViolations: legacyViolations,
      currentConfirmationRuleViolations: currentViolations, correctPositiveRetained: retained, positiveDenominator: 1,
      negativeDenominator: 5, baselineBoundary: 'actual legacy service selector, not provider delivery', currentBoundary: 'actual scripted GenerateOptions notice',
      sharedSourceProofs: 1, blindHoldout: false, realModelBenefit: false, paidHttpCalls: 0 }));
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
      await assert.rejects(() => service.ownerInput.submit(request(p), carrier()), code('owner_conversation_busy'));
    } finally { release(); await hold; }
    assert.equal(adapter.calls.length, 0); assert.equal(store.ownerInputs.receipts(service.repositoryId).length, 0);
    assert.equal(store.tasks().length, 0); assert.equal(store.learning.jobs().length, 0);
  } finally { await a.dispose(); await b.dispose(); await foreign.dispose(); await ctx.fiber.dispose(); store.close(); }
});

test('unknown unbound owner input and steering retain the context-only turn guard until the actual host end', { timeout: 30000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); const store = new Store(':memory:'); schema(f.repo);
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 1000 }, false, undefined, true);
  let sent = { id: '', text: '' }; const carrier: OwnerTaskCarrier = { sessionId: 'boundary', scopeKey: 'f'.repeat(64), assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent = { id, text }; } }; } };
  try {
    for (const invalid of [true, false]) {
      const oldJobs = store.learning.jobs().length;
      const turn = invalid ? 1 : 2; const p = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text, goal: 'repair_behavior' }, carrier);
      const receipt = await service.ownerInput.submit({ instanceId: p.instanceId, previewId: p.previewId, idempotencyKey: randomUUID() }, carrier);
      if (invalid) store.ownerInputs.transition(service.repositoryId, receipt.id, ['submitted'], { phase: 'unknown', reason: 'synthetic_unknown' });
      assert.equal(service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, turn, [sent]).owned, true);
      if (!invalid) {
        const task = store.task(store.ownerInputs.receipt(service.repositoryId, receipt.id)!.taskId!)!; assert.ok(task);
        service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, turn, [{ id: randomUUID(), text: 'Additional steering' }]);
        assert.equal(store.task(task.id)!.state, 'closed'); assert.equal(store.learning.forTask(task.id), null); assert.equal(store.learning.jobs().length, oldJobs);
      }
      assert.throws(() => service.begin(carrier.sessionId, 'model attempts manual bypass'), code('owner_context_only'));
      service.ownerInput.end(carrier.sessionId, turn + 100); // Another turn's event cannot release this guard.
      assert.throws(() => service.begin(carrier.sessionId, 'still blocked'), code('owner_context_only'));
      service.ownerInput.end(carrier.sessionId, turn); const ordinary = service.begin(carrier.sessionId, 'subsequent ordinary task'); service.finish(ordinary.id);
    }
  } finally { store.close(); }
});

test('automatic owner steering invalidates the original segment, does not copy correction text or queue mixed repair work', { timeout: 30000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); const store = new Store(join(f.home, 'owner-auto.sqlite')); schema(f.repo);
  const extraction = { grantId: randomUUID(), provider: 'owner-offline', model: 'scripted', maxCalls: 1, maxTokens: 128, timeoutMs: 1000 };
  const service = new EvolveService(store, f.repo, { trusted: true, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 1000 }, true, extraction, true, true);
  let sent = { id: '', text: '' }; const carrier: OwnerTaskCarrier = { sessionId: 'automatic-owner', scopeKey: 'e'.repeat(64), assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent = { id, text }; } }; } };
  try {
    const p = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text: '纠正：' + 'x'.repeat(900), goal: 'repair_behavior' }, carrier);
    await service.ownerInput.submit({ instanceId: p.instanceId, previewId: p.previewId, idempotencyKey: randomUUID() }, carrier);
    service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, 1, [sent]);
    const task = store.tasks()[0]!; assert.ok(task); assert.ok(task.summary.length <= 256); assert.equal(store.evidenceRecords().length, 0);
    assert.equal(store.automatic.rows()[0]!.state, 'open');
    assert.equal(service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, 1, [{ id: randomUUID(), text: 'Different steering' }]).owned, true);
    service.automatic.finish(carrier.sessionId, 1); service.ownerInput.end(carrier.sessionId, 1);
    assert.equal(store.automatic.rows()[0]!.state, 'blocked'); assert.equal(store.automatic.rows()[0]!.reason, 'multiple_inputs');
    assert.equal(store.task(task.id)!.state, 'closed'); assert.equal(store.learning.jobs().length, 0); assert.equal(store.extraction.jobs().length, 0);
    assert.equal(store.extraction.grants().reduce((n, g) => n + g.used, 0), 0);
  } finally { store.close(); }
});

test('a new context-only turn does not revoke previously queued ordinary work in that same session', { timeout: 30000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); const store = new Store(':memory:'); schema(f.repo);
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 1000 }, false, undefined, true);
  const old = service.begin('same-session', 'Previously authorized ordinary task'); service.finish(old.id);
  const oldJob = store.learning.forTask(old.id)!; assert.equal(oldJob.state, 'queued');
  let sent = { id: '', text: '' }; const carrier: OwnerTaskCarrier = { sessionId: old.sessionId, scopeKey: 'd'.repeat(64), assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent = { id, text }; } }; } };
  try {
    const p = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text, goal: 'repair_behavior' }, carrier);
    await service.ownerInput.submit({ instanceId: p.instanceId, previewId: p.previewId, idempotencyKey: randomUUID() }, carrier);
    service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, 2, [sent]);
    assert.throws(() => service.correction(old.id, 'model tries old task'), /closed/);
    assert.equal(await service.jobs.runNext(), true); assert.equal(store.learning.forTask(old.id)!.state, 'succeeded');
    assert.equal(store.learning.bundle(oldJob.id)!.status, 'incomplete'); assert.equal(store.learning.forTask(old.id)!.effectStarted, false);
    assert.equal(store.extraction.jobs().length, 0); service.ownerInput.end(carrier.sessionId, 2);
  } finally { store.close(); }
});

test('previously authorized same-session extraction remains waiting and its frozen material stays valid during context-only work', { timeout: 60000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await verifiedRetrievalFixture(parent); const bank = f.createBank(); schema(f.repo);
  const policy = { grantId: randomUUID(), provider: 'owner-offline', model: 'scripted', maxCalls: 1, maxTokens: 128, timeoutMs: 1000 };
  const service = new EvolveService(bank.store, f.repo, f.policy, false, policy, true); const old = bank.store.tasks()[0]!;
  const job = service.jobs.enqueue(old); service.extraction.enqueue(old, job.id);
  let sent = { id: '', text: '' }; const carrier: OwnerTaskCarrier = { sessionId: old.sessionId, scopeKey: 'c'.repeat(64), assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent = { id, text }; } }; } };
  try {
    const p = service.ownerInput.taskPreview({ path: sourcePath, property: 'state', text, goal: 'repair_behavior' }, carrier);
    await service.ownerInput.submit({ instanceId: p.instanceId, previewId: p.previewId, idempotencyKey: randomUUID() }, carrier);
    service.ownerInput.admit(carrier.sessionId, carrier.scopeKey, 3, [sent]);
    assert.equal(await service.jobs.runNext(), true); assert.equal(bank.store.learning.job(job.id)!.state, 'succeeded');
    assert.equal(bank.store.learning.bundle(job.id)!.status, 'ready');
    assert.equal(await service.extraction.runNext(null), false);
    const extraction = bank.store.extraction.jobs()[0]!; assert.equal(extraction.state, 'waiting'); assert.equal(extraction.reason, 'model_unavailable');
    assert.ok(extractionMaterial(bank.store, f.repo, extraction).text.length > 0);
    assert.equal(bank.store.extraction.grants()[0]!.used, 0); service.ownerInput.end(carrier.sessionId, 3);
  } finally { bank.store.close(); f.store.close(); }
});
