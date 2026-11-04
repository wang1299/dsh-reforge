import { execFileSync, spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/repository.js';
import { parsePytest, passes } from '../src/verification.js';
import type { TestRun } from '../src/domain.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
export const sourceCode = 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        raise ValueError("transaction failed")\n    return state["balance"]\n';
export const offlineRepair = sourceCode.replace('        raise ValueError', '        state["balance"] = before\n        raise ValueError');
export const sourcePrompt = '纠正：transaction rollback failure must restore the original balance. Fix ledger.py below: if fail=True raises ValueError, state["balance"] must remain its original value; success increments once. Use fixture_write_source to replace this function. Do not call evolve tools, edit tests or change configuration. After the write succeeds, finish your turn.\n\n' + sourceCode;
export const laterPrompt = 'For a later transaction rollback failure, explain one relevant safety check before changing code. Do not edit files or call tools. Use an offered reference only if it applies.';
export const sourceAcceptance = `import pytest
from ledger import apply_change
def test_failed_transaction_restores_original_balance():
    state = {"balance": 17}
    with pytest.raises(ValueError):
        apply_change(state, True)
    assert state["balance"] == 17
`;
export const sourceRegression = `from ledger import apply_change
def test_success_increments_once():
    state = {"balance": 2}
    assert apply_change(state) == 3
    assert state["balance"] == 3
`;
export type PilotCase = { id: string; file: string; entry: string; summary: string; code: string; acceptance: string; regression: string };
export async function pilotCases(): Promise<PilotCase[]> {
  const form = await readFile(join(workspace, 'examples/customer-form/before/form_state.py'), 'utf8');
  return [{ id: 'stock', file: 'stock.py', entry: 'reserve', summary: 'Fix inventory transaction rollback: preserve remaining stock if persistence fails; keep successful reservation and insufficient-stock behavior.',
    code: 'def reserve(stock, quantity, persist):\n    if quantity <= 0:\n        raise ValueError("quantity must be positive")\n    if stock["remaining"] < quantity:\n        return False\n    stock["remaining"] -= quantity\n    persist(dict(stock))\n    return True\n',
    acceptance: `import pytest
from stock import reserve
def test_failed_persistence_restores_remaining():
    stock = {"remaining": 9}
    def unavailable(value):
        raise OSError("synthetic persistence failure")
    with pytest.raises(OSError):
        reserve(stock, 3, unavailable)
    assert stock == {"remaining": 9}
`, regression: `import pytest
from stock import reserve
def test_success_reserves_exactly_once():
    stock = {"remaining": 9}
    seen = []
    assert reserve(stock, 3, lambda value: seen.append(dict(value))) is True
    assert stock == {"remaining": 6} and seen == [{"remaining": 6}]
def test_insufficient_stock_is_unchanged():
    stock = {"remaining": 2}
    seen = []
    assert reserve(stock, 3, lambda value: seen.append(value)) is False
    assert stock == {"remaining": 2} and seen == []
def test_invalid_quantity_is_rejected_without_writing():
    stock = {"remaining": 9}
    with pytest.raises(ValueError):
        reserve(stock, 0, lambda value: None)
    assert stock == {"remaining": 9}
` }, { id: 'form', file: 'customer_form.py', entry: 'submit',
    summary: 'Fix customer form transaction rollback: preserve every input when persistence fails and clear the draft only after success.', code: form,
    acceptance: (await readFile(join(workspace, 'examples/customer-form/acceptance/test_acceptance.py'), 'utf8')).replaceAll('from form_state import', 'from customer_form import'),
    regression: (await readFile(join(workspace, 'examples/customer-form/project/tests/test_regression.py'), 'utf8')).replaceAll('from form_state import', 'from customer_form import') }];
}
export async function createPilotFixture(root: string): Promise<{ repo: string; acceptance: string; base: string }> {
  const rel = relative(join(workspace, '.probe-work'), resolve(root));
  if (!rel || isAbsolute(rel) || rel.startsWith('..' + sep) || rel === '..') throw new Error('Pilot fixtures stay in this repository ignored directory');
  await mkdir(root); const repo = join(root, 'project'); const acceptance = join(root, 'source-acceptance');
  await mkdir(repo); await mkdir(acceptance); await mkdir(join(repo, 'tests'));
  await writeFile(join(repo, 'ledger.py'), sourceCode);
  await writeFile(join(repo, 'contract.py'), 'POLICY = "restore-only-on-failure"\n');
  await writeFile(join(repo, 'requirements.txt'), '# synthetic standard-library case; pytest supplied externally\n');
  await writeFile(join(repo, 'tests/test_regression.py'), sourceRegression);
  await writeFile(join(acceptance, 'test_acceptance.py'), sourceAcceptance);
  for (const item of await pilotCases()) {
    await writeFile(join(repo, item.file), item.code); const tests = join(root, item.id + '-checks'); await mkdir(tests);
    await writeFile(join(tests, 'test_acceptance.py'), item.acceptance); await writeFile(join(tests, 'test_regression.py'), item.regression);
  }
  execFileSync('git', ['init', '-b', 'codex/pilot-fixture', repo], { windowsHide: true, stdio: 'ignore' });
  git(repo, ['config', 'user.name', 'DSH-Reforge Pilot']); git(repo, ['config', 'user.email', 'pilot@example.invalid']); git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['add', '--', 'ledger.py', 'stock.py', 'customer_form.py', 'contract.py', 'requirements.txt', 'tests/test_regression.py']);
  execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '-m', 'synthetic source and held-out targets'],
    { windowsHide: true, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-04T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-04T00:00:00Z' } });
  return { repo, acceptance, base: git(repo, ['rev-parse', 'HEAD']) };
}

const validator = `import ast,sys
tree=ast.parse(sys.argv[1]); entry=sys.argv[2]
assert len(tree.body)==1 and isinstance(tree.body[0],ast.FunctionDef) and tree.body[0].name==entry
nodes=list(ast.walk(tree)); assert len(nodes)<=300
allowed={'Module','FunctionDef','arguments','arg','Assign','AugAssign','Return','If','Raise','Try','ExceptHandler','Expr','Dict','List','Tuple','Name','Load','Store','Subscript','Constant','Attribute','Call','Compare','BinOp','UnaryOp','BoolOp','And','Or','Not','Add','Sub','USub','Eq','NotEq','Lt','LtE','Gt','GtE','Is','IsNot','In','NotIn','Pass','keyword'}
for n in nodes:
    assert type(n).__name__ in allowed
    if isinstance(n,ast.Name): assert not n.id.startswith('__')
    if isinstance(n,ast.Attribute): assert n.attr in {'get','clear','copy','update','items','append','strip'}
    if isinstance(n,ast.Constant) and isinstance(n.value,int): assert abs(n.value)<=10000
    if isinstance(n,ast.Call): assert (isinstance(n.func,ast.Name) and n.func.id in {'persist','dict','len','ValueError','OSError'}) or isinstance(n.func,ast.Attribute)
print('valid')
`;
export function validatePilotCode(python: string, code: string, entry: string): void {
  if (Buffer.byteLength(code) > 4096) throw new Error('Pilot code too large');
  try { execFileSync(python, ['-I', '-c', validator, code, entry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 4096 }); }
  catch { throw new Error('invalid_bounded_pilot_function'); }
}

export async function runPilotTests(python: string, repository: string, tests: string, xml: string): Promise<TestRun> {
  const outputFile = await open(xml, 'wx', 0o600); await outputFile.close();
  const config = xml + '.ini'; await writeFile(config, '[pytest]\n', { flag: 'wx', mode: 0o600 });
  const controller = new AbortController(); const began = Date.now(); let timedOut = false; let output = '';
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  const child = spawn(python, ['-m', 'pytest', tests, '-q', '-c', config, '--import-mode=importlib', '-p', 'no:cacheprovider', '--junitxml', xml],
    { cwd: repository, signal: controller.signal, windowsHide: true,
      env: { ...process.env, PYTHONPATH: repository, PYTHONDONTWRITEBYTECODE: '1', PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTEST_ADDOPTS: '' } });
  child.stdout.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-2000); });
  child.stderr.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-2000); });
  const code = await new Promise<number | null>(done => { child.once('error', () => { /* close follows error/abort. */ }); child.once('close', done); });
  clearTimeout(timer); let report = ''; try { report = await readFile(xml, 'utf8'); } catch { /* Missing results are unknown, not passes. */ }
  return parsePytest(code, report, Date.now() - began, timedOut, output);
}
export function briefPilotTests(run: TestRun): object {
  return { passed: passes(run), exitCode: run.exitCode, tests: run.tests, failures: run.failures, errors: run.errors, skipped: run.skipped, timedOut: run.timedOut };
}
