import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPilotFixture, offlineRepair, pilotCases, runPilotTests, validatePilotCode } from '../scripts/pilot-fixtures.js';
import { passes, reproduces } from '../src/verification.js';

test('pilot source and held-out cases have real failures, fixed external acceptance and bounded code validation', async () => {
  await mkdir('.probe-work', { recursive: true }); const root = await mkdtemp(resolve('.probe-work/pilot-fixtures-'));
  const f = await createPilotFixture(join(root, 'new-case')); const python = process.env.EVOLVE_PYTHON ?? 'python';
  assert.equal(reproduces(await runPilotTests(python, f.repo, f.acceptance, join(root, 'source-before.xml'))), true);
  validatePilotCode(python, offlineRepair, 'apply_change'); await writeFile(join(f.repo, 'ledger.py'), offlineRepair);
  assert.equal(passes(await runPilotTests(python, f.repo, f.acceptance, join(root, 'source-after.xml'))), true);
  assert.equal(passes(await runPilotTests(python, f.repo, join(f.repo, 'tests'), join(root, 'source-regression.xml'))), true);
  for (const item of await pilotCases()) {
    const checks = join(root, 'new-case', item.id + '-checks');
    assert.equal(reproduces(await runPilotTests(python, f.repo, checks, join(root, item.id + '-before.xml'))), true);
    const fixed = item.id === 'form' ? await readFile('examples/customer-form/after/form_state.py', 'utf8')
      : item.code.replace('    persist(dict(stock))', '    try:\n        persist(dict(stock))\n    except OSError:\n        stock["remaining"] += quantity\n        raise');
    validatePilotCode(python, fixed, item.entry); await writeFile(join(f.repo, item.file), fixed);
    assert.equal(passes(await runPilotTests(python, f.repo, checks, join(root, item.id + '-after.xml'))), true);
  }
  for (const code of ['import os\ndef apply_change(): pass', 'def apply_change(state):\n    open("outside", "w")',
    'def apply_change(state):\n    return state.__class__', 'def apply_change(state):\n    while True: pass']) assert.throws(() => validatePilotCode(python, code, 'apply_change'));
  await assert.rejects(runPilotTests(python, f.repo, f.acceptance, join(root, 'source-before.xml')), /EEXIST/);
  await assert.rejects(createPilotFixture(resolve('outside-ignored-root')), /ignored directory/);
});
