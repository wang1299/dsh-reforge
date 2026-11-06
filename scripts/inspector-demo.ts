/** Fresh synthetic verified repair + real selection/panel; no user profile or model. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPanel } from '../src/panel.js';
import { verifiedRetrievalFixture } from '../test/retrieval-fixture.js';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('Usage: inspector-demo [--check]');
const root = fileURLToPath(new URL('../../', import.meta.url)); const work = join(root, '.probe-work/inspector-demo');
await mkdir(work, { recursive: true });
const fixture = await verifiedRetrievalFixture(work); const bank = fixture.createBank(3);
const queries = ['transaction rollback exception', 'transaction', 'unrelated typography layout',
  'rollback transaction failure restore balance', 'transaction exception rollback', 'transaction', 'restore balance'];
for (const [i, query] of queries.entries()) { const task = bank.service.begin('inspector-demo-' + i, '合成示例 ' + query); bank.service.select(task.id); }
await writeFile(join(fixture.repo, 'contract.py'), await readFile(join(fixture.repo, 'contract.py'), 'utf8') + '\n# synthetic code condition changed\n');
const last = bank.service.begin('inspector-demo-changed', '合成示例：变更代码后为什么没有提供经验'); bank.service.select(last.id);
const panel = await startPanel(bank.service);
const close = async () => { await panel.close(); bank.store.close(); fixture.store.close(); };
if (args[0] === '--check') {
  try {
    const before = { applications: bank.store.applications().length, feedback: bank.store.feedback().length };
    const response = await fetch(panel.origin + '/api/state', { headers: { Authorization: 'Bearer ' + panel.token } });
    assert.equal(response.status, 200);
    const state = await response.json() as { retrieval: { attempts: { outcome: string }[] }; experiences: unknown[] };
    assert.equal(state.retrieval.attempts.length, 8); assert.equal(state.experiences.length, 3);
    assert.equal(state.retrieval.attempts[0]!.outcome, 'abstained');
    assert.deepEqual({ applications: bank.store.applications().length, feedback: bank.store.feedback().length }, before);
    process.stdout.write(JSON.stringify({ status: 'passed', attempts: 8, syntheticVariantsSharingOneProof: 3, applicationRecords: before.applications,
      feedbackRecords: before.feedback, paidApiCalls: 0, limitation: 'Source verification and synthetic UI exercise, not Agent benefit or real user research.' }) + '\n');
  } finally { await close(); }
} else {
  process.stdout.write('合成演示：3个文本变体共用一份真实pytest修复来源；8次参考选择，未调用模型。\n' + panel.url + '\n');
  process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
}
