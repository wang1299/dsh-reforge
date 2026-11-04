import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { configSchema, loadConfig, type Config } from './config.js';
import { digest, hashSchema, relativePath } from './domain.js';
import { snapshot } from './repository.js';
import { supportedDshVersions } from './dsh-adapter-policy.js';

class OwnerOperationError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new OwnerOperationError(code); };
export const ownerError = (error: unknown): string => error instanceof OwnerOperationError ? error.code : 'operation_failed_check_local_paths_and_permissions';
const command = (exe: string, args: string[]): string => execFileSync(exe, args,
  { encoding: 'utf8', timeout: 10000, maxBuffer: 16384, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Reject links in every existing component, including junctions in a parent directory. */
function noLinks(path: string): void {
  const full = resolve(path); const root = parse(full).root; let current = root;
  for (const part of full.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail('symlink_or_junction_not_supported'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
function repo(input: string): { root: string; id: string } {
  noLinks(input); const root = realpathSync(resolve(input)); const current = snapshot(root);
  return { root, id: current.scope.repoId };
}
function configured(path: string): { config: z.output<typeof configSchema>; root: string; repoId: string; data: string } {
  noLinks(path); const stat = lstatSync(resolve(path));
  if (!stat.isFile() || stat.size > 65536) fail('configuration_must_be_a_bounded_regular_file');
  const config = configSchema.parse(loadConfig(resolve(path))); const current = repo(config.repoRoot);
  const data = config.dataDir ? resolve(config.dataDir) : join(homedir(), '.dsh', 'evolve', current.id);
  noLinks(data); return { config, root: current.root, repoId: current.id, data };
}
function separate(source: string, destination: string): void {
  for (const [a, b] of [[source, destination], [destination, source]]) {
    const rel = relative(a!, b!);
    if (!rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) fail('source_and_destination_must_be_separate');
  }
}
async function newDirectory(path: string): Promise<string> {
  const output = resolve(path); noLinks(output);
  if (existsSync(output)) fail('destination_already_exists');
  await mkdir(output, { mode: 0o700 }); return output;
}

export async function setupOwner(input: { repo: string; output: string; python?: string; dataDir?: string }): Promise<void> {
  const current = repo(input.repo); const output = resolve(input.output); noLinks(output);
  const config: Config = { repoRoot: current.root, python: input.python ?? 'python',
    ...(input.dataDir ? { dataDir: resolve(input.dataDir) } : {}),
    executionTrusted: false, shareWithModel: false, backgroundVerification: false, automaticLearning: false };
  configSchema.parse(config);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 }); noLinks(output);
  const file = await open(output, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(config, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
}

const counts = ['experiences', 'applications', 'feedback', 'extraction_grants', 'extraction_jobs'] as const;
function inspectDatabase(data: string, repoId: string, stopped = false): { schema: number; counts: Record<string, number> } {
  noLinks(data); const file = join(data, 'evolve.sqlite');
  if (!lstatSync(file).isFile()) fail('database_not_a_regular_file');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const path = file + suffix;
    if (existsSync(path)) fail('database_not_cleanly_stopped');
  }
  // SQLite read-only opens can create WAL/SHM even after a clean WAL shutdown.
  // Inspect the persistent format before SQLite sees it; never convert a source journal mode.
  const header = Buffer.alloc(100); const descriptor = openSync(file, 'r');
  try { if (readSync(descriptor, header, 0, header.length, 0) !== header.length) fail('invalid_database_header'); }
  finally { closeSync(descriptor); }
  if (header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') fail('invalid_database_header');
  if (header[18] === 2 || header[19] === 2) fail('wal_mode_requires_manual_private_copy_no_database_opened');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    const schema = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (schema !== 9) fail('unsupported_database_schema');
    if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('database_integrity_failed');
    const bindings = db.prepare(`SELECT DISTINCT json_extract(body,'$.scope.repoId') AS repo_id FROM tasks
      UNION SELECT DISTINCT json_extract(body,'$.scope.repoId') FROM experiences
      UNION SELECT DISTINCT json_extract(body,'$.repoId') FROM verifications
      UNION SELECT DISTINCT json_extract(body,'$.repoId') FROM evidence
      UNION SELECT DISTINCT repo_id FROM learning_jobs UNION SELECT DISTINCT repo_id FROM extraction_jobs
      UNION SELECT DISTINCT repo_id FROM automatic_segments UNION SELECT DISTINCT repo_id FROM automatic_locks`).all();
    if (bindings.some(row => row.repo_id !== repoId)) fail('repository_binding_mismatch');
    if (stopped && (db.prepare("SELECT count(*) AS n FROM learning_jobs WHERE state='running'").get()!.n
      || db.prepare("SELECT count(*) AS n FROM extraction_jobs WHERE state='running'").get()!.n
      || db.prepare("SELECT count(*) AS n FROM automatic_segments WHERE state IN ('capturing','open','qualifying')").get()!.n)) fail('active_work_must_be_resolved_before_backup');
    return { schema, counts: Object.fromEntries(counts.map(table => [table, Number(db.prepare('SELECT count(*) AS n FROM ' + table).get()!.n)])) };
  } finally { db.close(); }
}

export function doctorOwner(path: string): {
  schemaVersion: 1; checks: { code: string; status: 'ok' | 'warning' | 'error'; detail: string }[];
  settings: { execution: boolean; background: boolean; sharing: boolean; automatic: boolean; extraction: boolean } | null;
  database: { schema: number; counts: Record<string, number> } | null;
} {
  const report: ReturnType<typeof doctorOwner> = { schemaVersion: 1, checks: [], settings: null, database: null };
  const check = (code: string, status: 'ok' | 'warning' | 'error', detail: string): void => { report.checks.push({ code, status, detail }); };
  const [major, minor] = process.versions.node.split('.').map(Number);
  check('node', major! > 24 || major === 24 && minor! >= 10 ? 'ok' : 'error', 'requires_Node_24_10_or_later');
  try { command('git', ['--version']); check('git', 'ok', 'available'); } catch { check('git', 'error', 'install_Git_then_reopen_terminal'); }
  let info: ReturnType<typeof configured>;
  try { info = configured(path); check('configuration', 'ok', 'valid_exact_repository_root'); }
  catch (error) { check('configuration', 'error', ownerError(error)); return report; }
  const { config, data, repoId } = info;
  report.settings = { execution: config.executionTrusted, background: config.backgroundVerification,
    sharing: config.shareWithModel, automatic: config.automaticLearning, extraction: config.extraction !== undefined };
  try {
    const version = JSON.parse(command(config.python, ['-I', '-c', 'import sys,importlib.util,json; print(json.dumps({"supported":sys.version_info>=(3,10),"pytest":importlib.util.find_spec("pytest") is not None}))'])) as { supported: boolean; pytest: boolean };
    check('python', version.supported ? 'ok' : 'error', version.supported ? 'Python_3_10_or_later' : 'requires_Python_3_10_or_later');
    check('pytest', version.pytest ? 'ok' : 'error', version.pytest ? 'available' : 'install_pytest_in_selected_interpreter');
  } catch { check('python', 'error', 'set_local_python_executable_then_install_pytest'); }
  if (config.acceptanceDir) {
    try {
      noLinks(config.acceptanceDir); const acceptance = realpathSync(resolve(config.acceptanceDir));
      const rel = relative(info.root, acceptance);
      if (!lstatSync(acceptance).isDirectory() || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) fail('acceptance_must_be_outside_repository');
      check('acceptance', 'ok', 'external_directory_exists_tests_still_require_independent_verification');
    } catch { check('acceptance', 'error', 'provide_existing_acceptance_directory_outside_repository'); }
  } else check('acceptance', 'warning', 'not_configured_read_only_use_available');
  check('host', 'warning', 'owner_must_check_running_DSH_exactly_' + supportedDshVersions.join('_or_'));
  check('model_connection', 'warning', 'not_contacted_configure_and_check_credentials_locally_in_DSH');
  if (existsSync(join(data, 'evolve.sqlite'))) {
    try { report.database = inspectDatabase(data, repoId); check('database', 'ok', 'read_only_schema_and_binding_checked_no_migration'); }
    catch (error) { check('database', 'error', ownerError(error)); }
  } else check('database', 'warning', 'not_created_no_data_written');
  return report;
}

const inventorySchema = z.object({ directories: z.array(relativePath).max(10000), files: z.array(z.object({
  path: relativePath, bytes: z.number().int().nonnegative().max(512 * 1024 * 1024), sha256: hashSchema,
}).strict()).max(10000) }).strict();
type Inventory = z.infer<typeof inventorySchema>;
const manifestSchema = z.object({ format: z.literal('dsh-reforge-stopped-backup-v1'), schema: z.literal(9), repoId: hashSchema,
  createdAt: z.string().datetime(), inventory: inventorySchema }).strict();

async function inventory(root: string): Promise<Inventory> {
  noLinks(root); if (!(await lstat(root)).isDirectory()) fail('expected_data_directory');
  const result: Inventory = { directories: [], files: [] }; let bytes = 0; let entries = 0;
  async function walk(sub = ''): Promise<void> {
    for (const entry of (await readdir(join(root, sub), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 10000) fail('backup_entry_limit_exceeded');
      const path = relativePath.parse(sub ? sub + '/' + entry.name : entry.name);
      const full = join(root, path); const stat = await lstat(full);
      if (stat.isSymbolicLink()) fail('symlink_or_junction_not_supported');
      if (stat.isDirectory()) { result.directories.push(path); await walk(path); }
      else if (stat.isFile()) {
        bytes += stat.size; if (bytes > 512 * 1024 * 1024) fail('backup_size_limit_exceeded');
        const data = await readFile(full); if (data.length !== stat.size) fail('source_changed_during_backup');
        result.files.push({ path, bytes: data.length, sha256: digest(data) });
      } else fail('special_file_not_supported');
    }
  }
  await walk(); return inventorySchema.parse(result);
}
const same = (a: Inventory, b: Inventory): void => { if (JSON.stringify(a) !== JSON.stringify(b)) fail('file_set_or_hash_mismatch'); };
async function copyInventory(source: string, output: string, listing: Inventory): Promise<void> {
  for (const path of listing.directories) await mkdir(join(output, path), { mode: 0o700 });
  for (const file of listing.files) {
    noLinks(join(source, file.path)); await copyFile(join(source, file.path), join(output, file.path), constants.COPYFILE_EXCL);
  }
}
function stopped(value: boolean): void { if (!value) fail('stop_DSH_and_panels_then_explicitly_pass_stopped'); }

export async function backupOwner(path: string, outputInput: string, isStopped: boolean): Promise<{ files: number; schema: number }> {
  stopped(isStopped); const info = configured(path); const source = await realpath(info.data); const output = resolve(outputInput);
  noLinks(output); separate(source, output); separate(source, resolve(path));
  // Config/profile/financial ledgers are deliberately outside this data-only backup contract.
  const inspection = inspectDatabase(source, info.repoId, true); const listing = await inventory(source);
  await newDirectory(output); const target = join(output, 'data'); await mkdir(target, { mode: 0o700 });
  await copyInventory(source, target, listing);
  same(listing, await inventory(source)); same(listing, await inventory(target));
  inspectDatabase(target, info.repoId, true); same(listing, await inventory(target));
  const manifest = manifestSchema.parse({ format: 'dsh-reforge-stopped-backup-v1', schema: inspection.schema,
    repoId: info.repoId, createdAt: new Date().toISOString(), inventory: listing });
  const file = await open(join(output, 'manifest.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  return { files: listing.files.length, schema: inspection.schema };
}

export async function restoreOwner(input: string, outputInput: string, repository: string, isStopped: boolean): Promise<{ files: number; schema: number }> {
  stopped(isStopped); noLinks(input); const source = await realpath(resolve(input)); const output = resolve(outputInput);
  noLinks(output); separate(source, output); const current = repo(repository);
  const manifestPath = join(source, 'manifest.json'); noLinks(manifestPath);
  if ((await lstat(manifestPath)).size > 4 * 1024 * 1024) fail('backup_manifest_too_large');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest.repoId !== current.id) fail('repository_binding_mismatch');
  const data = join(source, 'data'); const actual = await inventory(data); same(manifest.inventory, actual);
  inspectDatabase(data, current.id, true); same(actual, await inventory(data));
  await newDirectory(output); await copyInventory(data, output, actual);
  same(actual, await inventory(data)); same(actual, await inventory(output));
  inspectDatabase(output, current.id, true); same(actual, await inventory(output));
  return { files: actual.files.length, schema: 9 };
}

export async function ownerCommand(command: string, args: string[]): Promise<void> {
  const choices: Record<string, string[]> = { setup: ['--repo', '--output', '--python', '--data-dir'], doctor: ['--config'],
    backup: ['--config', '--output', '--stopped'], restore: ['--input', '--output', '--repo', '--stopped'] };
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!choices[command]?.includes(key) || options.has(key)) fail('unknown_or_duplicate_option');
    if (key === '--stopped') { options.set(key, 'true'); continue; }
    const value = args[++i]; if (!value || value.startsWith('--')) fail('missing_option_value'); options.set(key, value!);
  }
  const required = (key: string): string => options.get(key) ?? fail('missing_required_' + key.slice(2).replaceAll('-', '_'));
  if (command === 'setup') {
    await setupOwner({ repo: required('--repo'), output: required('--output'), python: options.get('--python'), dataDir: options.get('--data-dir') });
    console.log(JSON.stringify({ created: true, permissions: 'all_disabled', next: 'run_doctor_then_follow_local_authorization_guide' }));
  } else if (command === 'doctor') {
    const report = doctorOwner(required('--config')); console.log(JSON.stringify(report, null, 2));
    if (report.checks.some(check => check.status === 'error')) process.exitCode = 1;
  } else {
    const output = required('--output');
    const result = command === 'backup' ? await backupOwner(required('--config'), output, options.has('--stopped'))
      : await restoreOwner(required('--input'), output, required('--repo'), options.has('--stopped'));
    console.log(JSON.stringify({ ...result, complete: true, tasksExecuted: false, authorizationIncreased: false }));
  }
}
