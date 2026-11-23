import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import { evidenceSchema, experienceSchema, factCitationsSchema, idSchema, taskSchema, verificationSchema } from './domain.js';
import type { MemoryReviewReader } from './memory-review.js';

/** Uses an already inspected read-only connection; never creates or migrates a store. */
export function memoryReviewReader(db: DatabaseSync): MemoryReviewReader {
  const boundedBody = 'CASE WHEN length(CAST(body AS BLOB)) <= 1048576 THEN body ELSE NULL END AS body';
  function row<T>(table: 'tasks' | 'evidence' | 'verifications', id: string, schema: z.ZodType<T>): T | null {
    const record = db.prepare('SELECT id,' + boundedBody + ' FROM ' + table + ' WHERE id=?').get(idSchema.parse(id));
    if (!record) return null;
    if (typeof record.body !== 'string') throw new Error('Unsupported memory review record size');
    const value = schema.parse(JSON.parse(record.body));
    if ((value as { id: string }).id !== record.id) throw new Error('Invalid memory review record identity');
    return value;
  }
  return {
    task: id => row('tasks', id, taskSchema), evidence: id => row('evidence', id, evidenceSchema),
    verification: id => row('verifications', id, verificationSchema),
    citations: (id, revision) => factCitationsSchema.parse(db.prepare(`SELECT fact_index,evidence_id,fact_digest,evidence_digest
      FROM fact_citations WHERE experience_id=? AND revision=? ORDER BY fact_index,evidence_id LIMIT 37`)
      .all(id, revision).map(r => ({ factIndex: r.fact_index, evidenceId: r.evidence_id, factDigest: r.fact_digest, evidenceDigest: r.evidence_digest }))),
    page(repoId, after, limit) {
      const total = Number(db.prepare("SELECT count(*) AS n FROM experiences WHERE json_extract(body,'$.scope.repoId')=?").get(repoId)!.n);
      const records = db.prepare("SELECT id," + boundedBody + " FROM experiences WHERE json_extract(body,'$.scope.repoId')=? AND id>? ORDER BY id LIMIT ?")
        .all(repoId, after ?? '', limit + 1);
      const experiences = records.slice(0, limit).map(record => {
        if (typeof record.body !== 'string') throw new Error('Unsupported memory review record size');
        const experience = experienceSchema.parse(JSON.parse(record.body));
        if (experience.id !== record.id) throw new Error('Invalid memory review record identity');
        return experience;
      });
      return { total, experiences, more: records.length > limit };
    },
  };
}
