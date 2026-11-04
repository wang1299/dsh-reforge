import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { backupOwner, doctorOwner, restoreOwner, setupOwner } from '../src/owner-operations.js';
import { createService, loadConfig } from '../src/config.js';
import { digest } from '../src/domain.js';
import { fixture } from './fixture.js';
import { ExtractionModelFailure } from '../src/extraction-domain.js';

async function work() { await mkdir('.probe-work', { recursive: true }); return mkdtemp(resolve('.probe-work/owner-ops-')); }
function tables(path: string): object {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => {
      const name = String(row.name); assert.match(name, /^[a-z_]+$/);
      return [name, db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()];
    }));
  } finally { db.close(); }
}

test('owner setup refuses overwrite and doctor is passive, bounded and redacted even with broken private configuration', async () => {
  const root = await work(); const f = await fixture(); const config = join(root, 'config.json'); const data = join(root, 'data');
  await setupOwner({ repo: f.repo, output: config, python: process.env.EVOLVE_PYTHON ?? 'python', dataDir: data });
  const before = await readFile(config, 'utf8');
  await assert.rejects(setupOwner({ repo: f.repo, output: config }), /EEXIST/);
  assert.equal(await readFile(config, 'utf8'), before);
  const report = doctorOwner(config); assert.equal(report.settings!.automatic, false); assert.equal(report.settings!.extraction, false);
  assert.equal(report.checks.some(check => check.status === 'error'), false);
  assert.equal(existsSync(data), false, 'Passive doctor must not create a database or data directory');
  const serialized = JSON.stringify(report); assert.ok(!serialized.includes(f.repo)); assert.ok(!serialized.includes(root));
  const bad = join(root, 'bad.json'); await writeFile(bad, '{"password":"sk-private-fixture0123456789"}');
  const diagnostic = JSON.stringify(doctorOwner(bad));
  assert.ok(!diagnostic.includes('private-fixture')); assert.ok(!diagnostic.includes('password'));
  assert.equal(existsSync(data), false);
  const cli = execFileSync(process.execPath, ['dist/src/cli.js', 'doctor', '--config', config], { encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(cli).schemaVersion, 1); assert.ok(!cli.includes(f.repo));
});

test('stopped backup and restore preserve every table, private snapshots and consumed unknown grants byte for byte', async () => {
  const root = await work(); const f = await fixture(); const config = join(root, 'config.json'); const data = join(root, 'data');
  const input = { repoRoot: f.repo, dataDir: data, python: process.env.EVOLVE_PYTHON ?? 'python', acceptanceDir: f.acceptance,
    executionTrusted: true, shareWithModel: true, backgroundVerification: true, automaticLearning: true,
    extraction: { grantId: crypto.randomUUID(), provider: 'offline', model: 'synthetic', maxCalls: 1, maxTokens: 256, timeoutMs: 10000 } };
  await writeFile(config, JSON.stringify(input)); const { service } = createService(input);
  const task = service.automatic.begin('synthetic', 1, [{ id: 'synthetic-request', text: '纠正：repair transaction rollback and restore balance on failure' }]); assert.ok(task);
  await writeFile(join(f.repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
  service.automatic.finish('synthetic', 1); await service.jobs.runNext();
  await service.extraction.runNext(async () => { throw new ExtractionModelFailure('model_transport_failed'); });
  assert.equal(service.store.extraction.grants()[0]!.used, 1);
  assert.equal(service.store.extraction.jobs()[0]!.state, 'unknown');
  const beforeTables = tables(join(data, 'evolve.sqlite')); service.store.close();
  const originalHash = digest(await readFile(join(data, 'evolve.sqlite')));
  const sourceFiles = await readdir(data); const diagnostic = doctorOwner(config);
  assert.equal(diagnostic.database!.schema, 9);
  assert.deepEqual(await readdir(data), sourceFiles);
  assert.equal(digest(await readFile(join(data, 'evolve.sqlite'))), originalHash);
  assert.ok(!JSON.stringify(diagnostic).includes(input.extraction.grantId));
  const backup = join(root, 'backup'); const restored = join(root, 'restored');
  await assert.rejects(backupOwner(config, backup, false), /explicitly_pass_stopped/);
  const result = await backupOwner(config, backup, true); assert.ok(result.files > 1); assert.equal(result.schema, 9);
  assert.equal(digest(await readFile(join(data, 'evolve.sqlite'))), originalHash);
  assert.deepEqual(tables(join(backup, 'data', 'evolve.sqlite')), beforeTables);
  await restoreOwner(backup, restored, f.repo, true);
  assert.deepEqual(tables(join(restored, 'evolve.sqlite')), beforeTables);
  assert.equal(digest(await readFile(join(restored, 'evolve.sqlite'))), originalHash);
  assert.ok((await readdir(restored)).includes('private-snapshots.git'));
  assert.equal(await readFile(config, 'utf8'), JSON.stringify(input));
  await assert.rejects(backupOwner(config, backup, true), /destination_already_exists/);
  await assert.rejects(restoreOwner(backup, restored, f.repo, true), /destination_already_exists/);
  const other = await fixture(); await assert.rejects(restoreOwner(backup, join(root, 'wrong-repo'), other.repo, true), /repository_binding_mismatch/);
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
  manifest.inventory.files[0].path = '../escape';
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(restoreOwner(backup, join(root, 'invalid'), f.repo, true));
  assert.equal(existsSync(join(root, 'invalid')), false);
});

test('backup refuses active jobs, hot WAL, changed hashes and symlinks without overwriting or mutating the source', async t => {
  const root = await work(); const f = await fixture(); const data = join(root, 'data'); const config = join(root, 'config.json');
  await setupOwner({ repo: f.repo, output: config, dataDir: data });
  const { service } = createService(loadConfig(config)); service.store.close();
  const file = join(data, 'evolve.sqlite'); const db = new DatabaseSync(file);
  db.prepare('INSERT INTO automatic_locks VALUES(?,1)').run(digest(f.repo));
  db.exec("PRAGMA user_version=10"); db.close();
  await assert.rejects(backupOwner(config, join(root, 'future'), true), /unsupported_database_schema/);
  const v9 = new DatabaseSync(file); v9.exec('PRAGMA user_version=9'); v9.close();
  await writeFile(file + '-wal', 'synthetic-hot-WAL');
  await assert.rejects(backupOwner(config, join(root, 'hot'), true), /cleanly_stopped/);
  await unlink(file + '-wal');
  const backup = join(root, 'backup'); await backupOwner(config, backup, true);
  await writeFile(join(backup, 'data', 'extra-private.bin'), 'not in the manifest');
  await assert.rejects(restoreOwner(backup, join(root, 'corrupt'), f.repo, true), /hash_mismatch/);
  assert.equal(existsSync(join(root, 'corrupt')), false);
  const target = join(root, 'external'); await writeFile(target, 'outside bytes');
  try { await symlink(target, join(data, 'linked')); }
  catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    t.diagnostic('Symlink refusal cannot be exercised here: Windows user lacks symlink privilege'); return;
  }
  await assert.rejects(backupOwner(config, join(root, 'linked-backup'), true), /symlink/);
  assert.equal(readFileSync(target, 'utf8'), 'outside bytes');
});

test('backup refuses a claimed evidence job even after its process stopped, preserving unresolved work', async () => {
  const root = await work(); const f = await fixture(); const data = join(root, 'data'); const config = join(root, 'config.json');
  await setupOwner({ repo: f.repo, output: config, dataDir: data });
  const { service } = createService(loadConfig(config));
  const task = service.begin('synthetic-active', 'repair transaction rollback'); service.finish(task.id);
  const claimed = service.store.learning.claim(task.scope.repoId, Date.now(), 30000); assert.ok(claimed);
  service.store.close(); const before = digest(await readFile(join(data, 'evolve.sqlite')));
  await assert.rejects(backupOwner(config, join(root, 'active'), true), /active_work/);
  assert.equal(existsSync(join(root, 'active')), false);
  assert.equal(digest(await readFile(join(data, 'evolve.sqlite'))), before);
});
