/** Bounded local runtime inventory. Owner/OS rollback resistance is outside this contract. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface StudyFreezeRoot { name: string; path: string; files?: string[]; skip?: string[]; allowFileLinks?: boolean }
interface FileIdentity { dev: string; ino: string; size: string; mtime: string; ctime: string }
interface InventoryEntry { path: string; group: string; kind: 'file' | 'directory' | 'link'; identity?: FileIdentity; target?: string; targetIdentity?: FileIdentity }
export interface StudyRuntimeFreeze { version: 1; roots: StudyFreezeRoot[]; entries: (InventoryEntry & { sha256?: string })[]; bytes: number; critical: string[] }
const identity = (s: Awaited<ReturnType<typeof lstat>>) => ({ dev: String(s.dev), ino: String(s.ino), size: String(s.size), mtime: String(s.mtimeMs), ctime: String(s.ctimeMs) });
const inside = (root: string, path: string) => { const child = relative(root, path); return !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep); };
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function inventory(roots: StudyFreezeRoot[]): Promise<InventoryEntry[]> {
  const entries = new Map<string, InventoryEntry>();
  for (const spec of roots) {
    const root = resolve(spec.path); const rootStat = await lstat(root);
    assert(rootStat.isDirectory() && !rootStat.isSymbolicLink() && samePath(await realpath(root), root), 'Frozen root must be a canonical real directory');
    const skip = new Set(spec.skip ?? []);
    async function walk(path: string): Promise<void> {
      const local = relative(root, path).split(sep).join('/'); if (skip.has(local)) return;
      assert(samePath(await realpath(dirname(path)), dirname(path)), 'Runtime parent directory alias is not allowed');
      const name = basename(path).toLowerCase();
      assert(inside(root, path)); assert(!['.env', '.npmrc', '.netrc', 'plan.env'].includes(name)
        && !(name.startsWith('.env.') && name !== '.env.example'), 'Unexpected private configuration in runtime closure');
      const stat = await lstat(path);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        entries.set(path, { path, group: spec.name, kind: 'directory' });
        for (const name of (await readdir(path)).sort()) await walk(join(path, name));
      } else if (stat.isSymbolicLink()) {
        assert(spec.allowFileLinks, 'Runtime link is not allowed'); const target = await realpath(path);
        assert(inside(root, target), 'Runtime link leaves its frozen root'); const targetStat = await lstat(target);
        assert(targetStat.isFile() && !targetStat.isSymbolicLink() && targetStat.nlink === 1, 'Only closed regular-file links are supported');
        entries.set(path, { path, group: spec.name, kind: 'link', identity: identity(stat), target, targetIdentity: identity(targetStat) });
      } else {
        assert(stat.isFile() && stat.nlink === 1 && stat.size <= 268435456, 'Unsupported or oversized runtime file');
        entries.set(path, { path, group: spec.name, kind: 'file', identity: identity(stat) });
      }
      assert(entries.size <= 40000, 'Runtime inventory limit');
    }
    if (spec.files) {
      for (const file of [...spec.files].sort()) { const path = resolve(root, file); assert(inside(root, path) && path !== root); await walk(path); }
    } else await walk(root);
  }
  for (const entry of entries.values()) if (entry.kind === 'link') {
    assert(entries.get(entry.target!)?.kind === 'file', 'Runtime leaf link target must be explicitly covered as a regular file');
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
function criticalCoverage(entries: InventoryEntry[], paths: string[]): void {
  const files = new Set(entries.filter(entry => entry.kind !== 'directory').map(entry => resolve(entry.path)));
  for (const path of paths) assert(files.has(resolve(path)), 'Critical runtime file is missing from the inventory');
}
async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) { bytes += chunk.length; assert(bytes <= 268435456); hash.update(chunk); }
  return hash.digest('hex');
}
export async function freezeStudyRuntime(roots: StudyFreezeRoot[], critical: string[] = []): Promise<StudyRuntimeFreeze> {
  const entries = await inventory(roots); criticalCoverage(entries, critical); let bytes = 0;
  for (let i = 0; i < entries.length; i += 16) await Promise.all(entries.slice(i, i + 16).map(async entry => {
    if (entry.kind === 'directory') return;
    bytes += Number(entry.targetIdentity?.size ?? entry.identity!.size); assert(bytes <= 2147483648, 'Frozen runtime byte limit');
    Object.assign(entry, { sha256: await fileHash(entry.path) });
  }));
  const frozen: StudyRuntimeFreeze = { version: 1, roots: structuredClone(roots), entries, bytes, critical: critical.map(p => resolve(p)).sort() };
  await verifyStudyRuntime(frozen, false); return frozen;
}
export async function verifyStudyRuntime(frozen: StudyRuntimeFreeze, full = false): Promise<void> {
  assert.equal(frozen.version, 1); const now = await inventory(frozen.roots); criticalCoverage(now, frozen.critical);
  assert.deepEqual(now, frozen.entries.map(({ sha256: _hash, ...entry }) => entry), 'Frozen runtime paths/identities changed');
  const critical = new Set(frozen.critical);
  for (let i = 0; i < frozen.entries.length; i += 16) await Promise.all(frozen.entries.slice(i, i + 16).map(async entry => {
    if (entry.kind !== 'directory' && (full || critical.has(entry.path))) assert.equal(await fileHash(entry.path), entry.sha256, 'Frozen runtime bytes changed');
  }));
}
