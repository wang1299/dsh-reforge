import type { ArrayValueSchemaSpec, ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools';

// The fixed DSH DSL expresses shape; domain.ts still checks bounds and provenance.
export const candidateInput = {
  type: 'object', additionalProperties: false,
  description: 'Candidate only; no status or verification claims. Separate observed facts from inference and advice.',
  properties: {
    title: { type: 'string', required: true, description: 'Nonempty title, at most 160 characters.' },
    strategy: { type: 'string', required: true, description: 'Observed repair strategy, nonempty, at most 4000 characters.' },
    observedFacts: { type: 'array', required: true, items: { type: 'string' }, description: '1–12 observed facts, each nonempty and at most 4000 characters. Every fact needs a source for default reuse.' },
    inferences: { type: 'array', required: true, items: { type: 'string' }, description: '0–12 fallible inferences, each nonempty and at most 4000 characters.' },
    recommendations: { type: 'array', required: true, items: { type: 'string' }, description: '0–12 unverified recommendations, each nonempty and at most 4000 characters.' },
    requiredFiles: { type: 'array', required: true, items: { type: 'string' }, description: '1–20 repository relative file paths, at most 240 characters each. Use /; no absolute path, colon, backslash, control character, empty, . or .. segment.' },
  },
} as const satisfies ObjectValueSchemaSpec;

export const citationsInput = {
  type: 'array',
  description: '0–36 exact fact-to-source mappings, at most 3 distinct sources per fact; no duplicate factIndex/evidenceId. A source receipt alone is NOT a citation. Do not pass kind or invent digests.',
  items: {
    type: 'object', additionalProperties: false,
    properties: {
      factIndex: { type: 'integer', required: true, description: 'Zero-based observedFacts index (0–11); copy from the returned facts entry.' },
      factDigest: { type: 'string', required: true, description: 'Copy the 64 lowercase hex factDigest from propose/verify facts; never guess a hash.' },
      evidenceId: { type: 'string', required: true, description: 'Copy the UUID from the same-task correction or verification evidence receipt.' },
      evidenceDigest: { type: 'string', required: true, description: 'Copy the 64 lowercase hex evidenceDigest from that same evidence receipt.' },
    },
  },
} as const satisfies ArrayValueSchemaSpec;
