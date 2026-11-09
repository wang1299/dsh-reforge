import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStudyCommand } from '../scripts/study-live-runner.js';
import { assertReviewedStudyPriceDocument } from '../scripts/study-live-plan.js';
import { digest } from '../src/domain.js';

test('study CLI requires an exact plan, full digest, explicit paid acknowledgement and bounded decimal cap', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(parseStudyCommand(['authorize', '--plan', 'run-a', '--digest', hash, '--cap-cny', '9.000001', '--acknowledge-paid-calls']),
    { command: 'authorize', plan: 'run-a', digest: hash, cap: 9000001 });
  assert.equal(parseStudyCommand(['prepare']).command, 'prepare');
  assert.equal(parseStudyCommand(['qualify']).command, 'qualify');
  for (const args of [[], ['prepare', '--cap-cny', '10'], ['live', '--plan', 'run-a'],
    ['inspect', '--plan', '../other'], ['inspect', '--root', 'run-a'],
    ['live', '--plan', 'run-a', '--digest', hash, '--plan', 'run-b'],
    ['authorize', '--plan', 'run-a', '--digest', hash, '--cap-cny', '10'],
    ...['0', '10.000001', '1e1', 'Infinity', '-1', '.1', '1.1234567'].map(amount =>
      ['authorize', '--plan', 'run-a', '--digest', hash, '--cap-cny', amount, '--acknowledge-paid-calls'])]) assert.throws(() => parseStudyCommand(args));
});

test('an unchanged catalog label cannot admit prices outside the independently reviewed document bytes', () => {
  const bytes = Buffer.from('synthetic catalog-v1 peak input=2 output=8');
  const snapshot = { catalogVersion: 'catalog-v1', reviewedDocumentSha256: digest(bytes) };
  assert.doesNotThrow(() => assertReviewedStudyPriceDocument(bytes, snapshot));
  assert.throws(() => assertReviewedStudyPriceDocument(Buffer.from('synthetic catalog-v1 peak input=4 output=16'), snapshot));
  assert.throws(() => assertReviewedStudyPriceDocument(bytes, { ...snapshot, catalogVersion: 'catalog-v2' }));
});
