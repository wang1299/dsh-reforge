import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const studyRepository = fileURLToPath(new URL('../../', import.meta.url));
const probe = resolve(studyRepository, '.probe-work');
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export async function ownedStudyPath(input: string, missingLeaf = false): Promise<string> {
  const path = resolve(input); const child = relative(probe, path);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) throw new Error('Study path is outside owned work');
  const paths = [probe, ...child.split(sep).map((_, i, parts) => resolve(probe, ...parts.slice(0, i + 1)))];
  for (const [index, item] of paths.entries()) {
    let stat;
    try { stat = await lstat(item); } catch (error) { if (missingLeaf && index === paths.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return path; throw error; }
    if (stat.isSymbolicLink() || !samePath(await realpath(item), item) || index < paths.length - 1 && !stat.isDirectory()
      || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Study path contains a link or unsupported file');
  }
  return path;
}
export async function makeStudyDirectory(path: string): Promise<string> {
  const checked = await ownedStudyPath(path, true);
  try { await mkdir(checked, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await ownedStudyPath(checked); if (!(await lstat(checked)).isDirectory()) throw new Error('Study directory required'); return checked;
}
