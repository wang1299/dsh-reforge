/** Reads public synthetic fixtures only. No model, Store, credentials or runtime profile. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { evaluateRetrieval, parseRetrievalCorpus, renderRetrievalReport } from '../src/retrieval-evaluation.js';
import { rankText } from '../src/retrieval.js';
import { prepareTextIndex, rankStrategy } from '../src/retrieval-index.js';
import { pilotCases } from './pilot-fixtures.js';
import assert from 'node:assert/strict';

const args = process.argv.slice(2); const split = args[0];
if ((split !== 'development' && split !== 'holdout') || (args.length !== 1 && !(args.length === 3 && args[1] === '--out'))) {
  throw new Error('Usage: retrieval-evaluate development|holdout [--out .probe-work/report-directory]');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const corpus = parseRetrievalCorpus(await readFile(join(root, 'test/fixtures/retrieval-v2-cases.json')));
const sourcePaths = ['src/retrieval.ts', 'src/retrieval-index.ts', 'src/retrieval-evaluation.ts', 'scripts/retrieval-evaluate.ts', 'scripts/pilot-fixtures.ts'];
const sourceDigests = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await readFile(join(root, path)))])));
const git = (args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const historicalBytes = await readFile(join(root, 'docs/evaluation/t049-20261104/results.json'));
const historical = JSON.parse(historicalBytes.toString('utf8')) as {
  learnedSyntheticReference: { title: string; strategy: string };
  postRunLexicalDiagnostics: { case: string; matches: Omit<ReturnType<typeof rankText>[number], 'id'>[] }[];
};
const reference = { id: 't049-reference', ...historical.learnedSyntheticReference };
const historicalDiagnostics = (await pilotCases()).map(item => {
  const matches = rankText(item.summary, [reference]).map(({ id: _id, ...match }) => match);
  assert.deepEqual(matches, historical.postRunLexicalDiagnostics.find(row => row.case === item.id)!.matches, 'T049 baseline drift');
  return { case: item.id, query: item.summary, applicability: 'unconfirmed/not-a-positive-label', baseline: matches,
    candidate: rankStrategy(item.summary, prepareTextIndex([reference])),
    limitation: 'Known-invalid-input preconditions do not establish applicability to persistence failure. Excluded from quality metrics.' };
});
const report = { ...evaluateRetrieval(corpus, split), sourceCommit: git(['rev-parse', 'HEAD']),
  sourceDirty: git(['status', '--porcelain']).length > 0, sourceDigests, historicalDataDigest: digest(historicalBytes), historicalDiagnostics,
  environment: { node: process.version, platform: process.platform, arch: process.arch } };
const json = JSON.stringify(report, null, 2) + '\n';
if (args[2]) {
  const directory = resolve(root, args[2]); const rel = relative(join(root, '.probe-work'), directory);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Reports must stay inside repository .probe-work');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, split + '.json'), json);
  await writeFile(join(directory, split + '.html'), renderRetrievalReport(report));
}
process.stdout.write(json);
