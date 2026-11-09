import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { git } from '../src/repository.js';
import { withStudyGit } from '../scripts/study-git.js';
import { studyRepository } from '../scripts/study-owned-path.js';

test('actual study Git children omit synthetic credentials across awaits and restore normal caller behavior', async () => {
  const before = process.env.STUDY_SYNTHETIC_CREDENTIAL;
  process.env.STUDY_SYNTHETIC_CREDENTIAL = 'synthetic-only';
  const probe = () => git(studyRepository, ['-c', `alias.study-env=!node -e 'process.stdout.write(process.env.STUDY_SYNTHETIC_CREDENTIAL ? "present" : "absent")'`, 'study-env']);
  try {
    assert.equal(probe(), 'present');
    await withStudyGit(async () => { assert.equal(probe(), 'absent'); await setTimeout(1); assert.equal(probe(), 'absent');
      assert.equal(git(studyRepository, ['config', '--get', 'core.fsmonitor']), 'false'); });
    assert.equal(probe(), 'present');
    await assert.rejects(withStudyGit(async () => { await setTimeout(1); throw new Error('synthetic failure'); }));
    assert.equal(probe(), 'present');
  } finally { if (before === undefined) delete process.env.STUDY_SYNTHETIC_CREDENTIAL; else process.env.STUDY_SYNTHETIC_CREDENTIAL = before; }
});
