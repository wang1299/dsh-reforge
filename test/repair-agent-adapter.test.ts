import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { bindRepairTools } from '../src/dsh-adapter-repair.js';
import { RepairAgent } from '../src/repair-agent.js';
import { digest } from '../src/domain.js';
import type { RepairWorkspace, RepairCheck } from '../src/repair-agent-contract.js';

test('native tool schemas expose plan/patch contracts and propagate in-flight cancellation to acceptance', async () => {
  let code = 'before'; const contractDigest = digest('contract');
  const workspace: RepairWorkspace = { initialDigest: digest(code), contractDigest, expectedCases: ['test_contract'],
    async read() { return { code, codeDigest: digest(code) }; },
    async patch(_expected, next) { code = next; return this.read(); },
    async check(phase) { return { codeDigest: digest(phase === 'reproduce' ? 'before' : code), contractDigest,
      exitCode: phase === 'reproduce' ? 1 : 0, timedOut: false, cases: [{ id: 'test_contract', status: phase === 'reproduce' ? 'failed' : 'passed' }] }; } };
  const runner = new RepairAgent('fixed goal', workspace); const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await(); bindRepairTools(ctx, runner);
    const tools = (await ctx.systemPrompt.assemble()).tools;
    assert.deepEqual(tools.map(t => t.name).sort(), ['repair_check', 'repair_patch', 'repair_plan', 'repair_read']);
    const patch = tools.find(t => t.name === 'repair_patch')!; const required = patch.parameters.required;
    assert(Array.isArray(required)); assert(required.includes('expectedDigest')); assert(required.includes('code'));
    let id = 0; const send = (name: Parameters<RepairAgent['dispatch']>[1], args: unknown) => runner.dispatch('prepare_' + (++id), name, args);
    await send('repair_plan', { revision: 0, steps: [
      { id: 'read', action: 'read', dependsOn: [] }, { id: 'base', action: 'reproduce', dependsOn: ['read'] },
      { id: 'patch', action: 'patch', dependsOn: ['read', 'base'] }, { id: 'test', action: 'verify', dependsOn: ['patch'] },
    ] });
    await send('repair_read', { revision: 1, stepId: 'read', path: 'target.py' });
    await send('repair_check', { revision: 1, stepId: 'base' });
    await send('repair_patch', { revision: 1, stepId: 'patch', path: 'target.py', expectedDigest: digest('before'), code: 'after' });
    const good = await workspace.check('verify');
    let entered!: () => void; let release!: (value: RepairCheck) => void;
    const began = new Promise<void>(done => { entered = done; });
    workspace.check = () => { entered(); return new Promise<RepairCheck>(done => { release = done; }); };
    const controller = new AbortController();
    const pending = ctx.tools.execute({ name: 'repair_check', callId: ToolCallId(randomUUID()),
      arguments: { revision: 1, stepId: 'test' }, signal: controller.signal });
    await began; controller.abort(); release(good); await pending;
    assert.equal(runner.report().accepted, false); assert.equal(runner.snapshot().status, 'stopped');
  } finally { await ctx.fiber.dispose(); }
});
