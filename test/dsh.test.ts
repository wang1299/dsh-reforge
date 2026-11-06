import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { bindDsh } from '../src/dsh.js';
import { fixture } from './fixture.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';

test('official DSH 0.2.0-rc.2 services register, execute, isolate sessions and unload', async () => {
  const f = await fixture(); const ctx = new Context();
  await ctx.plugin(SystemPrompt, {}).await();
  await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
  await ctx.plugin(SessionStore).await();
  const store = new Store(':memory:'); const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  const plugin = ctx.plugin({ name: 'evolve-probe', inject: ['tools', 'systemPrompt', 'sessions'], apply: (child: Context) => bindDsh(child, service, false) });
  await plugin.await();
  // Real SessionStore and ToolRuntime; the agent identity is a fixture, not a running LLM loop.
  const session = ctx.sessions.create(SessionId('compat-session'), { meta: { cwd: f.repo } });
  const identity = { id: session.id } as Agent;
  const run = (name: string, args: object, agent = identity) => ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name, arguments: args, agent, signal: new AbortController().signal });
  const assembly = await ctx.systemPrompt.assemble();
  assert.ok(assembly.sections.some((s) => s.name === 'dsh-reforge:workflow'));
  assert.equal(assembly.tools.filter((t) => t.name.startsWith('evolve_')).length, 7);
  const proposeSchema = assembly.tools.find((t) => t.name === 'evolve_propose_experience')!.parameters;
  const linkSchema = assembly.tools.find((t) => t.name === 'evolve_link_fact_evidence')!.parameters;
  const candidateSchema = (proposeSchema.properties as Record<string, Record<string, unknown>>).candidate!;
  assert.equal(candidateSchema.type, 'object', 'Agent must see Candidate fields, not opaque JSON');
  assert.equal(candidateSchema.additionalProperties, false);
  assert.deepEqual(new Set(candidateSchema.required as string[]), new Set(['title', 'strategy', 'observedFacts', 'inferences', 'recommendations', 'requiredFiles']));
  for (const schema of [proposeSchema, linkSchema]) {
    const citations = (schema.properties as Record<string, Record<string, unknown>>).citations!;
    assert.equal(citations.type, 'array');
    const item = citations.items as Record<string, unknown>;
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(new Set(item.required as string[]), new Set(['factIndex', 'factDigest', 'evidenceId', 'evidenceDigest']));
    assert.equal((item.properties as Record<string, Record<string, unknown>>).factIndex!.type, 'integer');
  }
  assert.equal((linkSchema.properties as Record<string, Record<string, unknown>>).revision!.type, 'integer');
  const workflow = assembly.sections.find((s) => s.name === 'dsh-reforge:workflow')!.text;
  assert.match(workflow, /without citations/);
  assert.match(workflow, /kind/);
  const result = await run('evolve_begin_task', { summary: 'database rollback' });
  assert.equal(result.isError, false, JSON.stringify(result));
  const task = service.store.tasks()[0]!;
  assert.equal(task.sessionId, session.id);
  const other = ctx.sessions.create(SessionId('compat-other'), { meta: { cwd: f.repo } });
  const rejected = await run('evolve_finish_task', { taskId: task.id }, { id: other.id } as Agent);
  assert.equal(rejected.isError, true);
  const correctionResult = await run('evolve_record_correction', { taskId: task.id, note: 'Explicit fixture correction: restore state.' });
  assert.equal(correctionResult.isError, false);
  const evidence = store.evidenceRecords()[0]!;
  assert.ok(JSON.stringify(correctionResult).includes(evidence.digest));
  const candidate = { title: 'transaction rollback', strategy: 'Restore state.',
    observedFacts: ['The explicit correction asks to restore state.'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] };
  const receipt = (JSON.parse(correctionResult.content.find((b) => b.type === 'text')!.text) as {
    evidence: { evidenceId: string; evidenceDigest: string; kind: string };
  }).evidence;
  assert.equal(receipt.evidenceId, evidence.id);
  assert.equal((await run('evolve_propose_experience', { taskId: task.id, candidate, citations: [receipt] })).isError, true, 'T011 receipt is not a citation');
  assert.equal(store.experiences().length, 0, 'invalid citations cannot leave a partial candidate');
  const proposal = await run('evolve_propose_experience', { taskId: task.id, candidate });
  assert.equal(proposal.isError, false);
  const exp = store.experiences()[0]!;
  const returned = JSON.parse(proposal.content.find((b) => b.type === 'text')!.text) as {
    facts: { factIndex: number; factDigest: string }[];
  };
  const citations = [{ ...returned.facts[0]!, evidenceId: receipt.evidenceId, evidenceDigest: receipt.evidenceDigest }];
  assert.ok(JSON.stringify(proposal).includes(citations[0]!.factDigest));
  const args = { experienceId: exp.id, revision: exp.revision, citations };
  assert.equal((await run('evolve_link_fact_evidence', { ...args, citations: [receipt] })).isError, true);
  assert.equal((await run('evolve_link_fact_evidence', { ...args, citations: [{ ...citations[0], factDigest: '0'.repeat(64) }] })).isError, true, 'native shape cannot bypass exact digest validation');
  assert.equal((await run('evolve_link_fact_evidence', args, { id: other.id } as Agent)).isError, true);
  assert.equal((await run('evolve_link_fact_evidence', args)).isError, false);
  assert.equal(service.provenance(store.experience(exp.id)!).complete, true);
  assert.equal((await run('evolve_link_fact_evidence', args)).isError, true, 'stale tool calls cannot overwrite new references');
  assert.equal((await run('evolve_verify_experience', { experienceId: exp.id })).isError, true, 'DSH cannot grant execution trust');
  assert.equal(store.history(exp.id).length, 2);
  const observed = store.events(task.id);
  assert.ok(observed.length > 0);
  assert.ok(!JSON.stringify(observed).includes('database rollback'));
  const finished = await run('evolve_finish_task', { taskId: task.id });
  assert.equal(finished.isError, false);
  for (let i = 0; i < 150 && store.learning.forTask(task.id)?.state !== 'succeeded'; i++) await pause(20);
  const background = store.learning.forTask(task.id)!;
  assert.equal(background.state, 'succeeded'); assert.equal(background.effectStarted, false);
  assert.equal(store.learning.bundle(background.id)?.status, 'incomplete');
  assert.ok(background.input.sources.some(e => e.id === evidence.id));
  if (process.platform === 'win32') {
    const alias = execFileSync(process.env.EVOLVE_PYTHON ?? 'python', ['-c',
      'import ctypes,sys; b=ctypes.create_unicode_buffer(32768); n=ctypes.windll.kernel32.GetShortPathNameW(sys.argv[1],b,len(b)); assert n>0; print(b.value)', f.repo],
    { encoding: 'utf8', windowsHide: true }).trim();
    const aliasSession = ctx.sessions.create(SessionId('compat-alias'), { meta: { cwd: alias } });
    assert.equal((await run('evolve_begin_task', { summary: 'same repository alias' }, { id: aliasSession.id } as Agent)).isError, false);
  }
  const outside = ctx.sessions.create(SessionId('compat-outside'), { meta: { cwd: f.home } });
  assert.equal((await run('evolve_begin_task', { summary: 'outside repository' }, { id: outside.id } as Agent)).isError, true);
  await plugin.dispose();
  const after = await ctx.systemPrompt.assemble();
  assert.ok(!after.sections.some((s) => s.name === 'dsh-reforge:workflow'));
  assert.equal(after.tools.filter((t) => t.name.startsWith('evolve_')).length, 0);
});

test('official host tool requests reuse only a requalified index and record inert bounded explanations', { timeout: 60000 }, async () => {
  const f = await verifiedRetrievalFixture(); const bank = f.createBank(); const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await(); await ctx.plugin(SessionStore).await();
    await ctx.plugin({ name: 'live-retrieval-probe', inject: ['tools', 'systemPrompt', 'sessions'], apply: (child: Context) => bindDsh(child, bank.service, true) }).await();
    for (let i = 0; i < 2; i++) {
      const session = ctx.sessions.create(SessionId('retrieval-host-' + i), { meta: { cwd: f.repo } });
      const result = await ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name: 'evolve_begin_task', arguments: { summary: 'transaction rollback exception' },
        agent: { id: session.id } as Agent, signal: new AbortController().signal });
      assert.equal(result.isError, false); const output = JSON.parse(result.content.find(block => block.type === 'text')!.text);
      assert.equal(output.experience.id, bank.experiences[0]!.id);
    }
    const status = bank.service.retrievalStatus(); assert.equal(status.cache.builds, 1); assert.equal(status.cache.hits, 1);
    assert.equal(status.attempts.length, 2); assert(status.attempts.every(a => a.outcome === 'selected'));
    assert.equal(bank.store.applications().length, 2); assert.equal(bank.store.extraction.grants().length, 0);
  } finally { await ctx.fiber.dispose(); f.store.close(); }
});
