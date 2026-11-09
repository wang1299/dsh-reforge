import { join } from 'node:path';
import { withRepositoryGitContext } from '../src/repository.js';
import { studyChildEnvironment } from './study-bounded-python.js';
import { studyRepository } from './study-owned-path.js';

export function withStudyGit<T>(fn: () => T): T {
  return withRepositoryGitContext({ env: { ...studyChildEnvironment(join(studyRepository, '.probe-work')),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  config: ['core.fsmonitor=false', 'core.untrackedCache=false', 'core.hooksPath=', 'core.attributesFile=', 'core.excludesFile=', 'commit.gpgsign=false'] }, fn);
}
