import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepairAgent } from '../src/repair-agent.js';
import { RepairRejected, type RepairWorkspace, type RepairCheck } from '../src/repair-agent-contract.js';
import { repairContext } from '../src/repair-agent-context.js';
import { digest } from '../src/domain.js';

const steps = [
  { id: 'read', action: 'read', dependsOn: [] }, { id: 'base', action: 'reproduce', dependsOn: ['read'] },
  { id: 'patch', action: 'patch', dependsOn: ['read', 'base'] }, { id: 'test', action: 'verify', dependsOn: ['patch'] },
];
function fixture() {
  const initial = 'def repair(state):\n    return False\n', fixed = 'def repair(state):\n    return True\n';
  let code = initial, patches = 0, checks = 0;
  const workspace: RepairWorkspace = { initialDigest: digest(initial), contractDigest: digest('fixed independent contract'), expectedCases: ['test_edge', 'test_normal'],
    async read() { return { code, codeDigest: digest(code) }; },
    async patch(expected, proposal) { if (expected !== digest(code)) throw new RepairRejected('stale_file'); patches++; code = proposal; return this.read(); },
    async check(phase) {
      checks++; const pass = phase === 'verify' && code === fixed;
      return { codeDigest: digest(phase === 'reproduce' ? initial : code), contractDigest: this.contractDigest, exitCode: pass ? 0 : 1, timedOut: false,
        cases: [{ id: 'test_edge', status: pass ? 'passed' : 'failed' }, { id: 'test_normal', status: 'passed' }] };
    } };
  const runner = new RepairAgent('Preserve valid zero and independently verify the repair.', workspace);
  let call = 0;
  const send = (tool: Parameters<RepairAgent['dispatch']>[1], args: unknown) => runner.dispatch('call_' + (++call), tool, args);
  const prepare = async () => {
    const revision = runner.snapshot().revision;
    assert.equal((await send('repair_plan', { revision, steps })).ok, true);
    const current = revision + 1;
    const read = await send('repair_read', { revision: current, stepId: 'read', path: 'target.py' }); assert.equal(read.ok, true);
    assert.equal((await send('repair_check', { revision: current, stepId: 'base' })).reason, 'failure_reproduced'); return { read, revision: current };
  };
  const patch = async (proposal = fixed) => { const { read, revision } = await prepare();
    assert.equal((await send('repair_patch', { revision, stepId: 'patch', path: 'target.py', expectedDigest: read.codeDigest, code: proposal })).reason, 'patched'); return revision; };
  return { runner, workspace, send, prepare, patch, initial, fixed, counts: () => ({ patches, checks }), mutate: (text: string) => { code = text; } };
}

test('independent bound case receipts, rather than plan or patch success, accept the task', async () => {
  const f = fixture(); const revision = await f.patch(); assert.equal(f.runner.report().accepted, false);
  assert.equal((await f.send('repair_check', { revision, stepId: 'test' })).reason, 'tests_passed');
  assert.equal(f.runner.report().accepted, true); assert.equal(f.runner.snapshot().reason, 'independent_acceptance');
  assert(f.runner.snapshot().steps.every(s => s.state === 'completed'));
});

test('normal assistant completion without independent checks stops incomplete', () => {
  const f = fixture(); f.runner.finishTurn(); assert.equal(f.runner.snapshot().reason, 'incomplete_turn'); assert.equal(f.runner.report().accepted, false);
});

for (const [name, bad] of Object.entries({ cycle: [steps[0], { ...steps[1], dependsOn: ['test'] }, ...steps.slice(2)],
  duplicate: [steps[0], steps[0], ...steps.slice(2)], bypass: [steps[0], steps[1], { ...steps[2], dependsOn: ['read'] }, steps[3]],
  missing: steps.slice(0, 3), disconnected: [...steps.slice(0, 3), { id: 'unused', action: 'read', dependsOn: [] }, steps[3]],
  extra: steps.map(s => ({ ...s, completed: true })) })) {
  test('plan admission rejects ' + name, async () => { const f = fixture();
    assert.equal((await f.send('repair_plan', { revision: 0, steps: bad })).reason, 'invalid_plan'); assert.deepEqual(f.counts(), { checks: 0, patches: 0 }); });
}

test('steps cannot bypass dependencies, change paths, inject permission, or use stale plan revisions', async () => {
  const f = fixture(); await f.send('repair_plan', { revision: 0, steps });
  assert.equal((await f.send('repair_check', { revision: 1, stepId: 'test' })).reason, 'dependency_pending');
  assert.equal((await f.send('repair_read', { revision: 1, stepId: 'read', path: '../secret' })).reason, 'invalid_input');
  assert.equal((await f.send('repair_read', { revision: 1, stepId: 'read', path: 'target.py', trusted: true })).reason, 'invalid_input');
  assert.equal((await f.send('repair_read', { revision: 0, stepId: 'read', path: 'target.py' })).reason, 'invalid_input');
  assert.deepEqual(f.counts(), { checks: 0, patches: 0 });
});

test('known failed verification permits replan, resets all steps and rejects old calls', async () => {
  const f = fixture(); let revision = await f.patch(f.initial);
  assert.equal((await f.send('repair_check', { revision, stepId: 'test' })).reason, 'tests_failed');
  assert.equal(f.runner.snapshot().status, 'needs_replan');
  revision = await f.patch(); assert.equal(revision, 2);
  assert.equal((await f.send('repair_check', { revision: 1, stepId: 'test' })).reason, 'stale_plan');
  await f.send('repair_check', { revision, stepId: 'test' }); assert.equal(f.runner.report().accepted, true);
});

test('running plans cannot be replaced and repeated known failures exhaust the replan limit', async () => {
  const f = fixture(); await f.prepare(); assert.equal((await f.send('repair_plan', { revision: 1, steps })).reason, 'plan_locked');
  const g = fixture();
  for (let round = 0; round < 3; round++) { const revision = await g.patch(g.initial); await g.send('repair_check', { revision, stepId: 'test' }); }
  assert.equal(g.runner.snapshot().reason, 'replan_limit'); assert.equal(g.runner.snapshot().status, 'stopped');
});

test('duplicate concurrent patch ID executes once; changed args with the same ID are refused', async () => {
  const f = fixture(); const { read, revision } = await f.prepare();
  const args = { revision, stepId: 'patch', path: 'target.py', expectedDigest: read.codeDigest, code: f.fixed };
  const pair = await Promise.all([f.runner.dispatch('same', 'repair_patch', args), f.runner.dispatch('same', 'repair_patch', args)]);
  assert.deepEqual(pair[0], pair[1]); assert.equal(f.counts().patches, 1);
  assert.equal((await f.runner.dispatch('same', 'repair_patch', { ...args, code: f.initial })).reason, 'call_id_conflict');
});

test('patch needs the latest read digest and a confirmed exact proposed file', async () => {
  const f = fixture(); const { revision } = await f.prepare();
  assert.equal((await f.send('repair_patch', { revision, stepId: 'patch', path: 'target.py', expectedDigest: digest('old'), code: f.fixed })).reason, 'stale_file');
  f.workspace.patch = async () => ({ code: f.initial, codeDigest: digest(f.initial) });
  assert.equal((await f.send('repair_patch', { revision, stepId: 'patch', path: 'target.py', expectedDigest: digest(f.initial), code: f.fixed })).reason, 'execution_unknown');
});

test('explicit no-effect code rejection can be corrected; other patch errors halt', async () => {
  const f = fixture(); const { revision, read } = await f.prepare();
  f.workspace.patch = async () => { throw new RepairRejected('invalid_code'); };
  const args = { revision, stepId: 'patch', path: 'target.py', expectedDigest: read.codeDigest, code: f.fixed };
  assert.equal((await f.send('repair_patch', args)).reason, 'invalid_code'); assert.equal(f.runner.snapshot().status, 'running');
  f.workspace.patch = async () => { throw new Error('private backend error'); };
  assert.equal((await f.send('repair_patch', args)).reason, 'execution_unknown'); assert(!JSON.stringify(f.runner.report()).includes('private backend'));
});

for (const kind of ['missing', 'duplicate', 'skipped', 'error', 'timeout', 'contract_drift', 'code_drift', 'bad_exit'] as const) {
  test('acceptance cannot pass with ' + kind, async () => {
    const f = fixture(); const revision = await f.patch(); const good = await f.workspace.check('verify');
    const bad: RepairCheck = structuredClone(good);
    if (kind === 'missing') bad.cases.pop();
    if (kind === 'duplicate') bad.cases[1] = bad.cases[0]!;
    if (kind === 'skipped' || kind === 'error') bad.cases[0]!.status = kind;
    if (kind === 'timeout') bad.timedOut = true;
    if (kind === 'contract_drift') bad.contractDigest = digest('different contract');
    if (kind === 'code_drift') bad.codeDigest = digest('different code');
    if (kind === 'bad_exit') bad.exitCode = 2;
    f.workspace.check = async () => bad;
    await f.send('repair_check', { revision, stepId: 'test' });
    assert.equal(f.runner.snapshot().status, 'stopped'); assert.equal(f.runner.report().accepted, false);
  });
}

test('unknown execution stops without retry; duplicate receipt and future requests have no effect', async () => {
  const f = fixture(); await f.prepare(); let count = 0; f.workspace.check = async () => { count++; throw new Error('unavailable'); };
  const args = { revision: 1, stepId: 'test' }; // dependency check must prevent execution first
  assert.equal((await f.runner.dispatch('blocked', 'repair_check', args)).reason, 'dependency_pending'); assert.equal(count, 0);
  const g = fixture(); const revision = await g.patch(); g.workspace.check = async () => { count++; throw new Error('unavailable'); };
  const receipt = await g.runner.dispatch('unknown', 'repair_check', { revision, stepId: 'test' });
  assert.equal(receipt.reason, 'execution_unknown');
  assert.deepEqual(await g.runner.dispatch('unknown', 'repair_check', { revision, stepId: 'test' }), receipt);
  assert.equal((await g.send('repair_plan', { revision, steps })).reason, 'terminal'); assert.equal(count, 1);
});

test('a file changed after independent verification is not accepted', async () => {
  const f = fixture(); const revision = await f.patch(); const good = await f.workspace.check('verify');
  f.workspace.check = async () => { f.mutate(f.initial); return good; };
  assert.equal((await f.send('repair_check', { revision, stepId: 'test' })).reason, 'file_drift');
});

test('acceptance identity and expected cases are copied from the host at construction', async () => {
  const f = fixture(); const revision = await f.patch();
  f.workspace.contractDigest = digest('changed'); f.workspace.expectedCases.splice(0, 2, 'test_replacement');
  await f.send('repair_check', { revision, stepId: 'test' });
  assert.equal(f.runner.report().accepted, false); assert.equal(f.runner.snapshot().reason, 'acceptance_unknown');
});

test('an already passing baseline is not evidence that a repair reproduced the failure', async () => {
  const f = fixture(); const originalCheck = f.workspace.check;
  f.workspace.check = async () => ({ ...await originalCheck('reproduce'), exitCode: 0,
    cases: [{ id: 'test_edge', status: 'passed' }, { id: 'test_normal', status: 'passed' }] });
  await f.send('repair_plan', { revision: 0, steps }); await f.send('repair_read', { revision: 1, stepId: 'read', path: 'target.py' });
  assert.equal((await f.send('repair_check', { revision: 1, stepId: 'base' })).reason, 'failure_not_reproduced'); assert.equal(f.counts().patches, 0);
});

test('oversized malformed input consumes a distinct-call slot and cannot bypass the quota', async () => {
  const f = fixture(); const runner = new RepairAgent('goal', f.workspace, () => '', 8192, 1);
  assert.equal((await runner.dispatch('large', 'repair_plan', { payload: 'x'.repeat(9000) })).reason, 'invalid_input');
  assert.equal((await runner.dispatch('next', 'repair_plan', { revision: 0, steps })).reason, 'call_limit');
});

test('cancellation during final read cannot be overwritten by acceptance', async () => {
  const f = fixture(); const revision = await f.patch(); const read = f.workspace.read;
  f.workspace.read = async () => { f.runner.cancel(); return read(); };
  await f.send('repair_check', { revision, stepId: 'test' }); assert.equal(f.runner.snapshot().status, 'stopped'); assert.equal(f.runner.report().accepted, false);
});

test('context retains mandatory plan and entire reference or omits the reference atomically', () => {
  const memory = '中文事实及完整引用'.repeat(80), required = { goal: 'preserve zero', plan: steps, contract: digest('contract') };
  const full = repairContext(required, memory, 8192); assert.equal(JSON.parse(full.text).memory, memory); assert.equal(full.bytes, Buffer.byteLength(full.text));
  const small = repairContext(required, memory, 1024); assert.equal(small.memory, 'over_budget'); assert.deepEqual(JSON.parse(small.text).task, required);
  assert.equal(JSON.parse(small.text).memory, null); assert(small.bytes <= 1024);
  assert.equal(repairContext({ goal: 'x'.repeat(9000) }, '', 512).status, 'mandatory_over_budget');
});

test('context failure, qualification drift, and call limits are explicit and reports contain no source or goal text', async () => {
  const f = fixture(); let allowed = true;
  const runner = new RepairAgent('private goal sentinel', f.workspace, () => allowed ? 'qualified reference sentinel' : '');
  assert.equal(runner.context().memory, 'provided'); allowed = false; assert.equal(runner.context().memory, 'none');
  const bounded = new RepairAgent('goal', f.workspace, () => '', 8192, 1);
  await bounded.dispatch('first', 'repair_plan', { revision: 0, steps });
  assert.equal((await bounded.dispatch('second', 'repair_read', { revision: 1, stepId: 'read', path: 'target.py' })).reason, 'call_limit');
  const text = JSON.stringify(runner.report()); assert(!text.includes('private goal sentinel') && !text.includes('qualified reference sentinel') && !text.includes('def repair'));
});
