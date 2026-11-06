import { z } from 'zod';
import { digest, hashSchema, relativePath } from './domain.js';
import type { HybridMatch } from './hybrid-retrieval.js';

const identifier = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_/-]+$/);
const field = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).refine(value =>
  !['constructor', 'prototype'].includes(value) && !/(password|secret|api_key|access_token|credential|authorization)/i.test(value));
const scalar = z.union([z.boolean(), z.number().finite().min(-1e9).max(1e9), z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)]);
type Scalar = z.infer<typeof scalar>;
const condition = z.object({ field, oneOf: z.array(scalar).min(1).max(8) }).strict();
export const applicabilityContractSchema = z.object({ schemaVersion: z.literal(1), requires: z.array(condition).max(8),
  excludes: z.array(condition).max(4) }).strict().refine(c => c.requires.length + c.excludes.length > 0)
  .refine(c => new Set([...c.requires, ...c.excludes].map(r => r.field)).size === c.requires.length + c.excludes.length);
export type ApplicabilityContract = z.infer<typeof applicabilityContractSchema>;
export const contractSourceRefSchema = z.object({ namespace: identifier, taskId: identifier, revision: z.number().int().positive(),
  path: relativePath, sha256: hashSchema }).strict();
export type ContractSourceRef = z.infer<typeof contractSourceRefSchema>;
export interface ContractSourcePort {
  read(ref: ContractSourceRef): { namespace: string; taskId: string; revision: number; path: string; bytes: Buffer } | null;
}
const taskContractSchema = z.object({ schemaVersion: z.literal(1), facts: z.record(field, scalar)
  .refine(facts => Object.keys(facts).length <= 24) }).strict();
interface Fact { values: Scalar[]; sources: ContractSourceRef[] }
export interface ContractFacts { facts: ReadonlyMap<string, Fact>; problems: readonly string[] }
export type ApplicabilityState = 'applicable' | 'not_applicable' | 'insufficient_information';
export interface ApplicabilityAssessment { state: ApplicabilityState; reason: string; contractDigest: string | null;
  checks: { field: string; rule: 'requires' | 'excludes'; expected: Scalar[]; observed: Scalar[];
    result: 'confirmed' | 'contradicted' | 'missing' | 'conflicting'; sources: ContractSourceRef[] }[] }

// JSON.parse validates grammar first; this bounded scan detects overwritten keys,
// including escaped aliases, without interpreting source strings as code.
function duplicateJsonKeys(text: string): boolean {
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
/** Read a fresh, explicitly bound task contract. Integrity errors invalidate the bundle. */
export function readContractFacts(input: unknown, expected: { namespace: string; taskId: string; revision: number }, port: ContractSourcePort): ContractFacts {
  const parsed = z.array(contractSourceRefSchema).min(1).max(4).safeParse(input);
  if (!parsed.success) return { facts: new Map(), problems: ['invalid_source_references'] };
  const facts = new Map<string, Fact>(); const problems: string[] = []; const paths = new Set<string>();
  for (const ref of parsed.data) {
    if (ref.namespace !== expected.namespace || ref.taskId !== expected.taskId || ref.revision !== expected.revision || paths.has(ref.path)) {
      problems.push('source_binding_mismatch'); continue;
    }
    paths.add(ref.path);
    let source;
    try { source = port.read(ref); } catch { problems.push('source_unavailable'); continue; }
    if (!source) { problems.push('source_unavailable'); continue; }
    if (source.namespace !== ref.namespace || source.taskId !== ref.taskId || source.revision !== ref.revision || source.path !== ref.path) {
      problems.push('source_binding_mismatch'); continue;
    }
    if (!Buffer.isBuffer(source.bytes) || source.bytes.length > 8192 || digest(source.bytes) !== ref.sha256) { problems.push('source_size_or_digest_mismatch'); continue; }
    try {
      const text = source.bytes.toString('utf8'); const raw: unknown = JSON.parse(text);
      if (!Buffer.from(text).equals(source.bytes) || duplicateJsonKeys(text)) throw new Error('Invalid JSON bytes or duplicate keys');
      const contract = taskContractSchema.parse(raw);
      for (const [name, value] of Object.entries(contract.facts)) {
        const old = facts.get(name) ?? { values: [], sources: [] };
        if (!old.values.some(previous => previous === value)) old.values.push(value);
        old.sources.push({ ...ref }); facts.set(name, old);
      }
    } catch { problems.push('invalid_source_contract'); }
  }
  return { facts: problems.length ? new Map() : facts, problems: [...new Set(problems)] };
}
export function assessApplicability(input: unknown, context: ContractFacts): ApplicabilityAssessment {
  const parsed = applicabilityContractSchema.safeParse(input);
  if (!parsed.success) return { state: 'insufficient_information', reason: 'missing_or_invalid_applicability_contract', contractDigest: null, checks: [] };
  const contractDigest = digest(JSON.stringify(parsed.data));
  if (context.problems.length) return { state: 'insufficient_information', reason: context.problems.join(','), contractDigest, checks: [] };
  const checks: ApplicabilityAssessment['checks'] = (['requires', 'excludes'] as const).flatMap(rule => parsed.data[rule].map(check => {
    const fact = context.facts.get(check.field); const observed = fact?.values ?? [];
    const result = !observed.length ? 'missing' : observed.length !== 1 ? 'conflicting'
      : (check.oneOf.some(v => v === observed[0]) === (rule === 'requires')) ? 'confirmed' : 'contradicted';
    return { field: check.field, rule, expected: [...check.oneOf], observed: [...observed], result,
      sources: (fact?.sources ?? []).map(ref => ({ ...ref })) };
  }));
  if (checks.some(c => c.result === 'contradicted')) return { state: 'not_applicable', reason: 'condition_contradicted', contractDigest, checks };
  if (checks.some(c => c.result === 'missing' || c.result === 'conflicting')) return { state: 'insufficient_information', reason: 'condition_missing_or_conflicting', contractDigest, checks };
  return { state: 'applicable', reason: 'all_conditions_confirmed', contractDigest, checks };
}
export const applicabilityPolicy = { version: 'bound-contracts-v1', minimumScore: 0.5, minimumMargin: 0.025, topK: 3,
  contractsOnly: 'unique-confirmed-unknown-others-allowed', gate: 'original-next-margin/higher-unknown-blocks' } as const;
export const applicabilityPolicyDigest = digest(JSON.stringify(applicabilityPolicy));
export interface ContractCandidate { id: string; assessment: ApplicabilityAssessment }
export function selectContractsOnly(candidates: ContractCandidate[]) {
  const applicable = candidates.filter(c => c.assessment.state === 'applicable');
  return applicable.length === 1 ? { selected: applicable[0]!.id, state: 'applicable' as ApplicabilityState, reason: 'unique_confirmed_contract' }
    : { selected: null, state: (candidates.length > 0 && candidates.every(c => c.assessment.state === 'not_applicable') ? 'not_applicable' : 'insufficient_information') as ApplicabilityState,
      reason: applicable.length > 1 ? 'multiple_confirmed_contracts' : 'no_confirmed_contract' };
}
/** Same dense ranks/thresholds, with no label input or re-ranking by expected answer. */
export function selectWithContracts(ranked: HybridMatch[], candidates: ContractCandidate[]) {
  if (new Set(ranked.map(r => r.id)).size !== ranked.length || ranked.some((r, i) => !Number.isFinite(r.score) || r.score < 0 || r.score > 1
    || (i > 0 && r.score > ranked[i - 1]!.score))) {
    return { selected: null, state: 'insufficient_information' as ApplicabilityState, reason: 'invalid_ranking' };
  }
  const top = ranked.slice(0, applicabilityPolicy.topK);
  for (const [index, match] of top.entries()) {
    const assessment = candidates.find(c => c.id === match.id)?.assessment;
    if (assessment?.state === 'not_applicable') continue;
    if (assessment?.state !== 'applicable') return { selected: null, state: 'insufficient_information' as ApplicabilityState, reason: 'higher_ranked_unknown' };
    if (match.score < applicabilityPolicy.minimumScore) return { selected: null, state: 'insufficient_information' as ApplicabilityState, reason: 'low_score' };
    // The competitor is from the original whole rank, including rank4 for rank3.
    if (match.score - (ranked[index + 1]?.score ?? 0) < applicabilityPolicy.minimumMargin) {
      return { selected: null, state: 'insufficient_information' as ApplicabilityState, reason: 'ambiguous_original_margin' };
    }
    return { selected: match.id, state: 'applicable' as ApplicabilityState, reason: 'confirmed_contract_and_dense_gate' };
  }
  return { selected: null, state: (top.length ? 'not_applicable' : 'insufficient_information') as ApplicabilityState, reason: top.length ? 'top3_not_applicable' : 'empty_bank' };
}
