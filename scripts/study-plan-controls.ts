import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../src/domain.js';
import { passes, reproduces } from '../src/verification.js';
import { newStudyRoot } from './benefit-study-preflight.js';
import { studyCases } from './benefit-study-cases.js';
import { studyProjectSentinel, writeStudyTarget } from './benefit-study-files.js';
import type { StudyExecutionPort } from './study-bounded-python.js';

export async function qualifyBoundedStudyControls(parent: string, execution: StudyExecutionPort) {
  const controls = [];
  for (const item of studyCases) {
    const root = await newStudyRoot(parent); const project = join(root, 'project'); const checks = join(root, 'checks'); await mkdir(project); await mkdir(checks);
    await writeFile(join(project, 'contract.py'), studyProjectSentinel, { flag: 'wx' });
    await writeFile(join(checks, 'test_contract.py'), item.checks, { flag: 'wx' });
    const variants = [['before', item.before], ['reference', item.reference], ['wrong', item.wrong], ...Object.entries(item.additionalWrong ?? {})];
    for (const [variant, code] of variants) {
      assert(variant && code); execution.validate(code); await writeStudyTarget(root, project, code);
      const result = await execution.run(project, checks, join(root, variant + '.xml'));
      assert(result.skipped === 0 && (variant === 'reference' ? passes(result) : reproduces(result)), 'Bounded study control failed: ' + item.id + '/' + variant);
      controls.push({ case: item.id, variant, codeDigest: digest(code), passed: passes(result),
        exitCode: result.exitCode, tests: result.tests, failures: result.failures, errors: result.errors, skipped: result.skipped,
        cases: result.cases.map(c => ({ id: c.id, status: c.status })) });
    }
  }
  return { kind: 'bounded-controls', controls, count: controls.length, providerHttpRequests: 0 };
}
