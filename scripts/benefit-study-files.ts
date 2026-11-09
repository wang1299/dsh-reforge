/** Scoped synthetic-file operations, not an adversarial filesystem sandbox. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const studyProjectSentinel = 'STUDY = "benefit-preparation-v1"\n';
const ignored = fileURLToPath(new URL('../../.probe-work/', import.meta.url));
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
async function regular(path: string, optional = false): Promise<Stats | null> {
  let s: Stats; try { s = await lstat(path); } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;
  }
  assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1, 'Study file link or non-regular file refused'); return s;
}
async function projectScope(parent: string, project: string): Promise<string> {
  const owner = resolve(parent); const rel = relative(resolve(ignored), owner);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep), 'Study owner must remain in this repository');
  assert.equal(await realpath(owner), owner, 'Linked study owner refused');
  const expected = join(owner, 'project'); assert.equal(resolve(project), expected, 'Use only this freshly created study source repository');
  assert.equal(await realpath(expected), expected, 'Linked study project refused');
  const marker = join(expected, 'contract.py'); const before = (await regular(marker))!; const handle = await open(marker, 'r');
  try {
    const current = await handle.stat(); assert(same(before, current) && current.nlink === 1, 'Study marker changed');
    const bytes = Buffer.alloc(128); const read = await handle.read(bytes, 0, bytes.length, 0);
    assert.equal(read.bytesRead, Buffer.byteLength(studyProjectSentinel)); assert.equal(bytes.subarray(0, read.bytesRead).toString(), studyProjectSentinel);
    assert(same(current, (await regular(marker))!), 'Study marker changed');
  } finally { await handle.close(); }
  return expected;
}

/** Never truncate an existing target inode: refuse links, then atomically replace with a new owned file. */
export async function writeStudyTarget(parent: string, project: string, code: string): Promise<void> {
  assert(Buffer.byteLength(code) <= 4096, 'Study target too large'); const expected = await projectScope(parent, project);
  const target = join(expected, 'target.py'); const before = await regular(target, true);
  const temp = join(expected, '.target-' + randomUUID() + '.tmp'); const handle = await open(temp, 'wx', 0o600);
  const owned = await handle.stat(); let renamed = false;
  try {
    assert.equal(owned.nlink, 1); await handle.writeFile(code, 'utf8'); await handle.sync();
    assert(same(owned, (await regular(temp))!), 'Study temporary target changed'); await handle.close();
    await projectScope(parent, project); const latest = await regular(target, true);
    assert(before ? latest && same(before, latest) : !latest, 'Study target changed');
    await rename(temp, target); renamed = true;
    assert(same(owned, (await regular(target))!), 'Study replacement changed');
  } finally {
    await handle.close();
    if (!renamed) { const left = await lstat(temp).catch(() => null); if (left && same(owned, left) && left.nlink === 1) await unlink(temp); }
  }
}
