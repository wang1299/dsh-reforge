import { execFileSync } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { studyChildEnvironment } from './study-bounded-python.js';
import { makeStudyDirectory, ownedStudyPath, studyRepository } from './study-owned-path.js';

export const studyPythonRequirements = join(studyRepository, 'compat/study-runtime/requirements.txt');
/** Installs only preselected hashed wheels into a new owned directory. Never upgrades the user's Python. */
export async function installStudyVendor(python: string, root: string) {
  await ownedStudyPath(root); const vendor = join(root, 'vendor');
  try { await lstat(vendor); throw new Error('Preserve an existing study vendor'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await makeStudyDirectory(vendor); const temp = await makeStudyDirectory(join(root, 'installer-temp'));
  const netrc = join(root, 'empty-netrc'); await writeFile(netrc, '', { flag: 'wx', mode: 0o600 });
  try {
    execFileSync(python, ['-I', '-B', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-index', '--no-cache-dir',
      '--no-deps', '--no-compile', '--require-hashes', '--only-binary=:all:', '--target', vendor, '-r', studyPythonRequirements],
    { windowsHide: true, timeout: 120000, maxBuffer: 32768, env: { ...studyChildEnvironment(temp), NETRC: netrc }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error('Cannot prepare the fixed study Python vendor; no user installation was changed'); }
  return { vendor, requirementsDigest: digest(await readFile(studyPythonRequirements)) };
}
