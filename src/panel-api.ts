import { z } from 'zod';
import type { EvolveService } from './service.js';
import { idSchema, textSchema, feedbackSchema, factCitationsSchema } from './domain.js';
import { learningStatus } from './learning-status.js';
const revisionBody = z.object({ revision: z.number().int().positive(), reason: textSchema }).strict();

export function panelState(service: EvolveService) {
        const experiences = service.store.experiences();
        const histories = Object.fromEntries(experiences.map((e) => [e.id, service.store.history(e.id)]));
        const proofIds = new Set(Object.values(histories).flatMap((items) => items.flatMap((e) => e.verificationId ? [e.verificationId] : [])));
        const evidence = service.store.evidenceRecords();
        for (const e of evidence) if (e.kind === 'verification') proofIds.add(e.verificationId);
        const provenance = Object.fromEntries(Object.entries(histories).map(([id, versions]) => [id,
          Object.fromEntries(versions.map((e) => [e.revision, { ...service.provenance(e), facts: service.facts(e) }]))]));
        const learningJobs = service.store.learning.jobs();
  return { experiences, tasks: service.store.tasks(), applications: service.store.applications(), feedback: service.store.feedback(),
          automaticEnabled: service.automatic.enabled, automaticSegments: service.store.automatic.rows(), learning: learningStatus(service), retrieval: service.retrievalStatus(),
          learningJobs, learningRecoveries: service.store.learning.recoveries(), evidenceBundles: service.store.learning.bundles(), learningAttempts: Object.fromEntries(learningJobs.map(j => [j.id, service.store.learning.attempts(j.id)])),
          extractionJobs: service.store.extraction.jobs(), extractionReauthorizations: service.store.extraction.reauthorizations(), extractionGrants: service.store.extraction.grants(),
          histories, evidence, provenance, verifications: Object.fromEntries([...proofIds].map((id) => [id, service.store.verification(id)])) };
}

export function panelRequest(service: EvolveService, path: string, method: string, value?: unknown): { status: number; value: unknown } {
  if (method === 'GET' && path === '/api/state') return { status: 200, value: panelState(service) };
  if (method === 'GET' && path === '/api/candidates') return { status: 200, value: service.pendingCandidates() };
  if (method !== 'POST') return { status: 404, value: { error: 'Not found' } };
      if (path === '/api/feedback') {
        const parsed = feedbackSchema.omit({ createdAt: true }).parse(value);
        return { status: 200, value: service.feedback(parsed) };
      }
      if (path === '/api/cleanup') {
        z.object({}).strict().parse(value);
        return { status: 200, value: service.store.cleanEvidenceWithRetention(new Date(Date.now() - 30 * 86400000).toISOString()) };
      }
      const match = path.match(/^\/api\/experience\/([^/]+)\/(revise|disable|restore|evidence)$/);
      if (!match) { return { status: 404, value: { error: 'Not found' } }; }
      const id = idSchema.parse(match[1]); const current = service.requireExperience(id);
      const revision = z.object({ revision: z.number().int().positive() }).passthrough().parse(value).revision;
      if (revision !== current.revision) { return { status: 409, value: { error: 'Experience changed; refresh before editing' } }; }
      if (match[2] === 'revise') {
        const input = revisionBody.extend({ candidate: z.unknown(), citations: factCitationsSchema.optional() }).parse(value);
        return { status: 200, value: service.revise(id, input.revision, input.candidate, input.reason, input.citations ?? []) };
      } else if (match[2] === 'evidence') {
        const input = z.object({ revision: z.number().int().positive(), citations: factCitationsSchema }).strict().parse(value);
        return { status: 200, value: service.linkEvidence(id, input.revision, input.citations) };
      } else if (match[2] === 'restore') {
        const input = revisionBody.extend({ targetRevision: z.number().int().positive() }).parse(value);
        return { status: 200, value: service.restore(id, input.targetRevision, input.reason, input.revision) };
      } else {
        const input = revisionBody.parse(value); return { status: 200, value: service.disable(id, input.reason, input.revision) };
      }
}
