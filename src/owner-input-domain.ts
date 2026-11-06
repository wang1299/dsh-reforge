import { z } from 'zod';
import { digest, hashSchema, idSchema, taskSchema, type Task } from './domain.js';
import { applicabilityContractSchema } from './applicability.js';
import { projectFactRequestSchema, projectSchemaPath } from './project-facts.js';

export const ownerInputPolicy = { version: 'owner-task-input-v1', maxRules: 64, maxReceipts: 128, maxMessages: 4096,
  maxPreviews: 64, previewMs: 120000, maxTaskText: 2000, maxSummary: 256 } as const;
export const ownerGoals = ['repair_behavior', 'validate_payload', 'change_contract', 'present_ui', 'generate_docs'] as const;
export const ownerGoalLabels: Record<(typeof ownerGoals)[number], string> = { repair_behavior: '修复代码行为', validate_payload: '修复输入校验',
  change_contract: '修改接口契约', present_ui: '调整界面展示', generate_docs: '编写说明文档' };
export const ownerGoalSchema = z.enum(ownerGoals);
export const ownerFactNames = ['field_required', 'field_nullable', 'field_type'] as const;
const fieldType = z.enum(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'union']);
export const ownerFactsSchema = z.object({ field_required: z.boolean(), field_nullable: z.boolean(), field_type: fieldType }).strict();
const contract = applicabilityContractSchema.refine(value => value.excludes.length === 0 && value.requires.length >= 1
  && value.requires.length <= 3 && value.requires.every(c => ownerFactNames.some(f => f === c.field) && c.oneOf.length === 1
    && (c.field === 'field_type' ? fieldType.safeParse(c.oneOf[0]).success : typeof c.oneOf[0] === 'boolean')));
export const ownerRuleSchema = z.object({ schemaVersion: z.literal(1), repoId: hashSchema, experienceId: idSchema,
  experienceRevision: z.number().int().positive(), revision: z.number().int().positive(), enabled: z.boolean(),
  path: projectSchemaPath, property: projectFactRequestSchema.shape.property, declaredFromDigest: hashSchema,
  allowedGoals: z.array(ownerGoalSchema).min(1).max(5).refine(v => new Set(v).size === v.length), contract,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export type OwnerRule = z.infer<typeof ownerRuleSchema>;
export const ownerMarkerSchema = z.object({ schemaVersion: z.literal(1), repoId: hashSchema, requestId: idSchema, previewId: idSchema, messageId: z.string().min(1).max(200),
  hostRunId: idSchema, ownerPid: z.number().int().positive(), sessionId: z.string().min(1).max(128), scopeKey: hashSchema,
  requestDigest: hashSchema, mode: z.enum(['context_only', 'automatic']), taskId: idSchema.nullable(), taskIdentity: hashSchema.nullable(),
  turn: z.number().int().positive().nullable(), createdAt: z.string().datetime() }).strict().refine(v =>
    (v.taskId === null) === (v.taskIdentity === null) && (v.taskId === null) === (v.turn === null));
export type OwnerMarker = z.infer<typeof ownerMarkerSchema>;
export const ownerReceiptSchema = z.object({ schemaVersion: z.literal(1), repoId: hashSchema, id: idSchema,
  previewId: idSchema, hostRunId: idSchema, submissionDigest: hashSchema, messageId: z.string().min(1).max(200), sessionId: z.string().min(1).max(128),
  path: projectSchemaPath, property: projectFactRequestSchema.shape.property, sha256: hashSchema, goal: ownerGoalSchema,
  rulesRevision: z.number().int().nonnegative(), phase: z.enum(['reserved', 'submitted', 'bound', 'ended', 'blocked', 'unknown']),
  reason: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/), taskId: idSchema.nullable(), facts: ownerFactsSchema.nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), expiresAt: z.number().int().positive() }).strict();
export type OwnerReceipt = z.infer<typeof ownerReceiptSchema>;
export class OwnerInputError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function ownerTaskIdentity(task: Task): string {
  const { state: _state, ...identity } = taskSchema.parse(task); return digest(JSON.stringify(identity));
}
export interface OwnerRulesSnapshot { revision: number; rules: OwnerRule[] }
