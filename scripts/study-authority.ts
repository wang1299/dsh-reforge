/** One fixed authority per paid study. Fixture authorities can never mint a live-network lease. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { digest } from '../src/domain.js';
import { StudyCostLedger, studyCostPolicy, type StudyCostBinding } from './study-cost-ledger.js';
import { makeStudyDirectory, ownedStudyPath, studyRepository } from './study-owned-path.js';

export const liveStudyAuthorityRoot = join(studyRepository, '.probe-work/t065-benefit-live');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.object({ studyId: z.string().uuid(), planDigest: hash }).strict();
const locatorSchema = z.object({ schema: z.literal(1), scope: z.enum(['live', 'fixture']), authorityRoot: z.string(),
  root: z.string(), binding: bindingSchema, expiresAt: z.string().datetime() }).strict();
const approvalSchema = z.object({ schema: z.literal(1), scope: z.enum(['live', 'fixture']), id: z.string().uuid(),
  relativeRoot: z.string().regex(/^preparations\/[A-Za-z0-9_-]+$/), binding: bindingSchema,
  cap: z.number().int().min(1).max(studyCostPolicy.maxCap), acknowledgedPaidCalls: z.literal(true) }).strict();
export type StudyPlanLocator = z.infer<typeof locatorSchema>;
export interface StudyAuthorizationLease { readonly scope: 'live' | 'fixture' }
interface LeaseState { authority: StudyAuthority; locator: StudyPlanLocator; ledger: StudyCostLedger; approvalDigest: string }
const leases = new WeakMap<StudyAuthorizationLease, LeaseState>();
async function privateJson(path: string, maxBytes = 32768) {
  await ownedStudyPath(path); const stat = await lstat(path); assert(stat.isFile() && stat.size > 0 && stat.size <= maxBytes);
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function writeExclusiveStudyJson(path: string, value: unknown): Promise<void> {
  await ownedStudyPath(path, true); const fd = await open(path, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(value, null, 2) + '\n'); await fd.sync(); } finally { await fd.close(); }
}
export class StudyAuthority {
  private constructor(readonly root: string, readonly scope: 'live' | 'fixture') {
    assert.equal(root, resolve(root)); if (scope === 'live') assert.equal(root, resolve(liveStudyAuthorityRoot));
    else {
      const child = relative(resolve(liveStudyAuthorityRoot), root);
      assert(child && child !== '.' && (child === '..' || child.startsWith('..' + sep)), 'Fixture authority must be outside the live authority tree');
    }
  }
  static live() { return new StudyAuthority(resolve(liveStudyAuthorityRoot), 'live'); }
  static fixture(root: string) { return new StudyAuthority(resolve(root), 'fixture'); }
  get approvalPath() { return join(this.root, 'approval-v1.json'); }
  private checkLocator(input: StudyPlanLocator): StudyPlanLocator {
    const locator = locatorSchema.parse(input); assert.equal(locator.scope, this.scope); assert.equal(locator.authorityRoot, this.root);
    assert.match(relative(this.root, locator.root).split(sep).join('/'), /^preparations\/[A-Za-z0-9_-]+$/);
    assert.equal(locator.root, resolve(locator.root)); return locator;
  }
  async initialize(): Promise<void> { await makeStudyDirectory(this.root); await makeStudyDirectory(join(this.root, 'preparations')); }
  async register(locator: StudyPlanLocator): Promise<void> {
    this.checkLocator(locator); await ownedStudyPath(locator.root);
    await writeExclusiveStudyJson(join(locator.root, 'locator.json'), locator);
  }
  async locate(root: string): Promise<StudyPlanLocator> {
    assert.match(relative(this.root, resolve(root)).split(sep).join('/'), /^preparations\/[A-Za-z0-9_-]+$/);
    const locator = this.checkLocator(locatorSchema.parse(await privateJson(join(root, 'locator.json'))));
    assert.equal(locator.root, resolve(root)); return locator;
  }
  async approve(locator: StudyPlanLocator, cap: number, paidAcknowledgement: boolean, verifyPlan: () => Promise<void>) {
    this.checkLocator(locator); assert.equal(paidAcknowledgement, true); assert(Date.parse(locator.expiresAt) > Date.now(), 'Plan expired');
    z.number().int().min(1).max(studyCostPolicy.maxCap).parse(cap); await verifyPlan();
    const relativeRoot = relative(this.root, locator.root).split(sep).join('/');
    let approval: z.infer<typeof approvalSchema>;
    try {
      await lstat(this.approvalPath); approval = approvalSchema.parse(await privateJson(this.approvalPath));
      assert.equal(approval.scope, this.scope); assert.equal(approval.relativeRoot, relativeRoot); assert.deepEqual(approval.binding, locator.binding); assert.equal(approval.cap, cap);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      approval = approvalSchema.parse({ schema: 1, scope: this.scope, id: randomUUID(), relativeRoot, binding: locator.binding, cap, acknowledgedPaidCalls: true });
      await writeExclusiveStudyJson(this.approvalPath, approval);
    }
    const ledger = StudyCostLedger.open(locator.root, locator.binding);
    try {
      if (ledger.state.phase === 'unapproved') ledger.approve(locator.binding, cap, digest(JSON.stringify(approval)));
      assert.equal(ledger.state.phase, 'prepared', 'A started study cannot be authorized again'); assert.equal(ledger.state.cap, cap);
      assert.equal(ledger.state.approvalDigest, digest(JSON.stringify(approval))); return ledger.summary;
    } finally { ledger.close(); }
  }
  async openApproved(locator: StudyPlanLocator, verifyPlan: () => Promise<void>) {
    this.checkLocator(locator); assert(Date.parse(locator.expiresAt) > Date.now(), 'Plan expired'); await verifyPlan();
    const approval = approvalSchema.parse(await privateJson(this.approvalPath));
    assert.equal(approval.scope, this.scope); assert.equal(approval.relativeRoot, relative(this.root, locator.root).split(sep).join('/')); assert.deepEqual(approval.binding, locator.binding);
    const ledger = StudyCostLedger.open(locator.root, locator.binding);
    try {
      assert.equal(ledger.state.phase, 'prepared', 'Only an unstarted approved study may start');
      assert.equal(ledger.state.cap, approval.cap); const approvalDigest = digest(JSON.stringify(approval)); assert.equal(ledger.state.approvalDigest, approvalDigest);
      const lease = Object.freeze({ scope: this.scope }); leases.set(lease, { authority: this, locator: structuredClone(locator), ledger, approvalDigest });
      return { ledger, lease };
    } catch (error) { ledger.close(); throw error; }
  }
}
export async function requireStudyLease(lease: StudyAuthorizationLease, ledger: StudyCostLedger, binding: StudyCostBinding, scope: 'live' | 'fixture'): Promise<void> {
  const state = leases.get(lease); assert(state && state.ledger === ledger && lease.scope === scope, 'A genuine study lease is required');
  assert.deepEqual(state.locator.binding, binding); assert(Date.parse(state.locator.expiresAt) > Date.now(), 'Plan expired');
  const approval = approvalSchema.parse(await privateJson(state.authority.approvalPath));
  assert.equal(digest(JSON.stringify(approval)), state.approvalDigest); assert.equal(ledger.root, state.locator.root);
  assert(['prepared', 'started'].includes(ledger.state.phase)); assert.equal(ledger.state.cap, approval.cap); assert.equal(ledger.state.approvalDigest, state.approvalDigest);
}
