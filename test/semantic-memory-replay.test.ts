import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest } from '../src/domain.js';
import { semanticSnapshotPort } from '../src/semantic-memory.js';
import { assertSemanticRequests, semanticCorpusSchema } from '../scripts/semantic-memory-data.js';
import { calibrateSemantic, evaluateSemantic } from '../scripts/semantic-memory-evaluation.js';

const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url));
const data=read('test/fixtures/semantic-memory-v1.json');const corpus=semanticCorpusSchema.parse(JSON.parse(data.toString()));
const model=read('compat/retrieval-embedding/model.json');const calibration=JSON.parse(read('compat/semantic-memory/calibration.json').toString());
const load=(split:'development'|'holdout')=>semanticSnapshotPort(JSON.parse(read(`test/fixtures/semantic-memory-v1-${split}-vectors.json`).toString()),{modelDigest:digest(model),corpusDigest:digest(data),dimension:384});

test('published development calibration binds the method closure and reproduces both complete grids',()=>{
  assert.equal(calibration.sourceDirty,false);assert.equal(calibration.corpusDigest,digest(data));assert.equal(calibration.modelDigest,digest(model));
  assert.equal(calibration.vectorDigest,digest(read('test/fixtures/semantic-memory-v1-development-vectors.json')));
  for(const required of ['src/domain.ts','test/context-fixture.ts','scripts/retrieval-embedding.py','tsconfig.json','compat/retrieval-embedding/requirements-win-py310.lock'])assert.ok(calibration.sourceDigests[required]);
  for(const [path,expected]of Object.entries(calibration.sourceDigests))assert.equal(digest(read(path)),expected,'Frozen method closure changed: '+path);
  const lock=JSON.parse(read('package-lock.json').toString());
  const dependency=digest(JSON.stringify(Object.fromEntries(['zod','typescript'].map(name=>[name,{version:lock.packages['node_modules/'+name].version,integrity:lock.packages['node_modules/'+name].integrity}]))));
  assert.equal(calibration.coreDependencyDigest,dependency);
  const port=load('development');assert.equal(assertSemanticRequests(corpus,'development',port),84);
  assert.deepEqual(calibrateSemantic(corpus,port),{status:calibration.status,minimumCorrect:calibration.minimumCorrect,arms:calibration.arms});
});
test('all first development and evaluation decisions replay exactly, including false offers and lost positives',()=>{
  for(const split of ['development','holdout']as const){
    const snapshot=read(`test/fixtures/semantic-memory-v1-${split}-vectors.json`);
    const first=JSON.parse(read(`docs/evaluation/semantic-memory-v1-${split}.json`).toString());
    assert.equal(first.sourceDirty,false);assert.equal(first.vectorDigest,digest(snapshot));assert.equal(first.calibrationDigest,digest(read('compat/semantic-memory/calibration.json')));
    const port=load(split);assert.equal(assertSemanticRequests(corpus,split,port),84);
    const results=first.results.map((r:ReturnType<typeof evaluateSemantic>)=>evaluateSemantic(corpus,split,port,r.method,calibration.arms.find((a:{method:string})=>a.method===r.method)?.policy));
    assert.deepEqual(results,first.results);assert.ok(results.every((r:ReturnType<typeof evaluateSemantic>)=>r.budgetViolations===0&&r.citationBindingFailures===0));
  }
});
