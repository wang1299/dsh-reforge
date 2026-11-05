import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rankText } from '../src/retrieval.js';
import { prepareTextIndex, rankStrategy } from '../src/retrieval-index.js';
import { evaluateRetrieval, parseRetrievalCorpus, renderRetrievalReport, validateRetrievalCorpus } from '../src/retrieval-evaluation.js';

test('prepared index preserves every v1 field for varied corpora, token order and empty input', () => {
  const bank = [{ id: 'z', title: 'ＺＥＲＯ cacheKey cache_key', strategy: 'Explicit zero and empty strings; 事务回滚异常' },
    { id: 'a', title: 'transaction rollback', strategy: 'restore balance on failure' },
    { id: 'tie', title: 'transaction rollback', strategy: 'restore balance on failure' },
    { id: 'empty', title: 'the', strategy: '' }];
  for (const documents of [bank, bank.slice().reverse(), [], [bank[0]!]]) {
    const index = prepareTextIndex(documents);
    for (const query of ['', 'the', 'transaction', 'rollback transaction balance', 'balance rollback transaction',
      'cacheKey cacheKey ZERO', '事务回滚异常', 'restore balance', 'unmatched token']) {
      assert.deepEqual(index.rank(query), rankText(query, documents));
    }
  }
  assert.throws(() => prepareTextIndex([bank[0]!, bank[0]!]), /Duplicate/);
});

test('prepared index owns its snapshot and callers cannot mutate future query output', () => {
  const bank = [{ id: 'first', title: 'transaction rollback', strategy: 'restore balance before failure' }];
  const index = prepareTextIndex(bank); const expected = index.rank('transaction rollback');
  bank[0]!.id = 'changed'; bank[0]!.title = 'unrelated'; bank.push({ id: 'second', title: 'transaction rollback', strategy: 'x' });
  const output = index.rank('transaction rollback'); output[0]!.score = -999;
  const explanation = index.explain('transaction rollback'); explanation[0]!.titleTerms.push('injected');
  assert.deepEqual(index.rank('transaction rollback'), expected);
  assert.deepEqual(index.explain('transaction rollback')[0]!.titleTerms, ['transaction', 'rollback']);
  assert.equal(index.size, 1); assert(Object.isFrozen(index));
});

test('strategy candidate requires substantial body coverage and does not relax single-token rejection', () => {
  const bank = [{ id: 'entry', title: 'Durable updates', strategy: 'Write temporary sibling flush contents rename destination' }];
  const index = prepareTextIndex(bank);
  assert.equal(rankText('temporary sibling flush contents', bank)[0]!.reason, 'no_title_anchor');
  const candidate = rankStrategy('temporary sibling flush contents', index)[0]!;
  assert.equal(candidate.reason, null); assert.equal(candidate.route, 'strategy_coverage');
  assert.equal(rankStrategy('temporary sibling', index)[0]!.reason, 'no_title_anchor');
  assert.equal(rankStrategy('temporary', index)[0]!.reason, 'insufficient_anchors');
  assert.equal(rankStrategy('unrelated', index)[0]!.route, 'abstain');
  const many = prepareTextIndex([{ id: 'long', title: 'different', strategy: Array.from({ length: 40 }, (_, i) => 'token' + i).join(' ') }]);
  const explained = many.explain(Array.from({ length: 40 }, (_, i) => 'token' + i).join(' '))[0]!;
  assert.equal(explained.strategyAnchors, 40); assert.equal(explained.strategyTerms.length, 16); assert.equal(explained.strategyCoverage, 1);
});

test('explicit documentation-only rule is narrow and does not block a repair that also requests docs', () => {
  const index = prepareTextIndex([{ id: 'entry', title: 'transaction rollback', strategy: 'restore state after failure' }]);
  assert.equal(rankStrategy('Only edit the README about transaction rollback; do not change behavior.', index)[0]!.reason, 'explicit_documentation_only');
  assert.equal(rankStrategy('仅修改文档解释 transaction rollback，不改变运行行为。', index)[0]!.reason, 'explicit_documentation_only');
  assert.equal(rankStrategy('Fix transaction rollback and update documentation.', index)[0]!.reason, null);
  assert.equal(rankStrategy('Only update documentation about transaction rollback.', index)[0]!.reason, null, 'absence of explicit no-behavior instruction is not inferred');
});

test('frozen corpus validates identities, split separation and relevant/eligible labels', async () => {
  const bytes = await readFile(new URL('../../test/fixtures/retrieval-v2-cases.json', import.meta.url));
  const corpus = parseRetrievalCorpus(bytes);
  assert.throws(() => parseRetrievalCorpus(Buffer.concat([bytes, Buffer.from(' ')])), /Frozen/);
  const leaked = structuredClone(corpus); leaked.queries[0]!.split = 'holdout';
  assert.throws(() => validateRetrievalCorpus(leaked), /leakage/);
  const invalid = structuredClone(corpus); invalid.queries[0]!.ineligibleIds = invalid.queries[0]!.relevantIds;
  assert.throws(() => validateRetrievalCorpus(invalid), /ineligible/);
  const duplicate = structuredClone(corpus); duplicate.queries[1]!.id = duplicate.queries[0]!.id;
  assert.throws(() => validateRetrievalCorpus(duplicate), /Duplicate/);
  const unknown = structuredClone(corpus); unknown.queries[0]!.relevantIds = ['missing'];
  assert.throws(() => validateRetrievalCorpus(unknown), /unknown/);
});

test('development report retains every error and explains exclusion without treating labels as source proof', async () => {
  const corpus = parseRetrievalCorpus(await readFile(new URL('../../test/fixtures/retrieval-v2-cases.json', import.meta.url)));
  const report = evaluateRetrieval(corpus, 'development');
  for (const group of Object.values(report.groups)) {
    assert.equal(group.queries, 40); assert.equal(group.correct + group.wrong + group.abstained, 40);
    assert.equal(group.positives, 20); assert.equal(group.negatives, 20);
    for (const row of group.rows) {
      assert(!row.excludedIds.includes(row.selected ?? ''));
      assert.equal(row.wrong, row.selected !== null && !row.relevantIds.includes(row.selected));
    }
  }
  assert.equal(report.modelCalls, 0);
  assert.equal(report.groups.bm25_v1!.byKind.chinese!.positiveRecall, 0);
  assert.equal(report.groups.bm25_v1!.byKind.unrelated!.positiveRecall, null);
  const modified = structuredClone(report); modified.groups.strategy_v2!.rows[0]!.query = '<script>alert("x")</script>';
  const html = renderRetrievalReport(modified);
  assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;'));
  assert(html.includes('default-src \'none\'')); assert(!html.includes('https://'));
});
