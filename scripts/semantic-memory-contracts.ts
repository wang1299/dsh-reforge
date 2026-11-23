import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from '../src/domain.js';
import { semanticCorpusSchema } from './semantic-memory-data.js';

/** Executes only the fixed authored public corpus, never model output, a profile or a private repository. */
export function checkSemanticContracts() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const raw = readFileSync(join(root, 'test/fixtures/semantic-memory-v1.json')); const corpus = semanticCorpusSchema.parse(JSON.parse(raw.toString()));
  const parent = join(root, '.probe-work/t072'); mkdirSync(parent, { recursive: true });
  const run = mkdtempSync(join(parent, 'contracts-'));
  const python = process.env.EVOLVE_PYTHON ?? 'python';
  const version = execFileSync(python, ['-c', 'import platform;print(platform.python_version())'], { encoding: 'utf8', windowsHide: true }).trim();
  const rows = corpus.families.flatMap(f => (['original', 'reference', 'counterexample'] as const).map(kind => {
    const directory = join(run, f.id, kind); const repo = join(directory, 'repo'); const acceptance = join(directory, 'acceptance');
    mkdirSync(repo, { recursive: true }); mkdirSync(acceptance);
    const code = f.contract[kind]; const test = 'import sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path(__file__).resolve().parents[1]/"repo"))\n' + f.contract.acceptance;
    writeFileSync(join(repo, 'task.py'), code); writeFileSync(join(acceptance, 'test_contract.py'), test);
    const xml = join(directory, 'results.xml');
    const result = spawnSync(python, ['-I', '-m', 'pytest', '-q', '--junitxml=' + xml, acceptance], {
      cwd: repo, windowsHide: true, timeout: 30000, encoding: 'utf8', maxBuffer: 32768,
      env: { ...process.env, PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTHONHASHSEED: '0' } });
    let xmlText = ''; try { xmlText = readFileSync(xml, 'utf8'); } catch { /* Missing receipt is not a test failure proof. */ }
    const match = xmlText.match(/<testsuite\b[^>]*\btests="(\d+)"[^>]*>/); const suite = match?.[0] ?? '';
    const attr = (name: string) => Number(suite.match(new RegExp('\\b' + name + '="(\\d+)"'))?.[1] ?? 'NaN');
    const tests = attr('tests'), failures = attr('failures'), errors = attr('errors'), skipped = attr('skipped');
    const known = result.signal === null && tests === 2 && errors === 0 && skipped === 0 && Number.isFinite(failures);
    const expectedPass = kind === 'reference'; const matched = known && (expectedPass ? result.status === 0 && failures === 0 : result.status === 1 && failures > 0);
    return { family: f.id, split: f.split, kind, expectedPass, matched, exitCode: result.status, tests: Number.isFinite(tests) ? tests : null,
      failures: Number.isFinite(failures) ? failures : null, errors: Number.isFinite(errors) ? errors : null, skipped: Number.isFinite(skipped) ? skipped : null,
      codeDigest: digest(code), acceptanceDigest: digest(test), receiptDigest: xmlText ? digest(xmlText) : null };
  }));
  const report = { schema: 1, kind: 'authored-task-contract-controls', corpusDigest: digest(raw), pythonVersion: version,
    paidHttpCalls: 0, modelTasks: 0, sourceQualifiedExperiences: 0, passed: rows.every(row => row.matched), rows };
  writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return { ...report, reportPath: join(run, 'report.json') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = checkSemanticContracts(); process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (!report.passed) process.exitCode = 1;
}
