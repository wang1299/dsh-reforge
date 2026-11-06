import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { git } from '../src/repository.js';
import { digest, type Evidence, type FactCitation } from '../src/domain.js';

export function citeFact(evidence: Evidence, fact: string, factIndex = 0): FactCitation {
  return { factIndex, factDigest: digest(fact), evidenceId: evidence.id, evidenceDigest: evidence.digest };
}

export async function fixture(parent = tmpdir()): Promise<{ home: string; repo: string; acceptance: string; base: string; fix: () => Promise<string> }> {
  const home = await mkdtemp(join(parent, 'evolve-test-'));
  const repo = join(home, 'repository'); const acceptance = join(home, 'acceptance');
  await mkdir(repo); await mkdir(acceptance); await mkdir(join(repo, 'tests'));
  execFileSync('git', ['init', '-b', 'main', repo], { windowsHide: true, stdio: 'ignore' });
  git(repo, ['config', 'user.name', 'Synthetic Fixture']); git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(repo, 'requirements.txt'), '# standard-library-only fixture\n');
  await writeFile(join(repo, 'contract.py'), 'TRANSACTION_POLICY = "rollback-on-exception"\n');
  await writeFile(join(repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
  await writeFile(join(repo, 'tests', 'test_regression.py'), 'from ledger import apply_change\ndef test_success():\n    assert apply_change({"balance": 2}) == 3\n');
  await writeFile(join(acceptance, 'test_acceptance.py'), 'import pytest\nfrom ledger import apply_change\ndef test_exception_rolls_back():\n    state = {"balance": 2}\n    with pytest.raises(ValueError):\n        apply_change(state, fail=True)\n    assert state["balance"] == 2\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'synthetic failing transaction']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  return { home, repo, acceptance, base, fix: async () => {
    await writeFile(join(repo, 'ledger.py'), 'def apply_change(state, fail=False):\n    before = state["balance"]\n    state["balance"] += 1\n    if fail:\n        state["balance"] = before\n        raise ValueError("transaction failed")\n    return state["balance"]\n');
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'restore balance on failed transaction']);
    return git(repo, ['rev-parse', 'HEAD']);
  } };
}
