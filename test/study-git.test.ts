import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { git, gitBytes } from '../src/repository.js';
import { withStudyGit } from '../scripts/study-git.js';
import { studyRepository } from '../scripts/study-owned-path.js';
import { newStudyRoot } from '../scripts/benefit-study-preflight.js';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { studyChildEnvironment } from '../scripts/study-bounded-python.js';
import { verificationRuntime } from '../src/verification.js';

test('actual study Git children omit synthetic credentials across awaits and restore normal caller behavior', async () => {
  const before = process.env.STUDY_SYNTHETIC_CREDENTIAL;
  process.env.STUDY_SYNTHETIC_CREDENTIAL = 'synthetic-only';
  const probe = () => git(studyRepository, ['-c', `alias.study-env=!node -e 'process.stdout.write(process.env.STUDY_SYNTHETIC_CREDENTIAL ? "present" : "absent")'`, 'study-env']);
  try {
    assert.equal(probe(), 'present');
    await withStudyGit(async () => { assert.equal(probe(), 'absent'); await setTimeout(1); assert.equal(probe(), 'absent');
      assert.equal(gitBytes(studyRepository, ['-c', `alias.study-env=!node -e 'process.stdout.write(process.env.STUDY_SYNTHETIC_CREDENTIAL ? "present" : "absent")'`, 'study-env']).toString(), 'absent');
      assert.equal(git(studyRepository, ['config', '--get', 'core.fsmonitor']), 'false'); });
    assert.equal(probe(), 'present');
    await assert.rejects(withStudyGit(async () => { await setTimeout(1); throw new Error('synthetic failure'); }));
    assert.equal(probe(), 'present');
  } finally { if (before === undefined) delete process.env.STUDY_SYNTHETIC_CREDENTIAL; else process.env.STUDY_SYNTHETIC_CREDENTIAL = before; }
});

test('scoped source Git blob reads retain exact binary bytes and the caller size limit', async () => {
  const root = await newStudyRoot(join(studyRepository, '.probe-work/t065-git-binary-test'));
  const bytes = Buffer.concat([Buffer.from('\n\r'), Buffer.from([0, 255, 128]), Buffer.alloc(2048, 32), Buffer.from('\n')]);
  const file = join(root, 'synthetic.bin'); await writeFile(file, bytes, { flag: 'wx' });
  withStudyGit(() => {
    git(root, ['init', '-b', 'codex/synthetic']); const object = git(root, ['hash-object', '-w', file]);
    assert(gitBytes(root, ['cat-file', 'blob', object], 4 * 1024 * 1024).equals(bytes));
    assert.throws(() => gitBytes(root, ['cat-file', 'blob', object], 1024));
  });
});

test('actual isolated source-version probes ignore a polluted parent pytest plugin setting', async () => {
  const root = await newStudyRoot(join(studyRepository, '.probe-work/t065-version-probe-test'));
  const previous = process.env.PYTEST_PLUGINS; process.env.PYTEST_PLUGINS = 'synthetic_missing_plugin_must_not_load';
  try {
    const result = verificationRuntime({ python: process.env.EVOLVE_PYTHON ?? 'python', probeEnvironment: studyChildEnvironment(root) });
    assert.match(result.python, /^Python 3\.10\./); assert.equal(result.pytest, 'pytest 9.1.1');
    assert.equal(JSON.stringify(result).includes('synthetic_missing_plugin'), false);
  } finally { if (previous === undefined) delete process.env.PYTEST_PLUGINS; else process.env.PYTEST_PLUGINS = previous; }
});
