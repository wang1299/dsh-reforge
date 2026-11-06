import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { projectSchemaFacts } from '../src/project-facts.js';
import { projectFactsHtml } from '../src/project-facts-view.js';

test('preview escapes display text and commands, omits source annotations and explains unknown states', () => {
  const content = JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
    properties: { alias: { type: ['string', 'null'], default: 'PRIVATE_ANNOTATION_MARKER' } } });
  const binding = { namespace: 'toy/preview', taskId: 'task', revision: 1 };
  const request = { ...binding, path: 'schemas/<img>.schema.json', property: 'alias', sha256: digest(content) };
  const facts = projectSchemaFacts(request, binding, { read: () => ({ ...binding, path: request.path, bytes: Buffer.from(content) }) });
  const html = projectFactsHtml(facts, 'validate_payload', '<img onerror=bad>', '</code><script>bad()</script>', 'a'.repeat(32));
  assert(html.includes('已读取 3 项接口约束')); assert(html.includes('&lt;img&gt;')); assert(!html.includes('PRIVATE_ANNOTATION_MARKER'));
  assert(!html.includes('<img')); assert(!html.includes('<script>bad()')); assert.equal((html.match(/<script /g) ?? []).length, 1);
  const unknown = { ...facts, state: 'unknown' as const, observations: [], context: { facts: new Map(), problems: ['invalid_or_unsupported_schema'] } };
  const missing = projectFactsHtml(unknown, 'toString', 'now', 'command', 'b'.repeat(32));
  assert(missing.includes('本次保留未知状态')); assert(missing.includes('尚未指定目标')); assert(!missing.includes('native code'));
});

test('source CLI check reads the public schema and generates a bounded local report without a user profile', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/project-facts.js', import.meta.url)), '--check'],
    { cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const result = JSON.parse(output) as { status: string; report: string; demo: boolean; paidApiCalls: number; facts: unknown[] };
  assert.equal(result.status, 'confirmed'); assert.equal(result.demo, true); assert.equal(result.paidApiCalls, 0); assert.equal(result.facts.length, 3);
  assert.match(result.report, /^\.probe-work\/t059\/preview-[a-f0-9-]+\.html$/);
  const report = readFileSync(new URL('../../' + result.report, import.meta.url), 'utf8');
  assert(report.includes('examples/project-facts/customer.schema.json')); assert(report.includes('来自公开示例的预设目标'));
  assert(!report.includes('Public synthetic example; annotations are not copied to the report.'));
});
