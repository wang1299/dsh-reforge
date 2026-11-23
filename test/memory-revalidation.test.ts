import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { previewRevalidation, revalidateMemory } from '../src/memory-revalidation.js';
import { startPanel } from '../src/panel.js';
import { git } from '../src/repository.js';
import { verifiedRetrievalFixture } from './retrieval-fixture.js';

async function source() {
  const work = resolve('.probe-work/t075-synthetic');
  await mkdir(work, { recursive: true });
  return verifiedRetrievalFixture(work);
}
async function drift(repo: string) {
  await writeFile(join(repo, 'contract.py'), '# Commit a new policy revision\nTRANSACTION_POLICY = "rollback-on-exception"\n');
  git(repo, ['add', 'contract.py']); git(repo, ['commit', '-m', 'revise synthetic code condition']);
}

test('owner panel revalidates a drifted Git repair once, preserving history, citations and permissions', { timeout: 90000 }, async () => {
  const f = await source(); const e = f.experience;
  const panel = await startPanel(f.service); const url = panel.origin + '/api/experience/' + e.id + '/revalidation';
  const headers = { Authorization: 'Bearer ' + panel.token, Origin: panel.origin, 'Content-Type': 'application/json' };
  const post = (data: unknown) => fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await (await fetch(url, { headers })).json()).reason, 'no_code_drift');
    await drift(f.repo);
    const preview = await (await fetch(url, { headers })).json(); assert.equal(preview.state, 'ready');
    const previous = f.store.verification(e.verificationId!)!;
    const oldCitations = f.store.citations(e.id, e.revision);
    assert.equal((await post({ ...preview.selection, expectedCommit: f.base })).status, 409);
    assert.equal((await post({ ...preview.selection, expectedRevision: e.revision - 1 })).status, 409);
    assert.equal(f.service.requireExperience(e.id).revision, e.revision);
    const results = await Promise.all([post(preview.selection), post(preview.selection)]);
    const bodies = await Promise.all(results.map(r => r.json()));
    assert.equal(bodies.filter(r => r.state === 'verified').length, 1);
    const history = f.store.history(e.id);
    assert.equal(history.at(-2)!.status, 'candidate'); assert.equal(history.at(-2)!.verificationId, null);
    const latest = history.at(-1)!; assert.equal(latest.revision, e.revision + 2);
    const fresh = f.store.verification(latest.verificationId!)!;
    assert.notEqual(fresh.id, previous.id); assert.equal(fresh.fixCommit, preview.selection.expectedCommit);
    assert.equal(fresh.acceptanceDigest, previous.acceptanceDigest); assert.equal(fresh.verified, true);
    assert.deepEqual(f.store.verification(previous.id), previous); assert.deepEqual(f.store.citations(e.id, latest.revision), oldCitations);
    assert.equal(f.service.provenance(latest).complete, true);
    assert.equal((await (await post(preview.selection)).json()).state, 'blocked');
    assert.deepEqual(f.store.extraction.grants(), []); assert.deepEqual(f.store.applications(), []);
  } finally { await panel.close(); f.store.close(); }
});

test('replay retains a failed candidate if the new commit removes the original regression test', { timeout: 90000 }, async () => {
  const f = await source(); const e = f.experience;
  try {
    await drift(f.repo);
    await writeFile(join(f.repo, 'tests/test_regression.py'), 'def test_replacement():\n    assert True\n');
    git(f.repo, ['commit', '-am', 'replace historical regression case']);
    const preview = await previewRevalidation(f.service, e.id); assert.equal(preview.state, 'ready');
    const outcome = await revalidateMemory(f.service, e.id, preview.selection);
    assert.equal(outcome.state, 'failed'); const fresh = f.store.verification(outcome.verificationId)!;
    assert.equal(fresh.regression.exitCode, 0); assert.equal(fresh.verified, false);
    assert.equal(f.service.requireExperience(e.id).status, 'candidate'); assert.equal(f.store.verification(e.verificationId!)!.verified, true);
  } finally { f.store.close(); }
});

test('dirty files, dependency changes, untrusted execution and switched acceptance stay outside replay', { timeout: 90000 }, async () => {
  const f = await source(); const e = f.experience; const inspect = () => previewRevalidation(f.service, e.id);
  try {
    await writeFile(join(f.repo, 'contract.py'), 'policy = "uncommitted"\n'); assert.deepEqual(await inspect(), { state: 'blocked', reason: 'committed_conditions_required' });
    await drift(f.repo);
    f.policy.trusted = false; assert.deepEqual(await inspect(), { state: 'blocked', reason: 'execution_untrusted' }); f.policy.trusted = true;
    const acceptance = join(f.acceptance, 'test_acceptance.py'); const before = await readFile(acceptance);
    await writeFile(acceptance, 'def test_other(): pass\n'); assert.deepEqual(await inspect(), { state: 'blocked', reason: 'test_contract_changed' });
    await writeFile(acceptance, before);
    await writeFile(join(f.repo, 'requirements.txt'), '# changed manifest\n'); assert.deepEqual(await inspect(), { state: 'blocked', reason: 'dependencies_changed' });
    assert.equal(f.service.requireExperience(e.id).revision, e.revision);
  } finally { f.store.close(); }
});

test('aborting a claimed replay leaves old proof in history and the candidate without inherited verification', { timeout: 90000 }, async () => {
  const f = await source(); const e = f.experience; const abort = new AbortController();
  try {
    await drift(f.repo); const preview = await previewRevalidation(f.service, e.id); assert.equal(preview.state, 'ready');
    const replay = revalidateMemory(f.service, e.id, preview.selection, abort.signal);
    for (let i = 0; i < 200 && f.service.requireExperience(e.id).revision === e.revision; i++) await delay(10);
    abort.abort(); assert.equal((await replay).state, 'inconclusive');
    const current = f.service.requireExperience(e.id); assert.equal(current.revision, e.revision + 1);
    assert.equal(current.status, 'candidate'); assert.equal(current.verificationId, null);
    assert.equal((await revalidateMemory(f.service, e.id, preview.selection)).state, 'blocked');
    assert.equal(f.store.verification(e.verificationId!)!.verified, true);
  } finally { f.store.close(); }
});

test('a newer owner decision survives an in-flight maintenance replay', { timeout: 90000 }, async () => {
  const f = await source(); const e = f.experience;
  try {
    await drift(f.repo); const preview = await previewRevalidation(f.service, e.id); assert.equal(preview.state, 'ready');
    const replay = revalidateMemory(f.service, e.id, preview.selection);
    for (let i = 0; i < 200 && f.service.requireExperience(e.id).revision === e.revision; i++) await delay(10);
    const disabled = f.service.disable(e.id, 'Owner recorded a counterexample during replay', e.revision + 1);
    await assert.rejects(replay, /Stale experience revision/);
    assert.deepEqual(f.service.requireExperience(e.id), disabled);
    assert.equal(f.store.evidenceRecords().filter(row => row.kind === 'verification').length, 1);
  } finally { f.store.close(); }
});
