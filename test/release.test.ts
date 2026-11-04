import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { create } from 'tar';
import { auditArchive, parseReleaseTag, release, validateManifest, validateRegistry, validateReleaseChecks } from '../scripts/release-helpers.js';
import { environmentConfig } from '../src/config.js';
import { packageName } from '../src/identity.js';
import { firstPublishedArtifact, legacyConfigEnvironment } from '../src/legacy.js';
async function workDir(prefix: string): Promise<string> { await mkdir('.probe-work', { recursive: true }); return mkdtemp(join('.probe-work', prefix)); }

test('release manifest, lock root, public bin and private file exclusions agree', async () => {
  const p = JSON.parse(await readFile('package.json', 'utf8')); validateManifest(p); assert.equal(packageName, p.name);
  assert.equal(p.repository.url, 'git+https://github.com/wang1299/dsh-reforge.git');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(lock.name, p.name); assert.equal(lock.version, p.version);
  assert.equal(lock.packages[''].name, p.name); assert.equal(lock.packages[''].version, p.version);
  assert.throws(() => validateManifest({ ...p, bin: { 'unrelated-plugin': './dist/src/cli.js' } }));
  assert.throws(() => validateManifest({ ...p, files: [...p.files, '.probe-work'] }));
});

test('configuration rename supports legacy files and fails closed on conflicting selections', async () => {
  const work = await workDir('config-rename-'); const file = join(work, 'config.json');
  const config = { repoRoot: process.cwd(), dataDir: join(work, 'unchanged-local-data') };
  await writeFile(file, JSON.stringify(config));
  const current = environmentConfig({ DSH_REFORGE_CONFIG: file }); const old = environmentConfig({ [legacyConfigEnvironment]: file });
  assert.deepEqual(current, old); assert.equal(current.dataDir, config.dataDir); assert.equal(current.automaticLearning, false);
  assert.deepEqual(environmentConfig({ DSH_REFORGE_CONFIG: file, [legacyConfigEnvironment]: join(work, '.', 'config.json') }), current);
  const other = join(work, 'other.json'); await writeFile(other, JSON.stringify(config));
  assert.throws(() => environmentConfig({ DSH_REFORGE_CONFIG: file, [legacyConfigEnvironment]: other }), /different files/);
  assert.deepEqual(environmentConfig({}), { repoRoot: process.cwd() });
});

test('publication audit accepts required files and rejects unintended private data', async () => {
  const work = await workDir('archive-audit-'); const root = join(work, 'package');
  await mkdir(join(root, 'dist/src'), { recursive: true }); await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'package.json'), await readFile('package.json'));
  for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', 'docs/installation.md', 'cordis.patch.yml', 'dist/src/cli.js', 'dist/src/dsh.js', 'dist/src/client.js', 'dist/src/service.js']) await writeFile(join(root, file), 'synthetic release fixture\n');
  const contents = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'docs/installation.md', 'cordis.patch.yml', 'dist/src/cli.js', 'dist/src/dsh.js', 'dist/src/client.js', 'dist/src/service.js'].map(p => 'package/' + p);
  const good = join(work, 'good.tgz'); await create({ file: good, cwd: work, gzip: true }, contents);
  const result = await auditArchive(good); assert.equal(result.files.length, 10); assert.match(result.integrity, /^sha512-/);
  await assert.rejects(auditArchive(good, true), /exact frozen first artifact/);
  await mkdir(join(root, '.probe-work')); await writeFile(join(root, '.probe-work', 'private.json'), '{}');
  const bad = join(work, 'bad.tgz'); await create({ file: bad, cwd: work, gzip: true }, [...contents, 'package/.probe-work/private.json']);
  await assert.rejects(auditArchive(bad), /whitelist/);
});

test('release annotation and registry bind owner, source, version and exact artifact', () => {
  const annotation = 'DSH-Reforge ' + release.tag + '\n\npackage: dsh-reforge\nversion: ' + release.version + '\nsource-commit: ' + 'a'.repeat(40) + '\nnpm-integrity: sha512-' + 'A'.repeat(86) + '==\nnpm-shasum: ' + 'b'.repeat(40) + '\nnpm-publisher: wang129\n';
  const tag = parseReleaseTag(annotation);
  assert.throws(() => parseReleaseTag(annotation + 'npm-publisher: wang129\n'), /Duplicate/);
  assert.throws(() => parseReleaseTag(annotation.replace('wang129\n', 'someone\n')));
  assert.throws(() => parseReleaseTag(annotation.replace('source-commit: ', 'unknown-field: ')));
  const metadata = { name: release.name, version: release.version, repository: { url: 'git+https://github.com/' + release.repository + '.git' }, _npmUser: { name: release.publisher },
    dist: { integrity: tag.integrity, shasum: tag.shasum, tarball: release.registry + '/' + release.name + '/-/' + release.name + '-' + release.version + '.tgz' } };
  assert.ok(validateRegistry(metadata, tag).startsWith(release.registry));
  assert.throws(() => validateRegistry({ ...metadata, _npmUser: { name: 'someone' } }, tag));
  assert.throws(() => validateRegistry({ ...metadata, dist: { ...metadata.dist, integrity: 'different' } }, tag));
  assert.throws(() => validateRegistry({ ...metadata, dist: { ...metadata.dist, tarball: 'https://example.invalid/package.tgz' } }, tag));
  const frozen = { commit: firstPublishedArtifact.sourceCommit, integrity: firstPublishedArtifact.integrity, shasum: firstPublishedArtifact.shasum };
  const historical = { ...metadata, version: firstPublishedArtifact.version, repository: { url: 'git+https://github.com/' + firstPublishedArtifact.repository + '.git' },
    dist: { ...metadata.dist, integrity: frozen.integrity, shasum: frozen.shasum, tarball: release.registry + "/" + release.name + "/-/" + release.name + "-" + firstPublishedArtifact.version + ".tgz" } };
  assert.ok(validateRegistry(historical, frozen));
  assert.throws(() => validateRegistry(historical, { ...frozen, commit: 'a'.repeat(40) }));
  assert.throws(() => validateRegistry(historical, { ...frozen, integrity: tag.integrity }));
  assert.throws(() => validateRegistry(historical, { ...frozen, shasum: tag.shasum }));
});

test('release checkout restores the remote annotation after a SHA fetch replaces its local tag reference', async () => {
  const historicalTag = release.tag;
  const work = resolve(await workDir('release-checkout-'));
  const origin = join(work, 'origin.git'), source = join(work, 'source'), checkout = join(work, 'checkout');
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(work, 'init', '--bare', origin); git(work, 'init', '-b', 'main', source);
  git(source, 'config', 'user.name', 'Synthetic release checkout'); git(source, 'config', 'user.email', 'synthetic@example.invalid');
  await writeFile(join(source, 'synthetic.txt'), 'Synthetic release checkout only\n');
  git(source, 'add', 'synthetic.txt'); git(source, 'commit', '-m', 'Synthetic release source');
  const commit = git(source, 'rev-parse', 'HEAD');
  const annotation = 'DSH-Reforge ' + historicalTag + '\n\npackage: dsh-reforge\nversion: ' + release.version + '\nsource-commit: ' + commit
    + '\nnpm-integrity: sha512-' + 'A'.repeat(86) + '==\nnpm-shasum: ' + 'b'.repeat(40) + '\nnpm-publisher: wang129\n';
  git(source, 'tag', '-a', historicalTag, '-m', annotation); const tagObject = git(source, 'rev-parse', historicalTag);
  git(source, 'remote', 'add', 'origin', origin); git(source, 'push', 'origin', 'main', 'refs/tags/' + historicalTag);
  git(work, 'init', checkout); git(checkout, 'remote', 'add', 'origin', origin);
  git(checkout, 'fetch', '--no-tags', 'origin', '+refs/tags/' + historicalTag + ':refs/tags/' + historicalTag);
  git(checkout, 'checkout', '--detach', commit);
  // This is the second fetch recorded in the failed hosted checkout, using a
  // peeled commit as the source and the annotated tag's ref as the destination.
  git(checkout, 'fetch', '--no-tags', 'origin', '+' + commit + ':refs/tags/' + historicalTag);
  assert.equal(git(checkout, 'cat-file', '-t', 'refs/tags/' + historicalTag), 'commit');
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');
  const command = workflow.match(/- name: Restore annotated release tag\s+run: (git fetch --no-tags origin \+refs\/tags\/[^\s:]+:refs\/tags\/[^\s]+)\r?\n/);
  assert.ok(command, 'Workflow must restore the remote annotated tag before release validation');
  git(checkout, ...command[1]!.split(' ').slice(1));
  assert.equal(git(checkout, 'cat-file', '-t', 'refs/tags/' + historicalTag), 'tag');
  assert.equal(git(checkout, 'rev-parse', 'refs/tags/' + historicalTag), tagObject);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), commit);
  assert.equal(parseReleaseTag(git(checkout, 'for-each-ref', '--format=%(contents)', 'refs/tags/' + historicalTag)).commit, commit);
  assert.equal(git(checkout, 'ls-remote', 'origin', 'refs/tags/' + historicalTag).split(/\s+/)[0], tagObject);
});

test('publication gates require all four current source checks and reject stale, pending, spoofed or failing results', () => {
  const sha = 'a'.repeat(40);
  const checks = ['ubuntu-latest', 'windows-latest'].flatMap(os => ['0.2.0-rc.2', '0.2.1-rc.5'].map((host, i) => ({ name: `check (${os}, ${host})`, head_sha: sha,
    status: 'completed', conclusion: 'success', id: i + 1, app: { slug: 'github-actions' } })));
  validateReleaseChecks(checks, sha);
  assert.throws(() => validateReleaseChecks(checks.slice(1), sha));
  assert.throws(() => validateReleaseChecks(checks, 'b'.repeat(40)));
  for (const changed of [{ status: 'in_progress', conclusion: null }, { conclusion: 'failure' }, { app: { slug: 'untrusted' } }]) {
    assert.throws(() => validateReleaseChecks([{ ...checks[0]!, ...changed }, ...checks.slice(1)], sha));
  }
  assert.throws(() => validateReleaseChecks([...checks, { ...checks[0]!, id: 99, status: 'queued', conclusion: null }], sha));
});
