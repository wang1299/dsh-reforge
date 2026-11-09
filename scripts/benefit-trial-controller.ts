/** Shared bounded repair controller. Provider authorization and credentials stay in the outer guarded backend. */
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
import { inspectStudyInput, studyReferenceMarker as referenceMarker, type StudyControllerDriver } from './study-controller-driver.js';
import type { StudyExecutionPort } from './study-bounded-python.js';

export const rehearsalModes = ['first_pass', 'repair_once', 'unchanged', 'self_report', 'forbidden_code', 'interrupted'] as const;
export type RehearsalMode = typeof rehearsalModes[number];
export type AttemptStatus = 'accepted' | 'tests_failed' | 'invalid_output' | 'invalid_code' | 'execution_unknown' | 'transport_unknown';
export function parseStudyProposal(text: string): string {
  if (Buffer.byteLength(text) > 8192 || !/^\s*\{\s*"code"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}\s*$/s.test(text)) throw new Error('invalid_output');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error('invalid_output'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1
    || !('code' in value) || typeof value.code !== 'string' || !value.code.trim() || Buffer.byteLength(value.code) > 4096) throw new Error('invalid_output');
  return value.code;
}
export interface Attempt {
  round: number; status: AttemptStatus; actualRequests: number; actualScriptedRequests: number; actualSdkRequests: number; outputDigest: string | null;
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
    assert.equal(this.calls, this.round - 1, 'Exactly one request per planned attempt; no provider retries'); this.calls++;
    this.inputDigests.push(inspectStudyInput(options, this.item, this.memory, this.round, 'study-controller-scripted', 'scripted'));
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

export interface StudyTrialInput { parent: string; item: StudyCase; memory: string | null; mode: string; python?: string; projectRoot?: string; projectOwner?: string; execution?: StudyExecutionPort }
/** Trusted internal harness API; a driver is not an authorization to call a paid provider. */
export async function executeBenefitTrial(input: StudyTrialInput, driver: StudyControllerDriver) {
  assert(['scripted', 'official-sdk-offline', 'official-sdk-live'].includes(driver.kind)); const python = input.python ?? process.env.EVOLVE_PYTHON ?? 'python';
  const execution = driver.kind === 'official-sdk-live' ? driver.execution : input.execution;
  if (driver.kind === 'official-sdk-live') assert(execution?.kind === 'bounded-study-v1', 'Live studies require the bounded worker');
  const root = await newStudyRoot(input.parent); const tests = join(root, 'checks'); await mkdir(tests);
  const project = input.projectRoot ?? join(root, 'project');
  assert(!input.projectOwner || input.projectRoot, 'A separate project owner requires an explicit existing project');
  const projectParent = input.projectRoot ? input.projectOwner ?? input.parent : root;
  if (!input.projectRoot) { await mkdir(project); await writeFile(join(project, 'contract.py'), studyProjectSentinel, { flag: 'wx', mode: 0o600 }); }
  await writeFile(join(tests, 'test_contract.py'), input.item.checks, { flag: 'wx' });
  await writeStudyTarget(projectParent, project, input.item.before);
  const ctx = new Context(); const adapter = driver.adapter;
  const attempts: Attempt[] = []; let lastText: string | null = null; let completed = false; const started = Date.now();
  try {
    for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
    ctx.systemPrompt.section({ name: 'benefit-controller-system', order: 100, text: studySystem, complete: true, interpolate: false });
    ctx.llm.registerAdapter([driver.provider], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0 }));
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'assistant/message' || event.data.interrupted) return;
      const text = event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
      completed = true; lastText = Buffer.byteLength(text) <= 8192 ? text : null;
    });
    const sessionId = SessionId('bounded-study-' + randomUUID());
    const handle = await ctx.agents.create({ sessionId, meta: {}, agentOptions: { provider: driver.provider, model: driver.model, maxTokens: 2048 } });
    try {
      let prompt = studyTaskInput(input.item);
      for (const round of [1, 2]) {
        adapter.round = round; completed = false; lastText = null; const began = Date.now(); const beforeCalls = adapter.calls;
        const content = round === 1 ? [{ type: 'text' as const, text: prompt }, ...(input.memory ? [{ type: 'text' as const, text: referenceMarker + input.memory }] : [])]
          : [{ type: 'text' as const, text: prompt }];
        let timedOut = false; let timer: ReturnType<typeof setTimeout> | undefined;
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content }));
        try { await Promise.race([handle.agent.whenIdle(), new Promise<void>(resolve => {
          timer = setTimeout(() => { timedOut = true; handle.agent.cancel({ kind: 'hook', reason: 'study_controller_deadline' }); resolve(); }, driver.kind === 'official-sdk-live' ? 150000 : 30000); timer.unref();
        })]); } finally { clearTimeout(timer); }
        const actualRequests = adapter.calls - beforeCalls;
        const row: Attempt = { round, status: 'transport_unknown', actualRequests,
          actualScriptedRequests: driver.kind === 'scripted' ? actualRequests : 0, actualSdkRequests: driver.kind !== 'scripted' ? actualRequests : 0,
          outputDigest: lastText === null ? null : digest(lastText), codeDigest: null, executionAttempted: false, tests: null, durationMs: 0 };
        if (!timedOut && completed && row.actualRequests === 1) {
          let code: string | null = null;
          try { if (lastText === null) throw new Error('invalid_output'); code = parseStudyProposal(lastText); }
          catch { row.status = 'invalid_output'; }
          if (code !== null) {
            row.codeDigest = digest(code);
            try { if (execution) execution.validate(code); else validateStudyCode(python, code); }
            catch (error) { row.status = error instanceof StudyValidationError && error.kind === 'rejected' ? 'invalid_code' : 'execution_unknown'; code = null; }
          }
          if (code !== null) {
            await writeFile(join(root, 'proposal-' + round + '.py'), code, { flag: 'wx', mode: 0o600 });
            await writeStudyTarget(projectParent, project, code); row.executionAttempted = true;
            const xml = join(root, 'attempt-' + round + '.xml');
            const checked = execution ? await execution.run(project, tests, xml) : await runPilotTests(python, project, tests, xml);
            row.tests = acceptanceSummary(checked);
            row.status = checked.skipped === 0 && passes(checked) ? 'accepted'
              : checked.skipped === 0 && reproduces(checked) ? 'tests_failed' : 'execution_unknown';
          }
        }
        row.durationMs = Date.now() - began; attempts.push(row);
        if (['accepted', 'execution_unknown', 'transport_unknown'].includes(row.status) || round === 2) break;
        prompt = repairFeedback(row.status, row.tests);
      }
      const result = { kind: driver.kind === 'scripted' ? 'scripted-agent-repair-trial' : driver.kind === 'official-sdk-offline'
        ? 'official-sdk-offline-repair-trial' : driver.scope === 'live' ? 'real-provider-repair-trial' : 'live-path-fixture-repair-trial', case: input.item.id, mode: input.mode, sessionId: String(sessionId),
        taskInputDigest: digest(studyTaskInput(input.item)), referenceDigest: input.memory ? digest(input.memory) : null,
        referenceProvided: input.memory !== null, inputDigests: adapter.inputDigests, attempts, firstPass: attempts[0]?.status === 'accepted',
        finalPass: attempts.at(-1)?.status === 'accepted', unknown: attempts.some(a => a.status.endsWith('_unknown')),
        actualAttempts: attempts.length, actualScriptedRequests: driver.kind === 'scripted' ? adapter.calls : 0,
        actualSdkRequests: driver.kind !== 'scripted' ? adapter.calls : 0, actualReworkAttempts: Math.max(0, attempts.length - 1),
        actualHumanEdits: 0, durationMs: Date.now() - started, modelHttpRequests: driver.kind === 'official-sdk-live' ? driver.httpRequests() : 0,
        realModelBenefit: driver.kind === 'official-sdk-live' && driver.scope === 'live' ? null : false,
        financialUsage: driver.kind === 'scripted' ? 'not_applicable_scripted' : driver.kind === 'official-sdk-live' && driver.scope === 'live'
          ? 'provider_usage_peak_upper_bound' : 'synthetic_offline_only', liveExecutionImplemented: driver.kind === 'official-sdk-live' };
      await writeFile(join(root, 'trial-result.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
      return { root, result };
    } finally { await handle.dispose(); }
  } finally { await ctx.fiber.dispose(); }
}

export async function rehearseBenefitTrial(input: Omit<StudyTrialInput, 'mode'> & { mode: RehearsalMode }) {
  assert(rehearsalModes.includes(input.mode));
  return executeBenefitTrial(input, { kind: 'scripted', provider: 'study-controller-scripted', model: 'scripted',
    adapter: new ScriptedRepairAdapter(input.item, input.memory, input.mode) });
}
