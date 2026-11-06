import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { digest, RevisionConflict, type Task } from '../src/domain.js';
import { Store } from '../src/store.js';
import { OwnerInputStore } from '../src/owner-input-store.js';
import { OwnerInputError, ownerInputPolicy, type OwnerMarker, type OwnerReceipt, type OwnerRule } from '../src/owner-input-domain.js';

const repoId = 'a'.repeat(64); const root = fileURLToPath(new URL('../../.probe-work/t060-tests/', import.meta.url));
function directory() { mkdirSync(root, { recursive: true }); return mkdtempSync(join(root, 'store-')); }
function rule(): Omit<OwnerRule, 'revision' | 'createdAt' | 'updatedAt'> {
  return { schemaVersion: 1, repoId, experienceId: randomUUID(), experienceRevision: 1, enabled: true,
    path: 'contract.schema.json', property: 'state', declaredFromDigest: 'b'.repeat(64), allowedGoals: ['repair_behavior'],
    contract: { schemaVersion: 1, requires: [{ field: 'field_nullable', oneOf: [false] }], excludes: [] } };
}
function reservation(offset = 0): { receipt: OwnerReceipt; marker: OwnerMarker } {
  const id = randomUUID(); const previewId = randomUUID(); const hostRunId = randomUUID(); const messageId = randomUUID();
  const createdAt = new Date(Date.UTC(2026, 10, 6) + offset * 1000).toISOString();
  const receipt: OwnerReceipt = { schemaVersion: 1, repoId, id, previewId, hostRunId, submissionDigest: 'c'.repeat(64), messageId,
    sessionId: 'session', path: 'contract.schema.json', property: 'state', sha256: 'd'.repeat(64), goal: 'repair_behavior', rulesRevision: 0,
    phase: 'reserved', reason: 'submit_reserved', taskId: null, facts: null, createdAt, updatedAt: createdAt, expiresAt: Date.now() + 120000 };
  const marker: OwnerMarker = { schemaVersion: 1, repoId, requestId: id, previewId, messageId, hostRunId, ownerPid: process.pid, sessionId: 'session',
    scopeKey: 'e'.repeat(64), requestDigest: 'f'.repeat(64), mode: 'context_only', taskId: null, taskIdentity: null, turn: null, createdAt };
  return { receipt, marker };
}
function task(): Task {
  return { schemaVersion: 1, id: randomUUID(), sessionId: 'session', summary: 'Bounded synthetic request',
    scope: { repoId, dependencyDigest: '1'.repeat(64), requiredFiles: {} }, baseCommit: '2'.repeat(40), state: 'open', createdAt: new Date().toISOString() };
}
const isCode = (code: string) => (error: unknown) => error instanceof OwnerInputError && error.code === code;

test('owner metadata is lazy and leaves the existing v9 database and unrelated ledger bytes unchanged', () => {
  const dir = directory(); const mainPath = join(dir, 'evolve.sqlite'); const old = new Store(mainPath); old.putTask(task()); old.close();
  const ledgerPath = join(dir, 'synthetic-budget.json'); writeFileSync(ledgerPath, '{"unknown":1,"used":1}');
  const before = digest(readFileSync(mainPath)); const ledger = readFileSync(ledgerPath);
  const sidecar = join(dir, 'owner-inputs-v1.sqlite'); const owner = new OwnerInputStore(sidecar);
  assert.deepEqual(owner.snapshot(repoId), { revision: 0, rules: [] }); assert.equal(existsSync(sidecar), false);
  owner.putRule(rule(), 0, 0); owner.close();
  assert.equal(digest(readFileSync(mainPath)), before); assert.deepEqual(readFileSync(ledgerPath), ledger);
  const check = new DatabaseSync(mainPath, { readOnly: true }); assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 9); check.close();
});

test('independent instances use actual transaction/CAS revisions and preserve rule identity', () => {
  const path = join(directory(), 'owner.sqlite'); const a = new OwnerInputStore(path); const b = new OwnerInputStore(path); const input = rule();
  try {
    const initial = a.putRule(input, 0, 0); assert.equal(initial.revision, 1);
    assert.throws(() => b.putRule({ ...input, enabled: false }, 0, 0), RevisionConflict);
    assert.deepEqual(b.snapshot(repoId), a.snapshot(repoId));
    const changed = b.putRule({ ...input, enabled: false }, 1, 1); assert.equal(changed.revision, 2);
    assert.equal(a.snapshot(repoId).rules[0]!.enabled, false); assert.equal(a.snapshot(repoId).revision, 2);
  } finally { a.close(); b.close(); }
});

test('same request has one reservation and the consumed preview cannot be reused under another UUID', () => {
  const owner = new OwnerInputStore(null); const a = reservation();
  try {
    assert.equal(owner.reserve(a.receipt, a.marker).fresh, true); assert.equal(owner.reserve(a.receipt, a.marker).fresh, false);
    assert.throws(() => owner.reserve({ ...a.receipt, submissionDigest: '0'.repeat(64) }, a.marker), isCode('owner_request_conflict'));
    const b = reservation(); b.receipt.previewId = a.receipt.previewId; b.marker.previewId = a.marker.previewId;
    assert.throws(() => owner.reserve(b.receipt, b.marker), isCode('owner_preview_consumed')); assert.equal(owner.markers(repoId).length, 1);
  } finally { owner.close(); }
});

test('receipt retention never removes context-only classification or turns an expired key into a new send', () => {
  const path = join(directory(), 'owner.sqlite'); const owner = new OwnerInputStore(path); const original = reservation(); const bound = task();
  owner.reserve(original.receipt, original.marker); owner.bind(repoId, original.marker.messageId, bound, 1, { field_required: true, field_nullable: false, field_type: 'object' });
  owner.transition(repoId, original.receipt.id, ['bound'], { phase: 'ended', reason: 'turn_ended_unverified' });
  for (let i = 1; i <= ownerInputPolicy.maxReceipts; i++) {
    const item = reservation(i); owner.reserve(item.receipt, item.marker); owner.transition(repoId, item.receipt.id, ['reserved'], { phase: 'unknown', reason: 'synthetic_interrupted' });
  }
  assert.equal(owner.receipts(repoId).length, 128); assert.equal(owner.receipt(repoId, original.receipt.id), null);
  assert.equal(owner.classification(bound), 'context_only'); owner.close();
  const restarted = new OwnerInputStore(path);
  try {
    assert.equal(restarted.classification({ ...bound, state: 'closed' }), 'context_only');
    assert.throws(() => restarted.reserve(original.receipt, original.marker), isCode('owner_request_expired'));
    assert.equal(restarted.markers(repoId).length, 129);
  } finally { restarted.close(); }
});

test('source/task identity and malformed owner metadata fail closed instead of resetting records', () => {
  const path = join(directory(), 'owner.sqlite'); const owner = new OwnerInputStore(path); const item = reservation(); const bound = task();
  owner.reserve(item.receipt, item.marker); owner.bind(repoId, item.marker.messageId, bound, 1, null);
  assert.throws(() => owner.classification({ ...bound, summary: 'Changed identity' }), isCode('owner_configuration_unavailable')); owner.close();
  const corrupt = new DatabaseSync(path); corrupt.prepare('UPDATE owner_receipts SET phase=? WHERE id=?').run('ended', item.receipt.id); corrupt.close();
  const reader = new OwnerInputStore(path);
  try { assert.throws(() => reader.receipt(repoId, item.receipt.id), isCode('owner_configuration_unavailable')); }
  finally { reader.close(); }
  const before = readFileSync(path); const bad = join(directory(), 'bad.sqlite'); writeFileSync(bad, 'not a database');
  const unavailable = new OwnerInputStore(bad); assert.throws(() => unavailable.snapshot(repoId)); unavailable.close(); assert.deepEqual(readFileSync(path), before);
});

test('a real main transaction rollback does not undo a sidecar binding or create atomic-success evidence', () => {
  const dir = directory(); const main = new Store(join(dir, 'evolve.sqlite')); const owner = new OwnerInputStore(join(dir, 'owner.sqlite'));
  const item = reservation(); const bound = task(); owner.reserve(item.receipt, item.marker);
  try {
    assert.throws(() => main.transaction(() => { main.putTask(bound); owner.bind(repoId, item.marker.messageId, bound, 1, null); throw new Error('injected-main-rollback'); }), /injected-main-rollback/);
    assert.equal(main.task(bound.id), null); assert.equal(owner.receipt(repoId, item.receipt.id)!.phase, 'bound');
    assert.equal(owner.marker(item.marker.messageId)!.taskId, bound.id); // Controller must project this orphan as unknown, never replay it.
    assert.throws(() => owner.bind(repoId, item.marker.messageId, task(), 2, null), isCode('owner_binding_conflict'));
  } finally { owner.close(); main.close(); }
});
