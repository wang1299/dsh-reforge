import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { digest, redact } from '../dist/src/domain.js';
import { git } from '../dist/src/repository.js';
import { acceptanceDigest, reproduces } from '../dist/src/verification.js';
import { auditArchive } from '../dist/scripts/release-helpers.js';
import { PilotBudget, pilotPolicy, pilotAuthorizationPath } from '../dist/scripts/pilot-budget.js';
import { createPilotFixture, pilotCases, runPilotTests } from '../dist/scripts/pilot-fixtures.js';
import { automaticPilot, installPilotPackage, pilotHost } from './pilot-harness.mjs';
import { comparePilot, comparisonOrder } from './pilot-comparison.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const runtimeNames = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-credentials-local', '@deepseek-ai/dsh-credentials'];
function owned(root) {
  const rel = relative(realpathSync.native(join(workspace, '.probe-work')), realpathSync.native(resolve(root)));
  assert(rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel), 'Use a new owned study directory');
}
async function credentialReady(runtime, path) {
  const [{ Context }, { LocalCredentialProvider }, { credentialRef }] = await Promise.all([
    runtime.load('@deepseek-ai/cordis'), runtime.load('@deepseek-ai/dsh-credentials-local'), runtime.load('@deepseek-ai/dsh-credentials')]);
  const ctx = new Context();
  try {
    await ctx.plugin(LocalCredentialProvider, { path, watch: false }).await();
    const credential = await ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'));
    assert(credential?.value && credential.source === 'file', 'Configure the managed DeepSeek key locally in DSH');
  } finally { await ctx.fiber.dispose(); }
}
export async function validatePilotPlan(run) {
  owned(run); const bytes = await readFile(join(run, 'plan.json')); assert(bytes.length <= 8 * 1024 * 1024);
  assert.equal(digest(bytes), await readFile(join(run, 'plan.sha256'), 'utf8'), 'Plan drift');
  const plan = JSON.parse(bytes); assert.equal(plan.kind, 't049-real-model-pilot-v1'); assert.equal(plan.root, resolve(run));
  assert.equal(plan.sourceCommit, git(workspace, ['rev-parse', 'HEAD']), 'Source changed since qualification');
  assert.equal(plan.nodeVersion, process.version); assert.deepEqual(plan.order, comparisonOrder);
  assert.deepEqual(plan.policy, pilotPolicy);
  for (const [path, target] of Object.entries(plan.links)) assert.equal(await realpath(path), target, 'Runtime link changed');
  for (const [file, sha] of Object.entries(plan.files)) assert.equal(digest(await readFile(file)), sha, 'Frozen file drift');
  for (const [path, sha] of Object.entries(plan.acceptance)) assert.equal(await acceptanceDigest(path), sha, 'Acceptance drift');
  for (const fixture of [plan.offlineFixture, plan.liveFixture]) {
    assert.equal(git(fixture.repo, ['rev-parse', 'HEAD']), fixture.base, 'Synthetic HEAD changed');
    assert.equal(digest(git(fixture.repo, ['ls-files', '--stage', '-z'])), fixture.indexDigest, 'Synthetic staged content changed');
    const changed = git(fixture.repo, ['--no-optional-locks', 'diff', '--name-only', 'HEAD', '--']).split(/\r?\n/).filter(Boolean);
    assert(changed.every(path => ['ledger.py', 'stock.py', 'customer_form.py'].includes(path)), 'Unexpected fixture changes');
  }
  return plan;
}
async function prepare(options, offlineOnly) {
  assert.equal(git(workspace, ['status', '--porcelain']), '', 'Commit all experiment code before freezing a plan');
  if (!offlineOnly && existsSync(pilotAuthorizationPath)) {
    const budget = new PilotBudget(pilotAuthorizationPath);
    try { assert(!budget.authorization && budget.state.calls.length === 0, 'Existing authorization or calls must be preserved'); } finally { budget.close(); }
  }
  const host = resolve(required(options, '--host')); const archive = resolve(required(options, '--archive'));
  const python = resolve(required(options, '--python')); const credentialFile = offlineOnly ? null : resolve(required(options, '--credentials'));
  const runtime = await pilotHost(host); const archiveResult = await auditArchive(archive);
  const pythonInfo = JSON.parse(execFileSync(python, ['-I', '-c', 'import json,sys,pytest; print(json.dumps({"python":list(sys.version_info[:3]),"pytest":pytest.__version__}))'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }));
  assert(pythonInfo.python[0] === 3 && pythonInfo.python[1] >= 10); assert.equal(pythonInfo.pytest, '9.1.1');
  if (!offlineOnly) await credentialReady(runtime, credentialFile);
  await mkdir(join(workspace, '.probe-work'), { recursive: true }); const root = await mkdtemp(join(workspace, '.probe-work/t049-study-'));
  const profile = await installPilotPackage(host, archive, root);
  const offlineFixture = await createPilotFixture(join(root, 'offline'));
  const liveFixture = await createPilotFixture(join(root, 'live'));
  const plan = { kind: 't049-real-model-pilot-v1', root, sourceCommit: git(workspace, ['rev-parse', 'HEAD']),
    authorization: offlineOnly ? 'offline-only' : 'owner-CNY10-20261104', createdAt: new Date().toISOString(),
    host, archive, archiveSha256: digest(await readFile(archive)), archiveIntegrity: archiveResult.integrity,
    python, pythonInfo, credentialFile, nodeVersion: process.version, policy: pilotPolicy, order: comparisonOrder,
    profile, offlineFixture, liveFixture, offlineGrant: randomUUID(), liveGrant: randomUUID(), anonymousId: randomUUID(), files: {}, links: {}, acceptance: {} };
  for (const fixture of [offlineFixture, liveFixture]) {
    fixture.indexDigest = digest(git(fixture.repo, ['ls-files', '--stage', '-z']));
    const fixtureRoot = resolve(fixture.repo, '..');
    for (const [id, tests] of [['source', fixture.acceptance], ...(await pilotCases()).map(item => [item.id, join(fixtureRoot, item.id + '-checks')])]) {
      const proof = await runPilotTests(python, fixture.repo, tests, join(fixtureRoot, 'baseline-' + id + '.xml'));
      assert(reproduces(proof), 'Baseline must demonstrate a real failure'); plan.acceptance[tests] = await acceptanceDigest(tests);
    }
    plan.acceptance[join(fixture.repo, 'tests')] = await acceptanceDigest(join(fixture.repo, 'tests'));
  }
  const tracked = git(workspace, ['ls-files', '-z']).split('\0').filter(file => /^(src|scripts|test|examples\/customer-form)\//.test(file));
  const files = [...tracked.map(file => join(workspace, file)), archive, python, process.execPath, join(workspace, 'package.json'), join(workspace, 'package-lock.json'),
    ...runtimeNames.map(name => runtime.require.resolve(name)),
    ...Object.keys(profile.productFiles).map(file => join(profile.packageDir, 'dist/src', file)),
    ...['package.json', 'pnpm-lock.yaml', 'cordis.yml', 'cordis.patch.yml'].map(file => join(profile.profile, file)).filter(file => existsSync(file)),
    ...['pilot-budget', 'pilot-fixtures'].map(file => join(workspace, 'dist/scripts', file + '.js'))];
  for (const file of files) plan.files[file] = digest(await readFile(file));
  const visited = new Set();
  const runtimeFile = path => /\.(?:js|mjs|cjs|json|node|wasm|dll|bin)$/.test(path);
  async function runtimeFiles(path) {
    const actual = await realpath(path); if (actual !== resolve(path)) plan.links[path] = actual;
    if (visited.has(actual)) return; visited.add(actual); assert(visited.size <= 50000, 'Runtime graph too large');
    const entry = await stat(actual);
    if (entry.isDirectory()) {
      for (const child of await readdir(actual, { withFileTypes: true })) {
        if (['.cache', '.bin', '.git'].includes(child.name)) continue;
        if (child.isDirectory() || child.isSymbolicLink() || runtimeFile(child.name)) await runtimeFiles(join(actual, child.name));
      }
    } else if (runtimeFile(actual)) plan.files[actual] = digest(await readFile(actual));
  }
  for (const path of [join(workspace, 'dist/src'), join(workspace, 'dist/scripts'), join(workspace, 'node_modules'), join(host, 'node_modules'), join(profile.profile, 'node_modules')]) await runtimeFiles(path);
  const text = JSON.stringify(plan, null, 2); await writeFile(join(root, 'plan.json'), text, { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'plan.sha256'), digest(text), { flag: 'wx', mode: 0o600 });
  if (!offlineOnly) {
    const budget = new PilotBudget(pilotAuthorizationPath);
    try { budget.bindStudy({ root, planDigest: digest(text) }); } finally { budget.close(); }
  }
  await validatePilotPlan(root); console.log(JSON.stringify({ prepared: true, offlineOnly, root, planDigest: digest(text), modelHttpRequests: 0 }));
}
async function execute(run, offline) {
  const plan = await validatePilotPlan(run); const root = join(run, offline ? 'offline' : 'live');
  assert(!existsSync(join(root, 'automatic-result.json')), 'Retain the previous attempt; never replay it');
  if (!offline) {
    assert.equal(plan.authorization, 'owner-CNY10-20261104');
    const prior = JSON.parse(await readFile(join(run, 'offline-summary.json'), 'utf8')); assert.equal(prior.complete, true);
    assert.equal(prior.planDigest, await readFile(join(run, 'plan.sha256'), 'utf8'));
    const budget = new PilotBudget(pilotAuthorizationPath);
    try { budget.beginStudy({ root: resolve(run), planDigest: await readFile(join(run, 'plan.sha256'), 'utf8') }); } finally { budget.close(); }
  }
  const validate = async () => { await validatePilotPlan(run); };
  const input = { root, fixtureRoot: root, fixture: offline ? plan.offlineFixture : plan.liveFixture,
    host: plan.host, archive: plan.archive, profile: plan.profile, python: plan.python, credentialFile: plan.credentialFile,
    grantId: offline ? plan.offlineGrant : plan.liveGrant, anonymousId: plan.anonymousId, offline, live: !offline,
    budgetFile: offline ? join(run, 'offline-budget.sqlite') : pilotAuthorizationPath,
    authorization: { root: resolve(run), planDigest: await readFile(join(run, 'plan.sha256'), 'utf8') }, validate };
  console.log(JSON.stringify({ stage: 'automatic_loop', offline, modelHttpRequests: 0 }));
  const automatic = await automaticPilot(input); let comparison = null;
  if (automatic.passed) comparison = await comparePilot(input);
  const summary = { kind: offline ? 'offline-preflight' : 'real-model-small-pilot', planDigest: await readFile(join(run, 'plan.sha256'), 'utf8'),
    complete: automatic.passed && comparison?.complete === true && (!offline || Object.values(comparison.arms).every(arm => arm.accepted === 4 && arm.evaluated === 4)), automatic, comparison: comparison && { complete: comparison.complete, arms: comparison.arms,
      totalConservativeMicroCny: comparison.totalConservativeMicroCny, learningAndReferenceOverheadMicroCny: comparison.learningAndReferenceOverheadMicroCny,
      heldCalls: comparison.heldCalls, modelHttpRequests: comparison.modelHttpRequests, limitations: comparison.limitations } };
  await writeFile(join(run, offline ? 'offline-summary.json' : 'live-summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  if (!offline) {
    const budget = new PilotBudget(pilotAuthorizationPath);
    try { budget.finishStudy(input.authorization, summary.complete); } finally { budget.close(); }
  }
  console.log(JSON.stringify(summary)); if (!summary.complete) process.exitCode = 1;
}
function required(options, name) { const value = options.get(name); assert(value, 'Missing explicit local argument'); return value; }

const [command, ...args] = process.argv.slice(2); const options = new Map();
try {
  assert(resolve(process.cwd()) === resolve(workspace), 'Run from this repository root');
  const choices = command?.startsWith('prepare') ? ['--host', '--archive', '--python', '--credentials'] : ['--run'];
  for (let n = 0; n < args.length; n += 2) {
    assert(choices.includes(args[n]) && !options.has(args[n]) && args[n + 1] && !args[n + 1].startsWith('--'));
    options.set(args[n], args[n + 1]);
  }
  if (command === 'prepare' || command === 'prepare-offline') await prepare(options, command === 'prepare-offline');
  else if (command === 'offline' || command === 'live') await execute(resolve(required(options, '--run')), command === 'offline');
  else if (command === 'status') {
    const run = resolve(required(options, '--run')); await validatePilotPlan(run);
    const db = existsSync(pilotAuthorizationPath) ? new DatabaseSync(pilotAuthorizationPath, { readOnly: true }) : null;
    try { const budget = db && JSON.parse(db.prepare('SELECT body FROM pilot_ledger WHERE id=1').get().body);
      console.log(JSON.stringify({ authorized: !!budget, capMicroCny: budget?.cap ?? 0, calls: budget?.calls.length ?? 0,
        conservativeMicroCny: budget?.calls.reduce((n, call) => n + call.charge, 0) ?? 0, heldCalls: budget?.calls.filter(call => !call.usage).length ?? 0, stopped: budget?.stopped ?? null })); }
    finally { db?.close(); }
  } else throw new Error('Use prepare-offline, prepare, offline, live or status with explicit local paths');
} catch (error) {
  console.error(JSON.stringify({ error: 'pilot_stopped_preserve_plan_data_and_budget_do_not_retry_unknowns', command: command ?? null,
    ...(['prepare-offline', 'offline'].includes(command) ? { offlineDiagnostic: redact(error instanceof Error ? error.message : 'offline_failure', 800) } : {}) })); process.exitCode = 1;
}
