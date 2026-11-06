import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { fixture } from '../test/fixture.js';
import { git } from '../src/repository.js';
import { verifyWorkspaceRepair } from '../src/verification.js';

const provider = 'automatic-offline'; const model = 'scripted';
class Scripted extends LlmAdapter {
  calls = 0; extractionCalls = 0; offered = false;
  private steps = new Map<string, number>();
  constructor(private readonly source: string) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'offline automatic rehearsal'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted(); if (++this.calls > 8) throw new Error('Scripted call bound');
    let text: string;
    if (options.sessionId?.startsWith('automatic-ignore')) text = 'Scripted no-op response to non-learning input.';
    else if (!options.sessionId) {
      this.extractionCalls++; assert.ok(options.system?.includes('untrusted evidence'));
      text = JSON.stringify({ kind: 'candidate', title: 'transaction rollback failure restore balance', strategy: 'Save the prior balance and restore it before raising on failure.',
        factIds: ['verification:base', 'verification:fixed', 'verification:regression'], inferences: [], recommendations: [] });
    } else {
      const step = this.steps.get(options.sessionId) ?? 0; this.steps.set(options.sessionId, step + 1);
      const source = options.sessionId === this.source;
      if (!source) { this.offered = JSON.stringify(options.messages).includes('Save the prior balance') || !!options.system?.includes('Save the prior balance'); assert.ok(this.offered, 'Actual target provider must receive experience context'); }
      if (step === 0) {
        const id = ToolCallId(crypto.randomUUID()); const args = JSON.stringify({ target: source ? 'ledger' : 'stock' });
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: 'fixture_fix', argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'fixture_fix', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      text = 'The scripted repair is ready for independent tests.';
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function turn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([agent.whenIdle(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Scripted turn timeout')), 45000); })]); }
  finally { clearTimeout(timer); }
}

/** Scripted compilation/coordination evidence, never a model quality or benefit experiment. */
export async function rehearseAutomatic(productDir?: string) {
  const f = await fixture(); const targetAcceptance = join(f.home, 'target-acceptance'); mkdirSync(targetAcceptance);
  writeFileSync(join(f.repo, 'stock.py'), 'def reserve(stock, fail=False):\n    before = stock["remaining"]\n    stock["remaining"] -= 3\n    if fail:\n        raise ValueError("failed")\n    return stock["remaining"]\n');
  git(f.repo, ['add', 'stock.py']); git(f.repo, ['commit', '-m', 'synthetic target failure']);
  writeFileSync(join(targetAcceptance, 'test_acceptance.py'), 'import pytest\nfrom stock import reserve\ndef test_stock_restored():\n    s={"remaining":9}\n    with pytest.raises(ValueError): reserve(s, True)\n    assert s["remaining"]==9\n');
  const head = git(f.repo, ['rev-parse', 'HEAD']); const index = readFileSync(join(f.repo, '.git/index'));
  const modules = productDir ? await Promise.all(['store', 'service', 'dsh'].map(n => import(pathToFileURL(join(productDir, 'dist/src', n + '.js')).href)))
    : await Promise.all([import('../src/store.js'), import('../src/service.js'), import('../src/dsh.js')]);
  const { Store } = modules[0] as typeof import('../src/store.js'); const { EvolveService } = modules[1] as typeof import('../src/service.js'); const { bindDsh } = modules[2] as typeof import('../src/dsh.js');
  const store = new Store(join(f.home, 'learning.sqlite')); const ctx = new Context(); const handles: AgentHandle[] = [];
  const policy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 };
  const service = new EvolveService(store, f.repo, policy, true, { grantId: crypto.randomUUID(), provider, model, maxCalls: 1, maxTokens: 256, timeoutMs: 10000 }, true, true);
  const sourceId = SessionId('automatic-source'); const targetId = SessionId('automatic-target'); const adapter = new Scripted(sourceId); const tools: string[] = [];
  try {
    for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await(); ctx.provide('credentials', {});
    ctx.llm.registerAdapter([provider], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    ctx.tools.register(defineTool({ name: 'fixture_fix', description: 'Apply a predetermined synthetic fixture edit; no learning tool calls.', parameters: { target: { type: 'string', required: true, enum: ['ledger', 'stock'] } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { const file = join(f.repo, args.target + '.py'); const old = readFileSync(file, 'utf8'); const assignment = args.target === 'ledger' ? '        state["balance"] = before\n' : '        stock["remaining"] = before\n';
        writeFileSync(file, old.replace('        raise ValueError', assignment + '        raise ValueError')); return 'Synthetic edit applied'; },
    }));
    await ctx.plugin({ name: 'automatic-binding', inject: ['tools', 'sessions', 'systemPrompt'], apply: (child: Context) => bindDsh(child, service, true) }).await();
    ctx.on('tools/result', exec => { tools.push(exec.name); });
    const create = async (sessionId: SessionId): Promise<Agent> => { const h = await ctx.agents.create({ sessionId, meta: { cwd: f.repo }, agentOptions: { provider, model, maxTokens: 256 } }); handles.push(h); return h.agent; };
    const pluginInput = await create(SessionId('automatic-ignore-plugin'));
    pluginInput.followup(createUserMessage({ source: { kind: 'dsh-reforge-experience', form: 'notice', summary: 'Synthetic plugin input, not a human request' }, content: [{ type: 'text', text: 'Do not infer a human task from this plugin message.' }] }));
    await pluginInput.whenIdle(); assert.equal(store.tasks().length, 0);
    const child = await ctx.agents.create({ sessionId: SessionId('automatic-ignore-child'), meta: { cwd: f.repo, origin: 'subagent' }, agentOptions: { provider, model, maxTokens: 256 } }); handles.push(child);
    await turn(child.agent, 'Synthetic subagent input'); assert.equal(store.tasks().length, 0);
    await turn(await create(sourceId), '修复 transaction rollback failure restore balance，失败时恢复状态。');
    assert.equal(store.tasks().length, 1); assert.equal(store.tasks()[0]!.state, 'closed');
    for (let n = 0; n < 1800 && ['queued', 'qualifying'].includes(store.automatic.rows()[0]?.state ?? ''); n++) await pause(50);
    assert.equal(store.automatic.rows()[0]!.state, 'learned', JSON.stringify(store.automatic.rows().map(s => ({ state: s.state, reason: s.reason }))));
    assert.equal(store.experiences()[0]!.status, 'source_verified');
    await turn(await create(targetId), '修复 stock.py 的 transaction rollback failure restore balance，库存失败后恢复原数量。');
    assert.equal(adapter.offered, true); assert.equal(store.applications().length, 1); assert.deepEqual(tools, ['fixture_fix', 'fixture_fix']);
    const target = store.automatic.rows().find(s => s.sessionId === targetId)!; assert.ok(target.base && target.fixed);
    const proof = await verifyWorkspaceRepair(f.repo, target.taskId!, target.base, target.fixed, service.automatic.snapshots!, { ...policy, acceptanceDir: targetAcceptance });
    assert.equal(proof.verified, true); assert.equal(adapter.extractionCalls, 1); assert.equal(store.extraction.grants()[0]!.used, 1);
    assert.equal(git(f.repo, ['rev-parse', 'HEAD']), head); assert.deepEqual(readFileSync(join(f.repo, '.git/index')), index); assert.equal(store.feedback().length, 0);
    const retrieval = { available: typeof service.retrievalStatus === 'function', actualContextDecisionRecorded: false, subsequentLocalSelectionReusedIndex: false };
    if (retrieval.available) {
      const before = service.retrievalStatus();
      retrieval.actualContextDecisionRecorded = before.attempts.some(a => a.selectedId === store.experiences()[0]!.id && a.applicationId === store.applications()[0]!.id);
      assert.equal(retrieval.actualContextDecisionRecorded, true);
      // A local abstention probes reuse after the real scripted provider context, without another model turn or application.
      const probe = service.begin('installed-index-probe', 'unrelated visual palette'); const chosen = service.select(probe.id);
      assert.equal(chosen.experience, null); retrieval.subsequentLocalSelectionReusedIndex = service.retrievalStatus().attempts[0]!.cache === 'hit';
      assert.equal(retrieval.subsequentLocalSelectionReusedIndex, true); assert.equal(store.applications().length, 1);
      assert.equal(store.extraction.grants()[0]!.used, 1); assert.equal(adapter.extractionCalls, 1);
    }
    return { passed: true, installedProduct: !!productDir, modelHttpRequests: 0, scriptedCalls: adapter.calls, extractionCalls: adapter.extractionCalls,
      evolveToolCalls: 0, nonHumanInputsIgnored: true, sourceVerified: true, targetReceivedContext: true, targetAcceptancePassed: proof.verified, userGitUnchanged: true, feedbackFabricated: false, benefitEvaluated: false, retrieval };
  } finally { for (const h of handles.reverse()) await h.dispose(); await ctx.fiber.dispose(); }
}
