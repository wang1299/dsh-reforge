import { cosine, type EmbeddingPort } from './embedding.js';
import { rankText, type TextDocument } from './retrieval.js';

export interface HybridDocument extends TextDocument { revision: number }
export interface HybridConfig { minimumScore: number; minimumMargin: number; lexicalWeight: number }
export interface HybridMatch { id: string; score: number; lexical: number; dense: number }
export const documentEmbeddingText = (document: TextDocument): string => document.title + '\n' + document.strategy;
/** Caller supplies only source/scope eligible documents, before both IDF and cosine scoring. */
export function rankHybrid(query: { id: string; text: string }, eligible: HybridDocument[], namespace: string,
  port: EmbeddingPort, lexicalWeight: number): HybridMatch[] {
  if (!Number.isFinite(lexicalWeight) || lexicalWeight < 0 || lexicalWeight > 1) throw new Error('Invalid lexical weight');
  const lexical = rankText(query.text, eligible);
  const vector = port.embed({ namespace: namespace + '/query', id: query.id, revision: 1, text: query.text });
  return eligible.map(document => {
    const match = lexical.find(item => item.id === document.id)!;
    const dense = cosine(vector, port.embed({ namespace: namespace + '/document', id: document.id,
      revision: document.revision, text: documentEmbeddingText(document) }));
    const score = match.reason === null ? match.score : 0;
    return { id: document.id, lexical: score, dense, score: lexicalWeight * score + (1 - lexicalWeight) * Math.max(0, dense) };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function hybridSelection(ranked: HybridMatch[], config: HybridConfig): { selected: string | null; reason: string } {
  if ([config.minimumScore, config.minimumMargin, config.lexicalWeight].some(v => !Number.isFinite(v) || v < 0 || v > 1)) {
    throw new Error('Invalid hybrid selection config');
  }
  const top = ranked[0];
  if (!top) return { selected: null, reason: 'empty_eligible_bank' };
  if (top.score < config.minimumScore) return { selected: null, reason: 'low_score' };
  if (top.score - (ranked[1]?.score ?? 0) < config.minimumMargin) return { selected: null, reason: 'ambiguous_margin' };
  return { selected: top.id, reason: 'offered' };
}
