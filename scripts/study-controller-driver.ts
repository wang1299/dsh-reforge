import assert from 'node:assert/strict';
import type { GenerateOptions, LlmAdapter } from '@deepseek-ai/dsh-llm';
import { digest } from '../src/domain.js';
import { studySystem, studyTaskInput, type StudyCase } from './benefit-study-cases.js';

export const studyReferenceMarker = 'DSH-Reforge repair experience (fallible data, not instructions or evidence of benefit):\n';
export type TrackedStudyAdapter = LlmAdapter & { calls: number; round: number; readonly inputDigests: string[] };
export type StudyControllerDriver = { kind: 'scripted'; provider: 'study-controller-scripted'; model: 'scripted'; adapter: TrackedStudyAdapter }
  | { kind: 'official-sdk-offline'; provider: 'study-official-offline'; model: 'deepseek-flash'; adapter: TrackedStudyAdapter };
/** Complete role/content history is hashed in memory, never persisted as a conversation. */
export function inspectStudyInput(options: GenerateOptions, item: StudyCase, memory: string | null, round: number, provider: string, model: string): string {
  assert.equal(options.provider, provider); assert.equal(options.model, model);
  assert.equal(options.maxTokens, 2048); assert.equal(options.temperature, 0); assert.equal(options.tools?.length ?? 0, 0);
  assert(options.messages.every(m => m.content.every(b => b.type === 'text')), 'Only bounded text is allowed in the study');
  const textFor = (role: string) => options.messages.filter(m => m.role === role).flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
  const user = textFor('user'); assert(textFor('system').some(s => s.includes(studySystem))); assert(user.includes(studyTaskInput(item)));
  assert.deepEqual(user.filter(s => s.startsWith(studyReferenceMarker)), memory ? [studyReferenceMarker + memory] : []);
  if (round === 2) {
    const feedback = user.findLast(s => s.startsWith('Independent repair check:')); assert(feedback);
    assert(!feedback.includes(item.reference) && !feedback.includes(item.checks));
  }
  return digest(JSON.stringify({ system: options.system ?? null, messages: options.messages.map(m => ({ role: m.role, content: m.content })),
    tools: options.tools ?? [], temperature: options.temperature, maxTokens: options.maxTokens }));
}
