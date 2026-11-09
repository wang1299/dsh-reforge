import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { supportedDshVersions } from '../dist/src/dsh-adapter-policy.js';
import { auditArchive, release } from '../dist/scripts/release-helpers.js';

const root = realpathSync.native(process.cwd());
const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true }).trim();
assert.equal(root, realpathSync.native(gitRoot), 'Run the matrix from the repository root');
const npmCli = process.env.npm_execpath;
assert(npmCli && isAbsolute(npmCli) && existsSync(npmCli), 'Use npm run compat:matrix');
const options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert(['--version', '--archive', '--typecheck-only'].includes(key) && !options.has(key), 'Unknown or duplicate matrix option');
  if (key === '--typecheck-only') options.set(key, true);
  else {
    const value = process.argv[++i]; assert(value && !value.startsWith('--'), 'Missing matrix option value'); options.set(key, value);
  }
}
const requested = options.get('--version');
assert(!requested || supportedDshVersions.includes(requested), 'Unknown matrix version');
const versions = requested ? [requested] : supportedDshVersions;
const typecheckOnly = options.has('--typecheck-only');
mkdirSync('.probe-work', { recursive: true });
const runRoot = mkdtempSync(resolve('.probe-work/dsh-matrix-'));
const run = (cwd, args) => {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, env: process.env, windowsHide: true, stdio: 'inherit', timeout: 1200000 });
  assert.equal(result.status, 0, 'Matrix command failed: npm ' + args.join(' '));
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let archive = options.get('--archive');
if (!typecheckOnly) {
  if (!archive) { run(root, ['pack', '--pack-destination', runRoot]); archive = join(runRoot, release.name + '-' + release.version + '.tgz'); }
  archive = resolve(archive); await auditArchive(archive);
}
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
const roots = ['package.json', 'package-lock.json', 'tsconfig.json', 'eslint.config.mjs', 'README.md', 'LICENSE', 'CHANGELOG.md', 'cordis.patch.yml'];
const files = [...new Set(tracked)].filter(p => /^(?:src|test|scripts|docs|examples|compat|\.github)\//.test(p) || roots.includes(p));
const report = { schemaVersion: 1, phase: typecheckOnly ? 'partial-typecheck' : 'matrix', passed: false,
  sourcePackage: archive ? { sha256: hash(readFileSync(archive)), path: archive } : null, versions: [] };

function learningEvidence(stage) {
  const receipts = [];
  for (const dir of readdirSync(join(stage, '.probe-work')).filter(d => d.startsWith('install-probe-'))) {
    const base = join(stage, '.probe-work', dir);
    for (const name of readdirSync(base).filter(f => /^learning-.*\.json$/.test(f) || f === 'normal-dialogue-learning.json')) {
      const bytes = readFileSync(join(base, name)); assert(bytes.length <= 262144);
      const value = JSON.parse(bytes); assert.equal(value.modelHttpRequests, 0);
      if (name.startsWith('learning-')) assert.equal(value.archiveDigest, report.sourcePackage.sha256);
      else {
        assert.equal(value.passed, true);
        assert.equal(value.retrieval?.available, true, 'Installed candidate must provide bounded live retrieval diagnostics');
        assert.equal(value.retrieval.actualContextDecisionRecorded, true);
        assert.equal(value.retrieval.subsequentLocalSelectionReusedIndex, true);
      }
      receipts.push({ file: join(base, name), sha256: hash(bytes), modelHttpRequests: value.modelHttpRequests });
    }
  }
  assert.equal(receipts.length, 5, 'Four learning scenarios and the normal-dialogue receipt are required');
  return receipts;
}

try {
  for (const version of versions) {
    const stage = join(runRoot, version); mkdirSync(stage);
    for (const file of files) {
      assert(!isAbsolute(file) && !file.split('/').includes('..'), 'Unsafe source path');
      if (!existsSync(join(root, file))) continue;
      const target = join(stage, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(root, file), target);
    }
    const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.devDependencies)) if (name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = version;
    writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    // Each SDK graph is committed; acceptance never uses floating resolution or peer bypass.
    if (version !== supportedDshVersions[0]) copyFileSync(join(root, 'compat', 'dsh-' + version + '.lock.json'), join(stage, 'package-lock.json'));
    console.log('DSH matrix host:', version, 'isolated stage:', stage);
    run(stage, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    const family = {};
    for (const name of Object.keys(manifest.devDependencies).filter(n => n.startsWith('@deepseek-ai/dsh-'))) {
      const actual = JSON.parse(readFileSync(join(stage, 'node_modules', name, 'package.json'), 'utf8')).version;
      assert.equal(actual, version, 'Mixed SDK family: ' + name); family[name] = actual;
    }
    run(stage, ['run', typecheckOnly ? 'typecheck' : 'check']);
    if (!typecheckOnly) {
      run(stage, ['run', 'study:rehearse']);
      run(stage, ['run', 'study:wire']);
      run(stage, ['run', 'study:qualify']);
      run(stage, ['run', 'compat']); run(stage, ['run', 'demo']);
      run(stage, ['run', 'install-probe', '--', archive]);
      run(stage, ['run', 'install-probe', '--', archive, '--learning']);
    }
    report.versions.push({ version, lockSha256: hash(readFileSync(join(stage, 'package-lock.json'))), sdk: family,
      passed: !typecheckOnly, typecheckPassed: true, learning: typecheckOnly ? [] : learningEvidence(stage) });
  }
  report.passed = !typecheckOnly && report.versions.length === versions.length;
} finally {
  writeFileSync(join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('DSH matrix evidence:', join(runRoot, 'report.json'));
}
