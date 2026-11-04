import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { createService } from '../src/config.js';
import { digest, type Evidence, type Verification } from '../src/domain.js';
import { startPanel } from '../src/panel.js';
import { git } from '../src/repository.js';

const run = promisify(execFile);
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const assets = join(workspace, 'examples', 'customer-form');
const submissionSchema = z.object({
  draft: z.object({ name: z.string().max(160), phone: z.string().max(160), note: z.string().max(4000) }).strict(),
  fail: z.boolean(),
}).strict();

export function examplePython(explicit?: string): string {
  const candidates = explicit ? [[explicit]] : process.env.EVOLVE_PYTHON ? [[process.env.EVOLVE_PYTHON]]
    : process.platform === 'win32' ? [['py', '-3.10'], ['python'], ['py', '-3']] : [['python3'], ['python']];
  for (const [command, ...args] of candidates) {
    try {
      return execFileSync(command!, [...args, '-c', 'import sys,pytest; assert sys.version_info >= (3,10); print(sys.executable)'],
        { encoding: 'utf8', timeout: 10000, maxBuffer: 4096, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch { /* Try only local Python discovery; never install or contact a provider. */ }
  }
  throw new Error('Python >=3.10 with pytest is required. Install pytest locally: <python> -m pip install pytest==9.1.1; then pass --python <executable>.');
}

export async function startCustomerForm(pythonInput?: string): Promise<{
  origin: string; panelUrl: string; home: string; close: () => Promise<void>;
}> {
  const python = examplePython(pythonInput);
  const parent = join(workspace, '.probe-work'); await mkdir(parent, { recursive: true });
  const home = await mkdtemp(join(parent, 'customer-form-'));
  const repo = join(home, 'project'); const acceptance = join(home, 'acceptance');
  await cp(join(assets, 'project'), repo, { recursive: true });
  await cp(join(assets, 'acceptance'), acceptance, { recursive: true });
  await cp(join(assets, 'before', 'form_state.py'), join(repo, 'form_state.py'));
  execFileSync('git', ['init', '-b', 'codex/customer-form', repo], { stdio: 'ignore', windowsHide: true });
  git(repo, ['config', 'user.name', 'DSH-Reforge Example']); git(repo, ['config', 'user.email', 'example@example.invalid']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['add', '--', 'form_state.py', 'contract.py', 'requirements.txt', 'tests/test_regression.py']);
  git(repo, ['-c', 'core.hooksPath=', 'commit', '-m', 'example: reproduce input loss on save failure']);
  const baseCommit = git(repo, ['rev-parse', 'HEAD']);
  const config = { repoRoot: repo, dataDir: join(home, 'data'), python, acceptanceDir: acceptance,
    executionTrusted: true, shareWithModel: false, backgroundVerification: false, automaticLearning: false,
    regressionPath: 'tests', timeoutMs: 30000 };
  await writeFile(join(home, 'config.json'), JSON.stringify(config, null, 2));
  const { service } = createService(config);
  const task = service.begin(randomUUID(), '客户表单保存失败丢失输入；失败保留输入，成功后才清空');
  const state = { stage: 'broken', correction: null as Evidence | null, fixed: false, candidateId: null as string | null,
    verified: false, report: null as Verification | null, saved: 0, requests: 0 };
  let panel: Awaited<ReturnType<typeof startPanel>>;
  try { panel = await startPanel(service); } catch (error) { service.store.close(); throw error; }
  const page = await readFile(join(assets, 'app.html'), 'utf8');
  let origin = ''; let busy = false; let closing = false;
  const pending = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    const active = handle(request, response).finally(() => pending.delete(active)); pending.add(active);
  });
  function summary() {
    return { ...state, correction: state.correction !== null, baseCommit,
      diff: state.fixed ? git(repo, ['diff', baseCommit, 'HEAD', '--', 'form_state.py']) : '',
      experienceCount: service.store.experiences().length, modelCalls: 0, automaticExtraction: false };
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (code: number, value: unknown): void => {
      response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
    };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (closing) { send(503, { error: 'Example is stopping; preserve this run and open its panel later.' }); return; }
      if (request.headers.host !== new URL(origin).host) { send(403, { error: 'Invalid local host' }); return; }
      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page); return;
      }
      if (request.method === 'GET' && request.url === '/api/state') { send(200, summary()); return; }
      if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
        send(403, { error: 'Same-origin JSON required' }); return;
      }
      if (!['/api/save', '/api/correct', '/api/fix', '/api/verify'].includes(request.url ?? '')) {
        send(404, { error: 'Unknown operation' }); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      for await (const data of request) {
        const chunk = Buffer.from(data as Uint8Array); size += chunk.length;
        if (size > 16000) { send(413, { error: 'Example request exceeds 16 kB' }); return; } chunks.push(chunk);
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (busy) { send(409, { error: 'Another operation is running; refresh state before continuing.' }); return; }
      busy = true;
      try {
        if (request.url === '/api/save') {
          const data = submissionSchema.parse(input); state.requests++;
          const { stdout } = await run(python, ['-c',
            'import json,sys; from form_state import submit; data=json.loads(sys.argv[1]); fail=data["fail"]; draft=data["draft"]; persist=lambda item: (_ for _ in ()).throw(OSError("synthetic failure")) if fail else None; print(json.dumps(submit(draft,persist),ensure_ascii=False))', JSON.stringify(data)],
          { cwd: repo, timeout: 10000, maxBuffer: 32768, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
          const result = JSON.parse(stdout) as { ok: boolean };
          if (result.ok) state.saved++;
          send(result.ok ? 200 : 503, { ...result, saved: state.saved, requests: state.requests }); return;
        }
        z.object({}).strict().parse(input);
        if (request.url === '/api/correct') {
          if (state.correction) { send(409, { error: 'Correction already recorded.' }); return; }
          state.correction = service.correction(task.id, '保存失败时保留姓名、电话和备注，显示错误并允许手动重试；只有保存成功后才能清空输入。');
          state.stage = 'corrected';
        } else if (request.url === '/api/fix') {
          if (!state.correction || state.fixed) { send(409, { error: 'Unexpected repair stage.' }); return; }
          // Write the patch so Git observes a fresh mtime even when NTFS copies preserve source timestamps.
          await writeFile(join(repo, 'form_state.py'), await readFile(join(assets, 'after', 'form_state.py')));
          git(repo, ['add', '--', 'form_state.py']);
          git(repo, ['-c', 'core.hooksPath=', 'commit', '-m', 'fix: clear the draft only after persistence succeeds']);
          state.fixed = true; state.stage = 'fixed';
        } else {
          if (!state.fixed || !state.correction || state.candidateId) {
            send(409, { error: 'Verification already attempted or repair incomplete; inspect the retained run.' }); return;
          }
          const fact = '本次明确纠正要求保存失败保留姓名、电话和备注，只有成功后才清空输入。';
          const candidate = service.propose(task.id, {
            title: '客户保存失败时保留全部输入',
            strategy: '提交时保留用户草稿；外部保存失败则显示错误，允许手动重试；确认保存成功后才清空。分别验收失败、成功与回归路径。',
            observedFacts: [fact], inferences: ['其他表单仍需各自验收。'],
            recommendations: ['分别测试失败保留输入、成功清空和重复点击保护。'], requiredFiles: ['contract.py'],
          }, [{ factIndex: 0, factDigest: digest(fact), evidenceId: state.correction.id, evidenceDigest: state.correction.digest }]);
          state.candidateId = candidate.id; state.stage = 'verifying';
          const experience = await service.verify(candidate.id);
          state.verified = experience.status === 'source_verified';
          state.report = experience.verificationId ? service.store.verification(experience.verificationId) : null;
          state.stage = state.verified ? 'verified' : 'not_verified';
          if (state.verified) service.finish(task.id);
          await writeFile(join(home, 'result.json'), JSON.stringify({
            kind: 'synthetic-explicit-customer-form', sourceVerified: state.verified,
            checks: state.report && { base: state.report.base, fixed: state.report.fixed, regression: state.report.regression },
            experiences: service.store.experiences().length, applications: service.store.applications().length,
            feedback: service.store.feedback().length, modelCalls: 0, automaticExtraction: false, futureBenefit: 'not_evaluated',
          }, null, 2));
        }
        send(200, summary());
      } finally { busy = false; }
    } catch {
      send(400, { error: 'Operation failed. Refresh state and inspect the retained example; do not repeat unknown operations.' });
    }
  }
  try {
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  } catch (error) { await panel.close(); service.store.close(); throw error; }
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing example address');
  origin = `http://127.0.0.1:${address.port}`;
  let closed: Promise<void> | undefined;
  return { origin, panelUrl: panel.url, home, close: () => closed ??= (async () => {
    closing = true;
    const stopped = new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    server.closeIdleConnections(); await Promise.allSettled([...pending]); await stopped;
    await panel.close(); service.store.close();
  })() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--python')) throw new Error('Usage: npm run example:customer-form -- [--python <executable>]');
  const example = await startCustomerForm(args[1]);
  console.log(`Customer form: ${example.origin}\nPrivate experience panel (do not share): ${example.panelUrl}\nRetained run: ${example.home}\nSynthetic explicit demo; zero model calls. Ctrl+C stops both pages.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void example.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
}
