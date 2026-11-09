import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStudyCommand } from '../scripts/study-live-runner.js';

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
