/** Bounded synthetic source-bank state only; never exports a user's product database. */
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Store } from '../src/store.js';
import { digest } from '../src/domain.js';
import { ownedStudyPath } from './study-owned-path.js';
import { writeExclusiveStudyJson } from './study-authority.js';

interface BankSnapshot {
  schema: 1; tasks: ReturnType<Store['tasks']>; evidence: ReturnType<Store['evidenceRecords']>;
  verifications: NonNullable<ReturnType<Store['verification']>>[];
  revisions: { experience: ReturnType<Store['history']>[number]; citations: ReturnType<Store['citations']> }[];
}
const shape = z.object({ schema: z.literal(1), tasks: z.array(z.unknown()).max(3), evidence: z.array(z.unknown()).max(128),
  verifications: z.array(z.unknown()).max(3), revisions: z.array(z.unknown()).max(6) }).strict();
export async function saveStudyBank(store: Store, path: string) {
  const experiences = store.experiences(); assert.equal(experiences.length, 3);
  const snapshot: BankSnapshot = { schema: 1, tasks: store.tasks(), evidence: store.evidenceRecords(),
    verifications: experiences.map(e => store.verification(e.verificationId!)!),
    revisions: experiences.flatMap(e => store.history(e.id).map(revision => ({ experience: revision, citations: store.citations(revision.id, revision.revision) }))) };
  shape.parse(snapshot); assert(Buffer.byteLength(JSON.stringify(snapshot)) <= 524288); await writeExclusiveStudyJson(path, snapshot);
  return { fileDigest: digest(await readFile(path)), experienceDigest: digest(JSON.stringify(experiences)) };
}
export async function restoreStudyBank(path: string, expected: string): Promise<Store> {
  await ownedStudyPath(path); const stat = await lstat(path); assert(stat.isFile() && stat.size <= 524288);
  const bytes = await readFile(path); assert.equal(digest(bytes), expected);
  const snapshot = shape.parse(JSON.parse(bytes.toString('utf8'))) as BankSnapshot; const store = new Store(':memory:');
  try {
    for (const task of snapshot.tasks) store.putTask(task);
    for (const evidence of snapshot.evidence) store.putEvidence(evidence);
    for (const verification of snapshot.verifications) store.putVerification(verification);
    for (const row of snapshot.revisions) store.putExperience(row.experience, row.citations);
    assert.equal(store.experiences().length, 3); return store;
  } catch (error) { store.close(); throw error; }
}
