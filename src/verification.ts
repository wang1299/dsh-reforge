import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, redact, relativePath, shaSchema, verificationSchema, type TestRun, type Verification } from './domain.js';
import { git, gitBytes, snapshot } from './repository.js';
import { WorkspaceSnapshots, type WorkspaceVersion } from './workspace-snapshots.js';

export interface VerificationPolicy {
  trusted: boolean;
  python: string;
  acceptanceDir: string;
  regressionPath: string;
  timeoutMs: number;
  probeEnvironment?: NodeJS.ProcessEnv;
}
/** Optional isolated source-study probes; environment values are never part of persisted verification. */
export function verificationRuntime(policy: Pick<VerificationPolicy, 'python' | 'probeEnvironment'>) {
  const isolated = policy.probeEnvironment;
  const options = { encoding: 'utf8' as const, windowsHide: true, ...(isolated ? {
    env: { ...isolated, PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTEST_ADDOPTS: '', PYTEST_PLUGINS: '' }, timeout: 5000, maxBuffer: 4096,
  } : {}) };
  const prefix = isolated ? ['-I', '-B'] : [];
  return { node: process.version, python: execFileSync(policy.python, [...prefix, '--version'], options).trim(),
    pytest: execFileSync(policy.python, [...prefix, '-m', 'pytest', '--version'], options).trim(), platform: process.platform };
}
export function parsePytest(exitCode: number | null, xml: string, durationMs: number, timedOut: boolean, output: string): TestRun {
  const suite = xml.match(/<testsuite\s[^>]*>/)?.[0];
  const count = (key: string): number => {
    const value = suite?.match(new RegExp(`\\b${key}="([0-9]+)"`))?.[1];
    return value === undefined ? 0 : Number(value);
  };
  const cases: TestRun['cases'] = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attributes = match[1]!; const body = match[2] ?? '';
    const name = attributes.match(/\bname="([^"]+)"/)?.[1];
    const group = attributes.match(/\bclassname="([^"]*)"/)?.[1] ?? '';
    if (!name) continue;
    cases.push({ id: group + '::' + name, status: /<failure\b/.test(body) ? 'failed' : /<error\b/.test(body) ? 'error' : /<skipped\b/.test(body) ? 'skipped' : 'passed' });
  }
  return { exitCode, tests: count('tests'), failures: count('failures'), errors: count('errors'), cases,
    skipped: count('skipped'), durationMs, timedOut, summary: redact(output, 2000) };
}
export function passes(run: TestRun): boolean {
  return !run.timedOut && run.exitCode === 0 && run.tests > run.skipped && run.failures === 0 && run.errors === 0 && run.cases.length === run.tests;
}
export function reproduces(run: TestRun): boolean {
  return !run.timedOut && run.exitCode === 1 && run.tests > run.skipped && run.failures > 0 && run.errors === 0 && run.cases.length === run.tests;
}
export function verifiedCases(base: TestRun, fixed: TestRun): boolean {
  if (!reproduces(base) || !passes(fixed)) return false;
  const fixedCases = new Map(fixed.cases.map((item) => [item.id, item.status]));
  return new Set(base.cases.map((item) => item.id)).size === base.cases.length
    && fixedCases.size === fixed.cases.length && base.cases.length === fixed.cases.length
    && base.cases.every((item) => fixedCases.has(item.id) && (item.status !== 'failed' || fixedCases.get(item.id) === 'passed'));
}
async function acceptanceFiles(root: string, sub = ''): Promise<{ path: string; bytes: Buffer }[]> {
  const files: { path: string; bytes: Buffer }[] = [];
  for (const entry of await readdir(join(root, sub), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
    const path = sub ? sub + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Acceptance symlinks are not supported');
    if (entry.isDirectory()) files.push(...await acceptanceFiles(root, path));
    else if (entry.name.endsWith('.py')) {
      const full = join(root, path);
      if ((await lstat(full)).size > 65536) throw new Error('Acceptance file too large');
      files.push({ path: relativePath.parse(path), bytes: await readFile(full) });
    }
  }
  if (files.length > 100) throw new Error('Too many acceptance files');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
/** Share the source verifier's complete file-set policy with preflight checks. */
export async function acceptanceDigest(root: string): Promise<string> {
  const files = await acceptanceFiles(await realpath(root));
  return digest(files.map((file) => `${file.path}:${digest(file.bytes)}`).join('\n'));
}
async function materialize(root: string, commit: string, target: string): Promise<void> {
  const entries = git(root, ['ls-tree', '-r', '-z', '--full-tree', commit]).split('\0').filter(Boolean);
  if (entries.length > 5000) throw new Error('MVP snapshot limit: 5000 tracked files');
  let total = 0;
  for (const entry of entries) {
    const match = entry.match(/^(\d+) blob ([a-f0-9]{40})\t(.+)$/);
    if (!match || match[1] === '120000') throw new Error('Snapshot contains symlink or unsupported entry');
    const path = relativePath.parse(match[3]);
    const bytes = gitBytes(root, ['cat-file', 'blob', match[2]!], 4 * 1024 * 1024);
    total += bytes.length;
    if (total > 64 * 1024 * 1024) throw new Error('MVP snapshot limit: 64 MiB');
    await mkdir(resolve(target, path, '..'), { recursive: true });
    await writeFile(join(target, path), bytes);
  }
}
async function runPytest(python: string, args: string[], cwd: string, report: string, timeoutMs: number, signal?: AbortSignal): Promise<TestRun> {
  const start = Date.now();
  let timedOut = false;
  let output = '';
  const exitCode = await new Promise<number | null>((resolveRun, reject) => {
    const child = spawn(python, ['-m', 'pytest', ...args, '--junitxml=' + report], {
      cwd, shell: false, windowsHide: true,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|pathext|virtual_env|appdata|localappdata|userprofile|home)$/i.test(key))),
        PYTHONPATH: cwd, PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTHONDONTWRITEBYTECODE: '1',
      },
      signal,
    });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const append = (chunk: Buffer): void => { if (output.length < 8000) output += chunk.toString('utf8').slice(0, 8000 - output.length); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolveRun(code); });
  });
  let xml = '';
  try { xml = await readFile(report, 'utf8'); } catch { /* Missing report is not successful verification. */ }
  return parsePytest(exitCode, xml, Date.now() - start, timedOut, output);
}
export async function verifyRepair(
  root: string, taskId: string, baseCommit: string, fixCommit: string, policy: VerificationPolicy, signal?: AbortSignal,
): Promise<Verification> {
  signal?.throwIfAborted();
  if (!policy.trusted) throw new Error('Explicit repository execution trust is required');
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 120000) throw new Error('Invalid timeout');
  shaSchema.parse(baseCommit); shaSchema.parse(fixCommit); relativePath.parse(policy.regressionPath);
  const current = snapshot(root);
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Commit tracked changes before source verification');
  git(root, ['merge-base', '--is-ancestor', baseCommit, fixCommit]);
  if (baseCommit === fixCommit) throw new Error('Repair must change the source commit');
  if (current.commit !== fixCommit) throw new Error('Repair commit must be the current repository HEAD');
  return verifyPair(root, taskId, baseCommit, fixCommit, policy, current.scope.dependencyDigest,
    (commit, target) => materialize(root, commit, target),
    redact(git(root, ['diff', '--no-ext-diff', '--no-textconv', baseCommit, fixCommit, '--', '*.py']), 8000), {}, () => {}, signal);
}

/** The version SHAs here refer to the private snapshot store, never the user's HEAD. */
export async function verifyWorkspaceRepair(root: string, taskId: string, base: WorkspaceVersion, fixed: WorkspaceVersion,
  snapshots: WorkspaceSnapshots, policy: VerificationPolicy, signal?: AbortSignal): Promise<Verification> {
  const check = (): void => {
    snapshots.validate(base); snapshots.validate(fixed);
    if (!snapshots.matches(fixed)) throw new Error('Workspace changed since the frozen repair');
    if (base.commit === fixed.commit || base.dependencyDigest !== fixed.dependencyDigest) throw new Error('Snapshot repair must change code with unchanged dependencies');
  };
  if (!policy.trusted) throw new Error('Explicit repository execution trust is required');
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 120000) throw new Error('Invalid timeout');
  relativePath.parse(policy.regressionPath); signal?.throwIfAborted(); check();
  snapshots.assertExternalAcceptance(await realpath(policy.acceptanceDir));
  const load = async (commit: string, target: string): Promise<void> => {
    for (const f of snapshots.files(commit)) { await mkdir(resolve(target, f.path, '..'), { recursive: true }); await writeFile(join(target, f.path), f.bytes); }
  };
  return verifyPair(root, taskId, base.commit, fixed.commit, policy, fixed.dependencyDigest, load,
    redact(snapshots.diff(base.commit, fixed.commit), 8000),
    { captureMethod: 'tracked-python-snapshot-v1', repositoryHead: fixed.sourceHead, baseContentDigest: base.digest, fixedContentDigest: fixed.digest }, check, signal);
}

async function verifyPair(root: string, taskId: string, baseCommit: string, fixCommit: string, policy: VerificationPolicy,
  dependencyDigest: string, load: (commit: string, target: string) => Promise<void>, diff: string,
  capture: Record<string, string>, check: () => void, signal?: AbortSignal): Promise<Verification> {
  const current = snapshot(root);
  const acceptanceRoot = await realpath(policy.acceptanceDir);
  const rel = relative(current.root, acceptanceRoot);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error('Acceptance tests must be outside the Agent repository');
  }
  const files = await acceptanceFiles(acceptanceRoot);
  if (!files.some((f) => /(?:^|\/)test_[^/]+\.py$/.test(f.path))) throw new Error('No independent acceptance tests');
  const acceptanceDigest = digest(files.map((f) => `${f.path}:${digest(f.bytes)}`).join('\n'));
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-reforge-verify-'));
  try {
    const baseDir = join(workspace, 'base'); const fixDir = join(workspace, 'fixed'); const testsDir = join(workspace, 'acceptance');
    await mkdir(baseDir); await mkdir(fixDir); await mkdir(testsDir);
    await load(baseCommit, baseDir); await load(fixCommit, fixDir);
    for (const file of files) { await mkdir(resolve(testsDir, file.path, '..'), { recursive: true }); await writeFile(join(testsDir, file.path), file.bytes); }
    const config = join(workspace, 'pytest.ini'); await writeFile(config, '[pytest]\n');
    const acceptanceArgs = [testsDir, '-q', '-c', config, '--import-mode=importlib', '-p', 'no:cacheprovider'];
    const regressionArgs = [policy.regressionPath, '-q', '-c', config, '--import-mode=importlib', '-p', 'no:cacheprovider'];
    const base = await runPytest(policy.python, acceptanceArgs, baseDir, join(workspace, 'base.xml'), policy.timeoutMs, signal);
    const fixed = await runPytest(policy.python, acceptanceArgs, fixDir, join(workspace, 'fixed.xml'), policy.timeoutMs, signal);
    const regression = await runPytest(policy.python, regressionArgs, fixDir, join(workspace, 'regression.xml'), policy.timeoutMs, signal);
    const after = await acceptanceFiles(testsDir);
    if (digest(after.map((f) => `${f.path}:${digest(f.bytes)}`).join('\n')) !== acceptanceDigest) throw new Error('Acceptance evidence changed during verification');
    check();
    const verified = verifiedCases(base, fixed) && passes(regression);
    const environment = {
      ...verificationRuntime(policy), dependencyDigest, ...capture,
    };
    return verificationSchema.parse({
      schemaVersion: 2, id: randomUUID(), sourceTaskId: taskId, repoId: current.scope.repoId, baseCommit, fixCommit, acceptanceDigest,
      acceptanceFiles: files.map((file) => ({ path: file.path, content: file.bytes.toString('utf8') })),
      environment, commands: [
        [policy.python, '-m', 'pytest', '<independent-acceptance>', '-q', '--import-mode=importlib'],
        [policy.python, '-m', 'pytest', policy.regressionPath, '-q', '--import-mode=importlib'],
      ], base, fixed, regression, verified,
      reason: verified ? 'Original test failure reproduced; repair and regression tests passed' : 'Incomplete source verification; retain as candidate',
      diff, createdAt: new Date().toISOString(),
    });
  } finally {
    // workspace is created exclusively by mkdtemp in this function; never accept a caller cleanup path.
    const cleanup = await realpath(workspace);
    if (!cleanup.startsWith(await realpath(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unsafe cleanup path');
    await rm(cleanup, { recursive: true, force: true });
  }
}
