import { performance } from 'node:perf_hooks';
import { digest, redact } from './domain.js';
import { prepareTextIndex } from './retrieval-index.js';
import { rankText, retrievalPolicyDigest, retrievalTokens, type TextDocument, type TextMatch } from './retrieval.js';

export const retrievalRuntimePolicy = { version: 1, maxDocuments: 10000, maxTextBytes: 2 * 1024 * 1024,
  maxAttempts: 8, maxCandidates: 5, maxTerms: 6, maxTermLength: 32, maxProjectionBytes: 24 * 1024 } as const;
export interface RuntimeDocument extends TextDocument { revision: number; verificationId: string | null }
export type CacheResult = 'cold' | 'hit' | 'rebuilt' | 'empty' | 'capacity_bypass' | 'legacy';
export interface SearchResult {
  matches: TextMatch[]; cache: CacheResult; generation: number;
  lookupMs: number; buildMs: number | null; queryMs: number;
}
export type CandidateReason = 'source_task' | 'candidate' | 'disabled' | 'missing_or_invalid_source_evidence'
  | 'incomplete_fact_sources' | 'missing_code_condition' | 'different_repository' | 'dependencies_changed'
  | 'code_condition_changed' | 'owner_irrelevant_context' | 'insufficient_anchors' | 'no_title_anchor' | 'low_bm25'
  | 'lower_rank' | 'original_text' | 'owner_accepted_context';
export interface CandidateExplanation {
  id: string; revision: number; title: string; reason: CandidateReason;
  textScore: number | null; combinedScore: number | null; anchors: number | null;
  titleTerms: string[]; strategyTerms: string[];
}
export interface RetrievalAttempt {
  taskId: string; mode: string; completedAt: string; outcome: 'selected' | 'abstained';
  selectedId: string | null; selectedRevision: number | null; applicationId: string | null;
  candidatesConsidered: number; eligibleCount: number; omittedCandidates: number;
  candidates: CandidateExplanation[]; cache: CacheResult; generation: number;
  scopeChecks?: { snapshotPasses: number; conditionPathsChecked: number | null; lifetime: 'request' | 'per-experience' };
  timings: { qualificationMs: number; lookupMs: number; buildMs: number | null; queryMs: number; selectionMs: number; totalMs: number };
}
export interface RetrievalStatus {
  version: 1; lifetime: 'service-instance'; policy: 'bm25-v1'; attempts: RetrievalAttempt[]; omittedAttempts: number;
  cache: { documents: number; builds: number; hits: number; bypasses: number };
}

/** A single eligible-corpus snapshot, scoped by the caller after every qualification pass. */
export class RetrievalRuntime {
  private key: string | null = null;
  private index: ReturnType<typeof prepareTextIndex> | null = null;
  private generation = 0;
  private hits = 0;
  private bypasses = 0;
  private attempts: RetrievalAttempt[] = [];
  private omittedAttempts = 0;
  constructor(private readonly execution: 'reuse' | 'legacy' = 'reuse', readonly scopeReads: 'request' | 'per-experience' = 'request') {}

  search(query: string, documents: readonly RuntimeDocument[], scopeKey: string): SearchResult {
    const lookupStart = performance.now();
    if (this.execution === 'legacy') {
      const queryStart = performance.now(); const matches = rankText(query, [...documents]);
      return { matches, cache: 'legacy', generation: 0, lookupMs: 0, buildMs: null, queryMs: performance.now() - queryStart };
    }
    if (!documents.length) {
      this.key = null; this.index = null;
      return { matches: [], cache: 'empty', generation: this.generation, lookupMs: performance.now() - lookupStart, buildMs: 0, queryMs: 0 };
    }
    // Bound retained state, not the search result set. Oversized banks still use the full legacy scorer.
    const signature = documents.length <= retrievalRuntimePolicy.maxDocuments
      ? JSON.stringify([scopeKey, retrievalPolicyDigest, documents.map(d => [d.id, d.revision, d.verificationId, d.title, d.strategy])]) : null;
    if (signature === null || Buffer.byteLength(signature) > retrievalRuntimePolicy.maxTextBytes) {
      this.key = null; this.index = null; this.bypasses++;
      const lookupMs = performance.now() - lookupStart; const start = performance.now(); const matches = rankText(query, [...documents]);
      return { matches, cache: 'capacity_bypass', generation: this.generation, lookupMs, buildMs: null, queryMs: performance.now() - start };
    }
    const key = digest(signature); const cache: CacheResult = this.key === key ? 'hit' : this.index ? 'rebuilt' : 'cold';
    const lookupMs = performance.now() - lookupStart; let buildMs = 0;
    if (cache === 'hit') this.hits++;
    else {
      const start = performance.now(); const index = prepareTextIndex(documents);
      buildMs = performance.now() - start; this.index = index; this.key = key; this.generation++;
    }
    const queryStart = performance.now(); const matches = this.index!.rank(query);
    return { matches, cache, generation: this.generation, lookupMs, buildMs, queryMs: performance.now() - queryStart };
  }

  record(attempt: RetrievalAttempt): void {
    // Own every nested field so projections or callers cannot rewrite the retained decision.
    const value = structuredClone(attempt); value.candidates = value.candidates.slice(0, retrievalRuntimePolicy.maxCandidates);
    this.attempts.unshift(value);
    while (this.attempts.length > retrievalRuntimePolicy.maxAttempts || Buffer.byteLength(JSON.stringify(this.status())) > retrievalRuntimePolicy.maxProjectionBytes) {
      this.attempts.pop(); this.omittedAttempts++;
    }
  }
  status(): RetrievalStatus {
    return { version: 1, lifetime: 'service-instance', policy: 'bm25-v1', omittedAttempts: this.omittedAttempts,
      cache: { documents: this.index?.size ?? 0, builds: this.generation, hits: this.hits, bypasses: this.bypasses },
      attempts: structuredClone(this.attempts) };
  }
}

/** Terms come from the chosen experience/accepted alias, never from an unmatched private query. */
export function explanationTerms(query: string, title: string, strategy: string): { titleTerms: string[]; strategyTerms: string[] } {
  const q = new Set(retrievalTokens(query));
  const matching = (text: string): string[] => [...new Set(retrievalTokens(text))].filter(token => q.has(token))
    .slice(0, retrievalRuntimePolicy.maxTerms).map(token => redact(token, retrievalRuntimePolicy.maxTermLength));
  return { titleTerms: matching(title), strategyTerms: matching(strategy) };
}
