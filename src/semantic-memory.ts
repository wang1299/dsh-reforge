import { z } from 'zod';
import { hashSchema } from './domain.js';
import { cosine, snapshotEmbeddingPort, type EmbeddingPort } from './embedding.js';
import { compileAgentContext, type AgentContextInput, type ContextDecision } from './agent-context.js';

export const semanticAnchors = {
  repair: 'Repair incorrect program behavior so execution satisfies its contract and tests.',
  nonRepair: 'Write documentation, explain existing code, or change visual appearance without changing program behavior.',
} as const;
export const semanticPolicySchema = z.object({ version: z.literal('local-semantic-v1'), modelDigest: hashSchema,
  minimumDocument: z.number().finite().min(0).max(1), minimumFact: z.number().finite().min(0).max(1),
  intent: z.enum(['none', 'contrastive']), minimumIntentMargin: z.number().finite().min(-2).max(2) }).strict();
export type SemanticPolicy = z.infer<typeof semanticPolicySchema>;
export interface SemanticPort extends EmbeddingPort { readonly modelDigest: string; readonly dimension: number }
export function semanticSnapshotPort(snapshot: unknown, expected: { modelDigest: string; corpusDigest: string; dimension: number }): SemanticPort {
  const port = snapshotEmbeddingPort(snapshot, expected);
  return { modelDigest: expected.modelDigest, dimension: expected.dimension, embed: request => port.embed(request) };
}
export interface SemanticDecision {
  version: 'local-semantic-v1'; status: 'provided' | 'invalid_source' | 'mandatory_over_budget' | 'invalid_vectors' | 'low_similarity' | 'intent_mismatch' | 'no_admitted_facts';
  documentScore: number | null; intentMargin: number | null; facts: { index: number; score: number; admitted: boolean }[];
  budgetBytes: number; mandatoryBytes: number; packing: ContextDecision | null;
}

/** Read-only experiment. Caller must qualify current source/scope/owner before this step; similarity is not proof. */
export function planSemanticMemory(input: AgentContextInput, options: { namespace: string; queryId: string; port: SemanticPort; policy: SemanticPolicy }) {
  const policy = semanticPolicySchema.parse(options.policy);
  const checked = compileAgentContext(input, 'source-order');
  const mandatory = checked.decision.status === 'provided' ? compileAgentContext({ ...input, allowedFacts: [] }, 'source-order') : checked;
  const decision: SemanticDecision = { version: policy.version, status: mandatory.decision.status === 'provided' ? 'invalid_vectors' : mandatory.decision.status,
    documentScore: null, intentMargin: null, facts: [], budgetBytes: mandatory.decision.budgetBytes, mandatoryBytes: mandatory.decision.mandatoryBytes, packing: null };
  if (mandatory.decision.status !== 'provided') return { text: '', decision };
  if (options.port.modelDigest !== policy.modelDigest || !Number.isInteger(options.port.dimension) || options.port.dimension < 1 || options.port.dimension > 4096) return { text: '', decision };
  try {
    const embed = (suffix: string, id: string, text: string, revision = 1) => {
      const vector = options.port.embed({ namespace: options.namespace + '/' + suffix, id, revision, text });
      if (vector.length !== options.port.dimension) throw new Error('Wrong bound dimension');
      return vector;
    };
    const query = embed('query', options.queryId, input.query);
    decision.documentScore = cosine(query, embed('document', input.experience.id, input.experience.title + '\n' + input.experience.strategy, input.experience.revision));
    // Resolve every required vector before admitting anything. Partial caches never provide partial context.
    decision.facts = input.experience.observedFacts.map((text, index) => {
      const score = cosine(query, embed('fact', String(index), text, input.experience.revision));
      return { index, score, admitted: score >= policy.minimumFact && (input.allowedFacts === undefined || input.allowedFacts.includes(index)) };
    });
    if (policy.intent === 'contrastive') decision.intentMargin = cosine(query, embed('intent', 'repair', semanticAnchors.repair))
      - cosine(query, embed('intent', 'nonRepair', semanticAnchors.nonRepair));
    if (decision.documentScore < policy.minimumDocument) { decision.status = 'low_similarity'; return { text: '', decision }; }
    if (decision.intentMargin !== null && decision.intentMargin < policy.minimumIntentMargin) { decision.status = 'intent_mismatch'; return { text: '', decision }; }
    const allowedFacts = decision.facts.filter(fact => fact.admitted).map(fact => fact.index);
    if (!allowedFacts.length) { decision.status = 'no_admitted_facts'; return { text: '', decision }; }
    const result = compileAgentContext({ ...input, allowedFacts }, 'source-order');
    decision.status = result.decision.status;
    // An admitted unit may still not fit or may be an exact duplicate; do not offer strategy-only as semantic success.
    if (decision.status === 'provided' && !result.decision.includedFacts.length) { decision.status = 'no_admitted_facts'; return { text: '', decision }; }
    decision.packing = result.decision;
    return { text: result.text, decision };
  } catch {
    decision.status = 'invalid_vectors'; decision.documentScore = null; decision.intentMargin = null; decision.facts = [];
    return { text: '', decision }; // no raw adapter error, private text, fallback, or effect
  }
}
