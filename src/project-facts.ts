import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { digest, relativePath } from './domain.js';
import { assessApplicability, contractSourceRefSchema, type ApplicabilityAssessment, type ContractFacts,
  type ContractSourcePort, type ContractSourceRef } from './applicability.js';

export const projectFactPolicy = { version: 'draft07-explicit-property-v1', maxBytes: 8192, maxProperties: 32,
  fields: ['field_required', 'field_nullable', 'field_type'], goals: ['validate_payload', 'change_contract', 'present_ui', 'generate_docs'] } as const;
const sensitive = /password|secret|credential|token|authorization|api[_-]?key/i;
const propertyName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/).refine(v =>
  !['__proto__', 'constructor', 'prototype'].includes(v) && !sensitive.test(v));
export const projectSchemaPath = relativePath.refine(path => path.endsWith('.schema.json') &&
  path.split('/').every(part => !part.startsWith('.') && part !== 'node_modules' && !sensitive.test(part)));
export const projectFactRequestSchema = contractSourceRefSchema.extend({ path: projectSchemaPath, property: propertyName });
export type ProjectFactRequest = z.infer<typeof projectFactRequestSchema>;
export type TaskBinding = Pick<ContractSourceRef, 'namespace' | 'taskId' | 'revision'>;
const goalSchema = contractSourceRefSchema.omit({ path: true, sha256: true }).extend({ kind: z.enum(projectFactPolicy.goals) });
export type ExplicitTaskGoal = z.infer<typeof goalSchema>;
const typeName = z.enum(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']);
const types = z.union([typeName, z.array(typeName).min(1).max(7).refine(v => new Set(v).size === v.length)]);
const annotation = { title: z.string().max(400).optional(), description: z.string().max(800).optional(), default: z.unknown().optional() };
const propertySchema = z.object({ type: types, ...annotation }).strict();
const schema = z.object({ $schema: z.literal('http://json-schema.org/draft-07/schema#'), type: z.literal('object'),
  properties: z.record(propertyName, propertySchema).refine(v => Object.keys(v).length >= 1 && Object.keys(v).length <= projectFactPolicy.maxProperties),
  required: z.array(propertyName).max(32).refine(v => new Set(v).size === v.length).optional(),
  additionalProperties: z.boolean().optional(), ...annotation }).strict().refine(v =>
  (v.required ?? []).every(name => Object.hasOwn(v.properties, name)));
export interface ProjectFactObservation {
  field: 'field_required' | 'field_nullable' | 'field_type'; value: boolean | string;
  pointer: string; basis: 'listed_in_required' | 'not_listed_in_required' | 'required_keyword_absent' | 'declared_type';
}
export interface ProjectFacts {
  state: 'confirmed' | 'unknown'; bindingVerified: boolean; source: ContractSourceRef | null;
  targetProperty: string | null; observations: ProjectFactObservation[]; context: ContractFacts;
}
function unknown(reason: string, source: ContractSourceRef | null = null, property: string | null = null, bindingVerified = false): ProjectFacts {
  return { state: 'unknown', bindingVerified, source, targetProperty: property, observations: [], context: { facts: new Map(), problems: [reason] } };
}
// Detect overwritten keys, including escaped aliases, after JSON grammar validation.
function duplicateKeys(text: string): boolean {
  const stack: { object: boolean; keys: Set<string>; expectingKey: boolean }[] = [];
  for (const [token] of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g)) {
    const current = stack.at(-1);
    if (token === '{' || token === '[') stack.push({ object: token === '{', keys: new Set(), expectingKey: true });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && current?.object) current.expectingKey = true;
    else if (token === ':' && current?.object) current.expectingKey = false;
    else if (token.startsWith('"') && current?.object && current.expectingKey) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) return true;
      current.keys.add(key);
    }
  }
  return false;
}
/** Source identity/bytes are checked fresh. No source text or annotation value is returned. */
export function projectSchemaFacts(input: unknown, expected: TaskBinding, port: ContractSourcePort): ProjectFacts {
  const parsed = projectFactRequestSchema.safeParse(input);
  if (!parsed.success) return unknown('invalid_project_source_request');
  const { property, ...ref } = parsed.data;
  if (ref.namespace !== expected.namespace || ref.taskId !== expected.taskId || ref.revision !== expected.revision) return unknown('source_binding_mismatch', ref, property);
  let source;
  try { source = port.read(ref); } catch { return unknown('source_unavailable', ref, property); }
  if (!source) return unknown('source_unavailable', ref, property);
  if (source.namespace !== ref.namespace || source.taskId !== ref.taskId || source.revision !== ref.revision || source.path !== ref.path) return unknown('source_binding_mismatch', ref, property);
  if (!Buffer.isBuffer(source.bytes) || source.bytes.length > projectFactPolicy.maxBytes || digest(source.bytes) !== ref.sha256) return unknown('source_size_or_digest_mismatch', ref, property);
  let document: unknown;
  try {
    const text = source.bytes.toString('utf8'); document = JSON.parse(text);
    if (!Buffer.from(text).equals(source.bytes) || duplicateKeys(text)) throw new Error('Invalid bounded JSON');
  } catch { return unknown('invalid_project_source_json', ref, property, true); }
  const artifact = schema.safeParse(document);
  if (!artifact.success) return unknown('invalid_or_unsupported_schema', ref, property, true);
  if (!Object.hasOwn(artifact.data.properties, property)) return unknown('target_property_not_declared', ref, property, true);
  const target = artifact.data.properties[property]!;
  const declared = Array.isArray(target.type) ? target.type : [target.type]; const nonNull = declared.filter(t => t !== 'null');
  const pointer = '/properties/' + property + '/type'; const required = artifact.data.required;
  const observations: ProjectFactObservation[] = [
    { field: 'field_required', value: required?.includes(property) ?? false, pointer: required ? '/required' : '',
      basis: !required ? 'required_keyword_absent' : required.includes(property) ? 'listed_in_required' : 'not_listed_in_required' },
    { field: 'field_nullable', value: declared.includes('null'), pointer, basis: 'declared_type' },
    { field: 'field_type', value: nonNull.length === 0 ? 'null' : nonNull.length === 1 ? nonNull[0]! : 'union', pointer, basis: 'declared_type' },
  ];
  return { state: 'confirmed', bindingVerified: true, source: ref, targetProperty: property, observations,
    context: { problems: [], facts: new Map(observations.map(o => [o.field, { values: [o.value], sources: [{ ...ref }] }])) } };
}
function noLinks(input: string): void {
  const full = resolve(input); const root = parse(full).root; let current = root;
  for (const part of full.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Link not supported');
  }
}
/** Bounded regular-file adapter. The explicitly chosen root/caller remain trusted. */
export function projectFilePort(rootInput: string, binding: TaskBinding): ContractSourcePort {
  const root = resolve(rootInput);
  return { read(ref) {
    if (!projectSchemaPath.safeParse(ref.path).success || ref.namespace !== binding.namespace || ref.taskId !== binding.taskId || ref.revision !== binding.revision) return null;
    let fd: number | undefined;
    try {
      const full = join(root, ref.path); noLinks(full);
      const rel = relative(realpathSync(root), realpathSync(full));
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) return null;
      const before = lstatSync(full); if (!before.isFile() || before.nlink !== 1 || before.size > projectFactPolicy.maxBytes) return null;
      fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > projectFactPolicy.maxBytes) return null;
      const buffer = Buffer.alloc(projectFactPolicy.maxBytes + 1); let length = 0;
      while (length < buffer.length) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (!n) break; length += n; }
      if (length > projectFactPolicy.maxBytes || lstatSync(full).isSymbolicLink()) return null;
      return { ...binding, path: ref.path, bytes: buffer.subarray(0, length) };
    } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
  } };
}
const experimentalCandidateSchema = z.object({ targetProperty: propertyName, allowedGoals: z.array(z.enum(projectFactPolicy.goals)).min(1).max(4)
  .refine(v => new Set(v).size === v.length), contract: z.unknown() }).strict();
export interface ProjectCandidateAssessment extends ApplicabilityAssessment {
  goalCheck: { state: 'not_checked' | 'confirmed' | 'contradicted' | 'unknown'; kind: string | null; source: 'explicit_owner_input' | null };
}
/** The caller must obtain goal input from the owner; this function is not authentication or NLP. */
export function assessProjectCandidate(candidateInput: unknown, facts: ProjectFacts, expected: TaskBinding, goalInput?: unknown, useGoal = false): ProjectCandidateAssessment {
  const candidate = experimentalCandidateSchema.safeParse(candidateInput);
  const goalCheck: ProjectCandidateAssessment['goalCheck'] = { state: 'not_checked', kind: null, source: null };
  if (!candidate.success) return { state: 'insufficient_information', reason: 'invalid_project_candidate', checks: [], contractDigest: null, goalCheck };
  let base = assessApplicability(candidate.data.contract, facts.context);
  if (!facts.context.problems.length && candidate.data.targetProperty !== facts.targetProperty) base = { ...base, state: 'not_applicable', reason: 'target_property_mismatch' };
  if (!useGoal) return { ...base, goalCheck };
  const goal = goalSchema.safeParse(goalInput);
  if (!goal.success || goal.data.namespace !== expected.namespace || goal.data.taskId !== expected.taskId || goal.data.revision !== expected.revision) {
    return { ...base, state: base.state === 'not_applicable' ? 'not_applicable' : 'insufficient_information',
      reason: base.state === 'not_applicable' ? base.reason : 'explicit_goal_missing_or_unbound', goalCheck: { state: 'unknown', kind: null, source: null } };
  }
  const matches = candidate.data.allowedGoals.includes(goal.data.kind);
  return { ...base, ...(!matches ? { state: 'not_applicable' as const, reason: 'explicit_goal_mismatch' } : {}),
    goalCheck: { state: matches ? 'confirmed' : 'contradicted', kind: goal.data.kind, source: 'explicit_owner_input' } };
}
