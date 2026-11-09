/** Immutable preparation: no Key, approval or paid HTTP. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { list } from 'tar';
import { digest } from '../src/domain.js';
import { git } from '../src/repository.js';
import { auditArchive } from './release-helpers.js';
import { createStudySourceBank, newStudyRoot, selectStudyReference } from './benefit-study-preflight.js';
import { writeStudyTarget } from './benefit-study-files.js';
import { studyCases, studySources, studySchedule, studySystem } from './benefit-study-cases.js';
import { saveStudyBank } from './study-bank-snapshot.js';
import { boundedStudyExecution, probeStudyPython, resolveStudyPython, studyChildEnvironment, studyPythonWorker } from './study-bounded-python.js';
import { installStudyVendor } from './study-python-vendor.js';
import { qualifyBoundedStudyControls } from './study-plan-controls.js';
import { StudyAuthority, writeExclusiveStudyJson, type StudyPlanLocator } from './study-authority.js';
import { StudyCostLedger, studyCostPolicy } from './study-cost-ledger.js';
import { freezeStudyRuntime, verifyStudyRuntime, type StudyFreezeRoot, type StudyRuntimeFreeze } from './study-runtime-freeze.js';
import { makeStudyDirectory, ownedStudyPath, studyRepository as repository } from './study-owned-path.js';
import { withStudyGit } from './study-git.js';

type PythonInfo = Awaited<ReturnType<typeof resolveStudyPython>>;
type Selection = typeof studySchedule[number] & Awaited<ReturnType<typeof selectStudyReference>> & { schemaDigest: string };
export interface PreparedStudyPlan {
  schema: 1; scope: 'live' | 'fixture'; root: string; sourceCommit: string; createdAt: string; expiresAt: string;
  python: PythonInfo; nodeVersion: string; vendor: string; policy: typeof studyCostPolicy;
  fixtureDigest: string; scheduleDigest: string; systemDigest: string; pricingDocumentDigest: string;
  candidate: Awaited<ReturnType<typeof auditArchive>> & { path: string };
  bank: { root: string; repo: string; snapshot: string; snapshotDigest: string; experienceDigest: string; proofs: Awaited<ReturnType<typeof createStudySourceBank>>['proofs'];
    head: string; indexDigest: string; initialSchemaDigest: string };
  selections: Selection[]; controls: Awaited<ReturnType<typeof qualifyBoundedStudyControls>>; limits: Awaited<ReturnType<typeof probeStudyPython>>;
  freeze: StudyRuntimeFreeze;
}
const priceFile = join(repository, 'compat/study-runtime/pricing.json');
export function assertReviewedStudyPriceDocument(bytes: Uint8Array, snapshot: { catalogVersion: string; reviewedDocumentSha256: string }) {
  assert.match(snapshot.reviewedDocumentSha256, /^[a-f0-9]{64}$/);
  assert.equal(digest(Buffer.from(bytes)), snapshot.reviewedDocumentSha256, 'Official price document differs from the manually reviewed source; review before preparing or spending');
  assert(Buffer.from(bytes).toString('utf8').includes(snapshot.catalogVersion));
}
export async function pricingDocumentDigest(scope: 'live' | 'fixture'): Promise<string> {
  const pricing = JSON.parse(await readFile(priceFile, 'utf8')) as { url: string; model: string; catalogVersion: string; reviewedDocumentSha256: string; inputMicroCnyPerToken: number; outputMicroCnyPerToken: number };
  assert.equal(pricing.model, studyCostPolicy.model); assert.equal(pricing.inputMicroCnyPerToken, 2); assert.equal(pricing.outputMicroCnyPerToken, 8);
  assert.equal(pricing.url, 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/');
  if (scope === 'fixture') return digest('synthetic price document fixture ' + JSON.stringify(pricing));
  const response = await fetch(pricing.url, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200);
  const parts: Uint8Array[] = []; let size = 0; assert(response.body);
  for await (const part of response.body) { size += part.length; assert(size <= 1048576); parts.push(part); }
  const bytes = Buffer.concat(parts); assertReviewedStudyPriceDocument(bytes, pricing);
  return digest(bytes);
}
export function requireCleanStudyProcess(): void {
  assert.equal(process.version, 'v24.19.0'); assert(['win32', 'linux'].includes(process.platform));
  assert(!process.env.NODE_OPTIONS && !process.env.NODE_PATH && !process.env.NODE_COMPILE_CACHE, 'Remove custom Node loader settings for this isolated study');
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'TLS validation must stay enabled');
}
async function exists(path: string) { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function freezeRoots(root: string, python: PythonInfo, scope: 'live' | 'fixture'): Promise<StudyFreezeRoot[]> {
  const checkout = git(repository, ['rev-parse', '--show-toplevel']);
  if (scope === 'live') assert.equal(await realpath(checkout), await realpath(repository), 'Live execution requires a real source worktree');
  const tracked = git(checkout, ['ls-files', '--full-name', '-z']).split('\0').filter(Boolean);
  const roots: StudyFreezeRoot[] = [{ name: 'checkout-source', path: await realpath(checkout), files: tracked }];
  if (await realpath(checkout) !== await realpath(repository)) {
    const copied = []; for (const path of tracked) if (await exists(join(repository, path))) copied.push(path);
    roots.push({ name: 'execution-source', path: await realpath(repository), files: copied });
  }
  roots.push({ name: 'compiled', path: await realpath(join(repository, 'dist')) },
    { name: 'node-dependencies', path: await realpath(join(repository, 'node_modules')), skip: ['.bin'] },
    { name: 'node-executable', path: await realpath(dirname(process.execPath)), files: [basename(await realpath(process.execPath))] },
    { name: 'python-stdlib', path: await realpath(python.stdlib), skip: ['site-packages'], allowFileLinks: true },
    { name: 'python-vendor', path: join(root, 'vendor') },
    { name: 'candidate', path: join(root, 'artifacts') },
    { name: 'source-bank', path: join(root, 'bank'), skip: ['project/.git', 'project/target.py', 'project/context.schema.json'] });
  const exe = await realpath(python.executable); roots.push({ name: 'python-executable', path: dirname(exe), files: [basename(exe)] });
  const native = (await readdir(python.prefix)).filter(name => /\.(?:dll|pyd|zip)$/i.test(name));
  if (native.length) roots.push({ name: 'python-native', path: await realpath(python.prefix), files: native, allowFileLinks: true });
  if (await exists(join(python.prefix, 'DLLs'))) roots.push({ name: 'python-dlls', path: await realpath(join(python.prefix, 'DLLs')), allowFileLinks: true });
  if (await exists(join(python.prefix, 'lib'))) {
    const libraries = (await readdir(join(python.prefix, 'lib'))).filter(name => /^libpython3\.10.*\.so/.test(name));
    if (libraries.length) roots.push({ name: 'python-shared-libraries', path: await realpath(join(python.prefix, 'lib')), files: libraries, allowFileLinks: true });
  }
  return roots;
}
function criticalFiles(roots: StudyFreezeRoot[]): string[] {
  return [...new Set([studyPythonWorker, join(repository, 'package.json'), join(repository, 'package-lock.json'),
    join(repository, 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js'),
    ...roots.filter(r => ['checkout-source', 'execution-source'].includes(r.name)).flatMap(r => (r.files ?? [])
      .filter(path => /^(?:src|scripts|compat)\//.test(path)).map(path => join(r.path, path)))])].sort();
}
async function candidatePackage(root: string, npmCli: string) {
  assert(npmCli && resolve(npmCli) === npmCli); assert(!(await exists(join(repository, '.npmrc'))), 'Do not read a private project npm configuration');
  const artifacts = await makeStudyDirectory(join(root, 'artifacts')); const temp = await makeStudyDirectory(join(root, 'pack-temp'));
  const userconfig = join(temp, 'userconfig'); const globalconfig = join(temp, 'globalconfig');
  await writeFile(userconfig, '', { flag: 'wx' }); await writeFile(globalconfig, '', { flag: 'wx' });
  const output = execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', artifacts,
    '--userconfig', userconfig, '--globalconfig', globalconfig], { cwd: repository, windowsHide: true, encoding: 'utf8', timeout: 60000,
    env: studyChildEnvironment(temp), maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] });
  const items = JSON.parse(output) as { filename: string }[]; assert.equal(items.length, 1); assert.equal(basename(items[0]!.filename), items[0]!.filename);
  const path = join(artifacts, items[0]!.filename); await ownedStudyPath(path); const audit = await auditArchive(path);
  const hashes = new Map<string, string>();
  await list({ file: path, strict: true, onReadEntry: entry => {
    if (!entry.path.startsWith('package/dist/src/') && entry.path !== 'package/cordis.patch.yml') return;
    const hash = createHash('sha256'); entry.on('data', part => hash.update(part)); entry.on('end', () => hashes.set(entry.path.slice(8), hash.digest('hex')));
  } });
  for (const [file, expected] of hashes) assert.equal(digest(await readFile(join(repository, file))), expected, 'Candidate must match actually executed plugin bytes');
  assert(hashes.size > 20); return { ...audit, path };
}
export async function prepareLiveStudy(authority: StudyAuthority, npmCli: string, command = process.env.EVOLVE_PYTHON ?? 'python') {
  return withStudyGit(() => prepareFrozenStudy(authority, npmCli, command));
}
async function prepareFrozenStudy(authority: StudyAuthority, npmCli: string, command: string) {
  requireCleanStudyProcess(); assert.equal(git(repository, ['status', '--porcelain']), '', 'Commit all study source before preparation');
  await authority.initialize(); assert(!(await exists(authority.approvalPath)), 'Preserve the existing one-shot authority');
  const root = await newStudyRoot(join(authority.root, 'preparations')); const python = await resolveStudyPython(command);
  const pricing = await pricingDocumentDigest(authority.scope); const { vendor } = await installStudyVendor(python.executable, root);
  const temp = join(root, 'execution-temp'); const limits = await probeStudyPython(python.executable, temp);
  const execution = boundedStudyExecution(python.executable, vendor, temp);
  const controls = await qualifyBoundedStudyControls(join(root, 'controls'), execution); assert.equal(controls.count, 23);
  const bankRoot = await makeStudyDirectory(join(root, 'bank')); const bank = await createStudySourceBank(bankRoot, python.executable, studyChildEnvironment(temp));
  try {
    const snapshot = join(bankRoot, 'snapshot.json'); const saved = await saveStudyBank(bank.store, snapshot);
    const initial = await readFile(join(bank.repo, 'context.schema.json')); const selections: Selection[] = [];
    for (const planned of studySchedule) {
      const item = studyCases.find(c => c.id === planned.case)!; await writeStudyTarget(bankRoot, bank.repo, item.before);
      const selected = await selectStudyReference(bank.store, bank.repo, item, planned.arm, python.executable);
      selections.push({ ...planned, ...selected, schemaDigest: digest(await readFile(join(bank.repo, 'context.schema.json'))) });
    }
    await writeFile(join(bank.repo, 'context.schema.json'), initial);
    const candidate = await candidatePackage(root, npmCli); const roots = await freezeRoots(root, python, authority.scope);
    const freeze = await freezeStudyRuntime(roots, criticalFiles(roots));
    const plan: PreparedStudyPlan = { schema: 1, scope: authority.scope, root, sourceCommit: git(repository, ['rev-parse', 'HEAD']),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), python, nodeVersion: process.version, vendor, policy: studyCostPolicy,
      fixtureDigest: digest(JSON.stringify({ studyCases, studySources })), scheduleDigest: digest(JSON.stringify(studySchedule)), systemDigest: digest(studySystem),
      pricingDocumentDigest: pricing, candidate, bank: { root: bankRoot, repo: bank.repo, snapshot, snapshotDigest: saved.fileDigest,
        experienceDigest: saved.experienceDigest, proofs: bank.proofs, head: git(bank.repo, ['rev-parse', 'HEAD']), indexDigest: digest(await readFile(join(bank.repo, '.git/index'))), initialSchemaDigest: digest(initial) },
      selections, controls, limits, freeze };
    const binding = { studyId: randomUUID(), planDigest: digest(JSON.stringify(plan)) };
    const locator: StudyPlanLocator = { schema: 1, scope: authority.scope, authorityRoot: authority.root, root, binding, expiresAt: plan.expiresAt };
    assert(Buffer.byteLength(JSON.stringify({ plan, binding }, null, 2) + '\n') <= 16777216); await writeExclusiveStudyJson(join(root, 'plan.json'), { plan, binding });
    StudyCostLedger.create(root, binding).close(); await authority.register(locator); return { plan, locator };
  } finally { bank.store.close(); }
}
export async function readLiveStudyPlan(authority: StudyAuthority, root: string) {
  return withStudyGit(() => readFrozenStudyPlan(authority, root));
}
async function readFrozenStudyPlan(authority: StudyAuthority, root: string) {
  const locator = await authority.locate(root); const path = await ownedStudyPath(join(root, 'plan.json'));
  assert((await lstat(path)).size <= 16777216); const envelope = JSON.parse(await readFile(path, 'utf8')) as { plan: PreparedStudyPlan; binding: StudyPlanLocator['binding'] };
  assert.deepEqual(envelope.binding, locator.binding); assert.equal(digest(JSON.stringify(envelope.plan)), locator.binding.planDigest);
  const plan = envelope.plan; assert.equal(plan.schema, 1); assert.equal(plan.scope, authority.scope); assert.equal(plan.root, locator.root); assert.equal(plan.expiresAt, locator.expiresAt);
  assert.equal(plan.sourceCommit, git(repository, ['rev-parse', 'HEAD'])); assert.equal(plan.nodeVersion, process.version); assert.deepEqual(plan.policy, studyCostPolicy);
  assert.equal(plan.fixtureDigest, digest(JSON.stringify({ studyCases, studySources }))); assert.equal(plan.scheduleDigest, digest(JSON.stringify(studySchedule))); assert.equal(plan.systemDigest, digest(studySystem));
  assert.equal(plan.vendor, join(root, 'vendor')); assert.equal(plan.bank.root, join(root, 'bank')); assert.equal(plan.bank.repo, join(root, 'bank/project'));
  assert.equal(plan.bank.snapshot, join(root, 'bank/snapshot.json')); assert.equal(plan.selections.length, 36);
  for (const [i, selected] of plan.selections.entries()) { const planned = studySchedule[i]!; assert.equal(selected.case, planned.case); assert.equal(selected.repeat, planned.repeat); assert.equal(selected.arm, planned.arm); }
  return { plan, locator };
}
export async function verifyLiveStudyPlan(authority: StudyAuthority, plan: PreparedStudyPlan, full = false, schemaDigest = plan.bank.initialSchemaDigest) {
  return withStudyGit(() => verifyFrozenStudyPlan(authority, plan, full, schemaDigest));
}
async function verifyFrozenStudyPlan(authority: StudyAuthority, plan: PreparedStudyPlan, full: boolean, schemaDigest: string) {
  assert.deepEqual((await readLiveStudyPlan(authority, plan.root)).plan, plan, 'Persisted study plan changed');
  requireCleanStudyProcess(); assert.equal(git(repository, ['rev-parse', 'HEAD']), plan.sourceCommit); assert.equal(git(repository, ['status', '--porcelain']), '');
  const python = await resolveStudyPython(process.env.EVOLVE_PYTHON ?? 'python'); assert.deepEqual(python, plan.python);
  const roots = await freezeRoots(plan.root, python, authority.scope); assert.deepEqual(roots, plan.freeze.roots); assert.deepEqual(criticalFiles(roots), plan.freeze.critical);
  await verifyStudyRuntime(plan.freeze, full); assert.equal(git(plan.bank.repo, ['rev-parse', 'HEAD']), plan.bank.head);
  assert.equal(digest(await readFile(join(plan.bank.repo, '.git/index'))), plan.bank.indexDigest);
  assert.equal(digest(await readFile(join(plan.bank.repo, 'context.schema.json'))), schemaDigest);
  assert.equal(digest(await readFile(plan.bank.snapshot)), plan.bank.snapshotDigest); assert(Date.parse(plan.expiresAt) > Date.now(), 'Plan expired');
}
