// Runs only for the reviewed, authorized alpha.2 tag (ADR044).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditArchive, parseReleaseTag, release, validateManifest, validateRegistry, validateReleaseChecks } from '../dist/scripts/release-helpers.js';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert.equal(process.env.GITHUB_REPOSITORY, release.repository);
assert.equal(process.env.GITHUB_REF, 'refs/tags/' + release.tag);
assert.equal(git('cat-file', '-t', 'refs/tags/' + release.tag), 'tag', 'Annotated tag required');
const tag = parseReleaseTag(git('for-each-ref', '--format=%(contents)', 'refs/tags/' + release.tag));
assert.equal(git('rev-parse', 'HEAD'), tag.commit);
assert.equal(git('rev-parse', release.tag + '^{commit}'), tag.commit);
git('merge-base', '--is-ancestor', tag.commit, 'origin/main');
const runs = JSON.parse(gh('api', 'repos/' + release.repository + '/actions/workflows/check.yml/runs?branch=main&event=push&head_sha=' + tag.commit + '&per_page=100'));
const mainRun = runs.workflow_runs.find(run => run.head_sha === tag.commit && run.head_branch === 'main' && run.event === 'push');
assert(mainRun?.status === 'completed' && mainRun.conclusion === 'success', 'Exact main source CI must pass before release');
const pages = JSON.parse(gh('api', '--paginate', '--slurp', 'repos/' + release.repository + '/commits/' + tag.commit + '/check-runs?per_page=100'));
validateReleaseChecks(pages.flatMap(page => page.check_runs), tag.commit);
validateManifest(JSON.parse(await readFile('package.json', 'utf8')));
// A previous side effect must be inspected by the owner; never overwrite an existing release.
const existing = JSON.parse(gh('api', '--paginate', '--slurp', 'repos/' + release.repository + '/releases?per_page=100'));
assert.ok(!existing.flat().some(r => r.tag_name === release.tag), 'Release already exists; inspect before recovery');
const response = await fetch(release.registry + '/' + release.name + '/' + release.version, { signal: AbortSignal.timeout(30000), redirect: 'error' });
assert.equal(response.status, 200); const metadata = await response.json();
const tarball = validateRegistry(metadata, tag);
const archiveResponse = await fetch(tarball, { signal: AbortSignal.timeout(30000), redirect: 'error' });
assert.equal(archiveResponse.status, 200);
const cap = 8 * 1024 * 1024; const chunks = []; let size = 0;
for await (const chunk of archiveResponse.body) { size += chunk.length; assert.ok(size <= cap); chunks.push(chunk); }
const work = '.probe-work/release'; await mkdir(work, { recursive: true });
const filename = release.name + '-' + release.version + '.tgz'; const archive = join(work, filename);
await writeFile(archive, Buffer.concat(chunks), { flag: 'wx' });
const audited = await auditArchive(archive);
assert.equal(audited.integrity, tag.integrity); assert.equal(audited.shasum, tag.shasum);
const checksum = join(work, 'SHA256SUMS'); await writeFile(checksum, audited.sha256 + '  ' + filename + '\n', { flag: 'wx' });
const manifest = join(work, 'release.json'); await writeFile(manifest, JSON.stringify({ package: release.name, version: release.version,
  sourceCommit: tag.commit, publisher: release.publisher, registry: release.registry, ...audited }, null, 2) + '\n', { flag: 'wx' });
const assets = [archive, checksum, manifest];
gh('release', 'create', release.tag, ...assets, '--repo', release.repository, '--verify-tag', '--draft', '--prerelease',
  '--title', 'DSH-Reforge ' + release.tag, '--notes-file', 'docs/releases/' + release.tag + '.md');
const draft = JSON.parse(gh('release', 'view', release.tag, '--repo', release.repository, '--json', 'isDraft,isPrerelease,assets,targetCommitish'));
assert.equal(draft.isDraft, true); assert.equal(draft.isPrerelease, true);
assert.deepEqual(draft.assets.map(a => a.name).sort(), [filename, 'SHA256SUMS', 'release.json'].sort());
for (const asset of draft.assets) assert.equal(asset.size, (await stat(join(work, asset.name))).size);
gh('release', 'edit', release.tag, '--repo', release.repository, '--draft=false', '--prerelease', '--latest=false');
const published = JSON.parse(gh('release', 'view', release.tag, '--repo', release.repository, '--json', 'isDraft,isPrerelease,url'));
assert.equal(published.isDraft, false); assert.equal(published.isPrerelease, true); console.log(published.url);
