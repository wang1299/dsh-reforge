/** Actual synthetic source verification and read-only maintenance; no model port or production config. */
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { reviewOwnerMemory } from '../src/owner-operations.js';
import { verifiedRetrievalFixture } from '../test/retrieval-fixture.js';

if (process.argv.length !== 2) throw new Error('Usage: npm run memory:demo');
const root = fileURLToPath(new URL('../../', import.meta.url));
const work = join(root, '.probe-work/t074-memory-review'); await mkdir(work, { recursive: true });
const f = await verifiedRetrievalFixture(work); const data = join(f.home, 'data');
try {
  const b = f.createBank(1, 'reuse', join(data, 'evolve.sqlite')); b.store.close();
  const config = join(f.home, 'config.json'); await writeFile(config, JSON.stringify({ repoRoot: f.repo, dataDir: data }));
  const database = join(data, 'evolve.sqlite'); const before = digest(await readFile(database));
  const condition = join(f.repo, 'contract.py'); const original = await readFile(condition);
  const current = reviewOwnerMemory(config, true);
  await writeFile(condition, 'TRANSACTION_POLICY = "changed"\n'); const drift = reviewOwnerMemory(config, true);
  await rename(condition, condition + '.held'); const unknown = reviewOwnerMemory(config, true);
  await rename(condition + '.held', condition); await writeFile(condition, original);
  assert.equal(current.items[0]!.state, 'source_scope_current');
  assert.equal(drift.items[0]!.reason, 'code_condition_changed');
  assert.equal(unknown.items[0]!.state, 'unknown');
  assert.equal(digest(await readFile(database)), before);
  const report = { format: 'dsh-reforge-memory-review-demo-v1', synthetic: true, modelRequests: 0, maintenanceTestExecutions: 0,
    source: 'Actual original-failure/fixed/regression pytest verification; one synthetic repair, not an Agent-benefit study.',
    databaseUnchanged: true, cases: { current, drift, unknown } };
  await writeFile(join(f.home, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, report: '.probe-work/t074-memory-review/' + f.home.split(/[\\/]/).at(-1) + '/report.json' }, null, 2));
} finally { f.store.close(); }
