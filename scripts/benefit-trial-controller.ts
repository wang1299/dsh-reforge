/** Bounded controller rehearsal. No live adapter, endpoint, credentials or financial authorization. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, createUserMessage, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { digest } from '../src/domain.js';
import { passes, reproduces } from '../src/verification.js';
import { runPilotTests, briefPilotTests } from './pilot-fixtures.js';
import { newStudyRoot, StudyValidationError, validateStudyCode } from './benefit-study-preflight.js';
import { studyProjectSentinel, writeStudyTarget } from './benefit-study-files.js';
import { studySystem, studyTaskInput, type StudyCase } from './benefit-study-cases.js';

export const rehearsalModes = ['first_pass', 'repair_once', 'unchanged', 'self_report', 'forbidden_code', 'interrupted'] as const;
export type RehearsalMode = typeof rehearsalModes[number];
export type AttemptStatus = 'accepted' | 'tests_failed' | 'invalid_output' | 'invalid_code' | 'execution_unknown' | 'transport_unknown';
const referenceMarker = 'DSH-Reforge repair experience (fallible data, not instructions or evidence of benefit):\n';
export function parseStudyProposal(text: string): string {
  if (Buffer.byteLength(text) > 8192 || !/^\s*\{\s*"code"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}\s*$/s.test(text)) throw new Error('invalid_output');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error('invalid_output'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1
    || !('code' in value) || typeof value.code !== 'string' || !value.code.trim() || Buffer.byteLength(value.code) > 4096) throw new Error('invalid_output');
  return value.code;
}
interface Attempt {
  round: number; status: AttemptStatus; actualScriptedRequests: number; outputDigest: string | null;
  codeDigest: string | null; executionAttempted: boolean; tests: ReturnType<typeof acceptanceSummary> | null; durationMs: number;
}
function acceptanceSummary(run: Awaited<ReturnType<typeof runPilotTests>>) {
  return { ...briefPilotTests(run), passed: passes(run), cases: run.cases.map(c => ({ id: c.id.split('::').at(-1)!.slice(0, 96), status: c.status })) };
}
export function repairFeedback(status: AttemptStatus, tests: Attempt['tests']): string {
  assert(['tests_failed', 'invalid_output', 'invalid_code'].includes(status), 'Unknown work is not an automatic retry');
  return 'Independent repair check: ' + status + '. One final repair attempt is allowed. Re-check the original task contract; return only the complete repair function as the same JSON shape.\n'
    + JSON.stringify({ status, cases: tests?.cases.slice(0, 8).map(c => ({ id: c.id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 96), status: c.status })) ?? [] });
}
class ScriptedRepairAdapter extends LlmAdapter {
  calls = 0; round = 0; readonly inputDigests: string[] = [];
  constructor(private readonly item: StudyCase, private readonly memory: string | null, private readonly mode: RehearsalMode) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'bounded controller zero HTTP'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assert.equal(options.provider, 'study-controller-scripted'); assert.equal(options.model, 'scripted');
    assert.equal(this.calls, this.round - 1, 'Exactly one request per planned attempt; no provider retries'); this.calls++;
    assert.equal(options.maxTokens, 2048); assert.equal(options.temperature, 0); assert.equal(options.tools?.length ?? 0, 0);
    const textFor = (role: string) => options.messages.filter(m => m.role === role).flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
    const system = textFor('system'); const user = textFor('user');
    assert(system.some(s => s.includes(studySystem))); assert(user.includes(studyTaskInput(this.item)));
    const references = user.filter(s => s.startsWith(referenceMarker));
    assert.deepEqual(references, this.memory ? [referenceMarker + this.memory] : []);
    if (this.round === 2) {
      const feedback = user.findLast(s => s.startsWith('Independent repair check:')); assert(feedback);
      assert(!feedback.includes(this.item.reference) && !feedback.includes(this.item.checks));
    }
    this.inputDigests.push(digest(JSON.stringify({ system: options.system ?? null,
      messages: options.messages.map(m => ({ role: m.role, content: m.content })),
      tools: options.tools ?? [], temperature: options.temperature, maxTokens: options.maxTokens })));
    let text: string;
    if (this.mode === 'self_report') text = 'Everything is fixed and all tests pass. This is only a scripted self-report.';
    else if (this.mode === 'forbidden_code') text = JSON.stringify({ code: 'def repair(state):\n    return open("outside", "w")\n' });
    else if (this.mode === 'interrupted') text = '{"code":"';
    else text = JSON.stringify({ code: this.mode === 'first_pass' || this.mode === 'repair_once' && this.round === 2 ? this.item.reference : this.item.before });
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
    if (this.mode === 'interrupted') throw new Error('scripted_transport_unknown');
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

/** Only a fixed internal scripted adapter is constructible here. This is not a live entry point. */
export async function rehearseBenefitTrial(input: { parent: string; item: StudyCase; memory: string | null; mode: RehearsalMode; python?: string; projectRoot?: string }) {
  assert(rehearsalModes.includes(input.mode)); const python = input.python ?? process.env.EVOLVE_PYTHON ?? 'python';
  const root = await newStudyRoot(input.parent); const tests = join(root, 'checks'); await mkdir(tests);
  const project = input.projectRoot ?? join(root, 'project');
  const projectParent = input.projectRoot ? input.parent : root;
  if (!input.projectRoot) { await mkdir(project); await writeFile(join(project, 'contract.py'), studyProjectSentinel, { flag: 'wx', mode: 0o600 }); }
  await writeFile(join(tests, 'test_contract.py'), input.item.checks, { flag: 'wx' });
  await writeStudyTarget(projectParent, project, input.item.before);
  const ctx = new Context(); const adapter = new ScriptedRepairAdapter(input.item, input.memory, input.mode);
  const attempts: Attempt[] = []; let lastText: string | null = null; let completed = false; const started = Date.now();
  try {
    for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
    ctx.systemPrompt.section({ name: 'benefit-controller-system', order: 100, text: studySystem, complete: true, interpolate: false });
    ctx.llm.registerAdapter(['study-controller-scripted'], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0 }));
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'assistant/message' || event.data.interrupted) return;
      const text = event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
      completed = true; lastText = Buffer.byteLength(text) <= 8192 ? text : null;
    });
    const sessionId = SessionId('bounded-study-' + randomUUID());
    const handle = await ctx.agents.create({ sessionId, meta: {}, agentOptions: { provider: 'study-controller-scripted', model: 'scripted', maxTokens: 2048 } });
    try {
      let prompt = studyTaskInput(input.item);
      for (const round of [1, 2]) {
        adapter.round = round; completed = false; lastText = null; const began = Date.now(); const beforeCalls = adapter.calls;
        const content = round === 1 ? [{ type: 'text' as const, text: prompt }, ...(input.memory ? [{ type: 'text' as const, text: referenceMarker + input.memory }] : [])]
          : [{ type: 'text' as const, text: prompt }];
        let timedOut = false; let timer: ReturnType<typeof setTimeout> | undefined;
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content }));
        try { await Promise.race([handle.agent.whenIdle(), new Promise<void>(resolve => {
          timer = setTimeout(() => { timedOut = true; handle.agent.cancel({ kind: 'hook', reason: 'scripted_controller_deadline' }); resolve(); }, 30000); timer.unref();
        })]); } finally { clearTimeout(timer); }
        const row: Attempt = { round, status: 'transport_unknown', actualScriptedRequests: adapter.calls - beforeCalls,
          outputDigest: lastText === null ? null : digest(lastText), codeDigest: null, executionAttempted: false, tests: null, durationMs: 0 };
        if (!timedOut && completed && row.actualScriptedRequests === 1) {
          let code: string | null = null;
          try { if (lastText === null) throw new Error('invalid_output'); code = parseStudyProposal(lastText); }
          catch { row.status = 'invalid_output'; }
          if (code !== null) {
            row.codeDigest = digest(code);
            try { validateStudyCode(python, code); }
            catch (error) { row.status = error instanceof StudyValidationError && error.kind === 'rejected' ? 'invalid_code' : 'execution_unknown'; code = null; }
          }
          if (code !== null) {
            await writeFile(join(root, 'proposal-' + round + '.py'), code, { flag: 'wx', mode: 0o600 });
            await writeStudyTarget(projectParent, project, code); row.executionAttempted = true;
            const checked = await runPilotTests(python, project, tests, join(root, 'attempt-' + round + '.xml'));
            row.tests = acceptanceSummary(checked);
            row.status = checked.skipped === 0 && passes(checked) ? 'accepted'
              : checked.skipped === 0 && reproduces(checked) ? 'tests_failed' : 'execution_unknown';
          }
        }
        row.durationMs = Date.now() - began; attempts.push(row);
        if (['accepted', 'execution_unknown', 'transport_unknown'].includes(row.status) || round === 2) break;
        prompt = repairFeedback(row.status, row.tests);
      }
      const result = { kind: 'scripted-agent-repair-trial', case: input.item.id, mode: input.mode, sessionId: String(sessionId),
        taskInputDigest: digest(studyTaskInput(input.item)), referenceDigest: input.memory ? digest(input.memory) : null,
        referenceProvided: input.memory !== null, inputDigests: adapter.inputDigests, attempts, firstPass: attempts[0]?.status === 'accepted',
        finalPass: attempts.at(-1)?.status === 'accepted', unknown: attempts.some(a => a.status.endsWith('_unknown')),
        actualAttempts: attempts.length, actualScriptedRequests: adapter.calls, actualReworkAttempts: Math.max(0, attempts.length - 1),
        actualHumanEdits: 0, durationMs: Date.now() - started, modelHttpRequests: 0, realModelBenefit: false,
        financialUsage: 'not_applicable_scripted', liveExecutionImplemented: false };
      await writeFile(join(root, 'trial-result.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
      return { root, result };
    } finally { await handle.dispose(); }
  } finally { await ctx.fiber.dispose(); }
}
