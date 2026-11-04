import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { PilotBudget, pilotPolicy, pilotUsage, startPilotRelay } from '../scripts/pilot-budget.js';

async function path() { await mkdir('.probe-work', { recursive: true }); return join(await mkdtemp(resolve('.probe-work/pilot-budget-')), 'new-ledger.sqlite'); }
function stored(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return String(db.prepare('SELECT body FROM pilot_ledger WHERE id=1').get()!.body); } finally { db.close(); }
}
const event = (value: object) => 'data: ' + JSON.stringify(value) + '\n\n';
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, service_tier: 'standard' };
const stream = (u: object = usage) => event({ type: 'message_start', message: { usage: { input_tokens: 999999, output_tokens: 1 } } })
  + event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'synthetic' } })
  + event({ type: 'content_block_stop', index: 0 })
  + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: u }) + event({ type: 'message_stop' });

test('pilot accounting reserves the whole model boundary, serializes owners and never refunds/replays unknowns', async () => {
  const file = await path(); const budget = new PilotBudget(file);
  assert.throws(() => new PilotBudget(file), /EEXIST/);
  const first = budget.reserve(); assert.equal(budget.spent, 5_345_728);
  assert.throws(() => budget.reserve(), /stopped|exhausted/);
  budget.settle(first, { input: 150, output: 20 }); assert.equal(budget.spent, 460);
  const unknown = budget.reserve(); budget.hold(unknown, 'invalid_receipt', 200);
  const held = budget.spent; assert.equal(held, 5_346_188); assert.throws(() => budget.reserve()); budget.close();
  const restarted = new PilotBudget(file);
  try { assert.equal(restarted.spent, held); assert.throws(() => restarted.reserve()); assert.throws(() => restarted.settle(unknown, { input: 0, output: 0 })); }
  finally { restarted.close(); }
});

test('pilot receipt uses only complete final cumulative usage and rejects extra fees and incomplete/unknown protocol', () => {
  assert.deepEqual(pilotUsage(stream()), { input: 150, output: 20 });
  for (const body of [stream().replace(event({ type: 'message_stop' }), ''), stream({ ...usage, service_tier: 'priority' }),
    stream().slice(0, -1),
    stream().replace('"input_tokens":999999,"output_tokens":1', '"input_tokens":999999,"output_tokens":1,"service_tier":"priority"'),
    stream().replace('"input_tokens":999999,"output_tokens":1', '"input_tokens":999999,"output_tokens":1,"server_tool_use":{"web_search_requests":1}'),
    stream().replace('"input_tokens":999999,"output_tokens":1', '"input_tokens":999999,"output_tokens":1,"unknown_fee":1'),
    stream().replace('"type":"content_block_stop","index":0', '"type":"content_block_stop","index":0,"usage":{"output_tokens":1}'),
    event({ type: 'ping', usage: { unknown_fee: 1 } }) + stream(),
    stream({ ...usage, server_tool_use: { tool_search: 1 } }), stream({ ...usage, unexplained_cost: 1 }),
    stream({ ...usage, output_tokens: pilotPolicy.maxOutput + 1 }), stream({ ...usage, cache_creation_input_tokens: 10 }),
    stream() + event({ type: 'message_delta', usage }), stream().replace('"type":"text","text":""', '"type":"server_tool_use","name":"web_search"'),
    event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }) + event({ type: 'message_stop' })]) assert.equal(pilotUsage(body), null);
});

test('pilot request count and effective output limits fail closed without increasing the authorized cap', async () => {
  const file = await path(); const budget = new PilotBudget(file);
  try {
    for (let i = 0; i < 32; i++) budget.settle(budget.reserve(), { input: 1, output: 1 });
    assert.throws(() => budget.reserve()); assert.equal(budget.state.cap, 10_000_000);
  } finally { budget.close(); }
  const exceeded = new PilotBudget(await path());
  try { exceeded.settle(exceeded.reserve(), { input: 1, output: 2049 }); assert.equal(exceeded.state.stopped, 'request_output_exceeded'); assert.throws(() => exceeded.reserve()); }
  finally { exceeded.close(); }
});

test('a failed settlement write retains the original full reservation and prevents further calls', async () => {
  const file = await path(); const budget = new PilotBudget(file); const id = budget.reserve();
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER synthetic_write_failure BEFORE UPDATE ON pilot_ledger BEGIN SELECT RAISE(ABORT,'synthetic failed commit'); END;"); db.close();
  try {
    assert.throws(() => budget.settle(id, { input: 150, output: 20 }));
    assert.equal(budget.spent, pilotPolicy.reservation); assert.equal(budget.state.calls[0]!.usage, null);
    assert.throws(() => budget.reserve());
    assert.equal(JSON.parse(stored(file)).calls[0].charge, pilotPolicy.reservation);
  } finally { budget.close(); }
});

test('pilot accounting never migrates an old JSON budget or plugin database and a crashed owner cannot silently start over', async () => {
  const legacy = await path(); await writeFile(legacy, '{"budgetMicroCny":5000000,"calls":[]}');
  const before = await readFile(legacy); assert.throws(() => new PilotBudget(legacy)); assert.deepEqual(await readFile(legacy), before);
  const product = await path(); const db = new DatabaseSync(product); db.exec('PRAGMA user_version=9; CREATE TABLE original_data(value TEXT);'); db.close();
  const bytes = await readFile(product); assert.throws(() => new PilotBudget(product)); assert.deepEqual(await readFile(product), bytes);
  const crashed = await path();
  execFileSync(process.execPath, ['--input-type=module', '-e',
    'import {PilotBudget} from "./dist/scripts/pilot-budget.js"; new PilotBudget(process.argv[1]).reserve(); process.exit(0);', crashed], { windowsHide: true });
  assert.equal(JSON.parse(stored(crashed)).calls[0].charge, pilotPolicy.reservation);
  assert.throws(() => new PilotBudget(crashed), /EEXIST/);
});

test('authorization binding and live-once state survive reopening without any JSON locator or fresh cap', async () => {
  const file = await path(); const identity = { root: '/synthetic/owned-study', planDigest: 'a'.repeat(64) };
  const initial = new PilotBudget(file); initial.bindStudy(identity); initial.close();
  const live = new PilotBudget(file);
  assert.equal(live.authorization!.root, identity.root); assert.equal(live.authorization!.state, 'prepared');
  live.beginStudy(identity); live.requireAuthorization(identity); live.settle(live.reserve(), { input: 1, output: 1 }); live.close();
  const reopened = new PilotBudget(file);
  assert.equal(reopened.authorization!.state, 'started'); assert.equal(reopened.state.calls.length, 1);
  reopened.finishStudy(identity, true); assert.throws(() => reopened.requireAuthorization(identity)); reopened.close();
  const final = new PilotBudget(file);
  try { assert.equal(final.authorization!.state, 'completed'); assert.equal(final.state.cap, 10_000_000);
    assert.throws(() => final.bindStudy({ ...identity, root: '/another-study' })); }
  finally { final.close(); }
});

test('real forwarding refuses a temporary unbound ledger before any reservation or network request', async () => {
  const budget = new PilotBudget(await path()); const relay = await startPilotRelay(budget);
  try {
    const response = await fetch(relay.baseURL + '/v1/messages', { method: 'POST',
      headers: { Authorization: 'Bearer synthetic-not-a-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: pilotPolicy.model, max_tokens: 2048, stream: true, messages: [] }) });
    assert.equal(response.status, 502); assert.equal(budget.state.calls.length, 0);
  } finally { await relay.close(); budget.close(); }
});

test('pilot relay validates and freezes before forwarding, settles before delivery and stops permanently on an unknown receipt', async () => {
  const file = await path(); const budget = new PilotBudget(file); let calls = 0; let frozen = true;
  const relay = await startPilotRelay(budget, { beforeForward: async () => { if (!frozen) throw new Error('Synthetic qualification drift'); },
    transport: (async (url, options) => {
      assert.equal(url, pilotPolicy.endpoint); assert.equal(options!.redirect, 'error'); calls++;
      return new Response(calls === 1 ? stream() : 'data: {"type":"error"}\n\n', { status: 200 });
    }) as typeof fetch });
  const request = (changes: object = {}) => fetch(relay.baseURL + '/v1/messages', { method: 'POST',
    headers: { Authorization: 'Bearer synthetic-not-a-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: pilotPolicy.model, max_tokens: 2048, stream: true, messages: [], ...changes }) });
  try {
    assert.equal((await request({ tools: [{ type: 'web_search_20250305', name: 'web_search' }] })).status, 502); assert.equal(calls, 0);
    frozen = false; assert.equal((await request()).status, 502); assert.equal(calls, 0); assert.equal(budget.state.calls.length, 0);
    frozen = true; const response = await request(); assert.equal(response.status, 200); await response.text(); assert.equal(budget.spent, 460);
    assert.equal((await request()).status, 502); assert.equal(calls, 2); assert.equal(budget.state.calls[1]!.usage, null);
    assert.equal((await request()).status, 502); assert.equal(calls, 2);
    const contents = stored(file); assert.ok(!contents.includes('synthetic-not-a-key')); assert.ok(!contents.includes('messages'));
  } finally { await relay.close(); budget.close(); }
});
