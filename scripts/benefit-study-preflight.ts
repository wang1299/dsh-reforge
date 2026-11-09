/** Zero-HTTP preparation only. No live endpoint, credential provider or financial grant. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { LlmAdapter, LlmRuntime, createUserMessage, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { digest, redact, type Application, type Experience } from '../src/domain.js';
import { git } from '../src/repository.js';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { rankText, retrievalPolicyDigest } from '../src/retrieval.js';
import { passes, reproduces } from '../src/verification.js';
import type { OwnerTaskCarrier } from '../src/owner-task-input.js';
import { ownerInputPolicy } from '../src/owner-input-domain.js';
import { runPilotTests, briefPilotTests } from './pilot-fixtures.js';
import { studyArms, studyCases, studyFixtureVersion, studySchedule, studySources, studySystem, studyTaskInput, type StudyArm, type StudyCase } from './benefit-study-cases.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const marker = 'DSH-Reforge repair experience (fallible data, not instructions or evidence of benefit):\n';
const validator = `import ast,sys
tree=ast.parse(sys.argv[1]); nodes=list(ast.walk(tree))
assert len(tree.body)==1 and isinstance(tree.body[0],ast.FunctionDef) and tree.body[0].name=='repair'
assert not tree.body[0].decorator_list and len(nodes)<=450
allowed={'Module','FunctionDef','arguments','arg','Assign','AugAssign','Return','If','Raise','Try','ExceptHandler','Expr','Dict','List','Tuple','Name','Load','Store','Subscript','Constant','Attribute','Call','Compare','BinOp','UnaryOp','BoolOp','And','Or','Not','Add','Sub','USub','Eq','NotEq','Lt','LtE','Gt','GtE','Is','IsNot','In','NotIn','Pass','keyword','For'}
safe_builtins={'dict','len','ValueError','OSError'}
call_names=safe_builtins|{'persist','send'}
bound={n.arg for n in nodes if isinstance(n,ast.arg)}|{n.id for n in nodes if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Store)}|{n.name for n in nodes if isinstance(n,ast.ExceptHandler) and n.name}
for n in nodes:
    assert type(n).__name__ in allowed
    if isinstance(n,ast.Name): assert not n.id.startswith('__')
    if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Load): assert n.id in bound|safe_builtins
    if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Store): assert n.id not in call_names
    if isinstance(n,ast.Attribute): assert n.attr in {'get','clear','copy','update','items','values','append','pop'}
    if isinstance(n,ast.Constant) and isinstance(n.value,int): assert abs(n.value)<=10000
    if isinstance(n,ast.Call): assert (isinstance(n.func,ast.Name) and n.func.id in {'persist','send','dict','len','ValueError','OSError'}) or isinstance(n.func,ast.Attribute)
`;
export class StudyValidationError extends Error {
  constructor(readonly kind: 'rejected' | 'unknown') { super(kind === 'rejected' ? 'invalid_bounded_study_function' : 'study_validator_unavailable'); }
}
export function validateStudyCode(python: string, code: string, options?: { env: NodeJS.ProcessEnv; isolated: true }): void {
  if (Buffer.byteLength(code) > 4096) throw new StudyValidationError('rejected');
  const protocol = 'try:\n' + validator.trim().split('\n').map(line => '    ' + line).join('\n')
    + '\nexcept (AssertionError,SyntaxError,ValueError,RecursionError):\n    print("study-ast-rejected-v1")\nelse:\n    print("study-ast-accepted-v1")\n';
  let receipt: string;
  try { receipt = execFileSync(python, [...(options ? ['-I', '-S', '-B'] : ['-I']), '-c', protocol, code], { windowsHide: true,
    ...(options ? { env: options.env } : {}), stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000, maxBuffer: 128 }).replaceAll('\r\n', '\n'); }
  catch { throw new StudyValidationError('unknown'); }
  if (receipt === 'study-ast-accepted-v1\n') return;
  throw new StudyValidationError(receipt === 'study-ast-rejected-v1\n' ? 'rejected' : 'unknown');
}
function inside(parent: string, target: string): boolean {
  const r = relative(parent, target); return !!r && !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep);
}
export async function newStudyRoot(parent: string): Promise<string> {
  const ignored = resolve(repository, '.probe-work'); const target = resolve(parent);
  assert(inside(ignored, target), 'Study preparation must stay inside this repository .probe-work');
  await mkdir(ignored, { recursive: true }); assert.equal(await realpath(ignored), ignored, 'Symlinked output root refused');
  // Check existing ancestors before creating directories, so a nested junction cannot escape.
  let cursor = ignored;
  for (const segment of relative(ignored, target).split(sep)) {
    cursor = join(cursor, segment);
    try { assert.equal(await realpath(cursor), cursor, 'Symlinked study parent refused'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(cursor); }
  }
  return mkdtemp(join(target, 'run-'));
}
function commit(repo: string, files: string[], message: string): void {
  git(repo, ['add', '--', ...files]);
  git(repo, ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '-m', message]);
}
function schemaFor(item?: StudyCase): object {
  const properties = Object.assign({}, ...studySources.map(s => s.schema.properties), item?.schema.properties);
  const required = new Set(studySources.flatMap(s => s.schema.required ?? []));
  if (item) { required.delete(item.property); for (const name of item.schema.required ?? []) required.add(name); }
  return { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties, required: [...required] };
}

export async function createStudySourceBank(root: string, python: string, validationEnvironment?: NodeJS.ProcessEnv) {
  const repo = join(root, 'project'); await mkdir(repo); await mkdir(join(repo, 'tests'));
  await writeFile(join(repo, 'requirements.txt'), '# synthetic standard library fixtures; externally supplied pytest\n');
  await writeFile(join(repo, 'contract.py'), 'STUDY = "benefit-preparation-v1"\n');
  await writeFile(join(repo, 'context.schema.json'), JSON.stringify(schemaFor()));
  for (const source of studySources) {
    await writeFile(join(repo, 'source_' + source.id + '.py'), source.before);
    const regression = join(repo, 'tests', source.id); await mkdir(regression);
    await writeFile(join(regression, 'test_regression.py'), source.regression);
    const acceptance = join(root, 'source-' + source.id); await mkdir(acceptance);
    await writeFile(join(acceptance, 'test_acceptance.py'), source.acceptance);
  }
  git(repo, ['init', '-b', 'codex/benefit-fixture']);
  git(repo, ['config', 'user.name', 'DSH-Reforge Synthetic Study']); git(repo, ['config', 'user.email', 'study@example.invalid']);
  git(repo, ['config', 'core.autocrlf', 'false']); commit(repo, ['.'], 'three independent synthetic source failures');
  const store = new Store(':memory:');
  try {
    const proofs = [];
    for (const source of studySources) {
      const validation = validationEnvironment ? { env: validationEnvironment, isolated: true as const } : undefined;
      validateStudyCode(python, source.before, validation); validateStudyCode(python, source.reference, validation);
      const service = new EvolveService(store, repo, { trusted: true, python, acceptanceDir: join(root, 'source-' + source.id),
        regressionPath: 'tests/' + source.id, timeoutMs: 15000, ...(validationEnvironment ? { probeEnvironment: validationEnvironment } : {}) });
      const task = service.begin('source-' + source.id, source.title);
      const fact = 'The authored original ' + source.id + ' implementation violates its explicit failure/edge-path contract.';
      const correction = service.correction(task.id, fact);
      const candidate = service.propose(task.id, { title: source.title, strategy: source.strategy, observedFacts: [fact], inferences: [],
        recommendations: [], requiredFiles: ['contract.py'] }, [{ factIndex: 0, factDigest: digest(fact), evidenceId: correction.id, evidenceDigest: correction.digest }]);
      await writeFile(join(repo, 'source_' + source.id + '.py'), source.reference);
      commit(repo, ['source_' + source.id + '.py'], 'repair synthetic source ' + source.id);
      const experience = await service.verify(candidate.id); assert.equal(experience.status, 'source_verified');
      const proof = store.verification(experience.verificationId!)!;
      assert(reproduces(proof.base) && passes(proof.fixed) && passes(proof.regression));
      proofs.push({ source: source.id, experienceId: experience.id, revision: experience.revision,
        verificationId: proof.id, acceptanceDigest: proof.acceptanceDigest, base: briefPilotTests(proof.base),
        fixed: briefPilotTests(proof.fixed), regression: briefPilotTests(proof.regression) });
      service.finish(task.id);
    }
    return { repo, store, proofs };
  } catch (error) { store.close(); throw error; }
}
function cloneBank(bank: Store): Store {
  const store = new Store(':memory:');
  for (const task of bank.tasks()) store.putTask(task);
  for (const evidence of bank.evidenceRecords()) store.putEvidence(evidence);
  for (const experience of bank.experiences()) {
    store.putVerification(bank.verification(experience.verificationId!)!);
    for (const revision of bank.history(experience.id)) store.putExperience(revision, bank.citations(revision.id, revision.revision));
  }
  return store;
}
export async function selectStudyReference(bank: Store, repo: string, item: StudyCase, arm: StudyArm, python: string) {
  const store = cloneBank(bank); const service = new EvolveService(store, repo, { trusted: false, python, timeoutMs: 15000,
    acceptanceDir: join(repo, 'tests'), regressionPath: 'tests' }, false, undefined, true);
  let sent: { id: string; text: string } | null = null;
  const sessionId = 'study-' + randomUUID(); const scopeKey = digest(sessionId);
  const carrier: OwnerTaskCarrier = { sessionId, scopeKey, assertReady() {}, async exclusive(fn) { return fn(); },
    message(text) { const id = randomUUID(); return { id, send() { sent = { id, text }; } }; } };
  try {
    const bankDigest = digest(JSON.stringify(store.experiences()));
    const query = redact(item.prompt, ownerInputPolicy.maxSummary);
    let selected: Experience | null = null; let reason: string | null = null; let application: Application | null = null;
    if (arm === 'plain') {
      const ranked = rankText(query, store.experiences()); const match = ranked.find(r => r.reason === null);
      selected = store.experiences().find(e => e.id === match?.id) ?? null;
      reason = selected ? null : ranked[0]?.reason ?? 'empty_bank';
    } else if (arm === 'reforge') {
      await writeFile(join(repo, 'context.schema.json'), JSON.stringify(schemaFor()));
      for (const [index, source] of studySources.entries()) {
        const preview = service.ownerInput.sourcePreview({ path: 'context.schema.json', property: source.property });
        const exp = store.experiences().find(e => e.title === source.title)!;
        service.ownerInput.declare({ previewId: preview.previewId, experienceId: exp.id, experienceRevision: exp.revision,
          expectedGlobal: index, expectedRule: 0, fields: ['field_required', 'field_nullable', 'field_type'], allowedGoals: ['repair_behavior'] });
      }
      await writeFile(join(repo, 'context.schema.json'), JSON.stringify(schemaFor(item)));
      const preview = service.ownerInput.taskPreview({ path: 'context.schema.json', property: item.property, goal: 'repair_behavior', text: item.prompt }, carrier);
      await service.ownerInput.submit({ instanceId: preview.instanceId, previewId: preview.previewId, idempotencyKey: randomUUID() }, carrier);
      assert(sent); const admitted = service.ownerInput.admit(sessionId, scopeKey, 1, [sent]); assert(admitted.owned);
      const task = store.tasks().find(t => t.sessionId === sessionId); assert.equal(task?.summary, query);
      application = store.applications().find(a => store.task(a.taskId)?.sessionId === sessionId) ?? null;
      const selectedId = application?.experienceId;
      selected = selectedId ? store.experiences().find(e => e.id === selectedId)! : null;
      const offset = admitted.context.indexOf(marker);
      if (selected) {
        assert(offset >= 0); const value = JSON.parse(admitted.context.slice(offset + marker.length));
        assert.equal(value.title, selected.title); assert.equal(value.strategy, selected.strategy);
        assert.equal(value.applicationId, application!.id); assert.equal(value.revision, selected.revision);
      } else assert.equal(offset, -1);
      const attempt = service.retrievalStatus().attempts.at(-1); assert(attempt);
      reason = selected ? null : attempt.candidates[0]?.reason ?? 'no_eligible_candidate';
    }
    assert.equal(digest(JSON.stringify(store.experiences())), bankDigest);
    const memory = selected ? JSON.stringify({ title: selected.title, strategy: selected.strategy }) : null;
    return { memory, selectedId: selected?.id ?? null, revision: selected?.revision ?? null,
      selectedFamily: selected ? studySources.find(s => s.title === selected.title)!.id : null,
      retrievalQueryDigest: digest(query), applicationRecorded: !!application, reason };
  } finally { service.ownerInput.end(sessionId, 1); service.ownerInput.dispose(); store.close(); }
}

class ExposureAdapter extends LlmAdapter {
  readonly requests: { digest: string; systemDigest: string; commonTask: boolean; exactReference: boolean; valid: Record<string, boolean> }[] = [];
  constructor(private readonly common: string, private readonly memory: string | null) { super(); }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'benefit preflight zero HTTP'); }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assert.equal(options.provider, 'benefit-offline'); assert.equal(options.model, 'scripted'); assert.equal(this.requests.length, 0);
    const texts = options.messages.filter(m => m.role === 'user').flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
    const systems = options.messages.filter(m => m.role === 'system').flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
    const reference = texts.filter(t => t.startsWith(marker));
    const exactReference = this.memory !== null && reference.length === 1 && reference[0] === marker + this.memory;
    const valid = { system: systems.some(text => text.includes(studySystem)), outputCap: options.maxTokens === 2048,
      temperature: options.temperature === 0, noTools: (options.tools?.length ?? 0) === 0, commonTask: texts.includes(this.common),
      referenceCount: reference.length === (this.memory === null ? 0 : 1), referenceContent: this.memory === null || exactReference };
    // Complete the scripted turn even on a bad probe, then report fixed booleans outside the SDK.
    // Throwing inside stream can be consumed by host error handling and hide the actual mismatch.
    this.requests.push({ digest: digest(JSON.stringify({ systems, texts })), systemDigest: digest(JSON.stringify(systems)), commonTask: valid.commonTask!, exactReference, valid });
    const text = 'Scripted exposure rehearsal only. No repair generated or task acceptance evaluated.';
    yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function providerExposure(item: StudyCase, memory: string | null) {
  const ctx = new Context(); const adapter = new ExposureAdapter(studyTaskInput(item), memory);
  try {
    for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await ctx.plugin(plugin).await();
    await ctx.plugin(SystemPrompt, {}).await(); await ctx.plugin(ToolRuntime, { mode: 'native' }).await();
    ctx.systemPrompt.section({ name: 'benefit-study-system', order: 100, text: studySystem, complete: true, interpolate: false });
    ctx.llm.registerAdapter(['benefit-offline'], adapter); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0 }));
    const handle = await ctx.agents.create({ sessionId: SessionId('exposure-' + randomUUID()), meta: {},
      agentOptions: { provider: 'benefit-offline', model: 'scripted', maxTokens: 2048 } });
    try {
      const content = [{ type: 'text' as const, text: studyTaskInput(item) }, ...(memory ? [{ type: 'text' as const, text: marker + memory }] : [])];
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([handle.agent.whenIdle(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('scripted_exposure_timeout')), 30000); timer.unref();
      })]); } finally { clearTimeout(timer); }
      assert.equal(adapter.requests.length, 1, 'Idle is insufficient; an actual GenerateOptions must be observed');
      assert(Object.values(adapter.requests[0]!.valid).every(Boolean), 'scripted_input_mismatch:' + JSON.stringify(adapter.requests[0]!.valid));
      return adapter.requests[0]!;
    } finally { await handle.dispose(); }
  } finally { await ctx.fiber.dispose(); }
}

export async function prepareBenefitStudy(parent = join(repository, '.probe-work/t061-study-preparation'), python = process.env.EVOLVE_PYTHON ?? 'python') {
  const root = await newStudyRoot(parent); const started = Date.now();
  const implementationPaths = ['scripts/benefit-study-cases.ts', 'scripts/benefit-study-preflight.ts',
    'src/service.ts', 'src/owner-task-input.ts', 'src/retrieval.ts'];
  const implementationSnapshot = async () => Object.fromEntries(await Promise.all(implementationPaths.map(async path => [path, digest(await readFile(join(repository, path)))])));
  const implementation = await implementationSnapshot();
  const executionSnapshot = async () => ({ preflight: digest(await readFile(fileURLToPath(import.meta.url))),
    cases: digest(await readFile(fileURLToPath(new URL('./benefit-study-cases.js', import.meta.url)))) });
  const execution = await executionSnapshot();
  const fixtureDigest = digest(JSON.stringify({ studyCases, studySources }));
  const methodDigest = digest(JSON.stringify({ studySchedule, studySystem, retrievalPolicyDigest, execution,
    taskInput: studyTaskInput.toString(), version: 'benefit-preflight-v1.1' }));
  const bank = await createStudySourceBank(root, python);
  try {
    const controls = [];
    for (const item of studyCases) {
      const folder = join(root, item.id); await mkdir(folder); const tests = join(folder, 'checks'); await mkdir(tests);
      await writeFile(join(tests, 'test_contract.py'), item.checks);
      const outcomes = [];
      const variants = [['before', item.before], ['reference', item.reference], ['wrong', item.wrong], ...Object.entries(item.additionalWrong ?? {})];
      for (const [variant, code] of variants) {
        assert(variant && code);
        validateStudyCode(python, code); await writeFile(join(folder, 'target.py'), code);
        const run = await runPilotTests(python, folder, tests, join(root, item.id + '-' + variant + '.xml'));
        const expected = variant === 'reference' ? passes(run) : reproduces(run);
        assert(expected, item.id + ' ' + variant + ' control failed');
        outcomes.push({ variant, codeDigest: digest(code), ...briefPilotTests(run), passed: passes(run), cases: run.cases });
      }
      controls.push({ case: item.id, family: item.family, authoredApplicable: item.expectedApplicable, outcomes });
    }
    // Targets and reference controls are never part of the source bank or provider prompt.
    const exposure = [];
    for (const item of studyCases) for (const arm of studyArms) {
      const selected = await selectStudyReference(bank.store, bank.repo, item, arm, python);
      const proof = await providerExposure(item, selected.memory);
      const { memory: _memory, ...selection } = selected;
      exposure.push({ case: item.id, arm, ...selection, commonPromptDigest: digest(studyTaskInput(item)),
        providerInputDigest: proof.digest, commonSystemDigest: proof.systemDigest, actualScriptedRequests: 1, commonTaskPresent: proof.commonTask,
        referencePresent: proof.exactReference, selectionAgreesWithAuthoredLabel: arm === 'none' ? null
          : selected.selectedFamily === item.family && item.expectedApplicable || !selected.memory && !item.expectedApplicable,
        realModelAcceptance: null, paidHttpCalls: 0 });
    }
    assert.deepEqual(await implementationSnapshot(), implementation, 'Preparation source changed during this run');
    assert.deepEqual(await executionSnapshot(), execution, 'Preparation compiled entry changed during this run');
    const runtime = { node: process.version, python: execFileSync(python, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 }).trim(),
      sdk: Object.fromEntries(await Promise.all(['dsh-agent', 'dsh-agent-loop', 'dsh-llm'].map(async name =>
        [name, (JSON.parse(await readFile(join(repository, 'node_modules/@deepseek-ai', name, 'package.json'), 'utf8')) as { version: string }).version]))) };
    const report = { kind: 'zero-http-benefit-study-preparation', schemaVersion: 1, fixtureVersion: studyFixtureVersion, fixtureDigest, methodDigest, implementation, execution, runtime,
      plannedRealTrials: studySchedule.length, schedule: studySchedule, realTrialsStarted: 0, paidHttpCalls: 0,
      sourceProofs: bank.proofs, controls, exposure, elapsedMs: Date.now() - started,
      futureBenefitProven: false, liveExecutionImplemented: false, spendingAuthorized: false,
      limitations: ['six authored visible synthetic cases, not a blind holdout', 'three authored strategies independently source-verified; no model extraction',
        'source-service selection projected into a uniform actual scripted AgentLoop request; not full production host comparison',
        'reference controls are author repairs, not model output or benefit', 'future live runner, frozen dependencies, current prices and fresh budget authorization still required'] };
    await writeFile(join(root, 'preparation.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    return { root, report };
  } finally { bank.store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== 'prepare') throw new Error('Usage: node dist/scripts/benefit-study-preflight.js prepare (zero HTTP only)');
  const { root, report } = await prepareBenefitStudy();
  process.stdout.write(JSON.stringify({ report: join(root, 'preparation.json'), fixtureDigest: report.fixtureDigest,
    plannedRealTrials: report.plannedRealTrials, actualScriptedRequests: report.exposure.length, paidHttpCalls: 0,
    referencePresent: Object.fromEntries(studyArms.map(arm => [arm, report.exposure.filter(r => r.arm === arm && r.referencePresent).length])),
    futureBenefitProven: false }) + '\n');
}
