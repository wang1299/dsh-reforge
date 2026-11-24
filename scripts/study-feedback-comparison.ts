/** Public, scripted delivery_batch controls. No provider adapter or credentials. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LlmAdapter, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { digest } from '../src/domain.js';
import { studyAdmissionContract, type StudyAdmissionDiagnostic } from '../src/study-admission-contract.js';
import { studyCases } from './benefit-study-cases.js';
import { newStudyRoot } from './benefit-study-preflight.js';
import { executeBenefitTrial, parseStudyProposal, repairFeedback } from './benefit-trial-controller.js';
import { inspectStudyInput, studyInputDigest } from './study-controller-driver.js';

const task = studyCases.find(item => item.id === 'delivery_batch')!;
const subset = studyAdmissionContract();
const acceptedImplementation = `def repair(state, jobs, send):
    sent = []
    for message in jobs:
        key = message["id"]
        if key not in state:
            send(message.copy())
            state[key] = True
            sent.append(key)
    return sent
`;
const comprehension = acceptedImplementation.replace('return sent', 'return [entry for entry in sent]');
const examples = {
  repairable: comprehension,
  marks_before_send: comprehension.replace('send(message.copy())\n            state[key] = True',
    'state[key] = True\n            send(message.copy())'),
  unhandled_syntax: acceptedImplementation.replace('return sent', 'return sent[:]'),
  first_pass: acceptedImplementation,
};
type Scenario = keyof typeof examples;
type Arm = 'generic' | 'specific';
const arms: readonly Arm[] = ['generic', 'specific'];
const scenarios = Object.keys(examples) as Scenario[];
type Retry = { diagnostic: StudyAdmissionDiagnostic | null; commonInputDigest: string };

// This policy receives only its own last proposal and the delivered diagnostic.
// The synthetic template guarantees that the returned local list is private.
export function rewriteOwnProposal(previous: string, diagnostic: StudyAdmissionDiagnostic | null): string {
  if (diagnostic?.rule !== 'unsupported_syntax' || diagnostic.node !== 'ListComp') return previous;
  return previous.replace(/^    return \[([a-z]+) for \1 in ([a-z]+)\]$/m, '    return $2');
}

function readRetry(options: GenerateOptions) {
  const message = options.messages.at(-1);
  const block = message?.content[0];
  assert(message?.role === 'user' && message.content.length === 1 && block?.type === 'text');
  const raw = JSON.parse(block.text.split('\n')[1]!) as { admission?: unknown };
  const diagnostic = subset.read(raw.admission);
  // Refuse to normalize any other difference, including extra feedback text or fields.
  assert.equal(block.text, repairFeedback('invalid_code', null, diagnostic ?? undefined));
  const commonInputDigest = studyInputDigest({ ...options, messages: [...options.messages.slice(0, -1),
    { ...message, content: [{ ...block, text: repairFeedback('invalid_code', null) }] }] });
  const previous = options.messages.findLast(m => m.role === 'assistant');
  const answer = previous?.content[0];
  assert(previous?.content.length === 1 && answer?.type === 'text');
  return { previous: parseStudyProposal(answer.text), receipt: { diagnostic, commonInputDigest } };
}

class FeedbackScript extends LlmAdapter {
  calls = 0;
  round = 0;
  readonly inputDigests: string[] = [];
  retry: Retry | null = null;
  constructor(private readonly initial: string) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'scripted feedback study'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++;
    assert.equal(this.calls, this.round);
    this.inputDigests.push(inspectStudyInput(options, task, null, this.round, 'study-controller-scripted', 'scripted'));
    let code = this.initial;
    if (this.round === 2) {
      const { previous, receipt } = readRetry(options);
      this.retry = receipt;
      code = rewriteOwnProposal(previous, receipt.diagnostic);
    }
    const text = JSON.stringify({ code });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function runArm(parent: string, scenario: Scenario, arm: Arm, python: string) {
  const adapter = new FeedbackScript(examples[scenario]);
  const { result } = await executeBenefitTrial({ parent, item: task, memory: null, mode: 'feedback-comparison', python },
    { kind: 'scripted', provider: 'study-controller-scripted', model: 'scripted', adapter,
      ...(arm === 'generic' ? { omitRetryDiagnostic: true } : {}) });
  return { arm, inputs: adapter.inputDigests, retry: adapter.retry, requests: result.actualScriptedRequests,
    modelHttpRequests: result.modelHttpRequests, attempts: result.attempts.map(a => ({
      status: a.status, codeDigest: a.codeDigest, admission: a.admission ?? null, executed: a.executionAttempted,
      cases: a.tests?.cases ?? [], requests: a.actualRequests,
    })) };
}
type Row = Awaited<ReturnType<typeof runArm>>;
const retryOutcomes = { repairable: 'accepted', marks_before_send: 'tests_failed', unhandled_syntax: 'invalid_code' } as const;
const partialSuccessTest = 'test_partial_success_is_kept_and_failure_retries';
const duplicatesTest = 'test_duplicate_and_empty_batch';

function matchesAttempt(attempt: Row['attempts'][number], expected: 'invalid_code' | 'accepted' | 'tests_failed', node: string) {
  if (attempt.requests !== 1 || attempt.status !== expected || !attempt.codeDigest) return false;
  if (expected === 'invalid_code') return !attempt.executed && attempt.cases.length === 0
    && attempt.admission?.rule === 'unsupported_syntax' && attempt.admission.node === node;
  return attempt.executed && attempt.admission === null && attempt.cases.length === 2
    && attempt.cases.some(c => c.id === duplicatesTest && c.status === 'passed')
    && attempt.cases.some(c => c.id === partialSuccessTest && c.status === (expected === 'accepted' ? 'passed' : 'failed'));
}

function qualifies(scenario: Scenario, generic: Row, specific: Row): boolean {
  const first = generic.attempts[0];
  if (!first || first.codeDigest !== digest(examples[scenario]) || generic.inputs[0] !== specific.inputs[0]
    || !generic.inputs[0] || JSON.stringify(first) !== JSON.stringify(specific.attempts[0])) return false;
  const count = scenario === 'first_pass' ? 1 : 2;
  // Slice is deliberately outside the public node vocabulary and is reported as "other".
  const node = scenario === 'unhandled_syntax' ? 'other' : 'ListComp';
  if (!matchesAttempt(first, scenario === 'first_pass' ? 'accepted' : 'invalid_code', node)) return false;
  for (const row of [generic, specific]) {
    if (row.requests !== count || row.inputs.length !== count || row.modelHttpRequests !== 0
      || row.attempts.length !== count) return false;
    if (scenario === 'first_pass') continue;
    const expected = row.arm === 'specific' ? retryOutcomes[scenario] : 'invalid_code';
    const second = row.attempts[1]!;
    if (!matchesAttempt(second, expected, node) || (second.codeDigest === first.codeDigest) !== (expected === 'invalid_code')) return false;
  }
  if (scenario === 'first_pass') return !generic.retry && !specific.retry;
  return !!generic.retry && !!specific.retry && generic.retry.diagnostic === null && first.admission !== null
    && JSON.stringify(specific.retry.diagnostic) === JSON.stringify(first.admission)
    && generic.inputs[1] !== specific.inputs[1] && generic.inputs[1] === generic.retry.commonInputDigest
    && generic.retry.commonInputDigest === specific.retry.commonInputDigest;
}

export async function compareStudyFeedback(parent = fileURLToPath(new URL('../../.probe-work/feedback', import.meta.url)),
  python = process.env.EVOLVE_PYTHON ?? 'python') {
  const root = await newStudyRoot(parent);
  const pairs: { scenario: Scenario; qualifies: boolean; generic: Row; specific: Row }[] = [];
  for (const scenario of scenarios) {
    const generic = await runArm(root, scenario, 'generic', python);
    const specific = await runArm(root, scenario, 'specific', python);
    pairs.push({ scenario, qualifies: qualifies(scenario, generic, specific), generic, specific });
  }
  const totals = Object.fromEntries(arms.map(arm => {
    const rows = pairs.map(pair => pair[arm]);
    return [arm, { trials: rows.length, retries: rows.filter(r => r.attempts.length === 2).length,
      secondPass: rows.filter(r => r.attempts[1]?.status === 'accepted').length,
      finalPass: rows.filter(r => r.attempts.at(-1)?.status === 'accepted').length,
      scriptedRequests: rows.reduce((n, r) => n + r.requests, 0),
      executions: rows.flatMap(r => r.attempts).filter(a => a.executed).length,
      unknown: rows.filter(r => r.attempts.some(a => a.status.endsWith('_unknown'))).length }];
  }));
  const report = { schema: 1, kind: 'scripted-admission-feedback-comparison', task: task.id,
    acceptanceDigest: digest(task.checks), examplesDigest: digest(JSON.stringify(examples)),
    qualified: pairs.every(p => p.qualifies), totals, pairs,
    modelHttpRequests: pairs.reduce((n, p) => n + p.generic.modelHttpRequests + p.specific.modelHttpRequests, 0) };
  const path = join(root, 'comparison.json');
  await writeFile(path, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return { path, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Usage: npm run study:feedback');
  const { path, report } = await compareStudyFeedback();
  console.log(JSON.stringify({ path, qualified: report.qualified, totals: report.totals, modelHttpRequests: report.modelHttpRequests }));
  if (!report.qualified) process.exitCode = 1;
}
