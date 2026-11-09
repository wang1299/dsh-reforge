import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { probeStudyPython, studyChildEnvironment } from '../scripts/study-bounded-python.js';

const python = process.env.EVOLVE_PYTHON ?? 'python';
const parent = fileURLToPath(new URL('../../.probe-work/t065-process-tests', import.meta.url));
test('study worker installs actual OS process limits and denies an allocation above the memory cap', async () => {
  const root = await newStudyRoot(parent);
  const limits = await probeStudyPython(python, join(root, 'probe'));
  assert.equal(limits.memory, 536870912); assert.equal(limits.cpuSeconds, 8);
  assert.equal(limits.mechanism, process.platform === 'win32' ? 'windows-job' : 'linux-rlimit');
  await probeStudyPython(python, join(root, 'memory'), 'memory');
});
test('a synthetic parent Key and unrelated environment are not inherited by acceptance Python', async () => {
  const root = await newStudyRoot(parent); const temp = join(root, 'temp'); await mkdir(temp);
  const module = new URL('../scripts/study-bounded-python.js', import.meta.url).href;
  const code = 'const m=await import(' + JSON.stringify(module) + ');await m.probeStudyPython(' + JSON.stringify(python) + ',' + JSON.stringify(temp) + ',"environment");';
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, timeout: 15000, maxBuffer: 4096,
    env: { ...studyChildEnvironment(temp), DSH_REFORGE_STUDY_KEY: 'synthetic-not-a-real-key', REFORGE_PARENT_SENTINEL: 'synthetic-secret' } });
  assert.equal(studyChildEnvironment(temp).DSH_REFORGE_STUDY_KEY, undefined);
  assert.equal(studyChildEnvironment(temp).PYTHONSTARTUP, undefined);
});
test('process preparation rejects a linked directory before running Python or creating files', async () => {
  const root = await newStudyRoot(parent); const destination = join(root, 'original'); await mkdir(destination);
  const alias = join(root, 'alias'); await symlink(destination, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(probeStudyPython(python, alias), /link/);
});
