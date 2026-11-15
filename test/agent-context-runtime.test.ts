import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { verifiedRetrievalFixture } from './retrieval-fixture.js';

class ContextProbe extends LlmAdapter {
  readonly calls: GenerateOptions[] = [];
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'context zero HTTP'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assert.equal(options.provider, 'context-offline'); assert.equal(options.model, 'scripted'); assert.equal(this.calls.length, 0);
    this.calls.push(options);
    const text = 'Scripted transport probe; not task acceptance.';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text }; yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('actual AgentLoop memory notices enforce opt-in budgets before application and retain host vetoes', { timeout: 180000 }, async t => {
  const f = await verifiedRetrievalFixture(); const contract = readFileSync(join(f.repo, 'contract.py'));
  try {
    for (const scenario of ['automatic_provided', 'automatic_budget', 'automatic_sharing_off', 'automatic_legacy', 'automatic_source_changed', 'owner_provided', 'owner_budget', 'owner_veto']) {
      await t.test(scenario, async () => {
        const automatic = scenario.startsWith('automatic');
        const bank = f.createBank(1, 'reuse', automatic ? join(f.home, scenario + '.sqlite') : ':memory:');
        const sharing = scenario !== 'automatic_sharing_off'; const legacy = scenario === 'automatic_legacy';
        const budget = scenario.endsWith('budget') ? 512 : 8192;
        const service = new EvolveService(bank.store, f.repo, f.policy, automatic,
          automatic ? { grantId: randomUUID(), provider: 'context-offline', model: 'scripted', maxCalls: 1, maxTokens: 256, timeoutMs: 5000 } : undefined,
          true, automatic, undefined, legacy ? undefined : { policy: 'evidence-mmr-v1', maxNoticeBytes: budget });
        const ctx = new Context(); const adapter = new ContextProbe(); let bound = false;
        try {
          for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
          await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
          ctx.provide('credentials', {});
          ctx.llm.registerAdapter(['context-offline'], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
          await ctx.plugin({ name: 'context-probe', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, sharing) }).await();
          bound = true;
          const sessionId = SessionId(randomUUID());
          const handle = await ctx.agents.create({ sessionId, meta: { cwd: f.repo }, agentOptions: { provider: 'context-offline', model: 'scripted', maxTokens: 256 } });
          const text = 'transaction rollback exception balance';
          try {
            if (scenario === 'automatic_source_changed') appendFileSync(join(f.repo, 'contract.py'), '\n# changed after source qualification\n');
            if (automatic) handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
            else {
              writeFileSync(join(f.repo, 'context.schema.json'), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { state: { type: 'object' } }, required: ['state'] }));
              const carrier = dshOwnerCarrier(ctx, service, String(sessionId), () => true)!;
              const source = service.ownerInput.sourcePreview({ path: 'context.schema.json', property: 'state' }); const exp = bank.experiences[0]!;
              service.ownerInput.declare({ previewId: source.previewId, experienceId: exp.id, experienceRevision: exp.revision, expectedGlobal: 0, expectedRule: 0, fields: ['field_nullable'], allowedGoals: ['repair_behavior'] });
              const preview = service.ownerInput.taskPreview({ path: 'context.schema.json', property: 'state', text, goal: scenario === 'owner_veto' ? 'present_ui' : 'repair_behavior' }, carrier);
              await service.ownerInput.submit({ instanceId: preview.instanceId, previewId: preview.previewId, idempotencyKey: randomUUID() }, carrier);
            }
            await handle.agent.whenIdle();
            assert.equal(adapter.calls.length, 1, 'idle alone is not evidence: inspect actual provider request');
            const notices = adapter.calls[0]!.messages.flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
            const memoryMessage = notices.find(text => text.includes('DSH-Reforge repair experience'));
            const notice = memoryMessage?.slice(memoryMessage.indexOf('DSH-Reforge repair experience'));
            const provided = ['automatic_provided', 'automatic_legacy', 'owner_provided'].includes(scenario);
            assert.equal(!!notice, provided); assert.equal(bank.store.applications().length, provided ? 1 : 0);
            if (notice && !legacy) {
              const value = JSON.parse(notice.slice(notice.indexOf('\n') + 1)); const app = bank.store.applications()[0]!;
              assert.ok(Buffer.byteLength(notice, 'utf8') <= budget); assert.equal(value.applicationId, app.id);
              assert.equal(value.experienceId, app.experienceId); assert.equal(value.revision, app.revision);
              assert.deepEqual(value.applicability, bank.experiences[0]!.scope);
              assert.equal(value.strategy, bank.experiences[0]!.strategy);
              assert.equal(value.observedFacts.length, 1); assert.equal(value.observedFacts[0].text, bank.experiences[0]!.observedFacts[0]);
              assert.deepEqual(value.observedFacts[0].citations, bank.store.citations(app.experienceId, app.revision));
            }
            const attempt = service.retrievalStatus().attempts.at(-1);
            if (scenario.endsWith('budget')) { assert.equal(attempt!.context!.status, 'mandatory_over_budget'); assert.equal(attempt!.outcome, 'abstained'); }
            if (provided && !legacy) assert.equal(attempt!.context!.status, 'provided');
            if (legacy || !sharing || scenario === 'owner_veto') assert.equal(attempt?.context, undefined);
            assert.equal(bank.store.extraction.jobs().length, 0); assert.equal(bank.store.feedback().length, 0);
            assert.ok(bank.store.extraction.grants().every(g => g.used === 0));
          } finally { await handle.dispose(); }
        } finally {
          await ctx.fiber.dispose(); if (!bound) bank.store.close();
          // The deliberately stale contract is restored before the next independent bank.
          if (scenario === 'automatic_source_changed') writeFileSync(join(f.repo, 'contract.py'), contract);
        }
      });
    }
  } finally { f.store.close(); }
});
