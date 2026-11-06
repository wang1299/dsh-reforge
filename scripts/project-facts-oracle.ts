/** Development-only independent validator. Never imported by the fact projection/runtime. */
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';

const ajv = new Ajv({ strict: false, useDefaults: false, coerceTypes: false, removeAdditional: false, validateFormats: false });
const probes: unknown[] = [null, 'sample', 'ready', 0, 1, 1.5, false, true, {}, []];
export function schemaFactOracle(content: string, property: string) {
  const document = JSON.parse(content) as { properties: Record<string, { type: string | string[] }> };
  const validate = ajv.compile(document); const baseline: Record<string, unknown> = {};
  for (const [name, constraint] of Object.entries(document.properties)) {
    const check = ajv.compile(constraint); const value = probes.find(p => check(p));
    assert.notEqual(value, undefined, 'No independent baseline witness for ' + name);
    baseline[name] = structuredClone(value);
  }
  const before = JSON.stringify(baseline); assert.equal(validate(baseline), true, 'Independent baseline must satisfy full schema');
  assert.equal(JSON.stringify(baseline), before, 'Oracle must not modify input or fill defaults');
  const omitted = structuredClone(baseline); delete omitted[property];
  const nullValue = { ...baseline, [property]: null };
  const declaration = document.properties[property]!.type; const nonNull = (Array.isArray(declaration) ? declaration : [declaration]).filter(t => t !== 'null');
  return { field_required: !validate(omitted), field_nullable: Boolean(validate(nullValue)),
    field_type: nonNull.length > 1 ? 'union' : nonNull[0] ?? 'null' };
}
