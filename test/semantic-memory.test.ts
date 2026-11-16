import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest } from '../src/domain.js';
import { compileAgentContext } from '../src/agent-context.js';
import { planSemanticMemory, semanticAnchors, semanticSnapshotPort, type SemanticPort, type SemanticPolicy } from '../src/semantic-memory.js';
import { syntheticContextInput } from './context-fixture.js';
import { assertSemanticRequests, semanticCorpusSchema, semanticRequests } from '../scripts/semantic-memory-data.js';
import { calibrateSemantic } from '../scripts/semantic-memory-evaluation.js';
import { evaluateContext } from '../scripts/context-evaluate.js';

const policy: SemanticPolicy = {version:'local-semantic-v1',modelDigest:digest('toy model'),minimumDocument:0.3,minimumFact:0.5,intent:'contrastive',minimumIntentMargin:0.05};
const toyPort = (vectors: Record<string,readonly number[]> = {}): SemanticPort => ({modelDigest:policy.modelDigest,dimension:2,embed(request){
  const suffix=request.namespace.split('/').at(-1)!; return vectors[suffix + '/' + request.id] ?? [1,0];
}});
const options = (port=toyPort({'intent/nonRepair':[0,1]})) => ({namespace:'toy',queryId:'q',port,policy});
const input = () => syntheticContextInput(['Restore balance on transaction failure.','The manual has a display heading.'],'失败后恢复余额');

test('semantic admission keeps original fact indices/citations and allows a cross-language fact without lexical overlap',()=>{
  const request=input(); const original=JSON.stringify(request);
  assert.deepEqual(compileAgentContext(request,'source-order').decision.includedFacts,[]);
  const result=planSemanticMemory(request,options(toyPort({'fact/1':[0,1],'intent/nonRepair':[0,1]})));
  assert.equal(result.decision.status,'provided'); assert.deepEqual(result.decision.packing!.includedFacts,[0]);
  const body=JSON.parse(result.text.slice(result.text.indexOf('\n')+1));
  assert.deepEqual(body.observedFacts[0].citations,[request.citations[0]]); assert.equal(body.observedFacts[0].text,request.experience.observedFacts[0]);
  assert.deepEqual(body.applicability,request.experience.scope);assert.equal(JSON.stringify(request),original);
});
test('low similarity, intent mismatch and no admitted facts are separate bounded abstentions',()=>{
  const request=input();
  for(const [vectors,status] of [
    [{'document/00000000-0000-4000-8000-000000000001':[0,1]},'low_similarity'],
    [{'intent/repair':[0,1]},'intent_mismatch'],
    [{'fact/0':[0,1],'fact/1':[0,1]},'no_admitted_facts'],
  ] as const){const result=planSemanticMemory(request,options(toyPort({'intent/nonRepair':[0,1],...vectors})));assert.equal(result.decision.status,status);assert.equal(result.text,'');assert.equal(result.decision.packing,null);}
});
test('mandatory budget and invalid source stop before embedding, and no-fit optional facts do not become a strategy-only success',()=>{
  const request=input(); let calls=0; const port:SemanticPort={...toyPort(),embed(){calls++;throw new Error('private error');}};
  request.policy.maxNoticeBytes=512;assert.equal(planSemanticMemory(request,options(port)).decision.status,'mandatory_over_budget');assert.equal(calls,0);
  request.policy.maxNoticeBytes=8192;request.citations=[];assert.equal(planSemanticMemory(request,options(port)).decision.status,'invalid_source');assert.equal(calls,0);
  const exact=input();exact.policy.maxNoticeBytes=compileAgentContext(exact).decision.mandatoryBytes;
  assert.equal(planSemanticMemory(exact,options()).decision.status,'no_admitted_facts');
});
test('missing, malformed and wrong-model vectors fail closed without raw adapter messages',()=>{
  for(const port of [
    {...toyPort(),modelDigest:digest('another model')},
    {...toyPort(),embed(){throw new Error('private-response-or-query');}},
    {...toyPort(),embed(){return [NaN,0];}},
    {...toyPort(),embed(){return [1];}},
    {...toyPort(),embed(request:{namespace:string}){if(request.namespace.endsWith('/fact'))throw new Error('missing one fact');return [1,0];}},
  ]) {const result=planSemanticMemory(input(),options(port));assert.equal(result.decision.status,'invalid_vectors');assert.equal(result.text,'');assert.equal(JSON.stringify(result).includes('private-response'),false);}
});
test('source-preserving white lists reject invalid indices and do not mutate legacy context replay',()=>{
  for(const allowedFacts of [[-1],[2],[0,0],[0.5]])assert.equal(compileAgentContext({...input(),allowedFacts}).decision.status,'invalid_source');
  const request=input();const result=compileAgentContext({...request,allowedFacts:[1]},'source-order');
  assert.deepEqual(result.decision.includedFacts,[1]);assert.equal(result.decision.omittedFacts[0]!.reason,'relevance_gate');
  assert.equal(planSemanticMemory({...request,allowedFacts:[]},options()).decision.status,'no_admitted_facts','semantic selection must not broaden an existing white list');
  const original=JSON.parse(readFileSync(new URL('../../docs/evaluation/context-packing-v1-results.json',import.meta.url),'utf8'));
  assert.deepEqual(evaluateContext(),original,'T071 original full comparison remains exact');
});
test('snapshot identity and text/revision binding reject stale inputs even when shape and scores match',()=>{
  const request=input();const requests=[{namespace:'toy/query',id:'q',revision:1,text:request.query},
    {namespace:'toy/document',id:request.experience.id,revision:2,text:request.experience.title+'\n'+request.experience.strategy},
    ...request.experience.observedFacts.map((text,index)=>({namespace:'toy/fact',id:String(index),revision:2,text})),
    ...Object.entries(semanticAnchors).map(([id,text])=>({namespace:'toy/intent',id,revision:1,text}))];
  const snapshot={schemaVersion:1,modelDigest:policy.modelDigest,corpusDigest:digest('toy corpus'),dimension:2,split:'development',entries:requests.map(({text,...identity})=>({...identity,textDigest:digest(text),vector:[1,0]})),
    provenance:{engine:'toy unit only',runtimeVersions:{},inferenceSeconds:0,texts:requests.length,forwardPasses:1,paidHttpCalls:0,precision:'round7'}};
  const expected={modelDigest:policy.modelDigest,corpusDigest:digest('toy corpus'),dimension:2};
  const port=semanticSnapshotPort(snapshot,expected);assert.equal(planSemanticMemory(request,{...options(port),policy:{...policy,intent:'none'}}).decision.status,'provided');
  assert.throws(()=>semanticSnapshotPort(snapshot,{...expected,corpusDigest:digest('changed')}));
  const changed=input();changed.query+=' changed';assert.equal(planSemanticMemory(changed,options(port)).decision.status,'invalid_vectors');
  const revised=input();revised.experience.revision++;assert.equal(planSemanticMemory(revised,options(port)).decision.status,'invalid_vectors');
});
test('new corpus balances languages and task types; calibration never reads evaluation vectors and retains both grids',()=>{
  const corpus=semanticCorpusSchema.parse(JSON.parse(readFileSync(new URL('../../test/fixtures/semantic-memory-v1.json',import.meta.url),'utf8')));
  assert.equal(corpus.families.flatMap(f=>f.queries).length,72);assert.equal(semanticRequests(corpus,'development').length,84);
  const port:SemanticPort={...toyPort(),embed(request){assert.ok(request.namespace.startsWith('development/'));return [1,0];}};
  const calibration=calibrateSemantic(corpus,port);assert.equal(calibration.minimumCorrect,9);assert.equal(calibration.status,'admissible');
  assert.deepEqual(calibration.arms.map(a=>a.grid.length),[15,45]);assert.ok(calibration.arms.every(a=>a.policy));
  assert.throws(()=>calibrateSemantic(corpus,{...port,embed(){throw new Error('unavailable');}}),/Invalid research inputs/);
  const missing=calibrateSemantic(corpus,{...port,embed(r){return r.namespace.endsWith('/document')?[0,1]:[1,0];}});assert.equal(missing.status,'no_admissible_config');assert.ok(missing.arms.every(a=>a.policy===null&&a.grid.length>0));
});
test('a missing negative replaced by an unrelated entry cannot improve quality or pass complete-input validation',()=>{
  const corpus=semanticCorpusSchema.parse(JSON.parse(readFileSync(new URL('../../test/fixtures/semantic-memory-v1.json',import.meta.url),'utf8')));
  const requests=semanticRequests(corpus,'development');const bad=requests.findIndex(r=>r.id.endsWith('-q2'));
  const entries=requests.map(({text,...identity})=>({...identity,textDigest:digest(text),vector:[1,0]}));
  entries[bad]={...entries[bad]!,id:'unrelated-extra-entry'};
  const expected={modelDigest:policy.modelDigest,corpusDigest:digest('toy corpus'),dimension:2};
  const port=semanticSnapshotPort({schemaVersion:1,...expected,split:'development',entries,provenance:{engine:'toy',runtimeVersions:{},inferenceSeconds:0,texts:84,forwardPasses:1,paidHttpCalls:0,precision:'round7'}},expected);
  assert.equal(entries.length,84);assert.throws(()=>assertSemanticRequests(corpus,'development',port),/cache miss/);
  assert.throws(()=>calibrateSemantic(corpus,port),/Invalid research inputs/);
});
