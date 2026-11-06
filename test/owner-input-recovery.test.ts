import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { OwnerInputError, type OwnerReceipt } from '../src/owner-input-domain.js';
import type { OwnerTaskCarrier } from '../src/owner-task-input.js';
import { fixture } from './fixture.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';

const parent = fileURLToPath(new URL('../../.probe-work/t060-tests/', import.meta.url));
function source(repo: string) { writeFileSync(join(repo, 'contract.schema.json'), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { state: { type: 'object' } }, required: ['state'] })); }
function carrier(sessionId = 'recovery') {
  const sent: { id: string; text: string }[] = [];
  const port: OwnerTaskCarrier = { sessionId, scopeKey: 'f'.repeat(64), assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent.push({ id, text }); } }; } };
  return { port, sent };
}
async function reserve(service: EvolveService, port: OwnerTaskCarrier) {
  const preview = service.ownerInput.taskPreview({ path: 'contract.schema.json', property: 'state', text: 'database transaction rollback exception', goal: 'repair_behavior' }, port);
  const request = { instanceId: preview.instanceId, previewId: preview.previewId, idempotencyKey: randomUUID() };
  return { request, receipt: await service.ownerInput.submit(request, port) };
}
const policy = (acceptance: string) => ({ trusted: false, python: 'python', acceptanceDir: acceptance, regressionPath: 'tests', timeoutMs: 1000 });
const isCode = (code: string) => (error: unknown) => error instanceof OwnerInputError && error.code === code;

test('a new epoch neither executes nor preempts a live old owner reservation; the retained request cannot enqueue twice', { timeout: 30000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); source(f.repo); const store = new Store(':memory:');
  const first = new EvolveService(store, f.repo, policy(f.acceptance), false, undefined, true); const c = carrier();
  try {
    const reserved = await reserve(first, c.port); const second = new EvolveService(store, f.repo, policy(f.acceptance), false, undefined, true);
    second.ownerInput.recover(); assert.deepEqual(store.ownerInputs.receipt(second.repositoryId, reserved.receipt.id), reserved.receipt);
    const rejected = second.ownerInput.admit(c.port.sessionId, c.port.scopeKey, 1, c.sent);
    assert.equal(rejected.owned, true); assert.equal(rejected.context, ''); assert.equal(store.tasks().length, 0);
    assert.deepEqual(store.ownerInputs.receipt(second.repositoryId, reserved.receipt.id), reserved.receipt, 'Another live epoch is not ours to modify');
    assert.throws(() => second.begin(c.port.sessionId, 'manual bypass'), isCode('owner_context_only'));
    assert.equal((await second.ownerInput.submit(reserved.request, c.port)).id, reserved.receipt.id);
    await assert.rejects(() => second.ownerInput.submit({ ...reserved.request, idempotencyKey: randomUUID() }, c.port), isCode('owner_preview_expired'));
    assert.equal(c.sent.length, 1); second.ownerInput.end(c.port.sessionId, 1);
  } finally { store.close(); }
});

test('controller projects a sidecar binding after an actual main rollback as unknown and never replays it', { timeout: 30000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); source(f.repo); const store = new Store(join(f.home, 'orphan', 'evolve.sqlite'));
  const service = new EvolveService(store, f.repo, policy(f.acceptance), false, undefined, true); const c = carrier();
  try {
    const reserved = await reserve(service, c.port); const transaction = store.transaction.bind(store); let depth = 0;
    store.transaction = fn => transaction(() => { depth++; try { const value = fn(); if (depth === 1) throw new Error('injected-main-commit-failure'); return value; } finally { depth--; } });
    const result = service.ownerInput.admit(c.port.sessionId, c.port.scopeKey, 1, c.sent); store.transaction = transaction;
    assert.equal(result.owned, true); assert.equal(result.context, ''); assert.equal(store.tasks().length, 0);
    const marker = store.ownerInputs.marker(c.sent[0]!.id)!; assert.ok(marker.taskId);
    const projected = service.ownerInput.state(c.port).receipts[0]!; assert.equal(projected.phase, 'unknown'); assert.equal(projected.reason, 'orphan_task_binding');
    assert.equal((await service.ownerInput.submit(reserved.request, c.port)).phase, 'unknown');
    service.ownerInput.admit(c.port.sessionId, c.port.scopeKey, 1, c.sent); assert.equal(store.tasks().length, 0); assert.equal(c.sent.length, 1);
    service.ownerInput.end(c.port.sessionId, 1);
  } finally { store.close(); }
});

test('actual source-qualified legacy selection is unchanged when absent; configured or corrupt owner metadata cannot silently fall back', { timeout: 60000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await verifiedRetrievalFixture(parent); source(f.repo);
  const data = join(f.home, 'gates'); const bank = f.createBank(1, 'reuse', join(data, 'evolve.sqlite')); const service = bank.service;
  try {
    const legacy = service.begin('ordinary-legacy', 'database transaction rollback exception'); assert.equal(service.select(legacy.id).experience?.id, bank.experiences[0]!.id);
    const preview = service.ownerInput.sourcePreview({ path: 'contract.schema.json', property: 'state' }); const exp = bank.experiences[0]!;
    service.ownerInput.declare({ previewId: preview.previewId, experienceId: exp.id, experienceRevision: exp.revision, expectedGlobal: 0, expectedRule: 0, fields: ['field_nullable'], allowedGoals: ['repair_behavior'] });
    const guarded = service.begin('ordinary-guarded', 'database transaction rollback exception'); assert.equal(service.select(guarded.id).experience, null);
    assert.equal(service.retrievalStatus().attempts[0]!.candidates[0]!.reason, 'owner_context_missing');
    const future = service.begin('ordinary-before-corruption', 'database transaction rollback exception'); const anchor = join(data, 'owner-inputs-v1.identity.json');
    const original = readFileSync(anchor); const identity = JSON.parse(original.toString()) as Record<string, unknown>; identity.storeId = randomUUID(); writeFileSync(anchor, JSON.stringify(identity));
    assert.equal(service.select(future.id).experience, null); assert.equal(service.retrievalStatus().attempts[0]!.candidates[0]!.reason, 'owner_configuration_unavailable');
    assert.equal(service.ownerInput.state().available, false); assert.equal(bank.store.applications().length, 1);
    assert.throws(() => service.ownerInput.sourcePreview({ path: 'contract.schema.json', property: 'state' }));
    assert.notDeepEqual(readFileSync(anchor), original, 'Diagnostics must not reset the corrupt file');
  } finally { bank.store.close(); f.store.close(); }
});

test('pruned receipt plus real database restart preserves service and enqueue learning guards and expires old submissions', { timeout: 30000 }, async () => {
  mkdirSync(parent, { recursive: true }); const f = await fixture(parent); source(f.repo); const path = join(f.home, 'retention', 'evolve.sqlite'); const c = carrier();
  const first = new Store(path); const service = new EvolveService(first, f.repo, policy(f.acceptance), false, undefined, true);
  const reserved = await reserve(service, c.port); service.ownerInput.admit(c.port.sessionId, c.port.scopeKey, 1, c.sent);
  const originalMarker = first.ownerInputs.marker(c.sent[0]!.id)!; const task = first.task(originalMarker.taskId!)!; service.ownerInput.end(c.port.sessionId, 1);
  for (let i = 1; i <= 128; i++) {
    const id = randomUUID(); const previewId = randomUUID(); const messageId = randomUUID(); const createdAt = new Date(Date.parse(reserved.receipt.createdAt) + i * 1000).toISOString();
    const receipt: OwnerReceipt = { ...reserved.receipt, id, previewId, messageId, phase: 'reserved', taskId: null, facts: null, createdAt, updatedAt: createdAt };
    first.ownerInputs.reserve(receipt, { ...originalMarker, requestId: id, previewId, messageId, taskId: null, taskIdentity: null, turn: null, createdAt });
    first.ownerInputs.transition(service.repositoryId, id, ['reserved'], { phase: 'unknown', reason: 'synthetic_terminal' });
  }
  assert.equal(first.ownerInputs.receipt(service.repositoryId, reserved.receipt.id), null); first.close();
  const reopened = new Store(path); const second = new EvolveService(reopened, f.repo, policy(f.acceptance), false, undefined, true);
  try {
    const persisted = reopened.task(task.id)!; assert.equal(reopened.ownerInputs.classification(persisted), 'context_only');
    assert.throws(() => second.propose(task.id, { title: 'x', strategy: 'x', observedFacts: ['x'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] }), isCode('owner_context_only'));
    assert.throws(() => second.jobs.enqueue(persisted), isCode('owner_context_only')); assert.throws(() => second.extraction.enqueue(persisted, randomUUID()), isCode('owner_context_only'));
    await assert.rejects(() => second.ownerInput.submit(reserved.request, c.port), isCode('owner_preview_expired'));
    second.ownerInput.admit(c.port.sessionId, c.port.scopeKey, 2, c.sent); assert.throws(() => second.begin(c.port.sessionId, 'old message bypass'), isCode('owner_context_only'));
    assert.equal(c.sent.length, 1); assert.equal(reopened.learning.jobs().length, 0); assert.equal(reopened.extraction.jobs().length, 0); second.ownerInput.end(c.port.sessionId, 2);
  } finally { reopened.close(); }
});
