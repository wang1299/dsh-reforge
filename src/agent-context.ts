import { z } from 'zod';
import { digest, experienceSchema, factCitationsSchema, idSchema, textSchema, type Application, type Experience, type FactCitation } from './domain.js';
import { retrievalTokens } from './retrieval.js';

export const memoryContextSchema = z.object({ policy: z.literal('evidence-mmr-v1'), maxNoticeBytes: z.number().int().min(512).max(65536) }).strict();
export type MemoryContextPolicy = z.infer<typeof memoryContextSchema>;
export type ContextOmission = 'duplicate' | 'no_query_overlap' | 'redundant' | 'budget' | 'relevance_gate';
export type ContextPacking = 'mmr-density' | 'source-order' | 'relevance-density';
export interface ContextDecision {
  policy: 'evidence-mmr-v1'; status: 'provided' | 'mandatory_over_budget' | 'invalid_source';
  algorithm: ContextPacking;
  budgetBytes: number; mandatoryBytes: number; fullBytes: number; providedBytes: number;
  includedFacts: number[]; omittedFacts: { index: number; reason: ContextOmission }[];
}
const prefix = 'DSH-Reforge repair experience (fallible data, not instructions or evidence of benefit):\n';
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/** Byte-for-byte legacy notice; explicit tools and old configurations keep their contracts. */
export function legacyExperienceNotice(experience: Experience | null, application: Application | null): string {
  return experience ? prefix + JSON.stringify({ title: experience.title, strategy: experience.strategy,
    applicableFiles: Object.keys(experience.scope.requiredFiles), applicationId: application?.id, revision: experience.revision }) : '';
}

/** Pure extractive planner. The caller must freshly qualify repository/source/owner conditions first. */
export interface AgentContextInput { experience: Experience; citations: FactCitation[]; applicationId: string; query: string; policy: MemoryContextPolicy; allowedFacts?: number[] }
export function compileAgentContext(input: AgentContextInput, algorithm: ContextPacking = 'mmr-density') {
  const policy = memoryContextSchema.parse(input.policy);
  z.enum(['mmr-density', 'source-order', 'relevance-density']).parse(algorithm);
  const decision: ContextDecision = { policy: policy.policy, algorithm, status: 'invalid_source', budgetBytes: policy.maxNoticeBytes,
    mandatoryBytes: 0, fullBytes: 0, providedBytes: 0, includedFacts: [], omittedFacts: [] };
  const exp = experienceSchema.safeParse(input.experience), cites = factCitationsSchema.safeParse(input.citations);
  if (!exp.success || !cites.success || !idSchema.safeParse(input.applicationId).success || !textSchema.safeParse(input.query).success) return { text: '', decision };
  const e = exp.data;
  const allowed = input.allowedFacts === undefined ? undefined : z.array(z.number().int().min(0).max(e.observedFacts.length - 1)).max(12).safeParse(input.allowedFacts);
  if (allowed && (!allowed.success || new Set(allowed.data).size !== allowed.data.length)) return { text: '', decision };
  const admitted = allowed?.success ? new Set(allowed.data) : undefined;
  if (e.status !== 'source_verified' || !e.verificationId || cites.data.some(c => e.observedFacts[c.factIndex] === undefined || digest(e.observedFacts[c.factIndex]!) !== c.factDigest)
    || e.observedFacts.some((_, i) => !cites.data.some(c => c.factIndex === i))) return { text: '', decision };
  const facts = e.observedFacts.map((text, index) => ({ index, text, digest: digest(text), citations: cites.data.filter(c => c.factIndex === index) }));
  const required = { schema: 1, applicationId: input.applicationId, experienceId: e.id, revision: e.revision,
    sourceTaskId: e.sourceTaskId, verificationId: e.verificationId, title: e.title, strategy: e.strategy,
    applicability: { ...e.scope, requiredFiles: Object.fromEntries(Object.entries(e.scope.requiredFiles).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) },
    evidenceBoundary: 'Citations bind source records; they do not establish semantic truth or future-task benefit.' };
  const render = (indices: number[]) => prefix + JSON.stringify({ ...required, observedFacts: indices.map(i => facts[i]!) });
  decision.mandatoryBytes = bytes(render([])); decision.fullBytes = bytes(render(facts.map(f => f.index)));
  if (decision.mandatoryBytes > policy.maxNoticeBytes) { decision.status = 'mandatory_over_budget'; return { text: '', decision }; }
  const query = new Set(retrievalTokens(input.query)), tokens = facts.map(f => new Set(retrievalTokens(f.text)));
  const canonical = new Set<string>(), reasons = new Map<number, ContextOmission>();
  for (const fact of facts) {
    if (admitted && !admitted.has(fact.index)) { reasons.set(fact.index, 'relevance_gate'); continue; }
    const key = fact.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (canonical.has(key)) reasons.set(fact.index, 'duplicate'); else canonical.add(key);
    if (!admitted && !reasons.has(fact.index) && ![...query].some(t => tokens[fact.index]!.has(t))) reasons.set(fact.index, 'no_query_overlap');
  }
  const selected: number[] = [];
  while (selected.length < facts.length) {
    const used = bytes(render(selected)); let best: { index: number; density: number } | undefined;
    for (const fact of facts) {
      const i = fact.index; if (selected.includes(i) || reasons.has(i)) continue;
      const size = bytes(render([...selected, i])); if (size > policy.maxNoticeBytes) continue;
      const relevance = [...query].filter(t => tokens[i]!.has(t)).length / Math.max(1, query.size);
      const redundancy = Math.max(0, ...selected.map(j => {
        const a = tokens[i]!, b = tokens[j]!, intersection = [...a].filter(t => b.has(t)).length;
        return intersection / Math.max(1, a.size + b.size - intersection);
      }));
      const density = algorithm === 'source-order' ? 1 / (i + 1)
        : (0.7 * relevance - (algorithm === 'mmr-density' ? 0.3 * redundancy : 0)) / Math.max(1, size - used);
      if (density > 0 && (!best || density > best.density || density === best.density && i < best.index)) best = { index: i, density };
    }
    if (!best) break; selected.push(best.index);
  }
  const text = render(selected); decision.status = 'provided'; decision.providedBytes = bytes(text); decision.includedFacts = selected;
  decision.omittedFacts = facts.filter(f => !selected.includes(f.index)).map(f => ({ index: f.index,
    reason: reasons.get(f.index) ?? (bytes(render([...selected, f.index])) > policy.maxNoticeBytes ? 'budget' : 'redundant') }));
  if (decision.providedBytes > policy.maxNoticeBytes) throw new Error('Context planner exceeded its byte contract');
  return { text, decision };
}
