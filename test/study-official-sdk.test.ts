import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { StudyCostLedger, studyCostPolicy } from '../scripts/study-cost-ledger.js';
import { guardedOfflineWireCall } from '../scripts/study-call-guard.js';
import { studyCases } from '../scripts/benefit-study-cases.js';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { executeBenefitTrial } from '../scripts/benefit-trial-controller.js';
import { createOfflineSdkDriver, sdkFixtureStream } from '../scripts/study-offline-sdk.js';
import { runOfficialTrialAttempt } from '../scripts/study-trial-attempt.js';

async function fixture() {
  const dir = await newStudyRoot(fileURLToPath(new URL('../../.probe-work/t064-wire-tests', import.meta.url)));
  const binding = { studyId: randomUUID(), planDigest: digest('synthetic offline plan, not a live freeze') };
  const ledger = StudyCostLedger.create(dir, binding); ledger.approve(binding, 10_000_000, digest('synthetic approval, not a real grant'));
  return { dir, binding, ledger };
}
const wire = ' { "messages": [{"role":"user","content":"synthetic"}], "system":"system", "temperature":0, "thinking":{"type":"disabled"}, "max_tokens":2048, "stream":true, "model":"deepseek-flash" }\n';
function options(f: Awaited<ReturnType<typeof fixture>>) {
  return { ledger: f.ledger, binding: f.binding, identity: { trialIndex: 0, round: 1 as const, inputDigest: digest(wire) }, wire,
    checkFrozen: async () => ({ planDigest: f.binding.planDigest }),
    transport: { kind: 'offline-fixture' as const, respond: async () => ({ status: 200, body: sdkFixtureStream(studyCases[0]!, 'first_pass', 1) }) } };
}

test('official study CLI accepts no live mode, credential path or extra option', () => {
  const cli = fileURLToPath(new URL('../scripts/study-official-runner.js', import.meta.url));
  for (const args of [[], ['live'], ['offline-wire', '--credentials=outside'], ['offline-wire', '--live']]) {
    assert.throws(() => execFileSync(process.execPath, [cli, ...args], { windowsHide: true, stdio: 'ignore' }));
  }
});

test('raw wire retains original bytes and rejects duplicate keys before reservation', async () => {
  const f = await fixture();
  try {
    await assert.rejects(guardedOfflineWireCall({ ...options(f), wire: wire.replace('"max_tokens":2048', '"max_tokens":3000,"max_tokens":2048') }));
    assert.equal(f.ledger.summary.calls, 0);
    await guardedOfflineWireCall({ ...options(f), transport: { kind: 'offline-fixture', respond: async value => {
      assert.equal(value, wire); assert.equal(f.ledger.state.calls[0]!.inputDigest, digest(wire));
      return { status: 200, body: sdkFixtureStream(studyCases[0]!, 'first_pass', 1) };
    } } });
    assert.equal(f.ledger.summary.settledUpperBound, 460);
  } finally { f.ledger.close(); }
});

test('cancellation before or during freeze never reserves or dispatches', async () => {
  for (const preCancelled of [true, false]) {
    const f = await fixture(); const controller = new AbortController(); let sends = 0; if (preCancelled) controller.abort();
    try {
      await assert.rejects(guardedOfflineWireCall({ ...options(f), signal: controller.signal,
        checkFrozen: async () => { controller.abort(); return { planDigest: f.binding.planDigest }; },
        transport: { kind: 'offline-fixture', respond: async () => { sends++; throw new Error('must never dispatch'); } } }));
      assert.equal(sends, 0); assert.equal(f.ledger.summary.calls, 0); assert.equal(f.ledger.summary.phase, 'prepared');
    } finally { f.ledger.close(); }
  }
});

test('post-reservation cancellation holds full liability and a late valid response cannot settle it', async () => {
  const f = await fixture(); const controller = new AbortController(); let sends = 0;
  let release!: (value: { status: number; body: string }) => void;
  try {
    await assert.rejects(guardedOfflineWireCall({ ...options(f), signal: controller.signal,
      transport: { kind: 'offline-fixture', respond: async () => { sends++; controller.abort(); return new Promise(resolve => { release = resolve; }); } } }));
    assert.equal(sends, 1); assert.equal(f.ledger.summary.unknownReserved, studyCostPolicy.reservation);
    release({ status: 200, body: sdkFixtureStream(studyCases[0]!, 'first_pass', 1) }); await Promise.resolve();
    assert.equal(f.ledger.summary.settledUpperBound, 0); assert.equal(f.ledger.summary.phase, 'unknown');
    await assert.rejects(guardedOfflineWireCall(options(f))); assert.equal(f.ledger.summary.calls, 1);
  } finally { f.ledger.close(); }
});

test('a finite guard deadline stops an unresponsive offline transport without replay', async () => {
  const f = await fixture(); let sends = 0;
  try {
    await assert.rejects(guardedOfflineWireCall({ ...options(f), deadlineMs: 10,
      transport: { kind: 'offline-fixture', respond: async () => { sends++; return new Promise(() => {}); } } }));
    assert.equal(sends, 1); assert.equal(f.ledger.summary.stopped, 'transport_unknown'); assert.equal(f.ledger.summary.unknownReserved, studyCostPolicy.reservation);
  } finally { f.ledger.close(); }
});

test('official SDK uses the same two-round controller and independent pytest with exactly two loopback calls', async () => {
  const f = await fixture();
  try {
    const sdk = await createOfflineSdkDriver({ ledger: f.ledger, binding: f.binding, trialIndex: 0, item: studyCases[0]!,
      memory: null, mode: 'repair_once', checkFrozen: async () => ({ planDigest: f.binding.planDigest }) });
    try {
      const trial = await executeBenefitTrial({ parent: f.dir, item: studyCases[0]!, memory: null, mode: 'repair_once' }, sdk.driver);
      assert.deepEqual(trial.result.attempts.map(a => a.status), ['tests_failed', 'accepted']);
      assert.equal(trial.result.actualSdkRequests, 2); assert.equal(trial.result.actualScriptedRequests, 0); assert.equal(trial.result.actualReworkAttempts, 1);
      assert.equal(trial.result.modelHttpRequests, 0); assert.equal(trial.result.financialUsage, 'synthetic_offline_only');
      const state = sdk.snapshot(); assert.equal(state.loopbackRequests, 2); assert.equal(state.offlineTransportInvocations, 2); assert.equal(state.providerHttpRequests, 0);
      assert.deepEqual(state.wireDigests, f.ledger.state.calls.map(c => c.inputDigest)); assert.equal(f.ledger.summary.settledUpperBound, 920);
      assert.equal(new Set(trial.result.inputDigests).size, 2);
      assert(!(await readFile(join(trial.root, 'trial-result.json'), 'utf8')).includes('msg_synthetic'));
      f.ledger.finish(false);
    } finally { await sdk.close(); }
  } finally { f.ledger.close(); }
});

test('official SDK HTTP failure and truncated usage never trigger another request or code execution', async () => {
  for (const mode of ['http_error', 'truncated'] as const) {
    const f = await fixture();
    try {
      const sdk = await createOfflineSdkDriver({ ledger: f.ledger, binding: f.binding, trialIndex: 0, item: studyCases[0]!,
        memory: null, mode, checkFrozen: async () => ({ planDigest: f.binding.planDigest }) });
      try {
        const trial = await executeBenefitTrial({ parent: f.dir, item: studyCases[0]!, memory: null, mode }, sdk.driver);
        assert.deepEqual(trial.result.attempts.map(a => a.status), ['transport_unknown']); assert.equal(trial.result.actualSdkRequests, 1);
        assert.equal(trial.result.attempts[0]!.executionAttempted, false); assert.equal(trial.result.actualReworkAttempts, 0);
        assert.equal(sdk.snapshot().loopbackRequests, 1); assert.equal(sdk.snapshot().offlineTransportInvocations, 1);
        assert.equal(f.ledger.summary.unknownReserved, studyCostPolicy.reservation); assert.equal(f.ledger.summary.stopped, mode === 'http_error' ? 'http_error' : 'invalid_receipt');
      } finally { await sdk.close(); }
    } finally { f.ledger.close(); }
  }
});

test('closing an actual SDK pending request preserves the committed unknown reservation', async () => {
  const f = await fixture();
  try {
    const sdk = await createOfflineSdkDriver({ ledger: f.ledger, binding: f.binding, trialIndex: 0, item: studyCases[0]!,
      memory: null, mode: 'unresponsive', checkFrozen: async () => ({ planDigest: f.binding.planDigest }) });
    const running = executeBenefitTrial({ parent: f.dir, item: studyCases[0]!, memory: null, mode: 'unresponsive' }, sdk.driver);
    try {
      await Promise.race([sdk.whenDispatched, running.then(() => { throw new Error('SDK ended before dispatch'); })]);
      await sdk.close(); const trial = await running;
      assert.deepEqual(trial.result.attempts.map(a => a.status), ['transport_unknown']); assert.equal(trial.result.actualSdkRequests, 1);
      assert.equal(sdk.snapshot().loopbackRequests, 1); assert.equal(f.ledger.summary.unknownReserved, studyCostPolicy.reservation);
      assert.equal(f.ledger.summary.phase, 'unknown');
    } finally { await sdk.close(); await running; }
  } finally { f.ledger.close(); }
});

test('a controller result lost after an actual SDK response retains request counts and financial receipts', async () => {
  const f = await fixture();
  try {
    const outcome = await runOfficialTrialAttempt({ ledger: f.ledger, binding: f.binding, trialIndex: 0, mode: 'first_pass',
      checkFrozen: async () => ({ planDigest: f.binding.planDigest }),
      trial: { parent: f.dir, item: studyCases[0]!, memory: null, mode: 'first_pass' } }, async (input, driver) => {
      await executeBenefitTrial(input, driver); throw new Error('Synthetic lost result after request');
    });
    assert.equal(outcome.trial, null); assert.equal(outcome.receipt.resultRecorded, false); assert.equal(outcome.receipt.countsComplete, true);
    assert.equal(outcome.receipt.sdkRequests, 1); assert.equal(outcome.receipt.loopbackRequests, 1); assert.equal(outcome.receipt.failureReason, 'controller_result_unavailable');
    assert.equal(f.ledger.summary.calls, 1); assert.equal(f.ledger.summary.settledUpperBound, 460);
  } finally { f.ledger.close(); }
});
