import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';

test('published peer declarations admit each tested DSH and reject untested prereleases', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  for (const version of ['0.2.0-rc.2', '0.2.1-rc.5']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, 'Official preflight must accept ' + version);
  }
  for (const version of ['0.2.0-rc.3', '0.2.1-rc.4', '0.2.1-rc.6', '0.2.1', '0.3.0']) {
    assert.ok(evaluatePluginCompatibility(manifest, {}, version), 'Untested version must not be implicitly admitted: ' + version);
  }
});

test('only explicit DSH adapter modules depend on the official host SDK', async () => {
  for (const file of await readdir('src')) {
    if (!file.endsWith('.ts') || file.startsWith('dsh-adapter-')) continue;
    assert.doesNotMatch(await readFile('src/' + file, 'utf8'), /(?:from\s*|import\s*)['"]@deepseek-ai\//, file + ' leaks a host dependency');
  }
});
