import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPilotFixture, offlineRepair } from '../scripts/pilot-fixtures.js';
import { createService } from '../src/config.js';
import { citeFact } from './fixture.js';
import { git } from '../src/repository.js';

test('an unknown twelfth trial stays financially partial instead of completing a twelve-row comparison', async () => {
  await mkdir('.probe-work', { recursive: true }); const root = await mkdtemp(resolve('.probe-work/comparison-fault-'));
  const fixtureRoot = join(root, 'case'); const fixture = await createPilotFixture(fixtureRoot);
  const python = process.env.EVOLVE_PYTHON ?? 'python'; const { service } = createService({ repoRoot: fixture.repo,
    dataDir: join(fixtureRoot, 'data'), executionTrusted: true, python, acceptanceDir: fixture.acceptance, timeoutMs: 15000 });
  const task = service.begin('synthetic-comparison-source', 'transaction rollback restore balance');
  const fact = 'Synthetic correction requires restoring balance on failure.'; const evidence = service.correction(task.id, fact);
  await writeFile(join(fixture.repo, 'ledger.py'), offlineRepair); git(fixture.repo, ['add', '--', 'ledger.py']); git(fixture.repo, ['commit', '-m', 'synthetic source repair']);
  const candidate = service.propose(task.id, { title: 'transaction rollback restore balance', strategy: 'Restore the previous state after failed persistence.',
    observedFacts: [fact], inferences: [], recommendations: [], requiredFiles: ['contract.py'] }, [citeFact(evidence, fact)]);
  assert.equal((await service.verify(candidate.id)).status, 'source_verified'); service.finish(task.id); service.store.close();
  const { comparePilot } = await import(pathToFileURL(resolve('scripts/pilot-comparison.mjs')).href) as {
    comparePilot(input: Record<string, unknown>): Promise<{ complete: boolean; completedTrials: number; heldCalls: number; stoppedReason: string | null }> };
  let calls = 0; const frame = (value: object) => 'data: ' + JSON.stringify(value) + '\n\n';
  const transport = (async () => {
    if (++calls === 12) return new Response(frame({ type: 'error' }), { status: 200 });
    return new Response(frame({ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } })
      + frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'invalid synthetic generation' } })
      + frame({ type: 'content_block_stop', index: 0 })
      + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {
        input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) + frame({ type: 'message_stop' }), { status: 200 });
  }) as typeof fetch;
  const result = await comparePilot({ root: fixtureRoot, fixtureRoot, fixture, python, offline: true,
    offlineTransport: transport, budgetFile: join(root, 'offline-fault-budget.sqlite'), anonymousId: crypto.randomUUID(), validate: async () => {} });
  assert.equal(calls, 12); assert.equal(result.completedTrials, 12); assert.equal(result.heldCalls, 1);
  assert.equal(result.stoppedReason, 'invalid_receipt'); assert.equal(result.complete, false);
});
