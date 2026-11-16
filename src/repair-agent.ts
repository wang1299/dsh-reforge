import { z } from 'zod';
import { digest, hashSchema } from './domain.js';
import { repairContext } from './repair-agent-context.js';
import { RepairRejected, repairCheckSchema, repairPatchSchema, repairPlanSchema, repairReadSchema,
  repairStepCallSchema, validRepairPlan, type RepairFile, type RepairStatus, type RepairStep, type RepairTool, type RepairWorkspace } from './repair-agent-contract.js';

type Step = RepairStep & { state: 'pending' | 'completed' | 'failed' };
export interface RepairReceipt {
  ok: boolean; reason: string; revision: number; status: RepairStatus;
  codeDigest?: string; code?: string; cases?: { id: string; status: string }[];
}
/** Explicitly invoked, in-process controller. DSH owns model/tool transport; owner owns the workspace. */
export class RepairAgent {
  private status: RepairStatus = 'awaiting_plan'; private reason = 'plan_required';
  private revision = 0; private steps: Step[] = []; private readDigest: string | null = null;
  private currentDigest: string; private calls = new Map<string, { request: string; result: RepairReceipt }>();
  private tail: Promise<unknown> = Promise.resolve(); private trace: { tool: RepairTool; reason: string; requestDigest: string }[] = [];
  private memoryProjections = 0;
  private readonly binding: { initialDigest: string; contractDigest: string; expectedCases: string[] };
  constructor(private readonly goal: string, private readonly workspace: RepairWorkspace,
    private readonly memory: () => string = () => '', private readonly budgetBytes = 8192, private readonly maxCalls = 32) {
    z.string().min(1).max(1500).parse(goal); hashSchema.parse(workspace.initialDigest); hashSchema.parse(workspace.contractDigest);
    z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,95}$/)).min(1).max(16).parse(workspace.expectedCases);
    if (new Set(workspace.expectedCases).size !== workspace.expectedCases.length) throw new Error('Duplicate acceptance IDs');
    this.binding = { initialDigest: workspace.initialDigest, contractDigest: workspace.contractDigest, expectedCases: [...workspace.expectedCases] };
    z.number().int().min(1).max(32).parse(maxCalls); this.currentDigest = workspace.initialDigest;
    this.context();
  }
  snapshot() { return structuredClone({ status: this.status, reason: this.reason, revision: this.revision, steps: this.steps,
    currentDigest: this.currentDigest, contractDigest: this.binding.contractDigest }); }
  report() { return { schemaVersion: 1, kind: 'bounded-repair-controller', ...this.snapshot(), distinctCalls: this.calls.size,
    memoryProjections: this.memoryProjections, trace: structuredClone(this.trace), accepted: this.status === 'accepted' }; }
  context() {
    let reference = ''; try { reference = this.memory(); } catch { /* Missing qualification means no memory. */ }
    const context = repairContext({ goal: this.goal, ...this.snapshot() }, reference, this.budgetBytes);
    if (context.status === 'mandatory_over_budget') this.stop('context_budget');
    else if (context.memory === 'provided') this.memoryProjections++;
    return context;
  }
  finishTurn() { if (this.status !== 'accepted' && this.status !== 'stopped') this.stop('incomplete_turn'); }
  cancel() { this.stop('cancelled'); }
  private stop(reason: string) { if (this.status !== 'accepted') { this.status = 'stopped'; this.reason = reason; } }
  private reply(ok: boolean, reason: string, extra: Partial<RepairReceipt> = {}): RepairReceipt {
    return { ok, reason, revision: this.revision, status: this.status, ...extra };
  }
  dispatch(callId: string, tool: RepairTool, args: unknown): Promise<RepairReceipt> {
    const next = this.tail.then(() => this.execute(callId, tool, args));
    this.tail = next.catch(() => {}); return next;
  }
  private async execute(callId: string, tool: RepairTool, args: unknown): Promise<RepairReceipt> {
    if (!z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).safeParse(callId).success) return this.reply(false, 'invalid_call_id');
    let request: string; let invalid = false;
    try { const text = JSON.stringify([tool, args]); invalid = Buffer.byteLength(text) > 8192; request = digest(text); }
    catch { request = digest('non_json_input'); invalid = true; }
    const old = this.calls.get(callId);
    if (old) return old.request === request ? structuredClone(old.result) : this.reply(false, 'call_id_conflict');
    if (this.calls.size >= this.maxCalls) { this.stop('call_limit'); return this.reply(false, 'call_limit'); }
    let result: RepairReceipt;
    try {
      if (this.status === 'stopped' || this.status === 'accepted') result = this.reply(false, 'terminal');
      else if (invalid) result = this.reply(false, 'invalid_input');
      else if (tool === 'repair_plan') result = this.plan(args);
      else result = await this.step(tool, args);
    } catch { this.stop('execution_unknown'); result = this.reply(false, 'execution_unknown'); }
    this.calls.set(callId, { request, result: structuredClone(result) });
    this.trace.push({ tool, reason: result.reason, requestDigest: request });
    return result;
  }
  private plan(args: unknown): RepairReceipt {
    const input = repairPlanSchema.safeParse(args);
    if (!input.success || !validRepairPlan(input.data.steps)) return this.reply(false, 'invalid_plan');
    if (input.data.revision !== this.revision) return this.reply(false, 'stale_plan');
    if (this.status !== 'awaiting_plan' && this.status !== 'needs_replan') return this.reply(false, 'plan_locked');
    if (this.revision >= 3) { this.stop('replan_limit'); return this.reply(false, 'replan_limit'); }
    this.revision++; this.steps = input.data.steps.map(s => ({ ...s, state: 'pending' })); this.readDigest = null;
    this.status = 'running'; this.reason = 'plan_admitted'; return this.reply(true, this.reason);
  }
  private file(value: RepairFile) {
    if (typeof value.code !== 'string' || Buffer.byteLength(value.code) > 4096 || digest(value.code) !== value.codeDigest) throw new Error('Invalid file receipt');
    return value;
  }
  private async step(tool: RepairTool, args: unknown): Promise<RepairReceipt> {
    const schema = tool === 'repair_read' ? repairReadSchema : tool === 'repair_patch' ? repairPatchSchema : tool === 'repair_check' ? repairStepCallSchema : null;
    const parsed = schema?.safeParse(args);
    if (!parsed?.success) return this.reply(false, 'invalid_input');
    const input = parsed.data;
    if (input.revision !== this.revision) return this.reply(false, 'stale_plan');
    if (this.status !== 'running') return this.reply(false, 'plan_required');
    const step = this.steps.find(s => s.id === input.stepId);
    const wanted = tool === 'repair_read' ? ['read'] : tool === 'repair_patch' ? ['patch'] : ['reproduce', 'verify'];
    if (!step || !wanted.includes(step.action) || step.state !== 'pending') return this.reply(false, 'invalid_step');
    if (step.dependsOn.some(id => this.steps.find(s => s.id === id)?.state !== 'completed')) return this.reply(false, 'dependency_pending');
    if (tool === 'repair_read') {
      const read = this.file(await this.workspace.read());
      if (this.status !== 'running') return this.reply(false, 'terminal');
      if (read.codeDigest !== this.currentDigest) { this.stop('file_drift'); return this.reply(false, 'file_drift'); }
      this.readDigest = read.codeDigest; step.state = 'completed'; return this.reply(true, 'file_read', read);
    }
    if (tool === 'repair_patch') {
      const patch = repairPatchSchema.parse(input);
      if (this.readDigest !== patch.expectedDigest || patch.expectedDigest !== this.currentDigest) return this.reply(false, 'stale_file');
      try {
        const read = this.file(await this.workspace.patch(patch.expectedDigest, patch.code));
        if (read.codeDigest !== digest(patch.code) || this.status !== 'running') throw new Error('Patch not confirmed');
        this.currentDigest = read.codeDigest; this.readDigest = null; step.state = 'completed';
        return this.reply(true, 'patched', { codeDigest: this.currentDigest });
      } catch (error) { if (error instanceof RepairRejected) return this.reply(false, error.reason); throw error; }
    }
    const receipt = repairCheckSchema.parse(await this.workspace.check(step.action as 'reproduce' | 'verify'));
    const actual = receipt.cases.map(c => c.id).sort(); const expected = [...this.binding.expectedCases].sort();
    if (receipt.contractDigest !== this.binding.contractDigest || receipt.codeDigest !== (step.action === 'reproduce' ? this.binding.initialDigest : this.currentDigest)
      || JSON.stringify(actual) !== JSON.stringify(expected) || receipt.timedOut || receipt.exitCode === null || receipt.cases.some(c => ['skipped', 'error'].includes(c.status))) {
      this.stop('acceptance_unknown'); return this.reply(false, 'acceptance_unknown');
    }
    if (this.status !== 'running') return this.reply(false, 'terminal');
    const failed = receipt.cases.some(c => c.status === 'failed');
    if (step.action === 'reproduce') {
      if (receipt.exitCode !== 1 || !failed) { this.stop('failure_not_reproduced'); return this.reply(false, 'failure_not_reproduced'); }
      step.state = 'completed'; return this.reply(true, 'failure_reproduced', { cases: receipt.cases });
    }
    const after = this.file(await this.workspace.read());
    if (this.status !== 'running') return this.reply(false, 'terminal');
    if (after.codeDigest !== this.currentDigest) { this.stop('file_drift'); return this.reply(false, 'file_drift'); }
    if (receipt.exitCode === 0 && !failed) {
      step.state = 'completed';
      if (this.steps.every(s => s.state === 'completed')) { this.status = 'accepted'; this.reason = 'independent_acceptance'; }
      return this.reply(true, 'tests_passed', { cases: receipt.cases });
    }
    if (receipt.exitCode !== 1 || !failed) { this.stop('acceptance_unknown'); return this.reply(false, 'acceptance_unknown'); }
    step.state = 'failed'; this.status = 'needs_replan'; this.reason = 'tests_failed';
    if (this.revision >= 3) this.stop('replan_limit');
    return this.reply(false, 'tests_failed', { cases: receipt.cases });
  }
}
