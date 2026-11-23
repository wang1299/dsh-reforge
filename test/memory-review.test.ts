import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { digest } from '../src/domain.js';
import { reviewOwnerMemory } from '../src/owner-operations.js';
import { memoryReviewReader } from '../src/memory-review-store.js';
import { reviewMemory } from '../src/memory-review.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';
import { fixture } from './fixture.js';

async function work() { await mkdir('.probe-work', { recursive: true }); return mkdtemp(resolve('.probe-work/memory-review-')); }

test('owner review uses real verified sources, paginates current revisions and leaves database/config/files unchanged', { timeout: 60000 }, async () => {
  const home = await work(); const f = await verifiedRetrievalFixture(home); const data = join(home, 'data');
  const database = join(data, 'evolve.sqlite'); const b = f.createBank(3, 'reuse', database);
  const second = b.experiences[1]!;
  const revised = b.service.revise(second.id, second.revision, { ...f.input, title: 'PRIVATE_TITLE_not_for_report' }, 'PRIVATE_REASON_not_for_report');
  b.service.disable(b.experiences[2]!.id, 'Synthetic disabled control'); b.store.close();
  const config = join(home, 'config.json');
  await writeFile(config, JSON.stringify({ repoRoot: f.repo, dataDir: data, python: 'must-not-be-executed' }));
  const before = { db: digest(await readFile(database)), config: await readFile(config, 'utf8'), files: await readdir(data) };
  try {
    const seen = []; let after: string | undefined;
    do {
      const report = reviewOwnerMemory(config, true, { limit: 1, ...(after ? { after } : {}) });
      assert.equal(report.total, 3); assert.equal(report.reviewed, 1); assert.equal(report.tasksExecuted, 0); assert.equal(report.modelRequests, 0);
      seen.push(report.items[0]!); after = report.nextCursor ?? undefined;
    } while (after);
    assert.equal(new Set(seen.map(item => item.experienceId)).size, 3);
    assert.equal(seen.find(item => item.experienceId === b.experiences[0]!.id)!.state, 'source_scope_current');
    assert.equal(seen.find(item => item.experienceId === revised.id)!.expectedRevision, revised.revision);
    assert.equal(seen.find(item => item.experienceId === revised.id)!.reason, 'candidate');
    assert.equal(seen.find(item => item.experienceId === b.experiences[2]!.id)!.reason, 'disabled');
    assert.equal(reviewOwnerMemory(config, true, { after: 'ffffffff-ffff-4fff-bfff-ffffffffffff' }).items.length, 0);
    const cli = spawnSync(process.execPath, ['dist/src/cli.js', 'memory-review', '--config', config, '--stopped', '--limit', '2'], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr); const output = JSON.parse(cli.stdout);
    assert.equal(output.items.length, 2); assert.equal(output.more, true);
    for (const value of [home, f.repo, 'PRIVATE_TITLE', 'PRIVATE_REASON', 'must-not-be-executed', f.input.observedFacts[0]!]) assert(!cli.stdout.includes(value));
    assert.equal(digest(await readFile(database)), before.db); assert.equal(await readFile(config, 'utf8'), before.config);
    assert.deepEqual(await readdir(data), before.files);
  } finally { f.store.close(); }
});

test('review distinguishes changed code/dependencies from unavailable conditions and never inherits proof onto changed conditions', { timeout: 60000 }, async () => {
  const home = await work(); const f = await verifiedRetrievalFixture(home); const data = join(home, 'data');
  const b = f.createBank(1, 'reuse', join(data, 'evolve.sqlite')); b.store.close();
  const config = join(home, 'config.json'); await writeFile(config, JSON.stringify({ repoRoot: f.repo, dataDir: data }));
  const condition = join(f.repo, 'contract.py'); const original = await readFile(condition);
  const dependencies = join(f.repo, 'requirements.txt'); const oldDependencies = await readFile(dependencies);
  const before = digest(await readFile(join(data, 'evolve.sqlite')));
  const check = () => reviewOwnerMemory(config, true).items[0]!;
  try {
    assert.equal(check().state, 'source_scope_current');
    await writeFile(condition, 'TRANSACTION_POLICY = "changed"\n');
    assert.equal(check().reason, 'code_condition_changed'); assert.equal(check().nextAction, 'revise_then_verify');
    await writeFile(condition, original); await writeFile(dependencies, 'dependency==2\n');
    assert.equal(check().reason, 'dependencies_changed');
    await writeFile(dependencies, oldDependencies); await rename(condition, condition + '.held');
    try { assert.equal(check().state, 'unknown'); assert.equal(check().reason, 'code_condition_unavailable'); }
    finally { await rename(condition + '.held', condition); }
    assert.equal(check().state, 'source_scope_current');
    assert.equal(digest(await readFile(join(data, 'evolve.sqlite'))), before);
    assert.equal(check().expectedRevision, 1);
  } finally { f.store.close(); }
});

test('missing, false and mismatched source reports or incomplete citations cannot obtain a current diagnostic', { timeout: 60000 }, async () => {
  const home = await work(); const f = await verifiedRetrievalFixture(home); const data = join(home, 'data');
  const b = f.createBank(1, 'reuse', join(data, 'evolve.sqlite')); b.store.close();
  const db = new DatabaseSync(join(data, 'evolve.sqlite'), { readOnly: true });
  try {
    const reader = memoryReviewReader(db); const run = (port: typeof reader) => reviewMemory(port, f.repo).items[0]!;
    assert.equal(run(reader).state, 'source_scope_current');
    assert.equal(run({ ...reader, verification: () => null }).reason, 'invalid_source_evidence');
    const proof = reader.verification(f.experience.verificationId!)!;
    for (const bad of [{ ...proof, verified: false }, { ...proof, sourceTaskId: randomUUID() }, { ...proof, id: randomUUID() }]) {
      assert.equal(run({ ...reader, verification: () => bad }).reason, 'invalid_source_evidence');
    }
    assert.equal(run({ ...reader, citations: () => [] }).reason, 'incomplete_fact_sources');
    assert.equal(run({ ...reader, task: () => null }).reason, 'incomplete_fact_sources');
    assert.equal(run({ ...reader, evidence: () => null }).reason, 'incomplete_fact_sources');
  } finally { db.close(); f.store.close(); }
});

test('review requires explicit stopped declaration and valid options, never creates a missing store or echoes errors', async () => {
  const home = await work(); const config = join(home, 'config.json');
  assert.throws(() => reviewOwnerMemory(config, false), /explicitly_pass_stopped/);
  for (const limit of [0, 51, NaN, 1.5]) assert.throws(() => reviewOwnerMemory(config, true, { limit }));
  assert.throws(() => reviewOwnerMemory(config, true, { after: 'not-a-uuid' }));
  await writeFile(config, '{"token":"sk-private-fixture0123456789"}');
  const cli = spawnSync(process.execPath, ['dist/src/cli.js', 'memory-review', '--config', config, '--stopped'], { encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 1); assert(!cli.stderr.includes(home)); assert(!cli.stderr.includes('private-fixture'));
  assert.deepEqual(await readdir(home), ['config.json']);
});

test('review rejects live sidecars, unsupported schema and corrupt row identities without changing the database', { timeout: 60000 }, async () => {
  const home = await work(); const f = await verifiedRetrievalFixture(home); const data = join(home, 'data');
  const database = join(data, 'evolve.sqlite'); const b = f.createBank(1, 'reuse', database); b.store.close();
  const config = join(home, 'config.json'); await writeFile(config, JSON.stringify({ repoRoot: f.repo, dataDir: data }));
  try {
    await writeFile(database + '-journal', 'synthetic busy marker');
    assert.throws(() => reviewOwnerMemory(config, true), /database_not_cleanly_stopped/);
    await rename(database + '-journal', join(home, 'held-journal'));
    let db = new DatabaseSync(database); db.exec('PRAGMA user_version=8'); db.close();
    assert.throws(() => reviewOwnerMemory(config, true), /unsupported_database_schema/);
    db = new DatabaseSync(database); db.exec('PRAGMA user_version=9');
    db.prepare("UPDATE experiences SET body=json_set(body,'$.id',?)").run(randomUUID()); db.close();
    const before = digest(await readFile(database));
    assert.throws(() => reviewOwnerMemory(config, true), /record identity/);
    assert.equal(digest(await readFile(database)), before);
  } finally { f.store.close(); }
});

test('valid configuration with no store stays missing; malformed CLI cursors and limits fail without initialization', async () => {
  const home = await work(); const f = await fixture(home); const data = join(home, 'missing-data');
  const config = join(home, 'config.json'); await writeFile(config, JSON.stringify({ repoRoot: f.repo, dataDir: data }));
  const before = await readdir(home);
  for (const extra of [[], ['--limit', '51'], ['--limit', '1e1'], ['--after', 'private-not-a-uuid'], ['--limit', '1', '--limit', '2']]) {
    const cli = spawnSync(process.execPath, ['dist/src/cli.js', 'memory-review', '--config', config, '--stopped', ...extra], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 1); assert(!cli.stderr.includes(home)); assert(!cli.stderr.includes('private-not-a-uuid'));
    assert.deepEqual(await readdir(home), before);
  }
});
