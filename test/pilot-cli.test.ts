import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('paid pilot entry rejects unknown options and unowned/missing plans before credentials or budgets are opened', () => {
  const absent = resolve('pilot-must-never-create-this-directory'); assert.equal(existsSync(absent), false);
  for (const args of [['live', '--run', absent], ['live', '--budget', '100'], ['prepare', '--host', 'private-path-marker'], ['status']]) {
    const result = spawnSync(process.execPath, ['scripts/real-model-pilot.mjs', ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1); assert.match(result.stderr, /pilot_stopped_preserve_plan_data_and_budget/);
    assert.ok(!result.stderr.includes('private-path-marker')); assert.ok(!result.stderr.includes(absent));
  }
  assert.equal(existsSync(absent), false);
});
