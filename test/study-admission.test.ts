import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LlmAdapter, resolveRetryPolicy, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { studyCases, studySources, studySystem, studyTaskInput } from '../scripts/benefit-study-cases.js';
import { executeBenefitTrial, repairFeedback } from '../scripts/benefit-trial-controller.js';
import { readStudyAdmissionReceipt, StudyValidationError, validateStudyCode } from '../scripts/study-admission.js';
import { inspectStudyInput } from '../scripts/study-controller-driver.js';
import { studyAdmissionContract } from '../src/study-admission-contract.js';

// Independent copy of the original ADR056/059 predicate, before reasons were added.
const legacy = `import ast,sys
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
const python = process.env.EVOLVE_PYTHON ?? 'python';
test('diagnostic validator agrees with the historical predicate on frozen controls and boundary syntax', () => {
  const syntax = ['def repair(x):\n    return {1,2}\n', 'def repair(x):\n    return [i for i in x]\n',
    'def repair(x):\n    return x()\n', 'def repair(x):\n    return x.secret\n', 'def repair(x):\n    return __private\n',
    'def repair(x):\n    return SECRET_SENTINEL\n', 'def repair(x):\n    dict = x\n    return dict\n',
    'def repair(x):\n    return 10001\n', 'def repair(x):\n    return 10000\n', 'def repair(x):\n    return -10000\n',
    'def other(x):\n    return x\n', '@dict\ndef repair(x):\n    return x\n', 'def repair(x):\n    return (\n',
    'def repair(x):\n' + '    x = 1\n'.repeat(120) + '    return x\n',
    'def repair(x):\n    def local(y):\n        return y\n    return x\n'];
  const controls = [...studyCases.flatMap(c => [c.before, c.reference, c.wrong, ...Object.values(c.additionalWrong ?? {})]),
    ...studySources.flatMap(s => [s.before, s.reference]), ...syntax];
  for (const code of controls) {
    let admitted = true; try { execFileSync(python, ['-I', '-c', legacy, code], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); } catch { admitted = false; }
    if (admitted) assert.doesNotThrow(() => validateStudyCode(python, code));
    else assert.throws(() => validateStudyCode(python, code), e => e instanceof StudyValidationError && e.kind === 'rejected' && !!e.diagnostic);
  }
});

test('rejection feedback contains only finite metadata and a static allowed subset, never rejected names or code', () => {
  const cases = [
    ['def repair(x):\n    return {1}\n', 'unsupported_syntax', 'Set'],
    ['def repair(x):\n    return x.PRIVATE_SENTINEL\n', 'attribute', 'Attribute'],
    ['def repair(x):\n    return PRIVATE_SENTINEL\n', 'unbound_name', 'Name'],
    ['def repair(x):\n    return (\n', 'syntax_error', 'other'],
    ['#'.repeat(4097), 'code_size', 'other'],
  ];
  for (const [code, rule, node] of cases) {
    assert.throws(() => validateStudyCode(python, code!), e => {
      assert(e instanceof StudyValidationError); assert.equal(e.kind, 'rejected');
      assert.deepEqual(e.diagnostic, { schema: 1, rule, node });
      const feedback = repairFeedback('invalid_code', null, e.diagnostic);
      assert(feedback.includes(studyAdmissionContract().allowedSubset)); assert(feedback.length < 1600);
      assert(!feedback.includes('PRIVATE_SENTINEL') && !feedback.includes(code!));
      assert(!JSON.stringify(e).includes('PRIVATE_SENTINEL')); return true;
    });
  }
  for (const receipt of ['study-ast-accepted-v2\nextra', 'study-ast-rejected-v1\n', 'study-ast-v2:{}\n',
    'study-ast-v2:{"schema":1,"rule":"attribute","node":"PRIVATE_SENTINEL"}\n',
    'study-ast-v2:{"schema":1,"rule":"attribute","node":"Attribute","code":"SECRET"}\n']) {
    assert.throws(() => readStudyAdmissionReceipt(receipt), e => e instanceof StudyValidationError && e.kind === 'unknown' && !e.diagnostic);
  }
  assert.doesNotThrow(() => readStudyAdmissionReceipt('study-ast-accepted-v2\n'));
  assert.throws(() => validateStudyCode('missing-study-python-t066', studyCases[0]!.reference), e => e instanceof StudyValidationError && e.kind === 'unknown');
  // argv cannot contain NUL: transport never reached Python, same unknown as the old executor.
  assert.throws(() => validateStudyCode(python, 'def repair(x):\n    return x\x00\n'), e => e instanceof StudyValidationError && e.kind === 'unknown');
});

test('actual AgentLoop sees actionable diagnostics only in round two; original task/reference/system stay unchanged', { timeout: 30000 }, async () => {
  const item = studyCases[0]!, memory = 'fallible synthetic reference';
  class Adapter extends LlmAdapter {
    calls = 0; round = 0; inputDigests: string[] = []; sawSecond = false;
    override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'test no HTTP'); }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      this.calls++; this.inputDigests.push(inspectStudyInput(options, item, memory, this.round, 'study-controller-scripted', 'scripted'));
      const users = options.messages.filter(m => m.role === 'user').flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
      assert(users.includes(studyTaskInput(item)));
      assert(options.messages.some(m => m.role === 'system' && m.content.some(b => b.type === 'text' && b.text.includes(studySystem))));
      const feedback = users.filter(t => t.startsWith('Independent repair check:'));
      if (this.round === 1) { assert.equal(feedback.length, 0); assert(!users.some(t => t.includes('Bounded Python policy'))); }
      else { assert.equal(feedback.length, 1); assert(feedback[0]!.includes('unsupported_syntax')); assert(feedback[0]!.includes('"node":"Set"')); this.sawSecond = true; }
      const text = JSON.stringify({ code: this.round === 1 ? 'def repair(state):\n    return {1}\n' : item.reference });
      yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const adapter = new Adapter(), parent = fileURLToPath(new URL('../../.probe-work/t066-controller-tests', import.meta.url));
  const trial = await executeBenefitTrial({ parent, item, memory, mode: 'synthetic-feedback-control' },
    { kind: 'scripted', provider: 'study-controller-scripted', model: 'scripted', adapter });
  assert(adapter.sawSecond); assert.deepEqual(trial.result.attempts.map(a => a.status), ['invalid_code', 'accepted']);
  assert.deepEqual(trial.result.attempts[0]!.admission, { schema: 1, rule: 'unsupported_syntax', node: 'Set' });
  assert.equal(trial.result.attempts[0]!.executionAttempted, false); assert.equal(trial.result.modelHttpRequests, 0);
});
