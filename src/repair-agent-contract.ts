import { z } from 'zod';
import { hashSchema } from './domain.js';

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const repairStepSchema = z.object({ id: key, action: z.enum(['read', 'reproduce', 'patch', 'verify']),
  dependsOn: z.array(key).max(7) }).strict();
export const repairPlanSchema = z.object({ revision: z.number().int().min(0).max(2), steps: z.array(repairStepSchema).min(4).max(8) }).strict();
export const repairStepCallSchema = z.object({ revision: z.number().int().min(1).max(3), stepId: key }).strict();
export const repairReadSchema = repairStepCallSchema.extend({ path: z.literal('target.py') }).strict();
export const repairPatchSchema = repairReadSchema.extend({ expectedDigest: hashSchema, code: z.string().min(1).max(4096) }).strict();
export type RepairStep = z.infer<typeof repairStepSchema>;
export type RepairTool = 'repair_plan' | 'repair_read' | 'repair_patch' | 'repair_check';
export type RepairStatus = 'awaiting_plan' | 'running' | 'needs_replan' | 'accepted' | 'stopped';
export interface RepairFile { code: string; codeDigest: string }
export const repairCheckSchema = z.object({ codeDigest: hashSchema, contractDigest: hashSchema,
  exitCode: z.number().int().nullable(), timedOut: z.boolean(),
  cases: z.array(z.object({ id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,95}$/), status: z.enum(['passed', 'failed', 'error', 'skipped']) }).strict()).min(1).max(16) }).strict();
export type RepairCheck = z.infer<typeof repairCheckSchema>;
/** Host-owned port, not model-supplied functions or permission. Unknown effects must throw. */
export interface RepairWorkspace {
  initialDigest: string; contractDigest: string; expectedCases: string[];
  read(): Promise<RepairFile>;
  patch(expectedDigest: string, code: string): Promise<RepairFile>;
  check(phase: 'reproduce' | 'verify'): Promise<RepairCheck>;
}
/** Only this explicit rejection certifies no write occurred. Other errors stop the run. */
export class RepairRejected extends Error {
  constructor(readonly reason: 'stale_file' | 'invalid_code') { super(reason); }
}

export function validRepairPlan(steps: RepairStep[]): boolean {
  const seen = new Set<string>(); const ancestors = new Map<string, Set<string>>();
  for (const step of steps) {
    if (seen.has(step.id) || new Set(step.dependsOn).size !== step.dependsOn.length || step.dependsOn.some(id => !seen.has(id))) return false;
    const before = new Set(step.dependsOn.flatMap(id => [id, ...ancestors.get(id)!]));
    const contains = (action: RepairStep['action']) => steps.some(s => before.has(s.id) && s.action === action);
    if (step.action === 'patch' && (!contains('read') || !contains('reproduce')) || step.action === 'verify' && !contains('patch')) return false;
    seen.add(step.id); ancestors.set(step.id, before);
  }
  const last = steps.at(-1)!;
  return ['read', 'reproduce', 'patch', 'verify'].every(action => steps.some(s => s.action === action))
    && last.action === 'verify' && ancestors.get(last.id)!.size === steps.length - 1;
}
