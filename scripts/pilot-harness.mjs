import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as pause } from 'node:timers/promises';
import { digest, redact } from '../dist/src/domain.js';
import { git } from '../dist/src/repository.js';
import { PilotBudget, pilotPolicy, startPilotRelay } from '../dist/scripts/pilot-budget.js';
import { offlineRepair, sourcePrompt, laterPrompt, validatePilotCode } from '../dist/scripts/pilot-fixtures.js';

export async function pilotHost(host) {
  const anchor = join(resolve(host), 'package.json'); const require = createRequire(anchor);
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const boot = await load('@deepseek-ai/dsh-app-boot'); assert.equal(boot.getDshRuntimeVersion(), '0.2.1-rc.5');
  return { anchor, load, boot, require };
}
export async function installPilotPackage(host, archive, root) {
  const runtime = await pilotHost(host); const profile = join(root, 'profile'); runtime.boot.initProfile(profile, []);
  const operations = await runtime.load('@deepseek-ai/dsh-plugin-manager/operations');
  const result = await operations.runPluginCommand({ profile: 'reforge-pilot', dir: profile, home: root, installAnchor: runtime.anchor, cwd: root },
    ['add', archive, '--ignore-scripts', '--reporter=append-only', '--store-dir=' + join(root, 'pnpm-store')],
    { execution: 'service', outputBytes: 4000, idleTimeoutMs: 45000, signal: AbortSignal.timeout(180000) });
  assert.equal(result.exitCode, 0, 'Official isolated install failed');
  const loaded = runtime.boot.loadProfileDirectory('dsh', profile, runtime.anchor);
  assert.equal(loaded.skippedBundles.length, 0); assert.equal(loaded.layers.length, 1);
  const packageDir = loaded.layers[0].packageDir; assert.equal(loaded.layers[0].packageName, 'dsh-reforge');
  const productFiles = {};
  for (const file of (await readdir(join(packageDir, 'dist/src'))).filter(file => file.endsWith('.js'))) {
    const installed = await readFile(join(packageDir, 'dist/src', file));
    assert.deepEqual(installed, await readFile(join('dist/src', file)), 'Installed product differs from frozen source');
    productFiles[file] = digest(installed);
  }
  await writeFile(join(profile, 'cordis.yml'), '[]\n');
  return { profile, packageDir, productFiles, patches: [...loaded.layers.flatMap(layer => layer.patches), ...loaded.patches] };
}

function syntheticStream(blocks, stop = 'end_turn') {
  const frame = value => 'event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n';
  let text = frame({ type: 'message_start', message: { id: 'offline-' + randomUUID(), type: 'message', role: 'assistant', model: pilotPolicy.model,
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  for (const [index, block] of blocks.entries()) {
    text += frame({ type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
    text += frame({ type: 'content_block_delta', index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text }
      : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    text += frame({ type: 'content_block_stop', index });
  }
  return text + frame({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: {
    input_tokens: 100, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, service_tier: 'standard' } }) + frame({ type: 'message_stop' });
}
export function offlinePilotTransport() {
  return async (_url, options) => {
    const body = JSON.parse(Buffer.from(options.body).toString('utf8')); const all = JSON.stringify(body);
    let blocks; let stop = 'end_turn';
    if (all.includes('untrusted evidence')) blocks = [{ type: 'text', text: JSON.stringify({ kind: 'candidate',
      title: 'transaction rollback failure restore balance', strategy: 'Save the original value and restore it before raising on persistence failure.',
      factIds: ['verification:base', 'verification:fixed', 'verification:regression'], inferences: [], recommendations: [] }) }];
    else if (all.includes(laterPrompt)) blocks = [{ type: 'text', text: 'Offline rehearsal: check rollback behavior against independent tests.' }];
    else if (!body.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'))) {
      blocks = [{ type: 'tool_use', id: 'offline-tool-' + randomUUID(), name: 'fixture_write_source', input: { code: offlineRepair } }]; stop = 'tool_use';
    } else blocks = [{ type: 'text', text: 'Offline rehearsal repair written; independent verification is still required.' }];
    return new Response(syntheticStream(blocks, stop), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

/** Actual installed product and official SDK/provider; only offline=true substitutes transport. */
export async function automaticPilot(input) {
  assert.equal(typeof input.offline, 'boolean'); assert.equal(typeof input.validate, 'function');
  if (!input.offline) assert.equal(input.live, true, 'Explicit live mode required');
  const runtime = await pilotHost(input.host);
  const [{ AgentRegistry }, AgentLoopModule, { LlmRuntime, createUserMessage }, { SessionId, SessionStore },
    { SessionProjectionRegistry }, { SystemPrompt }, { ToolRuntime, defineTool }, providerModule, credentialModule, credentialTypes] = await Promise.all([
    runtime.load('@deepseek-ai/dsh-agent'), runtime.load('@deepseek-ai/dsh-agent-loop'), runtime.load('@deepseek-ai/dsh-llm'),
    runtime.load('@deepseek-ai/dsh-session'), runtime.load('@deepseek-ai/dsh-session-projection'), runtime.load('@deepseek-ai/dsh-system-prompt'),
    runtime.load('@deepseek-ai/dsh-tools'), runtime.load('@deepseek-ai/dsh-llm-deepseek'), runtime.load('@deepseek-ai/dsh-credentials-local'),
    runtime.load('@deepseek-ai/dsh-credentials')]);
  const AgentLoop = AgentLoopModule.default; const route = 'reforge-pilot'; const handles = [];
  const budget = new PilotBudget(input.budgetFile); let phase = 'source'; let strategy = ''; let offered = false;
  const preparedByPhase = { source: 0, learning: 0, later: 0 }; const tools = [];
  const relay = await startPilotRelay(budget, { transport: input.offline ? offlinePilotTransport() : undefined,
    beforeForward: input.validate,
    inspect(body) {
      assert(++preparedByPhase[phase] <= (phase === 'source' ? 4 : phase === 'later' ? 2 : 1), 'Pilot phase request limit');
      if (phase === 'later' && strategy) offered ||= JSON.stringify(body).includes(strategy);
    } });
  const config = { repoRoot: input.fixture.repo, dataDir: join(input.root, 'data'), python: input.python,
    acceptanceDir: input.fixture.acceptance, regressionPath: 'tests', timeoutMs: 30000,
    executionTrusted: true, backgroundVerification: true, shareWithModel: true, automaticLearning: true,
    extraction: { grantId: input.grantId, provider: route, model: pilotPolicy.model, maxCalls: 1, maxTokens: 2048, timeoutMs: 120000 } };
  const connection = providerModule.resolveAdapterOptions({ baseURL: relay.baseURL, thinking: 'disabled', reasoningEffort: 'off',
    maxTokens: 2048, defaultContextWindow: 1048576, streamIdleTimeoutMs: 150000,
    retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: pilotPolicy.model, contextWindow: 1048576, maxTokens: 2048 }] });
  assert.equal(connection.retryPolicy.maxRetries, 0, 'Paid requests must never automatically retry');
  let ctx; let db; const report = { kind: input.offline ? 'offline-automatic-rehearsal' : 'real-model-automatic-integration',
    passed: false, stage: 'boot', sourceVerified: false, offered: false, laterResponse: false, extractionUsed: 0,
    modelHttpRequests: 0, tools, counts: null, sourceChecks: null, indexUnchanged: false, headUnchanged: false, reason: 'incomplete' };
  const index = await readFile(join(input.fixture.repo, '.git/index'));
  try {
    ctx = await runtime.boot.boot('dsh', join(input.profile.profile, 'cordis.yml'), [...input.profile.patches, { id: 'dsh-reforge', config }], async root => {
      for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime]) await root.plugin(plugin).await();
      await root.plugin(SystemPrompt, {}).await(); await root.plugin(ToolRuntime, { mode: 'native' }).await();
      if (input.offline) root.provide('credentials', {});
      else await root.plugin(credentialModule.LocalCredentialProvider, { path: input.credentialFile, watch: false }).await();
      const adapter = new providerModule.DeepSeekAdapter({ options: () => connection,
        resolveAuth: async () => {
          if (input.offline) return { headers: { Authorization: 'Bearer offline-synthetic-not-a-key' } };
          const credential = await root.credentials.resolve(credentialTypes.credentialRef('DEEPSEEK_API_KEY'));
          assert(credential?.value, 'Configure credentials locally in DSH');
          return { headers: { Authorization: 'Bearer ' + credential.value } };
        }, resolveUserId: () => input.anonymousId,
        resolveFiles: () => new providerModule.DeepSeekFileStore(join(input.root, 'unused-image-index.json')),
        prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) });
      root.llm.registerAdapter([route], adapter); await root.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }).await();
      root.tools.register(defineTool({ name: 'fixture_write_source', description: 'Replace only the synthetic ledger.py function with your repair. No other files, commands or configuration can be changed.',
        parameters: { code: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(args) {
          assert.equal(phase, 'source', 'Writes only during the source repair');
          validatePilotCode(input.python, args.code, 'apply_change'); await writeFile(join(input.fixture.repo, 'ledger.py'), args.code);
          return 'Synthetic source file updated. Independent acceptance has not yet run.';
        } }));
    }, pathToFileURL(join(input.profile.profile, 'package.json')).href);
    const module = await import(pathToFileURL(join(input.profile.packageDir, 'dist/src/dsh.js')).href);
    const entry = [...ctx.loader.entries()].find(item => item.options.name === 'dsh-reforge');
    assert.equal(entry?.moduleNamespace.apply, module.apply, 'Loader must execute the installed package');
    db = new DatabaseSync(join(input.root, 'data/evolve.sqlite'), { readOnly: true });
    ctx.on('tools/result', (exec, result) => { assert(tools.length < 12); tools.push({ name: exec.name, isError: result.isError }); });
    let lastText = '';
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'assistant/message' || event.data.interrupted) return;
      lastText = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('').slice(0, 8192);
    });
    async function turn(id, text) {
      lastText = ''; const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: input.fixture.repo },
        agentOptions: { provider: route, model: pilotPolicy.model, maxTokens: 2048, reasoningEffort: 'off' } }); handles.push(handle);
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
      let timer;
      try { await Promise.race([handle.agent.whenIdle(), new Promise((_, reject) => { timer = setTimeout(() => {
        handle.agent.cancel({ kind: 'hook', reason: 'pilot_deadline' }); reject(new Error('Pilot turn deadline')); }, 180000); })]); }
      finally { clearTimeout(timer); }
      assert(!budget.state.stopped, 'Paid requests stopped; preserve ledger'); return lastText;
    }
    report.stage = 'source_repair'; await turn('pilot-source-' + randomUUID(), sourcePrompt); phase = 'learning';
    assert.deepEqual(tools.map(item => item.name), ['fixture_write_source'], 'Ordinary source repair must not call evolve tools or repeat writes');
    report.stage = 'automatic_learning';
    for (let n = 0; n < 2400; n++) {
      const row = db.prepare('SELECT state FROM automatic_segments ORDER BY rowid LIMIT 1').get();
      if (row && !['capturing', 'open', 'queued', 'qualifying'].includes(row.state)) break;
      assert(!budget.state.stopped, 'Unknown financial receipt'); await pause(50);
    }
    const segment = db.prepare('SELECT state FROM automatic_segments ORDER BY rowid LIMIT 1').get(); assert.equal(segment?.state, 'learned');
    const experience = JSON.parse(String(db.prepare('SELECT body FROM experiences').get()?.body)); assert.equal(experience.status, 'source_verified'); strategy = experience.strategy;
    const proof = JSON.parse(String(db.prepare('SELECT body FROM verifications WHERE id=?').get(experience.verificationId)?.body)); assert.equal(proof.verified, true);
    report.sourceVerified = true; report.sourceChecks = Object.fromEntries(['base', 'fixed', 'regression'].map(key => [key,
      { tests: proof[key].tests, failures: proof[key].failures, errors: proof[key].errors, skipped: proof[key].skipped, exitCode: proof[key].exitCode }]));
    phase = 'later'; report.stage = 'later_reference'; const response = await turn('pilot-later-' + randomUUID(), laterPrompt);
    report.laterResponse = response.length > 0; report.offered = offered;
    report.counts = Object.fromEntries(['tasks', 'experiences', 'applications', 'feedback'].map(table => [table, Number(db.prepare('SELECT count(*) AS n FROM ' + table).get().n)]));
    report.extractionUsed = Number(db.prepare('SELECT used FROM extraction_grants WHERE id=?').get(input.grantId)?.used ?? 0);
    report.indexUnchanged = (await readFile(join(input.fixture.repo, '.git/index'))).equals(index);
    report.headUnchanged = git(input.fixture.repo, ['rev-parse', 'HEAD']) === input.fixture.base;
    assert(report.laterResponse && offered && report.counts.applications === 1 && report.counts.feedback === 0 && report.extractionUsed === 1 && report.indexUnchanged && report.headUnchanged);
    report.passed = true; report.stage = 'completed'; report.reason = 'completed';
  } catch (error) {
    report.reason = budget.state.stopped ? 'financial_receipt_unknown_or_limit' : 'acceptance_incomplete';
    if (input.offline) report.offlineDiagnostic = redact(error instanceof Error ? error.message : 'offline_failure', 800);
  }
  finally {
    for (const handle of handles.reverse()) await handle.dispose(); await ctx?.fiber.dispose(); db?.close();
    await relay.close(); report.modelHttpRequests = input.offline ? 0 : budget.state.calls.length;
    report.conservativeMicroCny = input.offline ? 0 : budget.spent; report.heldCalls = budget.state.calls.filter(call => !call.usage).length;
    budget.close();
  }
  await writeFile(join(input.root, 'automatic-result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
