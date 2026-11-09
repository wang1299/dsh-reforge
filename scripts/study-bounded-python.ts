import { execFileSync, spawn } from 'node:child_process';
import { open, readFile, lstat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parsePytest } from '../src/verification.js';
import type { TestRun } from '../src/domain.js';
import { validateStudyCode } from './benefit-study-preflight.js';
import { makeStudyDirectory, ownedStudyPath } from './study-owned-path.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const studyPythonWorker = resolve(repository, 'scripts/study-python-worker.py');
const receipt = z.object({ installed: z.literal(true), mechanism: z.enum(['windows-job', 'linux-rlimit']),
  memory: z.literal(536870912), cpuSeconds: z.literal(8) }).strict();
export function studyChildEnvironment(temp: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { TEMP: temp, TMP: temp, TMPDIR: temp, PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTEST_ADDOPTS: '' };
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC']) if (process.env[name]) result[name] = process.env[name];
  return result;
}
function limitReceipt(text: string) {
  const first = text.split(/\r?\n/)[0] ?? '';
  if (!first.startsWith('study-limits-v1:')) throw new Error('Missing study process-limit receipt');
  return receipt.parse(JSON.parse(first.slice('study-limits-v1:'.length)));
}
export async function probeStudyPython(python: string, temp: string, mode: 'probe' | 'environment' | 'memory' = 'probe') {
  await makeStudyDirectory(temp);
  const output = execFileSync(python, ['-I', '-S', '-B', studyPythonWorker, mode], { windowsHide: true, encoding: 'utf8',
    env: studyChildEnvironment(temp), timeout: 15000, maxBuffer: 2048 });
  const limits = limitReceipt(output);
  if (mode !== 'probe' && !output.includes(mode === 'memory' ? 'study-memory-v1:bounded' : 'study-environment-v1:isolated')) throw new Error('Study process probe failed');
  return limits;
}
export interface StudyExecutionPort {
  kind: 'bounded-study-v1'; validate: (code: string) => void;
  run: (project: string, tests: string, xml: string) => Promise<TestRun>;
}
export function boundedStudyExecution(python: string, vendor: string, temp: string): StudyExecutionPort {
  return { kind: 'bounded-study-v1', validate: code => validateStudyCode(python, code, { env: studyChildEnvironment(temp), isolated: true }),
    run: async (project, tests, xml) => {
      for (const path of [vendor, project, tests]) await ownedStudyPath(path);
      await ownedStudyPath(xml, true); await makeStudyDirectory(temp);
      const outputFile = await open(xml, 'wx', 0o600); await outputFile.close();
      const config = xml + '.ini'; await ownedStudyPath(config, true); await writeFile(config, '[pytest]\n', { flag: 'wx', mode: 0o600 });
      const controller = new AbortController(); let timedOut = false; let prefix = ''; let size = 0; const began = Date.now();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
      const child = spawn(python, ['-I', '-S', '-B', studyPythonWorker, 'pytest', vendor, project, tests, config, xml],
        { cwd: project, windowsHide: true, signal: controller.signal, env: studyChildEnvironment(temp) });
      child.stdout.on('data', (data: Buffer) => { size += data.length; prefix = (prefix + data.toString()).slice(0, 1024); if (size > 65536) controller.abort(); });
      child.stderr.on('data', (data: Buffer) => { size += data.length; if (size > 65536) controller.abort(); });
      const code = await new Promise<number | null>(done => { child.once('error', () => {}); child.once('close', done); }); clearTimeout(timer);
      let report = ''; let limitsOk = true;
      try { limitReceipt(prefix); const stat = await lstat(xml); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1048576) throw new Error('Report limit'); report = await readFile(xml, 'utf8'); }
      catch { limitsOk = false; }
      return parsePytest(limitsOk && size <= 65536 ? code : null, limitsOk ? report : '', Date.now() - began, timedOut || controller.signal.aborted, '');
    } };
}
export async function resolveStudyPython(python: string) {
  const output = execFileSync(python, ['-I', '-S', '-B', '-c', 'import json,sys,sysconfig; print(json.dumps({"executable":sys.executable,"stdlib":sysconfig.get_path("stdlib"),"prefix":sys.base_prefix,"version":list(sys.version_info[:3])}))'],
    { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: studyChildEnvironment(dirname(studyPythonWorker)) });
  return z.object({ executable: z.string(), stdlib: z.string(), prefix: z.string(), version: z.tuple([z.literal(3), z.literal(10), z.number().int()]) }).strict().parse(JSON.parse(output));
}
