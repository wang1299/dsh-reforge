import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { repairWorkspace } from '../scripts/repair-agent-workspace.js';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { studyProjectSentinel } from '../scripts/benefit-study-files.js';
import { StudyValidationError } from '../scripts/study-admission.js';
import { studyCases } from '../scripts/benefit-study-cases.js';
import { RepairRejected } from '../src/repair-agent-contract.js';
import { digest } from '../src/domain.js';

async function fixture() {
  const root = await newStudyRoot(resolve('.probe-work/t073-files')); const project = join(root, 'project'); await mkdir(project);
  await writeFile(join(project, 'contract.py'), studyProjectSentinel);
  let runs = 0;
  const execution = { kind: 'bounded-study-v1' as const,
    validate(code: string) { if (code === 'rejected') throw new StudyValidationError('rejected'); },
    async run(): Promise<never> { runs++; throw new Error('Synthetic file-port control must not execute Python'); } };
  const item = studyCases[0]!; const workspace = await repairWorkspace(root, item, execution);
  return { root, project, item, workspace, runs: () => runs };
}

test('actual owned target replacement is version-bound; known rejection leaves the file intact', async () => {
  const f = await fixture(); const before = await f.workspace.read();
  await assert.rejects(f.workspace.patch(digest('old'), f.item.reference), e => e instanceof RepairRejected && e.reason === 'stale_file');
  await assert.rejects(f.workspace.patch(before.codeDigest, 'rejected'), e => e instanceof RepairRejected && e.reason === 'invalid_code');
  assert.equal((await f.workspace.read()).code, f.item.before);
  const patched = await f.workspace.patch(before.codeDigest, f.item.reference);
  assert.equal(patched.code, f.item.reference); assert.equal(patched.codeDigest, digest(f.item.reference));
  assert.equal(await readFile(join(f.project, 'contract.py'), 'utf8'), studyProjectSentinel);
});

test('actual hardlinked targets cannot be read or patched and the linked inode remains unchanged', async () => {
  const f = await fixture(); const untouched = join(f.root, 'untouched.txt'); const target = join(f.project, 'target.py');
  await writeFile(untouched, 'preserve this inode'); await unlink(target); await link(untouched, target);
  await assert.rejects(f.workspace.read()); await assert.rejects(f.workspace.patch(digest('preserve this inode'), f.item.reference));
  assert.equal(await readFile(untouched, 'utf8'), 'preserve this inode'); assert.equal(f.runs(), 0);
});

test('changed independent tests and changed original baseline are refused before execution', async () => {
  const f = await fixture(); await writeFile(join(f.root, 'runner-checks', 'test_contract.py'), 'def test_fake(): pass\n');
  await assert.rejects(f.workspace.check('verify')); assert.equal(f.runs(), 0);
  const g = await fixture(); await writeFile(join(g.root, 'runner-baseline', 'target.py'), g.item.reference);
  await assert.rejects(g.workspace.check('reproduce')); assert.equal(g.runs(), 0);
});
