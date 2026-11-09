import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { git } from '../src/repository.js';
import { configSchema } from '../src/config.js';
import { execFileSync } from 'node:child_process';

const policy = () => ({ grantId: crypto.randomUUID(), provider: 'scripted-offline', model: 'fixture', maxCalls: 1, maxTokens: 256, timeoutMs: 5000 });
async function setup() {
  const f = await fixture(); const store = new Store(join(f.home, 'learning.sqlite'));
  const verification = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 };
  const extraction = policy(); const service = new EvolveService(store, f.repo, verification, true, extraction, true, true);
  return { f, store, service, verification, extraction };
}

test('normal-request segments learn an uncommitted repair, independently qualify it and provide it to a later request', async () => {
  const { f, store, service } = await setup();
  try {
    const task = service.automatic.begin('source', 1, [{ id: 'user-one', text: '修复 transaction rollback failure restore balance' }]); assert.ok(task);
    await writeFile(join(f.repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
    service.automatic.finish('source', 1);
    assert.equal(await service.jobs.runNext(), true); assert.equal(store.learning.bundles()[0]!.status, 'ready');
    assert.equal(await service.extraction.runNext(async () => ({ text: JSON.stringify({ kind: 'candidate', title: 'transaction rollback restore balance', strategy: 'Save the prior balance and restore it before raising on failure.', factIds: ['verification:base', 'verification:fixed', 'verification:regression'], inferences: [], recommendations: [] }), usage: null })), true);
    assert.equal(store.experiences()[0]!.status, 'candidate');
    assert.equal(await service.automatic.runNext(), true);
    const learned = store.experiences()[0]!; assert.equal(learned.status, 'source_verified'); assert.equal(learned.revision, 2);
    assert.equal(store.automatic.rows()[0]!.state, 'learned'); assert.equal(store.verification(learned.verificationId!)!.verified, true);
    const later = service.automatic.begin('target', 1, [{ id: 'user-two', text: 'transaction rollback failure restore balance' }]); assert.ok(later);
    const context = service.automatic.context('target'); assert.match(context, /Save the prior balance/); assert.equal(store.applications().length, 1);
    assert.equal(service.automatic.context('target'), context); assert.equal(store.applications().length, 1);
    service.automatic.finish('target', 1); assert.equal(store.automatic.rows().at(-1)!.state, 'skipped');
    assert.equal(git(f.repo, ['rev-parse', 'HEAD']), f.base); assert.match(git(f.repo, ['status', '--short']), /ledger.py/);
    assert.equal(store.extraction.grants()[0]!.used, 1); assert.equal(store.feedback().length, 0);
  } finally { store.close(); }
});

test('duplicate requests, concurrent sessions and explicit manual tasks cannot silently merge or replay', async () => {
  const { store, service } = await setup();
  try {
    const first = service.automatic.begin('one', 1, [{ id: 'one-message', text: 'Fix rollback' }]); assert.ok(first);
    assert.equal(service.automatic.begin('one', 1, [{ id: 'one-message', text: 'Fix rollback' }])?.id, first.id);
    assert.equal(service.automatic.begin('two', 1, [{ id: 'two-message', text: 'Fix something else' }]), null);
    service.automatic.finish('one', 1); assert.equal(store.learning.jobs().length, 0); assert.ok(store.automatic.rows().every(s => s.state === 'blocked'));
    const manual = service.begin('manual', 'Explicit repair'); assert.ok(manual);
    assert.equal(service.automatic.begin('manual', 2, [{ id: 'manual-message', text: 'Continue' }]), null);
    assert.equal(store.task(manual.id)!.state, 'open'); assert.equal(store.extraction.jobs().length, 0);
  } finally { store.close(); }
});

test('only narrowly explicit corrections become facts and extra steering blocks ambiguous capture', async () => {
  const { store, service } = await setup();
  try {
    service.automatic.begin('one', 1, [{ id: 'one', text: '纠正：失败后恢复原值，token=private-value' }]);
    assert.equal(store.evidenceRecords().length, 1); assert.ok(!JSON.stringify(store.evidenceRecords()).includes('private-value'));
    service.automatic.invalidate('one', 1, 'multiple_inputs'); service.automatic.finish('one', 1);
    assert.equal(store.learning.jobs().length, 0); assert.equal(store.automatic.rows()[0]!.state, 'blocked');
    service.automatic.begin('one', 2, [{ id: 'two', text: 'Please inspect this code' }]);
    assert.equal(store.evidenceRecords().length, 1);
  } finally { store.close(); }
});

test('a manual task starting after automatic capture blocks the earlier segment', async () => {
  const { store, service } = await setup();
  try {
    const automatic = service.automatic.begin('automatic', 1, [{ id: 'earlier', text: 'Fix rollback' }]); assert.ok(automatic);
    const manual = service.begin('manual-later', 'A different explicit task');
    assert.equal(store.automatic.rows()[0]!.state, 'blocked'); assert.equal(store.task(automatic.id)!.state, 'closed');
    service.automatic.finish('automatic', 1); assert.equal(store.learning.jobs().length, 0);
    assert.equal(store.task(manual.id)!.state, 'open');
  } finally { store.close(); }
});

test('automatic mode is explicitly opted in and old configuration cannot grant it implicitly', async () => {
  assert.equal(configSchema.parse({ repoRoot: 'repository' }).automaticLearning, false);
  assert.equal(configSchema.safeParse({ repoRoot: 'repository', automaticLearning: true }).success, false);
  const f = await fixture(); const store = new Store(join(f.home, 'off.sqlite'));
  try {
    const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 15000 });
    assert.equal(service.automatic.begin('off', 1, [{ id: 'off', text: 'Fix rollback' }]), null); assert.equal(store.tasks().length, 0); assert.equal(store.automatic.rows().length, 0);
  } finally { store.close(); }
});

test('failed independent repair proof blocks automatic extraction without consuming a model call', async () => {
  const { f, store, service } = await setup();
  try {
    service.automatic.begin('failed', 1, [{ id: 'failed', text: 'Fix rollback' }]);
    await writeFile(join(f.repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    state["balance"] += 1\n    if fail:\n        raise ValueError("still broken")\n    return state["balance"]\n');
    service.automatic.finish('failed', 1); await service.jobs.runNext();
    let calls = 0; await service.extraction.runNext(async () => { calls++; throw new Error('Must not run'); }); await service.automatic.runNext();
    assert.equal(calls, 0); assert.equal(store.extraction.grants()[0]!.used, 0); assert.equal(store.experiences().length, 0);
    assert.equal(store.automatic.rows()[0]!.state, 'blocked'); assert.equal(store.learning.bundles()[0]!.status, 'incomplete');
  } finally { store.close(); }
});

test('only a confirmed ESRCH receipt recovers an automatic capture; live and inaccessible identities are never replayed', async () => {
  const { f, store, service, verification, extraction } = await setup();
  const probes = new Map<number, 'ESRCH' | 'EPERM' | 'alive'>([[1999999997, 'ESRCH'], [1999999998, 'EPERM'], [1999999999, 'alive']]);
  const rows = [];
  for (const [pid, receipt] of probes) {
    const session = 'probe-' + receipt; service.automatic.begin(session, 1, [{ id: session, text: 'Fix rollback' }]);
    const row = store.automatic.rows().find(r => r.sessionId === session)!; store.automatic.write({ ...row, ownerPid: pid }); rows.push({ ...row, receipt });
  }
  store.close(); const reopened = new Store(join(f.home, 'learning.sqlite')); const originalKill = process.kill;
  try {
    // Model the exact OS receipt, without assuming an exited PID cannot be reused on Windows.
    process.kill = ((pid, signal) => {
      const receipt = signal === 0 ? probes.get(pid) : undefined;
      if (!receipt) return originalKill(pid, signal); if (receipt === 'alive') return true;
      throw Object.assign(new Error('Synthetic process liveness receipt'), { code: receipt });
    }) as typeof process.kill;
    let restarted: EvolveService;
    try { restarted = new EvolveService(reopened, f.repo, verification, true, extraction, true, true); }
    finally { process.kill = originalKill; }
    for (const row of rows) {
      const current = reopened.automatic.rows().find(r => r.id === row.id)!; const dead = row.receipt === 'ESRCH';
      assert.equal(current.state, dead ? 'unknown' : 'open'); assert.equal(reopened.task(row.taskId!)!.state, dead ? 'closed' : 'open');
      assert.equal(restarted.automatic.begin(row.sessionId, 1, [{ id: row.sessionId, text: 'Fix rollback' }]), null);
    }
    assert.equal(await restarted.automatic.runNext(), false); assert.equal(reopened.learning.jobs().length, 0); assert.equal(reopened.extraction.grants().length, 0);
  } finally { process.kill = originalKill; reopened.close(); }
});

test('actual exited-child recovery follows the current OS receipt, including a reused or inaccessible PID', async t => {
  const { f, store, service, verification, extraction } = await setup();
  service.automatic.begin('restart', 1, [{ id: 'restart', text: 'Fix rollback' }]);
  const old = store.automatic.rows()[0]!;
  const exitedPid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true }));
  store.automatic.write({ ...old, ownerPid: exitedPid }); store.close();
  const reopened = new Store(join(f.home, 'learning.sqlite'));
  const originalKill = process.kill; let absent: boolean | undefined;
  try {
    process.kill = ((pid, signal) => {
      if (pid !== exitedPid || signal !== 0) return originalKill(pid, signal);
      try { const alive = originalKill(pid, signal); absent = false; return alive; }
      catch (error) { absent = (error as NodeJS.ErrnoException).code === 'ESRCH'; throw error; }
    }) as typeof process.kill;
    let restarted: EvolveService;
    try { restarted = new EvolveService(reopened, f.repo, verification, true, extraction, true, true); }
    finally { process.kill = originalKill; }
    assert.notEqual(absent, undefined, 'Observe the actual recovery probe, not an earlier racy lookup');
    assert.equal(reopened.automatic.rows()[0]!.state, absent ? 'unknown' : 'open'); assert.equal(reopened.task(old.taskId!)!.state, absent ? 'closed' : 'open');
    assert.equal(restarted.automatic.begin('restart', 1, [{ id: 'restart', text: 'Fix rollback' }]), null); assert.equal(await restarted.automatic.runNext(), false);
    assert.equal(reopened.learning.jobs().length, 0); assert.equal(reopened.extraction.grants().length, 0);
    t.diagnostic(JSON.stringify({ exitedChild: true, currentOsConfirmedAbsent: absent, reusedOrUnconfirmedIdentityPreserved: !absent, automaticReplay: false }));
  } finally { process.kill = originalKill; reopened.close(); }
});

test('changed frozen snapshot metadata cannot authorize verification or extraction', async () => {
  const { f, store, service } = await setup();
  try {
    service.automatic.begin('tampered', 1, [{ id: 'tampered', text: 'Fix rollback' }]);
    await writeFile(join(f.repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before=state["balance"]\n    state["balance"]+=1\n    if fail:\n        state["balance"]=before\n        raise ValueError("failed")\n    return state["balance"]\n');
    service.automatic.finish('tampered', 1); const s = store.automatic.rows()[0]!;
    store.automatic.write({ ...s, fixed: { ...s.fixed!, digest: '0'.repeat(64) } }); await service.jobs.runNext();
    assert.equal(store.learning.jobs()[0]!.effectStarted, false); assert.equal(store.learning.jobs()[0]!.reason, 'invalid_source');
    let calls = 0; await service.extraction.runNext(async () => { calls++; throw new Error('Must not run'); }); assert.equal(calls, 0);
  } finally { store.close(); }
});
