/** Scripted native Tool Calling rehearsal. No paid adapter, credential or endpoint option exists. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { RepairAgent, type RepairReceipt } from '../src/repair-agent.js';
import { bindRepairTools } from '../src/dsh-adapter-repair.js';
import { EvolveService } from '../src/service.js';
import { compileAgentContext } from '../src/agent-context.js';
import { applicability, snapshot } from '../src/repository.js';
import { digest } from '../src/domain.js';
import { createStudySourceBank, newStudyRoot } from './benefit-study-preflight.js';
import { studyCases } from './benefit-study-cases.js';
import { boundedStudyExecution, studyChildEnvironment, probeStudyPython } from './study-bounded-python.js';
import { installStudyVendor } from './study-python-vendor.js';
import { repairWorkspace } from './repair-agent-workspace.js';

export const exampleRepairPlan = [
  { id: 'inspect', action: 'read', dependsOn: [] },
  { id: 'reproduce', action: 'reproduce', dependsOn: ['inspect'] },
  { id: 'fix', action: 'patch', dependsOn: ['inspect', 'reproduce'] },
  { id: 'validate', action: 'verify', dependsOn: ['fix'] },
];
export const repairDemoScenarios = ['happy', 'replan', 'self_report', 'unknown'] as const;
type Scenario = typeof repairDemoScenarios[number];
const provider = 'reforge-repair-scripted';
type ModelResult = { result: RepairReceipt; context: { text: string; bytes: number; memory: string } };
class RepairScript extends LlmAdapter {
  calls = 0; nativeCalls = 0; providedMemoryRequests = 0; projectionChecks = 0; largestProjectionBytes = 0;
  private action = 0; private revision = 0; private fileDigest = '';
  constructor(private readonly reference: string, private readonly before: string, private readonly scenario: Scenario) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'zero-HTTP repair rehearsal'); }
  private last(options: GenerateOptions): ModelResult | undefined {
    const result = options.messages.filter(m => m.role === 'tool').at(-1);
    if (!result || result.role !== 'tool') return;
    assert(!result.isError, 'Native transport failure is not a controller receipt');
    const text = result.content.find(b => b.type === 'text'); assert(text?.type === 'text');
    return JSON.parse(text.text) as ModelResult;
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assert.equal(options.provider, provider); assert.equal(options.model, 'scripted'); assert(++this.calls <= 20);
    const previous = this.last(options);
    if (previous) {
      assert(previous.context.bytes <= 8192); assert.equal(Buffer.byteLength(previous.context.text), previous.context.bytes);
      assert(previous.context.text.includes('contractDigest')); this.projectionChecks++;
      this.largestProjectionBytes = Math.max(this.largestProjectionBytes, previous.context.bytes);
      if (previous.context.memory === 'provided') this.providedMemoryRequests++;
    }
    if (this.scenario === 'self_report' || previous?.result.status === 'accepted' || previous?.result.status === 'stopped') {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'The scripted assistant claims the task is complete.' } };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    if (previous?.result.status === 'needs_replan') this.action = 0;
    const stage = this.action++;
    let name: string; let args: object;
    if (stage === 0) { name = 'repair_plan'; args = { revision: this.revision, steps: exampleRepairPlan }; this.revision++; }
    else if (stage === 1) { name = 'repair_read'; args = { revision: this.revision, stepId: 'inspect', path: 'target.py' }; }
    else if (stage === 2) {
      assert.equal(previous?.result.reason, 'file_read'); this.fileDigest = previous.result.codeDigest!;
      assert(previous.result.code && digest(previous.result.code) === this.fileDigest);
      name = 'repair_check'; args = { revision: this.revision, stepId: 'reproduce' };
    } else if (stage === 3) {
      assert.equal(previous?.result.reason, 'failure_reproduced'); name = 'repair_patch';
      args = { revision: this.revision, stepId: 'fix', path: 'target.py', expectedDigest: this.fileDigest,
        code: this.scenario === 'replan' && this.revision === 1 ? this.before : this.reference };
    } else if (stage === 4) { assert.equal(previous?.result.reason, 'patched'); name = 'repair_check'; args = { revision: this.revision, stepId: 'validate' }; }
    else throw new Error('Unexpected scripted tool result');
    assert(options.tools?.some(t => t.name === name)); this.nativeCalls++;
    const id = ToolCallId(randomUUID()), argumentsText = JSON.stringify(args);
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText };
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

export async function repairDemo(scenario: Scenario = 'happy') {
  assert(repairDemoScenarios.includes(scenario));
  const root = await newStudyRoot(resolve('.probe-work/t073-repair-agent'));
  const python = process.env.EVOLVE_PYTHON ?? 'python'; await probeStudyPython(python, root);
  const { vendor } = await installStudyVendor(python, root);
  const execution = boundedStudyExecution(python, vendor, root);
  const bank = await createStudySourceBank(root, python, studyChildEnvironment(root));
  const item = studyCases[0]!; const workspace = await repairWorkspace(root, item, execution);
  const service = new EvolveService(bank.store, bank.repo, { trusted: false, python, acceptanceDir: join(root, 'runner-checks'), regressionPath: 'tests', timeoutMs: 15000 });
  const task = service.begin('repair-runner-memory', item.prompt); const selection = service.select(task.id);
  const memory = () => {
    const exp = selection.experience; if (!exp || !selection.application) return '';
    const current = bank.store.experience(exp.id); if (!current || digest(JSON.stringify(current)) !== digest(JSON.stringify(exp))) return '';
    if (!service.provenance(current).complete || applicability(current.scope, snapshot(bank.repo, Object.keys(current.scope.requiredFiles)).scope)) return '';
    return compileAgentContext({ experience: current, citations: service.provenance(current).citations,
      applicationId: selection.application.id, query: item.prompt, policy: { policy: 'evidence-mmr-v1', maxNoticeBytes: 6000 } }, 'source-order').text;
  };
  if (scenario === 'unknown') workspace.check = async () => { throw new Error('Injected unknown tool transport'); };
  const runner = new RepairAgent(item.prompt, workspace, memory);
  const adapter = new RepairScript(item.reference, item.before, scenario); const ctx = new Context();
  try {
    for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
    bindRepairTools(ctx, runner); ctx.llm.registerAdapter([provider], adapter);
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    const handle = await ctx.agents.create({ sessionId: SessionId('repair-example-' + randomUUID()), meta: {}, agentOptions: { provider, model: 'scripted', maxTokens: 2048 } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: runner.context().text }] }));
      await Promise.race([handle.agent.whenIdle(), new Promise<never>((_, reject) => { timer = setTimeout(() => {
        runner.cancel(); handle.agent.cancel({ kind: 'hook', reason: 'repair_demo_deadline' }); reject(new Error('Demo deadline'));
      }, 90000); })]); runner.finishTurn();
    } finally { clearTimeout(timer); await handle.dispose(); }
    const report = { schemaVersion: 1, kind: 'scripted-native-repair-agent', scenario, realModel: false, benefitEvaluated: false, providerHttpCalls: 0,
      sourceProofs: bank.proofs.map(p => ({ source: p.source, baseRejected: (p.base as { failures: number }).failures > 0,
        fixedPassed: (p.fixed as { exitCode: number }).exitCode === 0, regressionPassed: (p.regression as { exitCode: number }).exitCode === 0 })),
      memorySelected: selection.experience !== null, scriptedRequests: adapter.calls, nativeToolCalls: adapter.nativeCalls,
      providedMemoryRequests: adapter.providedMemoryRequests, projectionChecks: adapter.projectionChecks, largestProjectionBytes: adapter.largestProjectionBytes,
      controller: runner.report() };
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    return { root, report };
  } finally { await ctx.fiber.dispose(); bank.store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert(args.length <= 1 && (!args[0] || repairDemoScenarios.includes(args[0] as Scenario)), 'Only a scripted scenario is accepted');
  const { root, report } = await repairDemo(args[0] as Scenario | undefined);
  console.log(JSON.stringify({ report: join(root, 'report.json'), accepted: report.controller.accepted, status: report.controller.status,
    nativeToolCalls: report.nativeToolCalls, realModel: false, providerHttpCalls: 0 }));
  process.exitCode = report.controller.accepted === ['happy', 'replan'].includes(report.scenario) ? 0 : 1;
}
