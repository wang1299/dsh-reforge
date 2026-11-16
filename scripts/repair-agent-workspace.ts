/** Host-only scoped port for authored synthetic functions, not arbitrary user repositories. */
import { open, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/domain.js';
import { RepairRejected, type RepairWorkspace } from '../src/repair-agent-contract.js';
import { makeStudyDirectory, ownedStudyPath } from './study-owned-path.js';
import { studyProjectSentinel, writeStudyTarget } from './benefit-study-files.js';
import { StudyValidationError } from './study-admission.js';
import type { StudyExecutionPort } from './study-bounded-python.js';
import type { StudyCase } from './benefit-study-cases.js';

async function boundedRead(path: string, maxBytes: number) {
  await ownedStudyPath(path); const fd = await open(path, 'r');
  try {
    const stat = await fd.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('Invalid owned file');
    const buffer = Buffer.alloc(maxBytes + 1); const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error('Read limit'); await ownedStudyPath(path);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await fd.close(); }
}

export async function repairWorkspace(root: string, item: StudyCase, execution: StudyExecutionPort): Promise<RepairWorkspace> {
  await ownedStudyPath(root); const project = join(root, 'project'); await ownedStudyPath(project);
  const baseline = await makeStudyDirectory(join(root, 'runner-baseline'));
  const checks = await makeStudyDirectory(join(root, 'runner-checks'));
  const reports = await makeStudyDirectory(join(root, 'runner-receipts'));
  const checkFile = join(checks, 'test_contract.py');
  await writeFile(checkFile, item.checks, { flag: 'wx', mode: 0o600 });
  await writeFile(join(baseline, 'target.py'), item.before, { flag: 'wx', mode: 0o600 });
  if (await readFile(join(project, 'contract.py'), 'utf8') !== studyProjectSentinel) throw new Error('Wrong synthetic project');
  execution.validate(item.before); await writeStudyTarget(root, project, item.before);
  const initialDigest = digest(item.before), contractDigest = digest(item.checks);
  const expectedCases = [...item.checks.matchAll(/^def (test_[A-Za-z0-9_]+)\(/gm)].map(m => m[1]!);
  const read = async () => { const code = await boundedRead(join(project, 'target.py'), 4096); return { code, codeDigest: digest(code) }; };
  return { initialDigest, contractDigest, expectedCases, read,
    async patch(expectedDigest, code) {
      const before = await read(); if (before.codeDigest !== expectedDigest) throw new RepairRejected('stale_file');
      try { execution.validate(code); } catch (error) {
        if (error instanceof StudyValidationError && error.kind === 'rejected') throw new RepairRejected('invalid_code'); throw error;
      }
      if ((await read()).codeDigest !== expectedDigest) throw new RepairRejected('stale_file');
      await writeStudyTarget(root, project, code); return read();
    },
    async check(phase) {
      if (digest(await boundedRead(checkFile, 16384)) !== contractDigest) throw new Error('Acceptance changed');
      const folder = phase === 'reproduce' ? baseline : project;
      const before = await boundedRead(join(folder, 'target.py'), 4096); execution.validate(before);
      if (phase === 'reproduce' && digest(before) !== initialDigest) throw new Error('Baseline changed');
      const result = await execution.run(folder, checks, join(reports, randomUUID() + '.xml'));
      if (digest(await boundedRead(checkFile, 16384)) !== contractDigest || await boundedRead(join(folder, 'target.py'), 4096) !== before) throw new Error('Check input changed');
      return { codeDigest: digest(before), contractDigest, exitCode: result.exitCode, timedOut: result.timedOut,
        cases: result.cases.map(c => ({ id: c.id.split('::').at(-1)!, status: c.status })) };
    } };
}
