import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, composeEntries, getDshRuntimeVersion, initProfile, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot';
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { fixture } from '../test/fixture.js';
import { installedLearning } from './installed-learning.js';
import { installedScenarios } from './installed-learning-report.js';
import { rehearseAutomatic } from './automatic-rehearsal.js';
import { assertSupportedDshVersion } from '../src/dsh-adapter-policy.js';
import { packageName } from '../src/identity.js';

// Explicit, optional package verification. Uses synthetic data and never opens an owner's DSH profile.
const archive = resolve(process.argv[2] ?? '.probe-work/dsh-reforge-0.1.0-alpha.2.tgz');
const archiveDigest = createHash('sha256').update(await readFile(archive)).digest('hex');
const learning = process.argv.includes('--learning');
const workRoot = resolve('.probe-work'); await mkdir(workRoot, { recursive: true });
const work = await mkdtemp(join(workRoot, 'install-probe-'));
const host = join(work, 'host'); await mkdir(host);
const anchor = join(host, 'package.json');
await writeFile(anchor, JSON.stringify({ name: 'evolve-install-probe-host', version: '0.0.0', type: 'module' }));
const profile = join(work, 'profile');
initProfile(profile, []);
assertSupportedDshVersion(getDshRuntimeVersion());
const result = await runPluginCommand({ profile: 'evolve-install-probe', dir: profile, home: work, installAnchor: anchor, cwd: work },
  ['add', archive, '--ignore-scripts', '--reporter=append-only', `--store-dir=${join(work, 'store')}`],
  { execution: 'service', outputBytes: 8000, idleTimeoutMs: 45000, signal: AbortSignal.timeout(120000) });
assert.equal(result.exitCode, 0, JSON.stringify(result));
const loaded = loadProfileDirectory('dsh', profile, anchor);
assert.deepEqual(loaded.skippedBundles, []);
assert.equal(loaded.layers.length, 1);
assert.equal(loaded.layers[0]!.packageName, packageName);
assert.equal(await realpath(loaded.layers[0]!.packageDir), await realpath(join(profile, 'node_modules', packageName)));
const packageDir = loaded.layers[0]!.packageDir;
const jsFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (at: string, prefix: string): Promise<void> => {
    for (const item of await readdir(at, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory()) await walk(join(at, item.name), name + '/'); else if (item.isFile() && item.name.endsWith('.js')) files.push(name);
    }
  };
  await walk(root, ''); return files.sort();
};
const expectedRoot = resolve('dist/src'); const installedRoot = join(packageDir, 'dist/src');
const expectedFiles = await jsFiles(expectedRoot); assert.deepEqual(await jsFiles(installedRoot), expectedFiles);
for (const file of expectedFiles) assert.deepEqual(await readFile(join(installedRoot, file)), await readFile(join(expectedRoot, file)), 'Installed compiled JS differs: ' + file);
const patches = [...loaded.layers.flatMap((layer) => layer.patches), ...loaded.patches];
const entries = composeEntries([patches]);
assert.equal(entries.filter((entry) => entry.id === 'dsh-reforge' && entry.name === packageName).length, 1);

if (learning) {
  await writeFile(join(profile, 'cordis.yml'), '[]\n');
  for (const scenario of installedScenarios) {
    const report = await installedLearning({ profile, patches, packageDir, work, archiveDigest, scenario });
    const reportPath = join(work, 'learning-' + scenario + '.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log('Installed automatic learning:', scenario, report.phase, report.reason, 'stage:', report.stage, 'model HTTP =', report.modelHttpRequests, 'report:', reportPath);
    const expected = { happy: 'completed', 'invalid-extraction': 'extraction_invalid', 'sharing-off': 'sharing_disabled', 'failed-target': 'target_rejected' } as const;
    assert.equal(report.reason, expected[scenario]); assert.equal(report.phase, scenario === 'happy' ? 'passed' : 'partial');
  }
  const automatic = await rehearseAutomatic(packageDir);
  await writeFile(join(work, 'normal-dialogue-learning.json'), JSON.stringify(automatic, null, 2), { flag: 'wx' });
  assert.equal(automatic.passed, true); assert.equal(automatic.evolveToolCalls, 0);
  console.log('Installed normal-dialogue learning passed; zero evolve tools and model HTTP.');
  console.log('Installed automatic-learning rehearsal passed. Evidence:', work);
} else {

const f = await fixture();
await writeFile(join(profile, 'cordis.yml'), '[]\n');
patches.push({ id: 'dsh-reforge', config: { repoRoot: f.repo, dataDir: join(work, 'learning'), executionTrusted: false, shareWithModel: false } });
const ctx = await boot('dsh', join(profile, 'cordis.yml'), patches, async (root) => {
  await root.plugin(SystemPrompt, {}).await();
  await root.plugin(ToolRuntime, { mode: 'native' }).await();
  await root.plugin(SessionStore).await();
}, pathToFileURL(join(profile, 'package.json')).href);
try {
  const installedModule = await import(pathToFileURL(join(packageDir, 'dist/src/dsh.js')).href) as typeof import('../src/dsh.js');
  const entry = [...ctx.loader.entries()].find(e => e.options.name === packageName);
  assert.ok(entry?.fiber); assert.equal((entry.moduleNamespace as typeof import('../src/dsh.js')).apply, installedModule.apply);
  const assembled = await ctx.systemPrompt.assemble();
  assert.equal(assembled.tools.filter((tool) => tool.name.startsWith('evolve_')).length, 7);
  assert.ok(assembled.sections.some((section) => section.name === 'dsh-reforge:workflow'));
  const propose = assembled.tools.find((tool) => tool.name === 'evolve_propose_experience')!;
  const properties = propose.parameters.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.candidate!.type, 'object', 'installed package must publish Candidate fields');
  assert.equal(properties.candidate!.additionalProperties, false);
  assert.deepEqual(new Set((properties.citations!.items as Record<string, unknown>).required as string[]),
    new Set(['factIndex', 'factDigest', 'evidenceId', 'evidenceDigest']));
  const session = ctx.sessions.create(SessionId('installed-package-probe'), { meta: { cwd: f.repo } });
  const output = await ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name: 'evolve_begin_task',
    arguments: { summary: 'synthetic installed-package task' }, agent: { id: session.id } as Agent, signal: AbortSignal.timeout(10000) });
  assert.equal(output.isError, false, JSON.stringify(output));
  await writeFile(join(work, 'evidence.json'), JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(),
    runtimeVersion: getDshRuntimeVersion(), archiveDigest, profile, entries, toolCount: 7,
    installation: 'official shared plugin-manager operation and app-boot loader',
    limitations: ['Peer services supplied by source checkout; no full Web/Desktop application, actual Agent loop or benefit experiment'] }, null, 2));
  console.log('Installed tgz, official profile composition, loader and seven tools passed. Evidence:', join(work, 'evidence.json'));
} finally { await ctx.fiber.dispose(); }
}
