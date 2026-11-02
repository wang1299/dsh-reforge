import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { EvolveService } from '../src/service.js';
import { nativeHandler } from '../src/native-rpc.js';
import { fixture } from './fixture.js';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import { browserOwner } from '../src/dsh-adapter-rpc.js';
import { Context } from '@deepseek-ai/cordis';

test('native RPC shares experience state while fencing peers, repository, schema and stale revisions', async () => {
  const f = await fixture(); const store = new Store(':memory:');
  const service = new EvolveService(store, f.repo, { trusted: false, python: 'python', acceptanceDir: f.acceptance, regressionPath: 'tests', timeoutMs: 10000 });
  const owner = new Context();
  const connection = new HostConnectionService(owner, [], {} as ConstructorParameters<typeof HostConnectionService>[2]);
  const peer = browserOwner(connection); let active = true;
  const handler = nativeHandler(service, peer, () => active, () => false);
  const signal = new AbortController().signal;
  const call = (endpoint: string, payload: unknown) => handler(endpoint, payload, signal, peer);
  const request = (path: string, data?: unknown) => call('request', { repositoryId: service.repositoryId, path, method: data ? 'POST' : 'GET', ...(data ? { data } : {}) });
  try {
    const task = service.begin('native', 'synthetic native task');
    const exp = service.propose(task.id, { title: 'Native candidate', strategy: 'Restore before raising', observedFacts: ['Source correction'], inferences: [], recommendations: [], requiredFiles: ['contract.py'] });
    assert.equal((await request('/api/state')).ok, true);
    assert.equal((await handler('info', {}, signal, { ...peer, dispose: () => peer.dispose() })).ok, false);
    assert.equal((await call('info', { sessionId: 'outside' })).ok, false);
    assert.equal((await call('request', { repositoryId: 'other', path: '/api/state', method: 'GET' })).ok, false);
    assert.equal((await call('request', { repositoryId: service.repositoryId, path: '/api/state', method: 'GET', extra: 'ignored?' })).ok, false);
    assert.equal((await call('info', { extra: 'x'.repeat(32769) })).ok, false);
    assert.equal((await request('/api/config', { automaticLearning: true })).ok, false);
    assert.equal((await request('/api/experience/' + exp.id + '/disable', { revision: 1, reason: 'Owner disabled' })).ok, true);
    const stale = await request('/api/experience/' + exp.id + '/disable', { revision: 1, reason: 'Repeated stale write' });
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, 'conflict');
    const abort = new AbortController(); abort.abort();
    assert.equal((await handler('info', {}, abort.signal, peer)).ok, false);
    active = false; assert.equal((await call('info', {})).ok, false);
    assert.equal(service.requireExperience(exp.id).revision, 2); assert.equal(service.automatic.enabled, false);
    assert.equal(store.extraction.grants().length, 0);
  } finally { store.close(); await peer.dispose(); await owner.fiber.dispose(); }
});
