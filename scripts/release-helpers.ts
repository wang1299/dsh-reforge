import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { list } from 'tar';
import { firstPublishedArtifact } from '../src/legacy.js';

export const release = { name: 'dsh-reforge', version: '0.1.0-alpha.3', tag: 'v0.1.0-alpha.3',
  repository: 'wang1299/dsh-reforge', publisher: 'wang129', registry: 'https://registry.npmjs.org' } as const;
const baseFiles = ['dist/src', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md', 'docs/installation.md'];
const exampleFiles = [
  'docs/releases/v0.1.0-alpha.3.md',
  'examples/repair-agent/README.md',
  'examples/semantic-memory/replay.mjs',
  'scripts/study-python-worker.py',
  'compat/study-runtime/requirements.txt',
  'compat/retrieval-embedding/model.json',
  'compat/retrieval-embedding/README.md',
  'compat/semantic-memory/calibration.json',
  'compat/semantic-memory/README.md',
  'test/fixtures/semantic-memory-v1.json',
  'test/fixtures/semantic-memory-v1-holdout-vectors.json',
  'docs/evaluation/semantic-memory-v1-holdout.json',
  'dist/test/context-fixture.js',
  'dist/scripts/repair-agent-demo.js',
  'dist/scripts/benefit-study-preflight.js',
  'dist/scripts/pilot-fixtures.js',
  'dist/scripts/benefit-study-cases.js',
  'dist/scripts/study-admission.js',
  'dist/scripts/study-bounded-python.js',
  'dist/scripts/study-owned-path.js',
  'dist/scripts/study-python-vendor.js',
  'dist/scripts/repair-agent-workspace.js',
  'dist/scripts/benefit-study-files.js',
  'dist/scripts/semantic-memory-data.js',
  'dist/scripts/semantic-memory-evaluation.js',
];
const originalRequired = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'docs/installation.md', 'cordis.patch.yml',
  'dist/src/cli.js', 'dist/src/dsh.js', 'dist/src/client.js', 'dist/src/service.js'];
export const requiredReleaseFiles = [...originalRequired, ...exampleFiles,
  'dist/src/agent-context.js', 'dist/src/semantic-memory.js', 'dist/src/repair-agent.js', 'dist/src/dsh-adapter-repair.js',
  'dist/src/memory-review.js', 'dist/src/memory-revalidation.js'];
const allowed = (p: string): boolean => requiredReleaseFiles.includes(p) || /^dist\/src\/[a-z][a-z0-9-]*\.(?:js|d\.ts)$/.test(p);
type RecordValue = Record<string, unknown>;

export function validateReleaseChecks(checks: { name: string; head_sha: string; status: string; conclusion: string | null; id: number; app?: { slug?: string } }[], commit: string): void {
  for (const os of ['ubuntu-latest', 'windows-latest']) for (const host of ['0.2.0-rc.2', '0.2.1-rc.5']) {
    const name = `check (${os}, ${host})`;
    const latest = checks.filter(check => check.name === name && check.head_sha === commit && check.app?.slug === 'github-actions').sort((a, b) => b.id - a.id)[0];
    assert(latest?.status === 'completed' && latest.conclusion === 'success', 'Required source check missing or unsuccessful: ' + name);
  }
}

export function validateManifest(input: unknown, historicalFirstRelease = false): void {
  const p = input as RecordValue;
  assert.equal(p.name, release.name); assert.equal(p.version, release.version); assert.equal(p.license, 'MIT');
  assert.deepEqual(p.bin, { 'dsh-reforge': './dist/src/cli.js' });
  assert.deepEqual(p.repository, { type: 'git', url: 'git+https://github.com/' + release.repository + '.git' });
  assert.deepEqual(p.files, historicalFirstRelease ? baseFiles : [...baseFiles, ...exampleFiles]);
  assert.deepEqual(p.publishConfig, { registry: release.registry + '/', access: 'public', tag: 'alpha' });
  assert.equal((p.exports as RecordValue)['.'], './dist/src/dsh.js');
  assert.equal((p.exports as RecordValue)['./client'], './dist/src/client.js');
  if (!historicalFirstRelease) {
    assert.equal((p.exports as RecordValue)['./semantic-memory'], './dist/src/semantic-memory.js');
    assert.equal((p.exports as RecordValue)['./repair-agent'], './dist/src/repair-agent.js');
    assert.equal((p.exports as RecordValue)['./repair-tools'], './dist/src/dsh-adapter-repair.js');
  }
}

/** Audit only; never extracts an archive or executes its scripts. */
export async function auditArchive(file: string, historicalFirstRelease = false): Promise<{ files: string[]; sha256: string; integrity: string; shasum: string; bytes: number }> {
  assert.ok((await stat(file)).size <= 8 * 1024 * 1024, 'Compressed package exceeds release cap');
  const files = new Set<string>(); let total = 0; let manifest: Buffer | undefined; let invalid: unknown;
  await list({ file, strict: true, onReadEntry: entry => {
    try {
    assert.equal(entry.type, 'File', 'Package entries must be regular files');
    assert.ok(entry.path.startsWith('package/'), 'Unexpected archive root');
    const p = entry.path.slice(8);
    assert.ok(allowed(p), 'Not in publication whitelist: ' + p);
    assert.ok(!files.has(p), 'Duplicate archive entry: ' + p); files.add(p);
    total += entry.size;
    assert.ok(files.size <= 256 && entry.size <= 2 * 1024 * 1024 && total <= 8 * 1024 * 1024, 'Unpacked package exceeds release cap');
    if (p === 'package.json') {
      assert.ok(entry.size <= 32768, 'Manifest exceeds cap'); const chunks: Buffer[] = [];
      entry.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
      entry.on('end', () => { manifest = Buffer.concat(chunks); });
    }
    } catch (error) { invalid ??= error; }
  } });
  if (invalid) throw invalid;
  for (const p of historicalFirstRelease ? originalRequired : requiredReleaseFiles) assert.ok(files.has(p), 'Missing published file: ' + p);
  const buffer = await readFile(file);
  assert.ok(manifest); const metadata = JSON.parse(manifest.toString('utf8')) as RecordValue;
  if (historicalFirstRelease) {
    assert.equal(createHash('sha256').update(buffer).digest('hex'), firstPublishedArtifact.sha256, 'Historical exception requires the exact frozen first artifact');
    assert.equal(metadata.version, firstPublishedArtifact.version);
    assert.deepEqual(metadata.repository, { type: 'git', url: 'git+https://github.com/' + firstPublishedArtifact.repository + '.git' });
    validateManifest({ ...metadata, version: release.version, repository: { type: 'git', url: 'git+https://github.com/' + release.repository + '.git' } }, true);
  } else validateManifest(metadata);
  return { files: [...files].sort(), sha256: createHash('sha256').update(buffer).digest('hex'),
    integrity: 'sha512-' + createHash('sha512').update(buffer).digest('base64'), shasum: createHash('sha1').update(buffer).digest('hex'), bytes: buffer.length };
}

export function parseReleaseTag(message: string, expectedVersion: string = release.version): { commit: string; integrity: string; shasum: string } {
  const lines = message.trim().split(/\r?\n/);
  assert.equal(lines.shift(), 'DSH-Reforge v' + expectedVersion); assert.equal(lines.shift(), '');
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = /^([a-z-]+): (\S+)$/.exec(line); assert.ok(match, 'Malformed release annotation');
    assert.ok(!Object.hasOwn(fields, match[1]!), 'Duplicate tag field'); fields[match[1]!] = match[2]!;
  }
  assert.deepEqual(Object.keys(fields).sort(), ['package', 'version', 'source-commit', 'npm-integrity', 'npm-shasum', 'npm-publisher'].sort());
  assert.equal(fields.package, release.name); assert.equal(fields.version, expectedVersion); assert.equal(fields['npm-publisher'], release.publisher);
  assert.match(fields['source-commit']!, /^[a-f0-9]{40}$/); assert.match(fields['npm-shasum']!, /^[a-f0-9]{40}$/);
  assert.match(fields['npm-integrity']!, /^sha512-[A-Za-z0-9+/]{86}==$/);
  return { commit: fields['source-commit']!, integrity: fields['npm-integrity']!, shasum: fields['npm-shasum']! };
}

export function validateRegistry(metadata: unknown, tag: ReturnType<typeof parseReleaseTag>): string {
  const p = metadata as RecordValue; const dist = p.dist as RecordValue;
  assert.equal(p.name, release.name);
  const historical = tag.commit === firstPublishedArtifact.sourceCommit;
  assert.equal(p.version, historical ? firstPublishedArtifact.version : release.version);
  if (historical) {
    assert.equal(tag.integrity, firstPublishedArtifact.integrity); assert.equal(tag.shasum, firstPublishedArtifact.shasum);
  }
  assert.equal((p.repository as RecordValue).url, 'git+https://github.com/' + (historical ? firstPublishedArtifact.repository : release.repository) + '.git');
  assert.equal((p._npmUser as RecordValue).name, release.publisher);
  assert.equal(dist.integrity, tag.integrity); assert.equal(dist.shasum, tag.shasum);
  const tarball = release.registry + '/' + release.name + '/-/' + release.name + '-' + (historical ? firstPublishedArtifact.version : release.version) + '.tgz';
  assert.equal(dist.tarball, tarball); return tarball;
}
