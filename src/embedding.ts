import { z } from 'zod';
import { digest } from './domain.js';

/** Offline boundary only. The DSH runtime does not import or instantiate this port. */
export interface EmbeddingInput { namespace: string; id: string; revision: number; text: string }
export interface EmbeddingPort { embed(input: EmbeddingInput): readonly number[] }
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z.object({ namespace: z.string().min(1).max(100), id: z.string().min(1).max(100),
  revision: z.number().int().positive(), textDigest: hash, vector: z.array(z.number().finite()).min(1).max(4096) }).strict();
export const vectorSnapshotSchema = z.object({ schemaVersion: z.literal(1), modelDigest: hash, corpusDigest: hash,
  dimension: z.number().int().min(1).max(4096), split: z.enum(['development', 'holdout']),
  entries: z.array(entry).min(1).max(1000),
  provenance: z.object({ engine: z.string(), runtimeVersions: z.record(z.string(), z.string()),
    inferenceSeconds: z.number().nonnegative(), texts: z.number().int().positive(), forwardPasses: z.number().int().positive(),
    paidHttpCalls: z.literal(0), precision: z.literal('round7') }).strict(),
}).strict();
export type VectorSnapshot = z.infer<typeof vectorSnapshotSchema>;
export function embeddingTextDigest(text: string): string { return digest(text); }
function key(input: Omit<EmbeddingInput, 'text'>): string { return JSON.stringify([input.namespace, input.id, input.revision]); }
export function assertVector(vector: readonly number[], dimension: number): void {
  const norm = Math.hypot(...vector);
  if (vector.length !== dimension || vector.some(v => !Number.isFinite(v)) || !Number.isFinite(norm) || !(norm > 0)) {
    throw new Error('Invalid embedding dimension, finite values or norm');
  }
}
export function cosine(a: readonly number[], b: readonly number[]): number {
  assertVector(a, b.length); assertVector(b, a.length);
  const normA = Math.hypot(...a); const normB = Math.hypot(...b);
  return Math.max(-1, Math.min(1, a.reduce((sum, v, i) => sum + (v / normA) * (b[i]! / normB), 0)));
}
/** Model manifest includes revision, weights, tokenizer, pooling and precision. No fallback on a cache miss. */
export function snapshotEmbeddingPort(input: unknown, expected: { modelDigest: string; corpusDigest: string; dimension: number }): EmbeddingPort {
  const snapshot = vectorSnapshotSchema.parse(input);
  for (const property of ['modelDigest', 'corpusDigest', 'dimension'] as const) {
    if (snapshot[property] !== expected[property]) throw new Error('Embedding snapshot binding mismatch: ' + property);
  }
  const entries = new Map<string, (typeof snapshot.entries)[number]>();
  for (const item of snapshot.entries) {
    assertVector(item.vector, snapshot.dimension);
    if (entries.has(key(item))) throw new Error('Duplicate embedding cache key');
    entries.set(key(item), { ...item, vector: [...item.vector] });
  }
  return { embed(request) {
    const item = entries.get(key(request));
    if (!item || item.textDigest !== embeddingTextDigest(request.text)) throw new Error('Embedding cache miss or changed text');
    return [...item.vector];
  } };
}
