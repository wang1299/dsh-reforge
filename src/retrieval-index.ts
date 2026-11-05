import { digest } from './domain.js';
import { retrievalPolicy, retrievalPolicyDigest, retrievalTokens, type TextDocument, type TextMatch } from './retrieval.js';

export interface ExplainedMatch extends TextMatch {
  matchedTerms: string[];
  titleTerms: string[];
  strategyTerms: string[];
  strategyAnchors: number;
  strategyCoverage: number;
}

/** Immutable snapshot. Rebuild after changing documents or their eligibility; never share across scopes. */
export function prepareTextIndex(documents: readonly TextDocument[]): {
  readonly size: number;
  rank(query: string): TextMatch[];
  explain(query: string): ExplainedMatch[];
} {
  if (new Set(documents.map(d => d.id)).size !== documents.length) throw new Error('Duplicate retrieval document');
  const df = new Map<string, number>();
  const indexed = documents.map(d => {
    const title = retrievalTokens(d.title); const strategy = retrievalTokens(d.strategy); const tf = new Map<string, number>();
    for (const token of title) tf.set(token, (tf.get(token) ?? 0) + retrievalPolicy.titleWeight);
    for (const token of strategy) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    return { id: d.id, title: new Set(title), strategy: new Set(strategy), tf,
      length: title.length * retrievalPolicy.titleWeight + strategy.length };
  });
  const averageLength = indexed.reduce((n, d) => n + d.length, 0) / (indexed.length || 1);
  const postings = new Map<string, { index: number; contribution: number; title: boolean; strategy: boolean }[]>();
  indexed.forEach((d, index) => {
    for (const [token, frequency] of d.tf) {
      const idf = Math.log(1 + (indexed.length - df.get(token)! + 0.5) / (df.get(token)! + 0.5));
      const contribution = idf * frequency * (retrievalPolicy.k1 + 1)
        / (frequency + retrievalPolicy.k1 * (1 - retrievalPolicy.b + retrievalPolicy.b * d.length / averageLength));
      const entries = postings.get(token) ?? [];
      entries.push({ index, contribution, title: d.title.has(token), strategy: d.strategy.has(token) });
      postings.set(token, entries);
    }
  });
  const evaluate = (query: string, explain: boolean): ExplainedMatch[] => {
    const rows = indexed.map(d => ({ id: d.id, rawScore: 0, anchors: 0, titleAnchors: 0,
      matchedTerms: [] as string[], titleTerms: [] as string[], strategyTerms: [] as string[], strategyAnchors: 0 }));
    // Preserve the original query-term addition order, including floating-point accumulation.
    for (const token of new Set(retrievalTokens(query))) {
      for (const entry of postings.get(token) ?? []) {
        const row = rows[entry.index]!; row.rawScore += entry.contribution; row.anchors++;
        if (entry.title) row.titleAnchors++;
        if (entry.strategy) row.strategyAnchors++;
        if (explain) {
          if (row.matchedTerms.length < 16) row.matchedTerms.push(token);
          if (entry.title && row.titleTerms.length < 16) row.titleTerms.push(token);
          if (entry.strategy && row.strategyTerms.length < 16) row.strategyTerms.push(token);
        }
      }
    }
    return rows.map((row, index): ExplainedMatch => {
      const score = row.rawScore / (1 + row.rawScore);
      const reason = row.anchors < retrievalPolicy.minimumAnchors ? 'insufficient_anchors'
        : row.titleAnchors < retrievalPolicy.minimumTitleAnchors ? 'no_title_anchor'
          : score < retrievalPolicy.minimumScore ? 'low_bm25' : null;
      return { ...row, score, reason, strategyCoverage: row.strategyAnchors / (indexed[index]!.strategy.size || 1) };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  };
  return Object.freeze({ size: indexed.length,
    rank: (query: string): TextMatch[] => evaluate(query, false).map(({ id, score, rawScore, anchors, titleAnchors, reason }) =>
      ({ id, score, rawScore, anchors, titleAnchors, reason })),
    explain: (query: string): ExplainedMatch[] => evaluate(query, true) });
}

const documentationOnlyPatterns = [
  '^\\s*only\\s+(?:update|edit|change)\\s+(?:the\\s+)?(?:documentation|docs|readme|comments)\\b[\\s\\S]*\\bdo not change (?:runtime )?behavio[u]?r\\b',
  '^\\s*(?:仅|只)(?:更新|修改)(?:文档|注释|说明)[\\s\\S]*(?:不改变|不修改|不要改变)(?:运行|代码)?行为',
] as const;
export const strategyRetrievalPolicy = {
  version: 'strategy-v2-experimental', basePolicyDigest: retrievalPolicyDigest,
  minimumStrategyAnchors: 3, minimumStrategyCoverage: 0.5,
  documentationOnlyPatterns, explanationTermLimit: 16, tieBreak: 'score-desc/id-localeCompare',
  rollout: 'offline-only/default-product-unchanged',
} as const;
export const strategyRetrievalPolicyDigest = digest(JSON.stringify(strategyRetrievalPolicy));
export interface StrategyMatch extends Omit<ExplainedMatch, 'reason'> {
  reason: TextMatch['reason'] | 'explicit_documentation_only';
  route: 'title' | 'strategy_coverage' | 'abstain';
}
/** Experimental lexical heuristic; callers must enforce eligibility before constructing the index. */
export function rankStrategy(query: string, index: ReturnType<typeof prepareTextIndex>): StrategyMatch[] {
  const documentationOnly = documentationOnlyPatterns.some(pattern => new RegExp(pattern, 'iu').test(query.normalize('NFKC')));
  return index.explain(query).map(match => {
    if (documentationOnly) return { ...match, reason: 'explicit_documentation_only', route: 'abstain' };
    if (match.reason === null) return { ...match, route: 'title' };
    if (match.reason === 'no_title_anchor' && match.score >= retrievalPolicy.minimumScore
      && match.strategyAnchors >= strategyRetrievalPolicy.minimumStrategyAnchors
      && match.strategyCoverage >= strategyRetrievalPolicy.minimumStrategyCoverage) {
      return { ...match, reason: null, route: 'strategy_coverage' };
    }
    return { ...match, route: 'abstain' };
  });
}
