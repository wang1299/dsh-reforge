import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LearningStore, learningTablesSql } from './learning-store.js';
import { observationSchema } from './learning-domain.js';
import { ExtractionStore, extractionTablesSql } from './extraction-store.js';
import { AutomaticStore, automaticTablesSql } from './automatic-store.js';
import { OwnerInputStore } from './owner-input-store.js';
import { OwnerInputError } from './owner-input-domain.js';
import { applicationSchema, experienceSchema, feedbackSchema, taskSchema, verificationSchema, RevisionConflict,
  evidenceSchema, factCitationsSchema, type Evidence, type FactCitation,
  type Application, type Experience, type Feedback, type Task, type Verification } from './domain.js';

export class Store {
  private readonly db: DatabaseSync;
  readonly learning: LearningStore;
  readonly extraction: ExtractionStore;
  readonly automatic: AutomaticStore;
  readonly ownerInputs: OwnerInputStore;
  /** Retained until the actual host turn ends, even if a model closes its task early. */
  readonly ownerContextSessions = new Set<string>();
  constructor(path: string) {
    this.ownerInputs = new OwnerInputStore(path === ':memory:' ? null : join(dirname(path), 'owner-inputs-v1.sqlite'));
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    // SQLite's table rebuild procedure requires disabling enforcement before BEGIN.
    // No caller can access this connection until checks, commit and re-enabling finish.
    this.db.exec('PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=5000;');
    try {
      // Serialize initialization before any schema read. Deferred savepoint readers can
      // otherwise deadlock upgrading to a write lock even with busy_timeout enabled.
      this.db.exec('BEGIN IMMEDIATE');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9) throw new Error('Unsupported database schema version');
      this.transaction(() => { this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS experiences(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, revision));
      CREATE TABLE IF NOT EXISTS verifications(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, application_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fact_citations(experience_id TEXT NOT NULL, revision INTEGER NOT NULL, fact_index INTEGER NOT NULL,
        evidence_id TEXT NOT NULL, fact_digest TEXT NOT NULL, evidence_digest TEXT NOT NULL,
        PRIMARY KEY(experience_id, revision, fact_index, evidence_id),
        FOREIGN KEY(experience_id, revision) REFERENCES revisions(id, revision), FOREIGN KEY(evidence_id) REFERENCES evidence(id));
      CREATE INDEX IF NOT EXISTS fact_citations_evidence ON fact_citations(evidence_id);
    `);
      if (version === 1) this.migrateV1();
      this.db.exec(learningTablesSql);
      this.db.exec(extractionTablesSql);
      this.db.exec(automaticTablesSql);
      if (version !== 0 && version !== 6 && version !== 7 && version !== 8 && version !== 9) this.migrateV6();
      if (version === 6) this.migrateV7();
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key validation failed');
      this.db.exec('PRAGMA user_version=9');
      });
      this.db.exec('COMMIT');
      this.db.exec('PRAGMA foreign_keys=ON');
      if (this.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('Foreign key enforcement unavailable');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* BEGIN itself may have failed. */ }
      this.db.close(); throw error;
    }
    this.learning = new LearningStore(this.db, fn => this.transaction(fn));
    this.extraction = new ExtractionStore(this.db, fn => this.transaction(fn));
    this.automatic = new AutomaticStore(this.db, path, fn => this.transaction(fn));
  }
  private migrateV6(): void {
    const learning = learningTablesSql.match(/CREATE TABLE IF NOT EXISTS learning_jobs[\s\S]*?;/)![0];
    const extraction = extractionTablesSql.match(/CREATE TABLE IF NOT EXISTS extraction_jobs[\s\S]*?;/)![0];
    this.db.exec(learning.replace('IF NOT EXISTS learning_jobs', 'learning_jobs_v6'));
    this.db.exec(extraction.replace('IF NOT EXISTS extraction_jobs', 'extraction_jobs_v6'));
    this.db.exec(`INSERT INTO learning_jobs_v6 SELECT * FROM learning_jobs;
      INSERT INTO extraction_jobs_v6 SELECT * FROM extraction_jobs;
      DROP TABLE extraction_jobs; DROP TABLE learning_jobs;
      ALTER TABLE learning_jobs_v6 RENAME TO learning_jobs;
      ALTER TABLE extraction_jobs_v6 RENAME TO extraction_jobs;`);
    this.db.exec(learningTablesSql); this.db.exec(extractionTablesSql);
  }
  private migrateV7(): void {
    const extraction = extractionTablesSql.match(/CREATE TABLE IF NOT EXISTS extraction_jobs[\s\S]*?;/)![0];
    this.db.exec(extraction.replace('IF NOT EXISTS extraction_jobs', 'extraction_jobs_v7'));
    this.db.exec(`INSERT INTO extraction_jobs_v7 SELECT * FROM extraction_jobs;
      DROP TABLE extraction_jobs; ALTER TABLE extraction_jobs_v7 RENAME TO extraction_jobs;`);
    this.db.exec(extractionTablesSql);
  }
  private migrateV1(): void {
    this.transaction(() => {
      this.db.exec(`CREATE TABLE feedback_v2(id TEXT PRIMARY KEY, application_id TEXT NOT NULL, body TEXT NOT NULL);
        INSERT INTO feedback_v2 SELECT id, application_id, body FROM feedback;
        DROP TABLE feedback; ALTER TABLE feedback_v2 RENAME TO feedback;`);
      for (const row of this.db.prepare('SELECT id,body FROM verifications').all()) {
        const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(String(row.body)));
        const run = (key: string): unknown => ({ ...z.record(z.string(), z.unknown()).parse(raw[key]), cases: [] });
        const migrated = verificationSchema.parse({ ...raw, schemaVersion: 2,
          base: run('base'), fixed: run('fixed'), regression: run('regression'), verified: false,
          reason: 'Migrated legacy evidence without test identity; revalidation required' });
        this.db.prepare('UPDATE verifications SET body=? WHERE id=?').run(JSON.stringify(migrated), String(row.id));
      }
      for (const row of this.db.prepare('SELECT body FROM experiences').all()) {
        const current = experienceSchema.parse(JSON.parse(String(row.body)));
        if (current.status !== 'source_verified') continue;
        this.putExperience({ ...current, revision: current.revision + 1, status: 'candidate',
          reason: 'Legacy verification migrated; original failing test identities require revalidation', createdAt: new Date().toISOString() });
      }
      this.db.exec('PRAGMA user_version=2');
    });
  }
  private parse<T>(schema: z.ZodType<T>, row: Record<string, unknown> | undefined): T | null {
    return row ? schema.parse(JSON.parse(String(row.body))) : null;
  }
  task(id: string): Task | null { return this.parse(taskSchema, this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id)); }
  lockTask(id: string): void {
    if (this.db.prepare('UPDATE tasks SET body=body WHERE id=?').run(id).changes !== 1) throw new Error('Unknown task');
  }
  tasks(): Task[] { return this.db.prepare('SELECT body FROM tasks').all().map((r) => taskSchema.parse(JSON.parse(String(r.body)))); }
  putTask(task: Task): void {
    this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, JSON.stringify(taskSchema.parse(task)));
  }
  experience(id: string): Experience | null { return this.parse(experienceSchema, this.db.prepare('SELECT body FROM experiences WHERE id=?').get(id)); }
  experiences(): Experience[] { return this.db.prepare('SELECT body FROM experiences ORDER BY id').all().map((r) => experienceSchema.parse(JSON.parse(String(r.body)))); }
  history(id: string): Experience[] { return this.db.prepare('SELECT body FROM revisions WHERE id=? ORDER BY revision').all(id).map((r) => experienceSchema.parse(JSON.parse(String(r.body)))); }
  putExperience(experience: Experience, inputCitations: FactCitation[] = []): void {
    const item = experienceSchema.parse(experience);
    const citations = factCitationsSchema.parse(inputCitations);
    this.transaction(() => {
      const current = this.experience(item.id);
      if (item.revision !== (current?.revision ?? 0) + 1) throw new RevisionConflict();
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(item.id, item.revision, JSON.stringify(item));
      this.db.prepare('INSERT INTO experiences VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body')
        .run(item.id, item.revision, JSON.stringify(item));
      const insert = this.db.prepare('INSERT INTO fact_citations VALUES(?,?,?,?,?,?)');
      for (const c of citations) insert.run(item.id, item.revision, c.factIndex, c.evidenceId, c.factDigest, c.evidenceDigest);
    });
  }
  putVerification(v: Verification): void { this.db.prepare('INSERT INTO verifications VALUES(?,?)').run(v.id, JSON.stringify(verificationSchema.parse(v))); }
  verification(id: string): Verification | null { return this.parse(verificationSchema, this.db.prepare('SELECT body FROM verifications WHERE id=?').get(id)); }
  putApplication(v: Application): void { this.db.prepare('INSERT INTO applications VALUES(?,?)').run(v.id, JSON.stringify(applicationSchema.parse(v))); }
  application(id: string): Application | null { return this.parse(applicationSchema, this.db.prepare('SELECT body FROM applications WHERE id=?').get(id)); }
  applications(): Application[] { return this.db.prepare('SELECT body FROM applications').all().map((r) => applicationSchema.parse(JSON.parse(String(r.body)))); }
  feedback(): Feedback[] { return this.db.prepare('SELECT body FROM feedback ORDER BY rowid').all().map((r) => feedbackSchema.parse(JSON.parse(String(r.body)))); }
  putFeedback(v: Feedback): boolean {
    const previous = this.parse(feedbackSchema, this.db.prepare('SELECT body FROM feedback WHERE id=?').get(v.id));
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(v)) return false;
      throw new Error('Feedback already recorded; append evidence through a revision');
    }
    this.db.prepare('INSERT INTO feedback VALUES(?,?,?)').run(v.id, v.applicationId, JSON.stringify(feedbackSchema.parse(v)));
    return true;
  }
  event(id: string, taskId: string, createdAt: string, body: object): void {
    this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?)').run(id, taskId, createdAt, JSON.stringify(body));
  }
  events(taskId: string): unknown[] { return this.db.prepare('SELECT body FROM events WHERE task_id=? ORDER BY created_at').all(taskId).map((r) => JSON.parse(String(r.body)) as unknown); }
  boundedObservations(taskId: string): { observations: { id: string; createdAt: string; kind: string; tool?: string }[]; omitted: number } {
    const count = Number(this.db.prepare('SELECT count(*) AS n FROM events WHERE task_id=?').get(taskId)!.n);
    const observations = this.db.prepare('SELECT id,created_at,body FROM events WHERE task_id=? ORDER BY rowid DESC LIMIT 128').all(taskId).reverse().flatMap(r => {
      try {
        const v = z.record(z.string(), z.unknown()).parse(JSON.parse(String(r.body)));
        const item = observationSchema.safeParse({ id: String(r.id), createdAt: String(r.created_at), kind: v.kind, ...(v.tool === undefined ? {} : { tool: v.tool }) });
        return item.success ? [item.data] : [];
      } catch { return []; } // Legacy or malformed metadata is omitted explicitly, never copied wholesale.
    });
    return { observations, omitted: count - observations.length };
  }
  evidence(id: string): Evidence | null { return this.parse(evidenceSchema, this.db.prepare('SELECT body FROM evidence WHERE id=?').get(id)); }
  evidenceRecords(): Evidence[] { return this.db.prepare('SELECT body FROM evidence ORDER BY id').all().map((r) => evidenceSchema.parse(JSON.parse(String(r.body)))); }
  taskEvidence(taskId: string): Evidence[] {
    return this.db.prepare('SELECT body FROM evidence WHERE task_id=? ORDER BY rowid').all(taskId).map(r => evidenceSchema.parse(JSON.parse(String(r.body))));
  }
  putEvidence(input: Evidence): void {
    const item = evidenceSchema.parse(input); const old = this.evidence(item.id);
    if (old) { if (JSON.stringify(old) !== JSON.stringify(item)) throw new Error('Evidence is immutable'); return; }
    this.db.prepare('INSERT INTO evidence VALUES(?,?,?,?)').run(item.id, item.taskId, item.createdAt, JSON.stringify(item));
  }
  citations(id: string, revision: number): FactCitation[] {
    return factCitationsSchema.parse(this.db.prepare('SELECT fact_index,evidence_id,fact_digest,evidence_digest FROM fact_citations WHERE experience_id=? AND revision=? ORDER BY fact_index,evidence_id')
      .all(id, revision).map((r) => ({ factIndex: r.fact_index, evidenceId: r.evidence_id, factDigest: r.fact_digest, evidenceDigest: r.evidence_digest })));
  }
  cleanEvidenceWithRetention(before: string): { removedEventSummaries: number; removedUnreferencedSources: number } {
    return this.transaction(() => {
      const removedEventSummaries = Number(this.db.prepare('DELETE FROM events WHERE created_at < ?').run(before).changes);
      const removedUnreferencedSources = Number(this.db.prepare(`DELETE FROM evidence WHERE created_at < ?
        AND NOT EXISTS (SELECT 1 FROM fact_citations WHERE evidence_id=evidence.id)
        AND NOT EXISTS (SELECT 1 FROM learning_job_sources WHERE evidence_id=evidence.id)`).run(before).changes);
      return { removedEventSummaries, removedUnreferencedSources };
    });
  }
  cleanEvidence(before: string): number { return this.cleanEvidenceWithRetention(before).removedEventSummaries; }
  transaction<T>(fn: () => T): T {
    this.db.exec('SAVEPOINT evolve_transaction');
    try { const result = fn(); this.db.exec('RELEASE evolve_transaction'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO evolve_transaction; RELEASE evolve_transaction'); throw error; }
  }
  assertOwnerSessionLearningAllowed(repoId: string, sessionId: string): void {
    if (this.ownerContextSessions.has(repoId + ':' + sessionId)) throw new OwnerInputError('owner_context_only');
    for (const marker of this.ownerInputs.markers(repoId)) {
      if (marker.mode !== 'context_only' || marker.sessionId !== sessionId || !marker.taskId) continue;
      const task = this.task(marker.taskId);
      if (task?.state === 'open' && this.ownerInputs.classification(task) === 'context_only') throw new OwnerInputError('owner_context_only');
    }
  }
  assertLearningAllowed(task: Task): void {
    if (this.ownerInputs.classification(task) === 'context_only') throw new OwnerInputError('owner_context_only');
    this.assertOwnerSessionLearningAllowed(task.scope.repoId, task.sessionId);
  }
  close(): void { this.ownerInputs.close(); this.db.close(); }
}
