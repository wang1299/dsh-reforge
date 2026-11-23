import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { digest, hashSchema } from '../src/domain.js';
import { semanticCorpusSchema } from '../scripts/semantic-memory-data.js';

test('published contract receipt is the exact sanitized twelve-family control artifact, not another run report',()=>{
  const raw=readFileSync(new URL('../../test/fixtures/semantic-memory-v1.json',import.meta.url));
  const corpus=semanticCorpusSchema.parse(JSON.parse(raw.toString()));
  const row=z.object({family:z.string().regex(/^[a-z_]+$/),split:z.enum(['development','holdout']),kind:z.enum(['original','reference','counterexample']),
    expectedPass:z.boolean(),matched:z.literal(true),exitCode:z.number().int().min(0).max(1),tests:z.literal(2),failures:z.number().int().min(0).max(2),
    errors:z.literal(0),skipped:z.literal(0),codeDigest:hashSchema,acceptanceDigest:hashSchema,receiptDigest:hashSchema}).strict();
  const schema=z.object({schema:z.literal(1),kind:z.literal('authored-task-contract-controls'),corpusDigest:hashSchema,
    pythonVersion:z.string().regex(/^3\.10\.\d+$/),paidHttpCalls:z.literal(0),modelTasks:z.literal(0),sourceQualifiedExperiences:z.literal(0),passed:z.literal(true),rows:z.array(row).length(36)}).strict();
  const artifact=schema.parse(JSON.parse(readFileSync(new URL('../../docs/evaluation/semantic-memory-v1-contracts.json',import.meta.url),'utf8')));
  assert.equal(artifact.corpusDigest,digest(raw));
  const expected=corpus.families.flatMap(f=>['original','reference','counterexample'].map(kind=>f.id+'/'+kind)).sort();
  assert.deepEqual(artifact.rows.map(r=>r.family+'/'+r.kind).sort(),expected);
  for(const r of artifact.rows){
    const f=corpus.families.find(f=>f.id===r.family)!;const reference=r.kind==='reference';
    assert.equal(r.split,f.split);assert.equal(r.expectedPass,reference);assert.equal(r.exitCode,reference?0:1);
    assert.equal(reference?r.failures===0:r.failures>0,true);assert.equal(r.codeDigest,digest(f.contract[r.kind]));
    const acceptance='import sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path(__file__).resolve().parents[1]/"repo"))\n'+f.contract.acceptance;
    assert.equal(r.acceptanceDigest,digest(acceptance));
  }
  assert.throws(()=>schema.parse({...artifact,dbPath:'C:\\private\\do-not-publish'}));
});
