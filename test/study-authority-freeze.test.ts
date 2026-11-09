import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { StudyAuthority, requireStudyLease, type StudyPlanLocator } from '../scripts/study-authority.js';
import { StudyCostLedger, studyCostPolicy } from '../scripts/study-cost-ledger.js';
import { freezeStudyRuntime, verifyStudyRuntime } from '../scripts/study-runtime-freeze.js';

const parent = fileURLToPath(new URL('../../.probe-work/t065-authority-tests', import.meta.url));
async function plan(authority: StudyAuthority) {
  const root = await newStudyRoot(join(authority.root, 'preparations'));
  const binding = { studyId: randomUUID(), planDigest: digest('synthetic plan ' + root) };
  const locator: StudyPlanLocator = { schema: 1, scope: 'fixture', authorityRoot: authority.root, root, binding, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const ledger = StudyCostLedger.create(root, binding); ledger.close(); await authority.register(locator); return locator;
}
test('fixed authority is unapproved by default and binds only one plan and cap', async () => {
  const authority = StudyAuthority.fixture(await newStudyRoot(parent)); await authority.initialize(); const first = await plan(authority);
  await assert.rejects(authority.openApproved(first, async () => {}));
  assert.equal(StudyCostLedger.inspect(first.root, first.binding).cap, null);
  await assert.rejects(authority.approve(first, 10_000_000, false, async () => {}));
  await authority.approve(first, 10_000_000, true, async () => {});
  const original = await readFile(authority.approvalPath); await authority.approve(first, 10_000_000, true, async () => {});
  assert.deepEqual(await readFile(authority.approvalPath), original);
  await assert.rejects(authority.approve(first, 9_000_000, true, async () => {}));
  const other = await plan(authority); await assert.rejects(authority.approve(other, 10_000_000, true, async () => {}));
  assert.equal(StudyCostLedger.inspect(other.root, other.binding).phase, 'unapproved');
});
test('genuine leases require matching fixed approval and ledger; inspection cannot resume a started study', async () => {
  const authority = StudyAuthority.fixture(await newStudyRoot(parent)); await authority.initialize(); const locator = await plan(authority);
  await authority.approve(locator, 10_000_000, true, async () => {}); const { ledger, lease } = await authority.openApproved(locator, async () => {});
  try {
    await requireStudyLease(lease, ledger, locator.binding, 'fixture');
    await assert.rejects(requireStudyLease(lease, ledger, locator.binding, 'live'));
    await assert.rejects(requireStudyLease({ scope: 'live' }, ledger, locator.binding, 'live'));
    ledger.reserve(locator.binding, { trialIndex: 0, round: 1, inputDigest: digest('synthetic request') });
    const before = await readFile(ledger.path); assert.equal(StudyCostLedger.inspect(locator.root, locator.binding).phase, 'started');
    assert.deepEqual(await readFile(ledger.path), before); assert.equal(ledger.state.phase, 'started');
  } finally { ledger.close(); }
  await assert.rejects(authority.openApproved(locator, async () => {}));
  const state = StudyCostLedger.inspect(locator.root, locator.binding); assert.equal(state.phase, 'unknown'); assert.equal(state.calls[0]!.charge, studyCostPolicy.reservation);
  await assert.rejects(authority.approve(locator, 10_000_000, true, async () => {}));
});
test('approval, plan and scope drift reject before dispatch and never replace approval bytes', async () => {
  const authority = StudyAuthority.fixture(await newStudyRoot(parent)); await authority.initialize(); const locator = await plan(authority);
  await assert.rejects(authority.approve(locator, 10_000_000, true, async () => { throw new Error('synthetic freeze drift'); }));
  await assert.rejects(readFile(authority.approvalPath), { code: 'ENOENT' });
  await authority.approve(locator, 10_000_000, true, async () => {});
  await assert.rejects(authority.openApproved({ ...locator, binding: { ...locator.binding, planDigest: digest('changed') } }, async () => {}));
  await assert.rejects(authority.locate(await newStudyRoot(parent)));
  await assert.rejects(authority.openApproved({ ...locator, expiresAt: '2000-01-01T00:00:00.000Z' }, async () => {}));
});
test('runtime freeze detects byte, identity and inventory changes without accepting an updated baseline', async () => {
  const root = await newStudyRoot(parent); const file = join(root, 'code.js'); await writeFile(file, 'original');
  const frozen = await freezeStudyRuntime([{ name: 'fixture', path: root }], [file]); await verifyStudyRuntime(frozen, true);
  await writeFile(file, 'modified'); await assert.rejects(verifyStudyRuntime(frozen));
  await writeFile(file, 'original'); await assert.rejects(verifyStudyRuntime(frozen, true));
  const second = await freezeStudyRuntime([{ name: 'fixture', path: root }]); await writeFile(join(root, 'new.js'), 'new input');
  await assert.rejects(verifyStudyRuntime(second));
});
test('runtime freeze rejects linked roots, hard links and private environment files before reading them', async () => {
  const root = await newStudyRoot(parent); const real = join(root, 'original'); await mkdir(real); const alias = join(root, 'alias');
  await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir'); await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: alias }]));
  const file = join(real, 'code.js'); await writeFile(file, 'synthetic code'); await link(file, join(real, 'alias.js'));
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: real }]));
  const privateRoot = await newStudyRoot(parent); await writeFile(join(privateRoot, '.env'), 'synthetic sentinel');
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: privateRoot }]), /private configuration/);
});

test('explicit freeze files and roots cannot traverse a pre-existing intermediate directory alias', async () => {
  const owner = await newStudyRoot(parent); const outside = await newStudyRoot(parent); const nested = join(outside, 'nested'); await mkdir(nested);
  await writeFile(join(outside, 'code.js'), 'preserve outside bytes'); await writeFile(join(nested, 'code.js'), 'preserve nested bytes');
  const alias = join(owner, 'linked'); await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: owner, files: ['linked/code.js'] }]), /alias/);
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: join(alias, 'nested'), files: ['code.js'] }]), /canonical/);
  assert.equal(await readFile(join(outside, 'code.js'), 'utf8'), 'preserve outside bytes');
});

test('every critical path must exist as a covered non-directory before any freeze is accepted', async () => {
  const root = await newStudyRoot(parent); const file = join(root, 'code.js'); await writeFile(file, 'fixture');
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: root, files: [] }], [file]), /Critical/);
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: root }], [join(root, 'missing.js')]), /Critical/);
  await assert.rejects(freezeStudyRuntime([{ name: 'fixture', path: root }], [root]), /Critical/);
  const frozen = await freezeStudyRuntime([{ name: 'fixture', path: root }], [file]);
  frozen.critical.push(join(root, 'missing.js')); await assert.rejects(verifyStudyRuntime(frozen), /Critical/);
});
