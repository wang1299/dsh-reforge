import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { projectFactPolicy, projectFactRequestSchema, projectFilePort, projectSchemaFacts } from '../src/project-facts.js';
import { projectFactsHtml, projectGoalLabels } from '../src/project-facts-view.js';

const args = process.argv.slice(2); const check = args.at(-1) === '--check'; if (check) args.pop();
if (![0, 2, 3].includes(args.length) || (check && args.length)) throw new Error('Usage: project-facts [relative.schema.json property [validate_payload|change_contract|present_ui|generate_docs]] or --check');
const demo = args.length === 0; const path = args[0] ?? 'examples/project-facts/customer.schema.json'; const property = args[1] ?? 'alias';
const goal = args[2] ?? (demo ? 'validate_payload' : null);
if (goal && !Object.hasOwn(projectGoalLabels, goal)) throw new Error('Please provide an explicit supported task goal; no goal is inferred from text.');
const root = fileURLToPath(new URL('../../', import.meta.url)); const binding = { namespace: 'project-facts/local', taskId: randomUUID(), revision: 1 };
const parsed = projectFactRequestSchema.safeParse({ ...binding, path, property, sha256: '0'.repeat(64) });
if (!parsed.success) throw new Error('Please provide a supported relative Schema path and property name.');
const port = projectFilePort(root, binding); const initial = port.read(parsed.data); const request = { ...parsed.data, sha256: initial ? digest(initial.bytes) : parsed.data.sha256 };
const facts = projectSchemaFacts(request, binding, port);
if (check) {
  assert.equal(facts.state, 'confirmed'); assert.deepEqual(Object.fromEntries(facts.observations.map(o => [o.field, o.value])), { field_required: false, field_nullable: true, field_type: 'string' });
  assert(initial); assert.equal(digest(port.read(request)!.bytes), digest(initial.bytes));
}
const output = join(root, '.probe-work/t059'); await mkdir(output, { recursive: true }); const name = 'preview-' + randomUUID() + '.html';
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const command = 'npm run project:facts -- ' + [path, property, ...(goal ? [goal] : [])].map(quote).join(' ');
await writeFile(join(output, name), projectFactsHtml(facts, goal, new Date().toISOString(), command, randomBytes(16).toString('hex'), demo));
process.stdout.write(JSON.stringify({ status: facts.state, bindingVerified: facts.bindingVerified, source: facts.source, targetProperty: facts.targetProperty,
  facts: facts.observations, unknownReasons: facts.context.problems, explicitGoal: demo ? null : goal, previewGoal: goal,
  goalSource: goal === null ? 'missing' : demo ? 'demo_preset' : 'explicit_cli_option', goalLabel: goal ? projectGoalLabels[goal] : null,
  goalChoices: projectFactPolicy.goals, report: '.probe-work/t059/' + name, demo, paidApiCalls: 0,
  limitation: 'Declared contract only; explicit caller target/goal, not program behavior, NLP intent extraction or Agent benefit.' }) + '\n');
