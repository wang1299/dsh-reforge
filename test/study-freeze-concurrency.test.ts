import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { freezeStudyRuntime, verifyStudyRuntime, type StudyFreezeRoot } from '../scripts/study-runtime-freeze.js';
import { freezeStudyRuntime as serialFreeze, verifyStudyRuntime as serialVerify } from './study-freeze-serial-fixture.js';

const parent = fileURLToPath(new URL('../../.probe-work/t067-freeze-tests', import.meta.url));
async function rejectBoth(roots: StudyFreezeRoot[], critical: string[] = []) {
  await assert.rejects(serialFreeze(roots, critical)); await assert.rejects(freezeStudyRuntime(roots, critical));
}
test('bounded queue matches the immutable serial oracle on a branched tree, skips, duplicate selections and ordered overlapping roots', async () => {
  const source = fileURLToPath(new URL('../../test/study-freeze-serial-fixture.ts', import.meta.url));
  assert.equal(digest(await readFile(source)), '2b3024b4183153fa282dbf759a3422a5ecd43e68a6fc4a6c619c6cf94dcbaa3d');
  const root = await newStudyRoot(parent); const folders = ['a', 'b', 'c'];
  for (const folder of folders) {
    await mkdir(join(root, folder));
    await Promise.all(Array.from({ length: 40 }, (_, i) => writeFile(join(root, folder, 'file-' + i + '.js'), 'public fixture ' + i, { flag: 'wx' })));
  }
  await mkdir(join(root, 'ignored')); await writeFile(join(root, 'ignored/.env'), 'synthetic private fixture');
  const file = join(root, 'a/file-0.js');
  const roots: StudyFreezeRoot[] = [{ name: 'first', path: root, skip: ['ignored'] },
    { name: 'last', path: root, files: ['a/file-0.js', 'a', 'a/file-0.js'] }];
  const before = await serialFreeze(roots, [file]); const after = await freezeStudyRuntime(roots, [file]);
  assert.deepEqual(after, before); assert.equal(after.entries.length, 124);
  assert(after.entries.filter(e => e.path.startsWith(join(root, 'a'))).every(e => e.group === 'last'));
  await serialVerify(before, true); await verifyStudyRuntime(before, true);
});

test('concurrent and serial verifiers reject addition, deletion, replacement and changed critical bytes without accepting a new baseline', async () => {
  for (const change of ['add', 'delete', 'replace', 'bytes']) {
    const root = await newStudyRoot(parent), file = join(root, 'code.js'); await writeFile(file, 'fixed original');
    const frozen = await serialFreeze([{ name: 'fixture', path: root }], [file]);
    if (change === 'add') await writeFile(join(root, 'new.js'), 'new');
    if (change === 'delete') await unlink(file);
    if (change === 'replace') { await rename(file, join(root, 'old.js')); await writeFile(file, 'fixed original'); }
    if (change === 'bytes') await writeFile(file, 'changed bytes!');
    await assert.rejects(serialVerify(frozen)); await assert.rejects(verifyStudyRuntime(frozen));
  }
});

test('queue preserves intermediate-alias, private-name, hard-link, missing coverage and outside-file rejection', async () => {
  const root = await newStudyRoot(parent), outside = await newStudyRoot(parent), file = join(outside, 'sentinel.js');
  await writeFile(file, 'preserve external synthetic bytes');
  await symlink(outside, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await rejectBoth([{ name: 'fixture', path: root, files: ['alias/sentinel.js'] }]);
  await rejectBoth([{ name: 'fixture', path: join(root, 'alias') }]);
  await rejectBoth([{ name: 'fixture', path: root, files: ['../outside.js'] }]);
  const hard = await newStudyRoot(parent); await writeFile(join(hard, 'one.js'), 'fixture'); await link(join(hard, 'one.js'), join(hard, 'two.js'));
  await rejectBoth([{ name: 'fixture', path: hard }]);
  const secret = await newStudyRoot(parent); await writeFile(join(secret, '.npmrc'), 'synthetic sentinel'); await rejectBoth([{ name: 'fixture', path: secret }]);
  const covered = await newStudyRoot(parent); await writeFile(join(covered, 'code.js'), 'fixture');
  await rejectBoth([{ name: 'fixture', path: covered }], [join(covered, 'missing.js')]);
  assert.equal(await readFile(file, 'utf8'), 'preserve external synthetic bytes');
});

test('supported leaf links match the serial closure and uncovered targets reject', async t => {
  const root = await newStudyRoot(parent); await writeFile(join(root, 'code.js'), 'fixture');
  try { await symlink(join(root, 'code.js'), join(root, 'alias.js'), 'file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Windows user lacks symlink privilege'); return; } throw error; }
  const roots = [{ name: 'fixture', path: root, allowFileLinks: true }];
  assert.deepEqual(await freezeStudyRuntime(roots), await serialFreeze(roots));
  await rejectBoth([{ ...roots[0]!, files: ['alias.js'] }]);
});

test('simultaneous failures drain cleanly and a too-large pending inventory cannot launch unbounded work', async () => {
  const root = await newStudyRoot(parent);
  await writeFile(join(root, '.env'), 'synthetic'); await writeFile(join(root, '.npmrc'), 'synthetic');
  await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(root, 'file-' + i + '.js'), 'fixture')));
  const unhandled: unknown[] = [], observe = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', observe);
  try {
    await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: root }]), /private configuration/);
    await new Promise<void>(done => setImmediate(done)); assert.equal(unhandled.length, 0);
    await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: root, files: Array.from({ length: 40001 }, (_, i) => 'missing-' + i) }]), /inventory limit/);
  } finally { process.off('unhandledRejection', observe); }
});
