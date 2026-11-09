/** Independent research accounting. No credentials, network, historical grant or product Store. */
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const studyCostPolicy = Object.freeze({ version: 't063-flash-peak-v1', currency: 'micro-CNY', model: 'deepseek-flash',
  maxCap: 10_000_000, reservation: 5_345_728, maxInput: 1_100_000, maxOutput: 393_216,
  requestedOutput: 2048, maxCalls: 72, maxTrials: 36, inputRate: 2, outputRate: 8,
  maxRequestBytes: 262144, maxResponseBytes: 1048576 });
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.object({ studyId: z.string().uuid(), planDigest: hash }).strict();
const identitySchema = z.object({ trialIndex: integer.max(35), round: z.union([z.literal(1), z.literal(2)]), inputDigest: hash }).strict();
export const studyUsageSchema = z.object({ input: integer.max(studyCostPolicy.maxInput), output: integer.max(studyCostPolicy.maxOutput) }).strict();
const stopSchema = z.enum(['transport_unknown', 'http_error', 'invalid_receipt', 'owner_reopened', 'output_exceeded']);
const callSchema = z.object({ id: z.string().uuid(), ...identitySchema.shape, charge: integer,
  usage: studyUsageSchema.nullable(), reason: z.enum(['reserved', 'complete', ...stopSchema.options]) }).strict();
const stateSchema = z.object({ schema: z.literal(1), policy: z.literal(studyCostPolicy.version), binding: bindingSchema,
  phase: z.enum(['unapproved', 'prepared', 'started', 'completed', 'incomplete', 'unknown']),
  cap: integer.positive().max(studyCostPolicy.maxCap).nullable(), approvalDigest: hash.nullable(),
  stopped: stopSchema.nullable(), calls: z.array(callSchema).max(studyCostPolicy.maxCalls) }).strict();
export type StudyCostBinding = z.infer<typeof bindingSchema>;
export type StudyCallIdentity = z.infer<typeof identitySchema>;
export type StudyUsage = z.infer<typeof studyUsageSchema>;
type State = z.infer<typeof stateSchema>;
type UnknownReason = 'transport_unknown' | 'http_error' | 'invalid_receipt';
const probe = resolve(fileURLToPath(new URL('../../.probe-work/', import.meta.url)));
const table = 'CREATE TABLE study_cost(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)';
class CostPolicyError extends Error {}
function requireCost(condition: unknown): asserts condition { if (!condition) throw new CostPolicyError('Study cost policy rejected the operation'); }
const samePath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
function ownedRoot(input: string): string {
  const root = resolve(input); const child = relative(probe, root);
  requireCost(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
  for (const path of [probe, ...child.split(sep).map((_, i, parts) => join(probe, ...parts.slice(0, i + 1)))]) {
    const stat = lstatSync(path); requireCost(stat.isDirectory() && !stat.isSymbolicLink() && samePath(realpathSync(path), path));
  }
  return root;
}
function regular(path: string) {
  const stat = lstatSync(path); requireCost(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2_097_152);
  return stat;
}
function validate(value: unknown): State {
  const s = stateSchema.parse(value); const cost = s.calls.reduce((n, c) => n + c.charge, 0);
  requireCost(new Set(s.calls.map(c => c.id)).size === s.calls.length);
  requireCost(s.phase === 'unapproved' ? s.cap === null && s.approvalDigest === null && s.calls.length === 0 && !s.stopped
    : s.cap !== null && s.approvalDigest !== null && cost <= s.cap);
  requireCost(s.phase !== 'prepared' || s.calls.length === 0 && !s.stopped);
  requireCost(!['started', 'completed', 'unknown'].includes(s.phase) || s.calls.length > 0);
  requireCost(s.phase !== 'started' || !s.stopped);
  requireCost(s.phase !== 'unknown' || s.stopped !== null);
  requireCost(s.phase !== 'completed' || !s.stopped && s.calls.at(-1)?.trialIndex === 35 && s.calls.every(c => c.reason === 'complete'));
  for (const [index, c] of s.calls.entries()) {
    const previous = s.calls[index - 1];
    requireCost(previous ? previous.usage !== null && previous.reason === 'complete'
      && (c.trialIndex === previous.trialIndex && previous.round === 1 && c.round === 2 || c.trialIndex === previous.trialIndex + 1 && c.round === 1)
      : c.trialIndex === 0 && c.round === 1);
    requireCost(c.charge === (c.usage ? c.usage.input * 2 + c.usage.output * 8 : studyCostPolicy.reservation));
    requireCost(c.usage ? c.reason === (c.usage.output > 2048 ? 'output_exceeded' : 'complete')
      : c.reason !== 'complete' && c.reason !== 'output_exceeded');
    requireCost(!c.usage ? index === s.calls.length - 1 && ['started', 'unknown'].includes(s.phase) : true);
    requireCost(c.reason !== 'output_exceeded' || s.phase === 'incomplete' && s.stopped === 'output_exceeded');
  }
  return s;
}
function sameBinding(a: StudyCostBinding, b: StudyCostBinding) { return a.studyId === b.studyId && a.planDigest === b.planDigest; }

export class StudyCostLedger {
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly lock: number;
  private readonly fileIdentity: ReturnType<typeof regular>;
  private closed = false;
  private poisoned = false;
  private readonly fresh = new Set<string>();
  private constructor(readonly root: string, private readonly binding: StudyCostBinding, create: boolean) {
    this.root = ownedRoot(root); this.binding = bindingSchema.parse(binding); this.path = join(this.root, 'cost-ledger.sqlite');
    this.lock = openSync(this.path + '.lock', 'wx', 0o600);
    let db: DatabaseSync | undefined;
    try {
      if (create) { const fd = openSync(this.path, 'wx', 0o600); closeSync(fd); }
      else {
        regular(this.path); const fd = openSync(this.path, 'r'); const header = Buffer.alloc(100);
        try { requireCost(readSync(fd, header, 0, 100, 0) === 100); } finally { closeSync(fd); }
        requireCost(header.subarray(0, 16).toString('binary') === 'SQLite format 3\0'
          && header.readUInt32BE(60) === 1 && header.readUInt32BE(68) === 0x52463633 && header[18] === 1 && header[19] === 1);
        const inspect = new DatabaseSync(this.path, { readOnly: true });
        try {
          requireCost(inspect.prepare('PRAGMA quick_check').get()!.quick_check === 'ok');
          const schema = inspect.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
          requireCost(schema.length === 1 && schema[0]!.type === 'table' && schema[0]!.name === 'study_cost' && schema[0]!.sql === table);
          requireCost(inspect.prepare('SELECT count(*) AS n FROM study_cost').get()!.n === 1);
          const s = validate(JSON.parse(String(inspect.prepare('SELECT body FROM study_cost WHERE id=1').get()?.body)));
          requireCost(sameBinding(s.binding, this.binding));
        } finally { inspect.close(); }
      }
      this.fileIdentity = regular(this.path); db = new DatabaseSync(this.path); this.db = db;
      db.exec('PRAGMA synchronous=EXTRA; PRAGMA busy_timeout=1000;');
      requireCost(db.prepare('PRAGMA journal_mode').get()!.journal_mode === 'delete' && db.prepare('PRAGMA synchronous').get()!.synchronous === 3);
      if (create) {
        db.exec('BEGIN IMMEDIATE'); db.exec(table + '; PRAGMA user_version=1; PRAGMA application_id=0x52463633;');
        db.prepare('INSERT INTO study_cost VALUES(1,?)').run(JSON.stringify(validate({ schema: 1, policy: studyCostPolicy.version,
          binding: this.binding, phase: 'unapproved', cap: null, approvalDigest: null, stopped: null, calls: [] })));
        db.exec('COMMIT');
      } else if (this.state.phase === 'started') this.mutate(s => { s.phase = 'unknown'; s.stopped = 'owner_reopened'; });
    } catch (error) {
      try { db?.exec('ROLLBACK'); } catch { /* No active transaction. */ }
      db?.close(); this.releaseLock(); throw error;
    }
  }
  static create(root: string, binding: StudyCostBinding) { return new StudyCostLedger(root, binding, true); }
  static open(root: string, binding: StudyCostBinding) { return new StudyCostLedger(root, binding, false); }
  private check(): void {
    requireCost(!this.closed && !this.poisoned && ownedRoot(this.root) === this.root);
    const now = regular(this.path); requireCost(now.dev === this.fileIdentity.dev && now.ino === this.fileIdentity.ino);
    const lock = lstatSync(this.path + '.lock'); const held = fstatSync(this.lock);
    requireCost(lock.isFile() && !lock.isSymbolicLink() && lock.nlink === 1 && lock.dev === held.dev && lock.ino === held.ino);
  }
  get state(): State { this.check(); const s = validate(JSON.parse(String(this.db.prepare('SELECT body FROM study_cost WHERE id=1').get()?.body)));
    requireCost(sameBinding(s.binding, this.binding)); return s; }
  get summary() {
    const s = this.state; return { phase: s.phase, calls: s.calls.length, cap: s.cap, stopped: s.stopped,
      settledUpperBound: s.calls.filter(c => c.usage).reduce((n, c) => n + c.charge, 0),
      unknownReserved: s.calls.filter(c => !c.usage).reduce((n, c) => n + c.charge, 0) };
  }
  private mutate(change: (state: State) => void): void {
    this.check();
    try { this.db.exec('BEGIN IMMEDIATE'); const s = this.state; change(s); validate(s);
      requireCost(this.db.prepare('UPDATE study_cost SET body=? WHERE id=1').run(JSON.stringify(s)).changes === 1); this.db.exec('COMMIT');
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Keep committed reservation. */ }
      if (!(error instanceof CostPolicyError)) this.poisoned = true; throw error; }
  }
  /** Internal mechanism only: a future owner entry point must supply fresh explicit approval. Tests use synthetic approval. */
  approve(binding: StudyCostBinding, cap: number, approvalDigest: string): void {
    integer.positive().max(studyCostPolicy.maxCap).parse(cap); hash.parse(approvalDigest); bindingSchema.parse(binding);
    this.mutate(s => { requireCost(sameBinding(s.binding, binding) && s.phase === 'unapproved'); s.cap = cap; s.approvalDigest = approvalDigest; s.phase = 'prepared'; });
  }
  reserve(binding: StudyCostBinding, identity: StudyCallIdentity): string {
    const key = identitySchema.parse(identity); bindingSchema.parse(binding); const id = randomUUID();
    this.mutate(s => { requireCost(sameBinding(s.binding, binding) && ['prepared', 'started'].includes(s.phase) && !s.stopped
      && s.calls.every(c => c.usage !== null) && s.calls.length < 72
      && s.calls.reduce((n, c) => n + c.charge, 0) + studyCostPolicy.reservation <= s.cap!);
      s.phase = 'started'; s.calls.push({ id, ...key, charge: studyCostPolicy.reservation, usage: null, reason: 'reserved' }); });
    this.fresh.add(id); return id;
  }
  settle(id: string, input: StudyUsage): void {
    const usage = studyUsageSchema.parse(input);
    this.mutate(s => { const c = s.calls.at(-1); requireCost(s.phase === 'started' && c?.id === id && !c.usage && this.fresh.has(id));
      c.usage = usage; c.charge = usage.input * 2 + usage.output * 8; c.reason = usage.output > 2048 ? 'output_exceeded' : 'complete';
      if (c.reason === 'output_exceeded') { s.phase = 'incomplete'; s.stopped = 'output_exceeded'; } });
    this.fresh.delete(id);
  }
  hold(id: string, reason: UnknownReason): void {
    z.enum(['transport_unknown', 'http_error', 'invalid_receipt']).parse(reason);
    this.mutate(s => { const c = s.calls.at(-1); requireCost(s.phase === 'started' && c?.id === id && !c.usage && this.fresh.has(id));
      c.reason = reason; s.phase = 'unknown'; s.stopped = reason; }); this.fresh.delete(id);
  }
  finish(complete: boolean): void { this.mutate(s => { requireCost(s.phase === 'started' && s.calls.every(c => c.usage !== null)); s.phase = complete ? 'completed' : 'incomplete'; }); }
  private releaseLock(): void {
    const held = fstatSync(this.lock); closeSync(this.lock);
    const now = lstatSync(this.path + '.lock');
    if (now.isFile() && !now.isSymbolicLink() && now.nlink === 1 && now.dev === held.dev && now.ino === held.ino) unlinkSync(this.path + '.lock');
  }
  close(): void { if (!this.closed) { this.closed = true; try { this.db.close(); } finally { this.releaseLock(); } } }
}
