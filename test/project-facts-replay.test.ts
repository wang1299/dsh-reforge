import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertLegacyGraphPreserved, replayCurrentProjectFacts } from '../scripts/project-facts-current-replay.js';

for (const partition of ['development', 'holdout'] as const) test('current extended graph replays every ' + partition + ' arm while independently preserving original frozen assets', async () => {
  const receipt = await replayCurrentProjectFacts(partition);
  assert.equal(receipt.matched, true); assert.equal(receipt.dependencyReceipt.kind, 'current-extended-graph-regression');
});

test('current-graph comparison rejects legacy package or root-range drift rather than rewriting historical evidence', async () => {
  const original = JSON.parse(await readFile(fileURLToPath(new URL('../../compat/project-facts/locks/dsh-0.2.1-rc.5.lock.json', import.meta.url)), 'utf8'));
  const current = JSON.parse(await readFile(fileURLToPath(new URL('../../compat/dsh-0.2.1-rc.5.lock.json', import.meta.url)), 'utf8'));
  assertLegacyGraphPreserved(original, current);
  for (const change of ['integrity', 'dependencies', 'range']) {
    const altered = structuredClone(current);
    if (change === 'range') altered.packages[''].devDependencies.ajv = '*';
    else altered.packages['node_modules/ajv'][change] = change === 'integrity' ? 'changed' : { injected: '1.0.0' };
    assert.throws(() => assertLegacyGraphPreserved(original, altered));
  }
});
