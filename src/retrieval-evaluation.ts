import assert from 'node:assert/strict';
import { z } from 'zod';
import { digest } from './domain.js';
import { rankText, retrievalPolicyDigest } from './retrieval.js';
import { prepareTextIndex, rankStrategy, strategyRetrievalPolicyDigest } from './retrieval-index.js';

const splitSchema = z.enum(['development', 'holdout']);
const identifier = z.string().min(1).max(100);
const kinds = ['literal', 'long', 'strategy-only', 'chinese', 'paraphrase', 'unrelated', 'documentation-only', 'stale', 'other-repo', 'ambiguous'] as const;
export const retrievalCorpusSchema = z.object({ schemaVersion: z.literal(2), kind: z.literal('author-written-synthetic-retrieval'),
  experiences: z.array(z.object({ id: identifier, split: splitSchema, family: identifier,
    title: z.string().min(1).max(200), strategy: z.string().min(1).max(2000) }).strict()).length(10),
  queries: z.array(z.object({ id: identifier, split: splitSchema, family: identifier, kind: z.enum(kinds),
    text: z.string().min(1).max(4000), relevantIds: z.array(identifier).max(1), ineligibleIds: z.array(identifier).max(10) }).strict()).length(100),
}).strict();
export type RetrievalCorpus = z.infer<typeof retrievalCorpusSchema>;
export const frozenRetrievalDataDigest = 'd0564001694cdf6137486de31ea88bcf619991e735940e3870dc6e2b22289636';
export function parseRetrievalCorpus(bytes: Buffer): RetrievalCorpus {
  if (digest(bytes) !== frozenRetrievalDataDigest) throw new Error('Frozen retrieval v2 corpus changed; create a new evaluation version');
  return validateRetrievalCorpus(JSON.parse(bytes.toString('utf8')));
}
export function validateRetrievalCorpus(input: unknown): RetrievalCorpus {
  const corpus = retrievalCorpusSchema.parse(input);
  assert.equal(new Set(corpus.experiences.map(e => e.id)).size, corpus.experiences.length, 'Duplicate experience IDs');
  assert.equal(new Set(corpus.queries.map(q => q.id)).size, corpus.queries.length, 'Duplicate query IDs');
  assert.equal(new Set(corpus.experiences.map(e => e.family)).size, 10, 'Each family needs a unique source');
  for (const e of corpus.experiences) {
    const queries = corpus.queries.filter(q => q.family === e.family);
    assert.equal(queries.length, 10, 'Family needs ten queries');
    assert.equal(new Set(queries.map(q => q.kind)).size, kinds.length, 'Family must cover all query kinds');
    assert.equal(queries.filter(q => q.relevantIds.length).length, 5, 'Family needs five positives');
    for (const q of queries) assert.equal(q.split, e.split, 'Family split leakage');
  }
  for (const q of corpus.queries) {
    assert(corpus.experiences.some(e => e.family === q.family && e.split === q.split), 'Unknown query family');
    for (const id of [...q.relevantIds, ...q.ineligibleIds]) {
      assert(corpus.experiences.some(e => e.id === id && e.split === q.split), 'Cross-split or unknown label');
    }
    assert(!q.relevantIds.some(id => q.ineligibleIds.includes(id)), 'Relevant experience cannot be ineligible');
  }
  assert.equal(corpus.queries.filter(q => q.split === 'development').length, 40, 'Development count');
  assert.equal(corpus.queries.filter(q => q.split === 'holdout').length, 60, 'Holdout count');
  return corpus;
}

interface EvaluationRow {
  id: string; family: string; kind: string; query: string; relevantIds: string[]; excludedIds: string[];
  selected: string | null; correct: boolean; wrong: boolean;
  candidates: { id: string; score: number; reason: string | null; route: string; matchedTerms: string[];
    titleTerms: string[]; strategyTerms: string[]; strategyAnchors: number; strategyCoverage: number }[];
}
function metrics(rows: EvaluationRow[]) {
  const positives = rows.filter(r => r.relevantIds.length > 0).length;
  const negatives = rows.length - positives; const correct = rows.filter(r => r.correct).length;
  const wrong = rows.filter(r => r.wrong).length; const offered = rows.filter(r => r.selected !== null).length;
  const negativeSelections = rows.filter(r => !r.relevantIds.length && r.selected !== null).length;
  return { queries: rows.length, positives, negatives, correct, wrong, offered, abstained: rows.length - offered, negativeSelections,
    positiveRecall: positives ? correct / positives : null, wrongInjectionRate: rows.length ? wrong / rows.length : null,
    negativeInjectionRate: negatives ? negativeSelections / negatives : null, precision: offered ? correct / offered : null };
}
export function evaluateRetrieval(corpus: RetrievalCorpus, split: z.infer<typeof splitSchema>) {
  const bank = corpus.experiences.filter(e => e.split === split);
  const queries = corpus.queries.filter(q => q.split === split);
  const groups = Object.fromEntries((['bm25_v1', 'indexed_v1', 'strategy_v2'] as const).map(policy => {
    const rows: EvaluationRow[] = queries.map(q => {
      const eligible = bank.filter(e => !q.ineligibleIds.includes(e.id));
      const index = prepareTextIndex(eligible); const explained = index.explain(q.text);
      const ranked = policy === 'strategy_v2' ? rankStrategy(q.text, index)
        : (policy === 'bm25_v1' ? rankText(q.text, eligible) : index.rank(q.text)).map(match => {
          const detail = explained.find(d => d.id === match.id)!;
          return { ...detail, ...match, route: match.reason === null ? 'title' : 'abstain' };
        });
      const selected = ranked.find(m => m.reason === null)?.id ?? null;
      return { id: q.id, family: q.family, kind: q.kind, query: q.text, relevantIds: q.relevantIds, excludedIds: q.ineligibleIds,
        selected, correct: selected !== null && q.relevantIds.includes(selected), wrong: selected !== null && !q.relevantIds.includes(selected),
        candidates: ranked.map(({ id, score, reason, route, matchedTerms, titleTerms, strategyTerms, strategyAnchors, strategyCoverage }) =>
          ({ id, score, reason, route, matchedTerms, titleTerms, strategyTerms, strategyAnchors, strategyCoverage })) };
    });
    return [policy, { ...metrics(rows), byKind: Object.fromEntries(kinds.map(kind => [kind, metrics(rows.filter(r => r.kind === kind))])),
      byFamily: Object.fromEntries(bank.map(e => [e.family, metrics(rows.filter(r => r.family === e.family))])), rows }];
  }));
  assert.deepEqual(groups.bm25_v1!.rows, groups.indexed_v1!.rows, 'Prepared index changed historical semantics');
  const base = groups.bm25_v1!; const candidate = groups.strategy_v2!;
  return { schemaVersion: 2, kind: 'synthetic-retrieval-evaluation', split, dataDigest: frozenRetrievalDataDigest,
    methodDigests: { bm25_v1: retrievalPolicyDigest, indexed_v1: retrievalPolicyDigest, strategy_v2: strategyRetrievalPolicyDigest },
    modelCalls: 0, gate: { kind: 'development-only/do-not-promote-from-holdout',
      improvedCorrectWithoutMoreWrong: candidate.correct > base.correct && candidate.wrong <= base.wrong },
    limitations: ['Author-written synthetic data visible to the developer; not an independent blind evaluation.',
      'Eligibility is declared, not executable source proof. The candidate is offline-only and is not the default DSH policy.',
      'Lexical rules do not understand arbitrary intent, paraphrases or translation; documentation negatives share one template.',
      'No model, downstream task acceptance, financial benefit or production traffic was measured.'], groups };
}
export type RetrievalReport = ReturnType<typeof evaluateRetrieval>;
export function renderRetrievalReport(report: RetrievalReport): string {
  const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const percent = (value: number | null): string => value === null ? '—' : (value * 100).toFixed(1) + '%';
  const cards = Object.entries(report.groups).map(([name, group]) => `<article><h2>${escape(name)}</h2><div class="metric">${percent(group.positiveRecall)}</div><p>正例命中 ${group.correct}/${group.positives} · 错误提供 ${group.wrong}/${group.queries} · 拒绝 ${group.abstained}/${group.queries}</p><p>精确率 ${percent(group.precision)} · 负例提供率 ${percent(group.negativeInjectionRate)}</p></article>`).join('');
  const rows = report.groups.strategy_v2!.rows.map(row => {
    const base = report.groups.bm25_v1!.rows.find(r => r.id === row.id)!;
    return `<tr><td>${escape(row.id)}<br><span class="muted">${escape(row.kind)}</span></td><td>${escape(row.query)}</td><td>${escape(row.relevantIds.join(', ') || '应拒绝')}</td><td>${escape(base.selected ?? '拒绝')}</td><td><span class="badge ${row.wrong ? 'bad' : row.correct ? 'good' : 'neutral'}">${escape(row.selected ?? '拒绝')}</span></td><td><details><summary>查看 ${row.candidates.length} 个候选</summary><p>资格排除：${escape(row.excludedIds.join(', ') || '无')}</p>${row.candidates.map(c => `<p><b>${escape(c.id)}</b> · ${c.score.toFixed(3)} · ${escape(c.reason ?? c.route)}<br>标题：${escape(c.titleTerms.join(', ') || '无')}<br>正文：${escape(c.strategyTerms.join(', ') || '无')} · 覆盖 ${(c.strategyCoverage * 100).toFixed(1)}%</p>`).join('')}</details></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Reforge 检索评测 · ${escape(report.split)}</title><style>
  :root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#182433;background:#f6f8fb}*{box-sizing:border-box}body{margin:0}header{background:#fff;border-bottom:1px solid #dce1e7;padding:18px max(24px,calc((100vw - 1240px)/2));font-weight:700;color:#206bc4}main{max-width:1288px;margin:auto;padding:28px 24px}h1{margin:8px 0}h2{font-size:16px;margin:0}.muted,small{color:#526479}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}article,.table{background:white;border:1px solid #dce1e7;border-radius:8px}article{padding:20px}.metric{font-size:34px;font-weight:650;margin-top:12px}.notice{background:#fff4da;border:1px solid #efce80;border-radius:8px;padding:16px;line-height:1.7}.table{overflow:auto;margin-top:24px}table{width:100%;border-collapse:collapse;font-size:13px;min-width:960px}th,td{text-align:left;padding:13px;border-bottom:1px solid #e6e9ed;vertical-align:top}th{background:#f8fafc}td:nth-child(2){min-width:220px;max-width:340px}td:last-child{min-width:240px}.badge{display:inline-block;padding:4px 8px;border-radius:4px}.good{background:#e6f5ec;color:#146c43}.bad{background:#fbe9e9;color:#a92323}.neutral{background:#edf0f5;color:#526479}summary{cursor:pointer;color:#206bc4}details p{line-height:1.65;overflow-wrap:anywhere}code{overflow-wrap:anywhere}@media(max-width:720px){.cards{grid-template-columns:1fr}main{padding:20px 16px}}
  </style></head><body><header>DSH-Reforge / 离线评测</header><main><small>冻结合成数据 · ${escape(report.split)} · 0 次模型调用</small><h1>检索质量与选择依据</h1><p class="muted">查看命中、误选、拒绝，以及每条候选的标题和正文依据。</p><div class="notice">实验候选尚未接入默认 DSH。此报告衡量合成检索，不代表真实任务成功率或费用改善。${escape(report.limitations.join(' '))}</div><section class="cards">${cards}</section><p><small>数据摘要 <code>${escape(report.dataDigest)}</code><br>候选方法 <code>${escape(report.methodDigests.strategy_v2)}</code></small></p><div class="table"><table><thead><tr><th>查询 / 类型</th><th>任务描述</th><th>正确目标</th><th>原版</th><th>候选</th><th>选择依据</th></tr></thead><tbody>${rows}</tbody></table></div></main></body></html>`;
}
