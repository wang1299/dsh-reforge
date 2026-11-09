import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { digest, relativePath, shaSchema, type Scope } from './domain.js';

interface RepositoryGitContext { env: NodeJS.ProcessEnv; config: readonly string[] }
const gitContext = new AsyncLocalStorage<RepositoryGitContext>();
/** Internal scoped execution, including nested source-verification calls; normal product defaults remain. */
export function withRepositoryGitContext<T>(context: RepositoryGitContext, fn: () => T): T {
  return gitContext.run({ env: { ...context.env }, config: [...context.config] }, fn);
}
export function git(root: string, args: string[]): string {
  return gitBytes(root, args).toString('utf8').trim();
}
/** Binary blobs must not pass through text decoding or whitespace normalization. */
export function gitBytes(root: string, args: string[], maxBuffer = 8 * 1024 * 1024): Buffer {
  const context = gitContext.getStore(); const config = context?.config.flatMap(value => ['-c', value]) ?? [];
  return execFileSync('git', [...config, '-C', root, ...args], { maxBuffer,
    windowsHide: true, ...(context ? { env: context.env } : {}) });
}
export function safeFile(root: string, input: string): string {
  const path = relativePath.parse(input);
  const full = resolve(root, path);
  const normalizedRoot = realpathSync(root);
  const actual = realpathSync(full);
  const rel = relative(normalizedRoot, actual);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error('Path escapes repository');
  }
  if (!lstatSync(full).isFile()) throw new Error('Expected a regular file');
  return full;
}
const dependencyFiles = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'poetry.lock', 'uv.lock', 'Pipfile.lock'];
export function snapshot(root: string, requiredFiles: string[] = []): { scope: Scope; commit: string; root: string } {
  const actualRoot = realpathSync(git(root, ['rev-parse', '--show-toplevel']));
  // Windows' legacy realpath can retain an 8.3 alias while Git returns the long name.
  // Native resolution compares the same directory without changing persisted repository IDs.
  if (realpathSync.native(root) !== realpathSync.native(actualRoot)) throw new Error('Configure the exact Git repository root');
  const dependencyParts = dependencyFiles.filter((p) => existsSync(join(root, p)))
    .map((p) => `${p}:${digest(readFileSync(safeFile(root, p)))}`);
  const files = Object.fromEntries(requiredFiles.map((p) => [p, digest(readFileSync(safeFile(root, p)))]));
  return {
    root: actualRoot, commit: shaSchema.parse(git(root, ['rev-parse', 'HEAD'])),
    scope: { repoId: digest(actualRoot), dependencyDigest: digest(dependencyParts.join('\n')), requiredFiles: files },
  };
}
export function applicability(experience: Scope, current: Scope): string | null {
  if (experience.repoId !== current.repoId) return 'different_repository';
  if (experience.dependencyDigest !== current.dependencyDigest) return 'dependencies_changed';
  for (const [path, hash] of Object.entries(experience.requiredFiles)) {
    if (current.requiredFiles[path] !== hash) return 'code_condition_changed:' + path;
  }
  return null;
}

/** One synchronous selection's fresh view. Never retain this reader between requests. */
export function requestScopeReader(root: string, current: ReturnType<typeof snapshot>) {
  const hashes = new Map<string, string>(); const missing = new Set<string>(); let pathsChecked = 0;
  return {
    read(requiredFiles: string[]): ReturnType<typeof snapshot> {
      const files = Object.fromEntries(requiredFiles.map(path => {
        if (missing.has(path)) throw new Error('Missing code condition');
        if (!hashes.has(path)) {
          pathsChecked++;
          try { hashes.set(path, digest(readFileSync(safeFile(root, path)))); }
          catch { missing.add(path); throw new Error('Missing code condition'); }
        }
        return [path, hashes.get(path)!];
      }));
      return { root: current.root, commit: current.commit, scope: {
        repoId: current.scope.repoId, dependencyDigest: current.scope.dependencyDigest, requiredFiles: files } };
    },
    pathsChecked: (): number => pathsChecked,
  };
}
