import { DatabaseSync } from 'node:sqlite';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Task } from './domain.js';
import { hashSchema, idSchema, RevisionConflict } from './domain.js';
import { OwnerInputError, ownerInputPolicy, ownerMarkerSchema, ownerReceiptSchema, ownerRuleSchema, ownerTaskIdentity,
  type OwnerMarker, type OwnerReceipt, type OwnerRule, type OwnerRulesSnapshot } from './owner-input-domain.js';

const format = 'dsh-reforge-owner-input-v1';
const identitySchema = z.object({ format: z.literal(format), repoId: hashSchema, storeId: idSchema }).strict();
type Identity = z.infer<typeof identitySchema>;
const invalid = (): never => { throw new OwnerInputError('owner_configuration_unavailable'); };
const json = (body: unknown, maxBytes: number): unknown => {
  if (typeof body !== 'string' || Buffer.byteLength(body) > maxBytes) return invalid();
  try { return JSON.parse(body); } catch { return invalid(); }
};
/** Separate lazy schema1 metadata. Original experience SQLite remains v9. */
export class OwnerInputStore {
  private memory: DatabaseSync | null = null;
  private closed = false;
  private seenFile = false;
  private memoryIdentity: Identity | null = null;
  constructor(private readonly path: string | null) {}
  private initialize(db: DatabaseSync, identity: Identity): void {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE owner_format(name TEXT NOT NULL, repo_id TEXT NOT NULL, store_id TEXT NOT NULL);
      CREATE TABLE owner_meta(repo_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE owner_rules(repo_id TEXT NOT NULL, experience_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(repo_id,experience_id));
      CREATE TABLE owner_receipts(id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, phase TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE owner_messages(message_id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, preview_id TEXT UNIQUE NOT NULL, task_id TEXT UNIQUE, repo_id TEXT NOT NULL, body TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT; PRAGMA max_page_count=2048;`);
    db.prepare('INSERT INTO owner_format VALUES(?,?,?)').run(format, identity.repoId, identity.storeId);
  }
  private withDb<T>(write: boolean, absent: () => T, operation: (db: DatabaseSync) => T, repoId?: string): T {
    if (this.closed) throw new OwnerInputError('owner_store_closed');
    if (this.path === null) {
      if (!this.memory && !write) return absent();
      if (!this.memory) {
        if (!repoId) return invalid();
        this.memoryIdentity = { format, repoId, storeId: randomUUID() };
        this.memory = new DatabaseSync(':memory:'); this.initialize(this.memory, this.memoryIdentity);
      }
      if (repoId && repoId !== this.memoryIdentity?.repoId) return invalid();
      return operation(this.memory);
    }
    let exists = true;
    try {
      const info = lstatSync(this.path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8 * 1024 * 1024) return invalid();
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw error; }
    const anchorPath = this.path.replace(/\.sqlite$/, '') + '.identity.json';
    let identity: Identity | null = null;
    let anchor: ReturnType<typeof lstatSync> | null = null;
    try { anchor = lstatSync(anchorPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (anchor) {
      if (!anchor.isFile() || anchor.isSymbolicLink() || anchor.nlink !== 1 || anchor.size > 512) return invalid();
      identity = identitySchema.parse(JSON.parse(readFileSync(anchorPath, 'utf8')));
      if (repoId && identity.repoId !== repoId) return invalid();
    }
    if (exists !== !!identity || !exists && this.seenFile) return invalid();
    if (!exists && !write) return absent();
    let fresh = false;
    if (!exists) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      if (!repoId) return invalid();
      identity = { format, repoId, storeId: randomUUID() };
      // Incomplete initialization stays unavailable; never guess which half can be reset.
      writeFileSync(anchorPath, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
      const fd = openSync(this.path, 'wx', 0o600); closeSync(fd); fresh = true;
    }
    const db = new DatabaseSync(this.path, { readOnly: !write });
    try {
      db.exec('PRAGMA busy_timeout=1000;');
      if (fresh) this.initialize(db, identity!);
      const header = db.prepare('SELECT name,repo_id,store_id FROM owner_format').all();
      if (db.prepare('PRAGMA user_version').get()?.user_version !== 1 || header.length !== 1 || header[0]?.name !== format
        || header[0]?.repo_id !== identity!.repoId || header[0]?.store_id !== identity!.storeId) return invalid();
      for (const table of ['owner_meta', 'owner_rules', 'owner_receipts', 'owner_messages']) {
        if (db.prepare(`SELECT 1 FROM ${table} WHERE repo_id<>? LIMIT 1`).get(identity!.repoId)) return invalid();
      }
      this.seenFile = true;
      return operation(db);
    } finally { db.close(); }
  }
  private transaction<T>(db: DatabaseSync, operation: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const value = operation(); db.exec('COMMIT'); return value; }
    catch (error) { try { db.exec('ROLLBACK'); } catch { /* Do not replay an uncertain write. */ } throw error; }
  }
  private rules(db: DatabaseSync, repoId: string): OwnerRulesSnapshot {
    const meta = db.prepare('SELECT revision FROM owner_meta WHERE repo_id=?').get(repoId); const version = meta?.revision ?? 0;
    const revision = z.number().int().nonnegative().parse(version);
    const rows = db.prepare('SELECT experience_id,body FROM owner_rules WHERE repo_id=? ORDER BY experience_id').all(repoId);
    if (rows.length && (!meta || revision === 0)) return invalid();
    if (rows.length > ownerInputPolicy.maxRules) return invalid();
    const rules = rows.map(row => { const rule = ownerRuleSchema.parse(json(row.body, 4096));
      if (rule.repoId !== repoId || row.experience_id !== rule.experienceId) return invalid(); return rule; });
    return { revision, rules };
  }
  snapshot(repoId: string): OwnerRulesSnapshot {
    hashSchema.parse(repoId); return this.withDb(false, () => ({ revision: 0, rules: [] }), db => this.rules(db, repoId), repoId);
  }
  putRule(input: Omit<OwnerRule, 'revision' | 'createdAt' | 'updatedAt'>, expectedGlobal: number, expectedRule: number): OwnerRule {
    hashSchema.parse(input.repoId);
    return this.withDb(true, invalid, db => this.transaction(db, () => {
      const state = this.rules(db, input.repoId); const old = state.rules.find(r => r.experienceId === input.experienceId);
      if (state.revision !== expectedGlobal || (old?.revision ?? 0) !== expectedRule) throw new RevisionConflict();
      if (!old && Number(db.prepare('SELECT count(*) n FROM owner_rules').get()!.n) >= ownerInputPolicy.maxRules) throw new OwnerInputError('owner_rule_limit');
      const now = new Date().toISOString(); const rule = ownerRuleSchema.parse({ ...input, revision: expectedRule + 1, createdAt: old?.createdAt ?? now, updatedAt: now });
      db.prepare('INSERT INTO owner_rules VALUES(?,?,?) ON CONFLICT(repo_id,experience_id) DO UPDATE SET body=excluded.body').run(rule.repoId, rule.experienceId, JSON.stringify(rule));
      db.prepare('INSERT INTO owner_meta VALUES(?,?) ON CONFLICT(repo_id) DO UPDATE SET revision=excluded.revision').run(rule.repoId, expectedGlobal + 1);
      return rule;
    }), input.repoId);
  }
  private receiptRow(db: DatabaseSync, repoId: string, id: string): OwnerReceipt | null {
    const row = db.prepare('SELECT phase,created_at,body FROM owner_receipts WHERE id=? AND repo_id=?').get(id, repoId);
    if (!row) return null; const receipt = ownerReceiptSchema.parse(json(row.body, 8192));
    if (receipt.repoId !== repoId || receipt.id !== id || receipt.phase !== row.phase || receipt.createdAt !== row.created_at) return invalid(); return receipt;
  }
  receipt(repoId: string, id: string): OwnerReceipt | null {
    hashSchema.parse(repoId); idSchema.parse(id); return this.withDb(false, () => null, db => this.receiptRow(db, repoId, id), repoId);
  }
  receipts(repoId: string): OwnerReceipt[] {
    hashSchema.parse(repoId);
    return this.withDb(false, () => [], db => {
      const rows = db.prepare('SELECT id FROM owner_receipts WHERE repo_id=? ORDER BY created_at DESC,id DESC').all(repoId);
      if (rows.length > ownerInputPolicy.maxReceipts) return invalid();
      return rows.map(row => this.receiptRow(db, repoId, String(row.id))!);
    }, repoId);
  }
  reserve(receiptInput: OwnerReceipt, markerInput: OwnerMarker): { fresh: boolean; receipt: OwnerReceipt } {
    const receipt = ownerReceiptSchema.parse(receiptInput); const marker = ownerMarkerSchema.parse(markerInput);
    if (receipt.repoId !== marker.repoId || receipt.id !== marker.requestId || receipt.messageId !== marker.messageId
      || receipt.hostRunId !== marker.hostRunId || receipt.sessionId !== marker.sessionId || receipt.previewId !== marker.previewId || receipt.phase !== 'reserved'
      || receipt.taskId !== null || receipt.facts !== null || marker.taskId !== null) return invalid();
    return this.withDb(true, invalid, db => this.transaction(db, () => {
      const old = this.receiptRow(db, receipt.repoId, receipt.id);
      if (old) { if (old.submissionDigest !== receipt.submissionDigest) throw new OwnerInputError('owner_request_conflict'); return { fresh: false, receipt: old }; }
      if (db.prepare('SELECT 1 FROM owner_messages WHERE request_id=? OR message_id=?').get(receipt.id, marker.messageId)) throw new OwnerInputError('owner_request_expired');
      if (db.prepare('SELECT 1 FROM owner_messages WHERE preview_id=?').get(receipt.previewId)) throw new OwnerInputError('owner_preview_consumed');
      if (this.rules(db, receipt.repoId).revision !== receipt.rulesRevision) throw new RevisionConflict();
      // Permanent message/task classifications are never pruned with receipts.
      if (Number(db.prepare('SELECT count(*) n FROM owner_messages').get()!.n) >= ownerInputPolicy.maxMessages) throw new OwnerInputError('owner_message_limit');
      if (Number(db.prepare('SELECT count(*) n FROM owner_receipts').get()!.n) >= ownerInputPolicy.maxReceipts) {
        const terminal = db.prepare("SELECT id FROM owner_receipts WHERE phase IN ('ended','blocked','unknown') ORDER BY created_at,id LIMIT 1").get();
        if (!terminal) throw new OwnerInputError('owner_receipt_limit');
        db.prepare('DELETE FROM owner_receipts WHERE id=?').run(String(terminal.id));
      }
      db.prepare('INSERT INTO owner_messages VALUES(?,?,?,?,?,?)').run(marker.messageId, marker.requestId, marker.previewId, marker.taskId, marker.repoId, JSON.stringify(marker));
      db.prepare('INSERT INTO owner_receipts VALUES(?,?,?,?,?)').run(receipt.id, receipt.repoId, receipt.phase, receipt.createdAt, JSON.stringify(receipt));
      return { fresh: true, receipt };
    }), receipt.repoId);
  }
  transition(repoId: string, id: string, from: OwnerReceipt['phase'][], patch: Partial<Pick<OwnerReceipt, 'phase' | 'reason' | 'taskId' | 'facts'>>): OwnerReceipt | null {
    return this.withDb(true, invalid, db => this.transaction(db, () => {
      const old = this.receiptRow(db, repoId, id); if (!old || !from.includes(old.phase)) return null;
      const value = ownerReceiptSchema.parse({ ...old, ...patch, updatedAt: new Date().toISOString() });
      db.prepare('UPDATE owner_receipts SET phase=?,body=? WHERE id=? AND repo_id=?').run(value.phase, JSON.stringify(value), id, repoId); return value;
    }), repoId);
  }
  private markerRow(db: DatabaseSync, messageId: string): OwnerMarker | null {
    const row = db.prepare('SELECT request_id,preview_id,task_id,repo_id,body FROM owner_messages WHERE message_id=?').get(messageId);
    if (!row) return null; const marker = ownerMarkerSchema.parse(json(row.body, 4096));
    if (marker.messageId !== messageId || marker.requestId !== row.request_id || marker.previewId !== row.preview_id || marker.taskId !== row.task_id || marker.repoId !== row.repo_id) return invalid(); return marker;
  }
  marker(messageId: string): OwnerMarker | null { return this.withDb(false, () => null, db => this.markerRow(db, messageId)); }
  bind(repoId: string, messageId: string, task: Task, turn: number, facts: OwnerReceipt['facts']): OwnerMarker {
    return this.withDb(true, invalid, db => this.transaction(db, () => {
      const old = this.markerRow(db, messageId); if (!old || old.repoId !== repoId || old.sessionId !== task.sessionId || task.scope.repoId !== repoId
        || old.taskId !== null) throw new OwnerInputError('owner_binding_conflict');
      const receipt = this.receiptRow(db, repoId, old.requestId);
      if (!receipt || receipt.messageId !== messageId || receipt.hostRunId !== old.hostRunId || receipt.sessionId !== old.sessionId
        || !['reserved', 'submitted'].includes(receipt.phase)) throw new OwnerInputError('owner_receipt_unavailable');
      const marker = ownerMarkerSchema.parse({ ...old, taskId: task.id, taskIdentity: ownerTaskIdentity(task), turn });
      const value = ownerReceiptSchema.parse({ ...receipt, phase: 'bound', taskId: task.id, facts, reason: facts ? 'bound_to_task' : 'source_unconfirmed', updatedAt: new Date().toISOString() });
      db.prepare('UPDATE owner_messages SET task_id=?,body=? WHERE message_id=?').run(task.id, JSON.stringify(marker), messageId);
      db.prepare('UPDATE owner_receipts SET phase=?,body=? WHERE id=?').run(value.phase, JSON.stringify(value), value.id); return marker;
    }), repoId);
  }
  classification(task: Task): OwnerMarker['mode'] | null {
    return this.withDb(false, () => null, db => {
      const row = db.prepare('SELECT message_id FROM owner_messages WHERE task_id=?').get(task.id); if (!row) return null;
      const marker = this.markerRow(db, String(row.message_id))!;
      if (marker.repoId !== task.scope.repoId || marker.sessionId !== task.sessionId || marker.taskIdentity !== ownerTaskIdentity(task)) return invalid();
      return marker.mode;
    }, task.scope.repoId);
  }
  markers(repoId: string): OwnerMarker[] {
    return this.withDb(false, () => [], db => {
      const rows = db.prepare('SELECT message_id FROM owner_messages WHERE repo_id=?').all(repoId);
      if (rows.length > ownerInputPolicy.maxMessages) return invalid(); return rows.map(row => this.markerRow(db, String(row.message_id))!);
    }, repoId);
  }
  close(): void { this.closed = true; this.memory?.close(); this.memory = null; }
}
