import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '../src/domain.js';
import { StudyCostLedger, studyCostPolicy as policy, type StudyCallIdentity, type StudyCostBinding } from '../scripts/study-cost-ledger.js';
import { guardedOfflineStudyCall, studyUsageReceipt, studyWireRequest, type OfflineStudyTransport } from '../scripts/study-call-guard.js';

async function root() { await mkdir('.probe-work', { recursive: true }); return mkdtemp(resolve('.probe-work/t063-cost-test-')); }
const binding = (): StudyCostBinding => ({ studyId: randomUUID(), planDigest: digest('synthetic frozen study, not owner authorization') });
const key = (trialIndex = 0, round: 1 | 2 = 1): StudyCallIdentity => ({ trialIndex, round, inputDigest: digest('synthetic request') });
const approval = digest('synthetic test approval only, never a real owner grant');
function stored(path: string) { const db = new DatabaseSync(path, { readOnly: true });
  try { return JSON.parse(String(db.prepare('SELECT body FROM study_cost WHERE id=1').get()!.body)); } finally { db.close(); } }
function sql(path: string, statement: string) { const db = new DatabaseSync(path); try { db.exec(statement); } finally { db.close(); } }
async function approved(cap = 10_000_000) {
  const dir = await root(); const b = binding(); const ledger = StudyCostLedger.create(dir, b); ledger.approve(b, cap, approval); return { dir, b, ledger };
}
const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
function response(u: object = usage) {
  return frame({ type: 'message_start', message: { model: 'deepseek-flash', usage: { input_tokens: 999999, output_tokens: 0 } } })
    + frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'private synthetic output never persisted in ledger' } })
    + frame({ type: 'content_block_stop', index: 0 })
    + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: u }) + frame({ type: 'message_stop' });
}
const request = () => ({ model: 'deepseek-flash', stream: true, max_tokens: 2048, temperature: 0,
  thinking: { type: 'disabled' }, system: 'synthetic system', messages: [{ role: 'user', content: 'synthetic task' }] });
function call(ledger: StudyCostLedger, b: StudyCostBinding, transport: OfflineStudyTransport, overrides: object = {}) {
  const body = request(); return guardedOfflineStudyCall({ ledger, binding: b,
    identity: { ...key(), inputDigest: digest(studyWireRequest(body)) }, request: body,
    checkFrozen: async () => ({ planDigest: b.planDigest }), transport, ...overrides });
}

test('study accounting starts unapproved and preserves the immutable single-plan grant', async () => {
  const dir = await root(); const b = binding(); const ledger = StudyCostLedger.create(dir, b);
  try {
    assert.deepEqual(ledger.summary, { phase: 'unapproved', calls: 0, cap: null, stopped: null, settledUpperBound: 0, unknownReserved: 0 });
    assert.throws(() => ledger.reserve(b, key())); assert.throws(() => ledger.approve(binding(), 10_000_000, approval));
    ledger.approve(b, 10_000_000, approval); assert.throws(() => ledger.approve(b, 10_000_000, approval));
    assert.throws(() => ledger.reserve({ ...b, planDigest: digest('drift') }, key()));
    const copy = ledger.state; copy.cap = 1; copy.binding.planDigest = digest('mutation');
    assert.equal(ledger.state.cap, 10_000_000); assert.equal(ledger.state.binding.planDigest, b.planDigest);
  } finally { ledger.close(); }
  const reopened = StudyCostLedger.open(dir, b);
  try { assert.equal(reopened.state.phase, 'prepared'); assert.equal(reopened.state.approvalDigest, approval); }
  finally { reopened.close(); }
  assert.throws(() => StudyCostLedger.create(dir, b));
});

test('offline transport sees a committed reservation before dispatch; only final cumulative usage settles', async () => {
  const { b, ledger } = await approved(); let invocations = 0;
  try {
    const result = await call(ledger, b, { kind: 'offline-fixture', respond: async raw => {
      invocations++; const row = stored(ledger.path); assert.equal(row.phase, 'started'); assert.equal(row.calls[0].charge, policy.reservation);
      assert.equal(row.calls[0].usage, null); assert.equal(row.calls[0].inputDigest, digest(raw)); return { status: 200, body: response() };
    } });
    assert.equal(invocations, 1); assert.deepEqual(result.receipt.usage, { input: 150, output: 20 });
    assert.equal(ledger.summary.settledUpperBound, 460); assert.equal(ledger.summary.unknownReserved, 0);
    assert(!JSON.stringify(stored(ledger.path)).includes('private synthetic output')); assert.equal(result.kind, 'offline-fixture');
    ledger.finish(false); assert.equal(ledger.summary.phase, 'incomplete'); assert.throws(() => ledger.reserve(b, key(0, 2)));
  } finally { ledger.close(); }
});

test('freeze, authorization and wire policy reject before reserving or invoking transport', async () => {
  const { b, ledger } = await approved(); let sent = 0;
  const transport: OfflineStudyTransport = { kind: 'offline-fixture', respond: async () => { sent++; return { status: 200, body: response() }; } };
  try {
    for (const change of [{ model: 'deepseek-v4-pro' }, { max_tokens: 3000 }, { temperature: 1 }, { tools: [{ name: 'tool' }] },
      { thinking: { type: 'enabled' } }, { messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] },
      { output_config: {} }, { system: 'x'.repeat(policy.maxRequestBytes) }]) {
      await assert.rejects(call(ledger, b, transport, { request: { ...request(), ...change } }));
    }
    await assert.rejects(call(ledger, b, transport, { checkFrozen: async () => ({ planDigest: digest('changed') }) }));
    await assert.rejects(call(ledger, b, transport, { identity: key() }));
    assert.equal(sent, 0); assert.equal(ledger.summary.calls, 0); assert.equal(ledger.summary.phase, 'prepared');
  } finally { ledger.close(); }
});

test('pending freeze callbacks cannot mutate the copied wire request or request identity', async () => {
  const { b, ledger } = await approved(); const body = request(); const original = studyWireRequest(body);
  const identity = { ...key(), inputDigest: digest(original) }; const suppliedBinding = { ...b };
  try {
    await call(ledger, b, { kind: 'offline-fixture', respond: async raw => { assert.equal(raw, original); return { status: 200, body: response() }; } }, {
      request: body, identity, binding: suppliedBinding, checkFrozen: async () => {
        body.messages[0]!.content = 'mutated task'; identity.trialIndex = 20; suppliedBinding.planDigest = digest('mutated binding');
        return { planDigest: b.planDigest };
      } });
    assert.equal(ledger.state.calls[0]!.trialIndex, 0); assert.equal(ledger.state.calls[0]!.inputDigest, digest(original));
  } finally { ledger.close(); }
});

test('trial-round identities enforce order and block duplicates throughout the complete 72-request bound', async () => {
  const { b, ledger } = await approved();
  try {
    assert.throws(() => ledger.reserve(b, key(0, 2))); assert.throws(() => ledger.reserve(b, key(1, 1)));
    for (let trial = 0; trial < 36; trial++) {
      for (const round of [1, 2] as const) {
        const id = ledger.reserve(b, key(trial, round)); assert.throws(() => ledger.reserve(b, key(trial, round)));
        ledger.settle(id, { input: 1, output: 1 }); assert.throws(() => ledger.reserve(b, key(trial, round)));
      }
    }
    assert.equal(ledger.summary.calls, 72); assert.throws(() => ledger.reserve(b, key(35, 2)));
    ledger.finish(true); assert.equal(ledger.state.phase, 'completed');
  } finally { ledger.close(); }
});

test('cap blocks the next full reservation without resetting already settled cost', async () => {
  const { b, ledger } = await approved();
  try {
    for (const identity of [key(), key(0, 2), key(1)]) ledger.settle(ledger.reserve(b, identity), { input: 1_100_000, output: 2048 });
    const before = ledger.summary; assert.equal(before.settledUpperBound, 6_649_152);
    assert.throws(() => ledger.reserve(b, key(1, 2))); assert.deepEqual(ledger.summary, before);
    assert.throws(() => ledger.finish(true)); ledger.finish(false);
  } finally { ledger.close(); }
  const small = await approved(policy.reservation - 1);
  try { assert.throws(() => small.ledger.reserve(small.b, key())); assert.equal(small.ledger.summary.calls, 0); }
  finally { small.ledger.close(); }
});

test('transport unknowns retain full cost, never retry and remain stopped on restart', async () => {
  const { dir, b, ledger } = await approved(); let sent = 0;
  try {
    const transport: OfflineStudyTransport = { kind: 'offline-fixture', respond: async () => { sent++; throw new Error('do not persist arbitrary provider error'); } };
    await assert.rejects(call(ledger, b, transport)); await assert.rejects(call(ledger, b, transport));
    assert.equal(sent, 1); assert.equal(ledger.summary.stopped, 'transport_unknown'); assert.equal(ledger.summary.unknownReserved, policy.reservation);
    assert(!JSON.stringify(stored(ledger.path)).includes('arbitrary provider error'));
  } finally { ledger.close(); }
  const reopened = StudyCostLedger.open(dir, b);
  try { assert.throws(() => reopened.reserve(b, key())); assert.equal(reopened.summary.unknownReserved, policy.reservation); assert.equal(reopened.state.calls[0]!.reason, 'transport_unknown'); }
  finally { reopened.close(); }
});

test('reopening started studies never resumes either a settled or pending request', async () => {
  for (const settle of [false, true]) {
    const { dir, b, ledger } = await approved(); const id = ledger.reserve(b, key());
    if (settle) ledger.settle(id, { input: 1, output: 1 }); ledger.close();
    const reopened = StudyCostLedger.open(dir, b);
    try {
      assert.equal(reopened.summary.phase, 'unknown'); assert.equal(reopened.summary.stopped, 'owner_reopened');
      assert.equal(reopened.summary.unknownReserved, settle ? 0 : policy.reservation); assert.equal(reopened.summary.settledUpperBound, settle ? 10 : 0);
      assert.throws(() => reopened.reserve(b, key(0, 2))); assert.throws(() => reopened.settle(id, { input: 1, output: 1 }));
    } finally { reopened.close(); }
  }
});

test('strict SSE rejects truncated, duplicate, unknown-fee and tool receipts', () => {
  const good = response(); assert.deepEqual(studyUsageReceipt(good)?.usage, { input: 150, output: 20 });
  assert(studyUsageReceipt(good.replaceAll('\n', '\r\n')));
  for (const bad of [good.slice(0, -1), good + frame({ type: 'message_stop' }), good.replace('"message_stop"', '"error"'),
    response({ ...usage, output_tokens: -1 }), response({ ...usage, cache_creation_input_tokens: 1 }),
    response({ ...usage, input_tokens: policy.maxInput, cache_read_input_tokens: 1 }), response({ ...usage, future_charge: 1 }),
    response({ ...usage, service_tier: 'priority' }), response({ ...usage, server_tool_use: { web_search_requests: 1 } }),
    good.replace('"text_delta"', '"input_json_delta"'), good.replace('"end_turn"', '"tool_use"'),
    good.replace('"content_block_stop"', '"ping"'), good.replace('"index":0', '"index":1'), good.replace('"model":"deepseek-flash"', '"model":"bad label with spaces"'),
    good.replace('"model":"deepseek-flash"', '"model":"deepseek-v4-pro"'),
    'event: error\n' + good,
    good.replace('"input_tokens":100', '"input_tokens":100,"input_tokens":1'),
    good.replace('"input_tokens":100', '"input_tokens":100,"\\u0069nput_tokens":1'),
    good + ':'.repeat(policy.maxResponseBytes)]) assert.equal(studyUsageReceipt(bad), null);
});

test('HTTP, missing usage and output-limit failures stop the ledger without accepting a generation', async () => {
  for (const [status, body, stopped, charge] of [
    [503, 'error', 'http_error', policy.reservation], [200, 'plain text claims success', 'invalid_receipt', policy.reservation],
    [200, response().slice(0, -1), 'invalid_receipt', policy.reservation],
    [200, response({ ...usage, output_tokens: 2049 }), 'output_exceeded', 16_692],
  ] as const) {
    const { b, ledger } = await approved(); let sent = 0;
    try {
      const transport: OfflineStudyTransport = { kind: 'offline-fixture', respond: async () => { sent++; return { status, body }; } };
      await assert.rejects(call(ledger, b, transport)); await assert.rejects(call(ledger, b, transport));
      assert.equal(sent, 1); assert.equal(ledger.summary.stopped, stopped); assert.equal(ledger.state.calls[0]!.charge, charge);
      assert.equal(ledger.summary.unknownReserved, stopped === 'output_exceeded' ? 0 : policy.reservation);
    } finally { ledger.close(); }
  }
});

test('reserve and settlement write failures never dispatch or refund an uncommitted amount', async () => {
  for (const stage of ['reserve', 'settle']) {
    const { b, ledger } = await approved(); let sent = 0;
    sql(ledger.path, `CREATE TRIGGER synthetic_failure BEFORE UPDATE ON study_cost ${stage === 'settle' ? "WHEN json_extract(NEW.body,'$.calls[0].usage') IS NOT NULL" : ''} BEGIN SELECT RAISE(ABORT,'synthetic failed commit'); END;`);
    try {
      await assert.rejects(call(ledger, b, { kind: 'offline-fixture', respond: async () => { sent++; return { status: 200, body: response() }; } }));
      const row = stored(ledger.path); assert.equal(sent, stage === 'reserve' ? 0 : 1); assert.equal(row.calls.length, sent);
      if (sent) { assert.equal(row.calls[0].charge, policy.reservation); assert.equal(row.calls[0].usage, null); }
      assert.throws(() => ledger.reserve(b, key()));
    } finally { ledger.close(); }
  }
});

test('locks and foreign databases fail closed without overwriting bytes or deleting an existing lock', async () => {
  const { dir, b, ledger } = await approved();
  try { assert.throws(() => StudyCostLedger.open(dir, b)); assert.throws(() => StudyCostLedger.create(dir, b)); }
  finally { ledger.close(); }
  await writeFile(join(dir, 'cost-ledger.sqlite.lock'), 'stale owner, manual inspection required');
  assert.throws(() => StudyCostLedger.open(dir, b)); assert.equal(await readFile(join(dir, 'cost-ledger.sqlite.lock'), 'utf8'), 'stale owner, manual inspection required');
  const foreign = await root(); const file = join(foreign, 'cost-ledger.sqlite');
  sql(file, 'PRAGMA user_version=2; PRAGMA application_id=0x52463439; CREATE TABLE foreign_data(secret TEXT);');
  const before = await readFile(file); assert.throws(() => StudyCostLedger.open(foreign, binding())); assert.deepEqual(await readFile(file), before);
  const wrongBinding = await approved(); wrongBinding.ledger.close(); const frozenBytes = await readFile(wrongBinding.ledger.path);
  assert.throws(() => StudyCostLedger.open(wrongBinding.dir, binding())); assert.deepEqual(await readFile(wrongBinding.ledger.path), frozenBytes);
  assert.throws(() => StudyCostLedger.open(resolve('.probe-work'), b)); assert.throws(() => StudyCostLedger.open(resolve('.'), b));
});

test('hard-linked ledger and linked study directory are rejected before opening SQLite', async () => {
  const { dir, b, ledger } = await approved(); ledger.close(); const dest = await root(); const target = join(dest, 'cost-ledger.sqlite');
  await link(join(dir, 'cost-ledger.sqlite'), target);
  try { assert.throws(() => StudyCostLedger.open(dest, b)); } finally { await unlink(target); }
  const parent = await root(); const alias = join(parent, 'linked-study'); await symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => StudyCostLedger.open(alias, b));
});

test('existing SQLite sidecars are never followed, modified, recovered or removed', async () => {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const { dir, b, ledger } = await approved(); ledger.close(); const before = await readFile(ledger.path);
    const sentinel = join(await root(), 'external-sentinel.txt'); await writeFile(sentinel, 'synthetic sentinel must remain unchanged');
    const sidecar = ledger.path + suffix; await link(sentinel, sidecar);
    assert.throws(() => StudyCostLedger.open(dir, b)); assert.deepEqual(await readFile(ledger.path), before);
    assert.equal(await readFile(sentinel, 'utf8'), 'synthetic sentinel must remain unchanged');
    assert.equal(await readFile(sidecar, 'utf8'), 'synthetic sentinel must remain unchanged'); await unlink(sidecar);
    const reopened = StudyCostLedger.open(dir, b);
    try {
      await writeFile(sidecar, 'ordinary residual sidecar'); assert.throws(() => reopened.reserve(b, key()));
      assert.equal(await readFile(sidecar, 'utf8'), 'ordinary residual sidecar'); await unlink(sidecar);
      assert.equal(reopened.state.calls.length, 0); assert.equal(reopened.state.phase, 'prepared');
    } finally { reopened.close(); }
    const fresh = await root(); const preexisting = join(fresh, 'cost-ledger.sqlite' + suffix); await writeFile(preexisting, 'create must stop');
    assert.throws(() => StudyCostLedger.create(fresh, binding())); assert.equal(await readFile(preexisting, 'utf8'), 'create must stop');
    await assert.rejects(readFile(join(fresh, 'cost-ledger.sqlite')), { code: 'ENOENT' });
  }
});

test('overlapping guarded requests cannot both dispatch while one reservation is pending', async () => {
  const { b, ledger } = await approved(); let sent = 0; let release!: (value: { status: number; body: string }) => void;
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  const transport: OfflineStudyTransport = { kind: 'offline-fixture', respond: async () => {
    sent++; entered(); return new Promise(resolve => { release = resolve; });
  } };
  const first = call(ledger, b, transport); await started;
  try { await assert.rejects(call(ledger, b, transport)); assert.equal(sent, 1); assert.equal(ledger.state.calls.length, 1); }
  finally { release({ status: 200, body: response() }); await first; ledger.close(); }
});
