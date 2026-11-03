import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { fixture } from './fixture.js';
import type { ExtractionJob, ExtractionPolicy } from '../src/extraction-domain.js';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startPanel } from '../src/panel.js';
import { Script } from 'node:vm';

function renderEvidence(html: string, state: unknown): string {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
  const start = script.indexOf('function renderEvidenceJobs()'); const end = script.indexOf('async function refresh(');
  assert.ok(start >= 0 && end > start, 'The evidence renderer must be isolated from client startup');
  const render = script.slice(start, end);
  class Element {
    children: Element[] = [];
    constructor(readonly tag: string, readonly text = '') {}
    append(...children: Element[]): void { this.children.push(...children); }
    replaceChildren(...children: Element[]): void { this.children = children; }
    allText(): string { return this.text + this.children.map(c => c.allText()).join('\n'); }
  }
  const root = new Element('section');
  new Script(render + '\nrenderEvidenceJobs();').runInNewContext({ state, recordsSnapshot: '', $: () => root,
    node: (tag: string, text?: string) => new Element(tag, text), section: () => {} }, { timeout: 1000 });
  return root.allText();
}

async function unknown() {
  const f = await fixture(); const path = join(f.home, 'evolve.sqlite'); const store = new Store(path);
  const policy = { trusted: true, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 };
  const original: ExtractionPolicy = { grantId: randomUUID(), provider: 'offline', model: 'scripted', maxCalls: 1, maxTokens: 2048, timeoutMs: 30000 };
  const service = new EvolveService(store, f.repo, policy, true, original);
  const task = service.begin('source', 'restore balance'); service.correction(task.id, 'Restore the balance on failure.');
  await f.fix(); service.finish(task.id); await service.jobs.runNext();
  await service.extraction.runNext(async () => { throw new Error('Synthetic interrupted transport'); });
  const old = store.extraction.jobs()[0]!; assert.equal(old.state, 'unknown');
  const fresh: ExtractionPolicy = { ...original, grantId: randomUUID() };
  return { f, path, store, policy, original, fresh, task, old };
}

test('owner reauthorization appends exactly one attempt and preserves the consumed unknown', async () => {
  const r = await unknown(); const other = new Store(r.path);
  try {
    const frozen = JSON.stringify(r.store.extraction.job(r.old.id));
    const service = new EvolveService(r.store, r.f.repo, r.policy, true, r.fresh, true);
    assert.ok('reauthorizeExtraction' in service, 'Missing explicit owner reauthorization');
    const owner = service as unknown as { reauthorizeExtraction(task: string, expected: string): ExtractionJob };
    const next = owner.reauthorizeExtraction(r.task.id, r.old.id);
    const peer = new EvolveService(other, r.f.repo, r.policy, true, r.fresh, true) as unknown as typeof owner;
    assert.equal(peer.reauthorizeExtraction(r.task.id, r.old.id).id, next.id);
    assert.equal(next.state, 'waiting'); assert.equal(next.evidenceJobId, r.old.evidenceJobId);
    assert.equal(r.store.extraction.enqueue(r.task.id, r.old.repoId, r.old.evidenceJobId, { ...r.fresh, grantId: randomUUID() }).id, r.old.id);
    assert.equal(r.store.extraction.grants().length, 2, 'Ordinary enqueue must not create grants or new attempts');
    assert.equal(r.store.extraction.grants().find(g => g.id === r.original.grantId)!.used, 1);
    assert.equal(r.store.extraction.grants().find(g => g.id === r.fresh.grantId)!.used, 0);
    let calls = 0;
    await service.extraction.runNext(async () => { calls++; return { text: JSON.stringify({ kind: 'candidate', title: 'Restore prior balance',
      strategy: 'For this transaction restore the saved balance before raising.', factIds: ['verification:base', 'verification:fixed'], inferences: [], recommendations: [] }), usage: null }; });
    assert.equal(calls, 1); assert.equal(r.store.experiences()[0]!.status, 'candidate');
    assert.equal(r.store.extraction.grants().find(g => g.id === r.fresh.grantId)!.used, 1);
    assert.equal(owner.reauthorizeExtraction(r.task.id, r.old.id).id, next.id);
    assert.equal(await service.extraction.runNext(async () => { calls++; throw new Error('No replay'); }), false);
    assert.equal(calls, 1); assert.equal(JSON.stringify(r.store.extraction.job(r.old.id)), frozen);
    assert.throws(() => owner.reauthorizeExtraction(r.task.id, next.id), /chain/i);
    const changed = new EvolveService(other, r.f.repo, r.policy, true, { ...r.fresh, grantId: randomUUID() }, true);
    assert.throws(() => changed.reauthorizeExtraction(r.task.id, r.old.id), /different grant/i);
    const panel = await startPanel(service);
    try {
      const url = new URL(panel.url); const token = new URLSearchParams(url.hash.slice(1)).get('token')!;
      const state = await (await fetch(url.origin + '/api/state', { headers: { Authorization: 'Bearer ' + token } })).json() as { extractionReauthorizations: { originalJobId: string; newJobId: string }[] };
      assert.equal(state.extractionReauthorizations[0]!.originalJobId, r.old.id);
      assert.equal(state.extractionReauthorizations[0]!.newJobId, next.id);
      const html = await (await fetch(url.origin)).text();
      const rendered = renderEvidence(html, state);
      assert.match(rendered, /模型调用结果未知/); assert.match(rendered, /已生成候选/);
      assert.match(rendered, /owner重新授权/); assert.match(rendered, /原未知记录/);
      assert.match(rendered, new RegExp(r.old.id)); assert.match(rendered, new RegExp(next.id));
      const withoutExtraction = renderEvidence(html, { ...state, extractionJobs: [] });
      assert.match(withoutExtraction, /证据齐备，尚未开启自动提炼/);
    } finally { await panel.close(); }
  } finally { other.close(); r.store.close(); }
});

test('reauthorization rejects unauthorized policy, reused grants, non-unknown jobs and changed material', async () => {
  const r = await unknown(); const raw = new DatabaseSync(r.path);
  const originalFile = await readFile(join(r.f.repo, 'ledger.py'));
  try {
    const make = (fresh = r.fresh, trusted = true, sharing = true) => new EvolveService(r.store, r.f.repo, { ...r.policy, trusted }, true, fresh, sharing);
    for (const service of [make(r.original), make({ ...r.fresh, model: 'different' }), make({ ...r.fresh, maxCalls: 2 }),
      make({ ...r.fresh, maxTokens: 1024 }), make({ ...r.fresh, timeoutMs: 1000 }), make(r.fresh, false), make(r.fresh, true, false)]) {
      assert.throws(() => service.reauthorizeExtraction(r.task.id, r.old.id), /authorization|grant|controls/i);
    }
    for (const state of ['waiting', 'running', 'failed', 'abstained', 'blocked']) {
      // running needs a valid token/lease in the schema; other states must clear them.
      raw.prepare('UPDATE extraction_jobs SET state=?, token=?,lease_until=? WHERE id=?')
        .run(state, state === 'running' ? randomUUID() : null, state === 'running' ? Date.now() + 100000 : null, r.old.id);
      assert.throws(() => make().reauthorizeExtraction(r.task.id, r.old.id), /unknown/i);
    }
    raw.prepare("UPDATE extraction_jobs SET state='unknown',token=NULL,lease_until=NULL WHERE id=?").run(r.old.id);
    raw.prepare('INSERT INTO extraction_grants VALUES(?,?,1,0)').run(r.fresh.grantId, 'a'.repeat(64));
    assert.throws(() => make().reauthorizeExtraction(r.task.id, r.old.id), /fresh/i);
    raw.prepare('DELETE FROM extraction_grants WHERE id=?').run(r.fresh.grantId);
    await writeFile(join(r.f.repo, 'ledger.py'), '# changed\n');
    assert.throws(() => make().reauthorizeExtraction(r.task.id, r.old.id), /version changed/i);
    await writeFile(join(r.f.repo, 'ledger.py'), originalFile);
    raw.prepare('UPDATE extraction_jobs SET input_digest=? WHERE id=?').run('b'.repeat(64), r.old.id);
    assert.throws(() => make().reauthorizeExtraction(r.task.id, r.old.id), /material changed/i);
    raw.prepare('UPDATE extraction_jobs SET input_digest=? WHERE id=?').run(r.old.inputDigest, r.old.id);
    raw.prepare('UPDATE evidence_bundles SET body=? WHERE job_id=?').run(JSON.stringify({ ...r.store.learning.bundle(r.old.evidenceJobId), status: 'incomplete', reasons: ['no_source_verification'], verificationId: null, verificationDigest: null }), r.old.evidenceJobId);
    assert.throws(() => make().reauthorizeExtraction(r.task.id, r.old.id), /evidence/i);
    assert.equal(r.store.extraction.jobs().length, 1); assert.equal(r.store.extraction.reauthorizations().length, 0);
    assert.equal(r.store.extraction.grants().length, 1); assert.equal(r.store.extraction.grants()[0]!.used, 1);
  } finally { raw.close(); r.store.close(); }
});

test('v6 migration preserves all original extraction rows and rolls back failed initialization', async () => {
  const r = await unknown(); r.store.close(); const raw = new DatabaseSync(r.path);
  raw.exec('DROP TABLE extraction_reauthorizations; CREATE UNIQUE INDEX legacy_evidence_unique ON extraction_jobs(evidence_job_id); PRAGMA user_version=6; CREATE TABLE extraction_jobs_v7(blocker TEXT)');
  const tables = ['tasks', 'learning_jobs', 'evidence_bundles', 'extraction_jobs', 'extraction_grants'];
  const frozen = tables.map(t => raw.prepare('SELECT * FROM ' + t).all()); raw.close();
  assert.throws(() => new Store(r.path)); const failed = new DatabaseSync(r.path);
  assert.equal(failed.prepare('PRAGMA user_version').get()!.user_version, 6);
  assert.equal(failed.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='extraction_reauthorizations'").get()!.n, 0);
  assert.deepEqual(tables.map(t => failed.prepare('SELECT * FROM ' + t).all()), frozen);
  failed.exec('DROP TABLE extraction_jobs_v7'); failed.close(); const migrated = new Store(r.path);
  try {
    const check = new DatabaseSync(r.path);
    try { assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 9);
      assert.deepEqual(tables.map(t => check.prepare('SELECT * FROM ' + t).all()), frozen);
      assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { check.close(); }
    const service = new EvolveService(migrated, r.f.repo, r.policy, true, r.fresh, true);
    service.reauthorizeExtraction(r.task.id, r.old.id);
    assert.equal(migrated.extraction.jobs().length, 2);
    assert.throws(() => migrated.extraction.enqueue(randomUUID(), r.old.repoId, r.old.evidenceJobId + 'x', r.fresh), /FOREIGN KEY/i);
  } finally { migrated.close(); }
});

test('concurrent owner CLI repeats queue one fresh attempt without executing tests or a model', async () => {
  const r = await unknown(); r.store.close(); const config = join(r.f.home, 'config.json');
  await writeFile(config, JSON.stringify({ repoRoot: r.f.repo, dataDir: r.f.home, executionTrusted: true, shareWithModel: true,
    acceptanceDir: r.f.acceptance, python: r.policy.python, timeoutMs: r.policy.timeoutMs, extraction: r.fresh }));
  const args = [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'reauthorize-extraction', '--config', config, '--task-id', r.task.id, '--expected-job', r.old.id];
  const run = () => promisify(execFile)(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const outputs = await Promise.all([run(), run()]); const next = JSON.parse(outputs[0]!.stdout);
  assert.equal(JSON.parse(outputs[1]!.stdout).newJobId, next.newJobId); assert.equal(next.executed, false); assert.equal(next.state, 'waiting');
  const store = new Store(r.path);
  try { assert.equal(store.extraction.jobs().length, 2); assert.equal(store.extraction.reauthorizations().length, 1);
    assert.equal(store.extraction.grants().find(g => g.id === r.original.grantId)!.used, 1);
    assert.equal(store.extraction.grants().find(g => g.id === r.fresh.grantId)!.used, 0);
    assert.equal(store.extraction.job(next.newJobId)!.inputDigest, null);
  } finally { store.close(); }
});
