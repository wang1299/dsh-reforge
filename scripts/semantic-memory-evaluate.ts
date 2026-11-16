import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';
import { semanticSnapshotPort, type SemanticPolicy } from '../src/semantic-memory.js';
import { semanticCorpusSchema } from './semantic-memory-data.js';
import { calibrateSemantic, evaluateSemantic } from './semantic-memory-evaluation.js';

const mode = process.argv[2];
assert(process.argv.length === 3 && ['calibrate','development','holdout'].includes(mode!), 'Usage: semantic-memory-evaluate calibrate|development|holdout');
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(root,path));
const data = read('test/fixtures/semantic-memory-v1.json'); const corpus = semanticCorpusSchema.parse(JSON.parse(data.toString()));
const model = read('compat/retrieval-embedding/model.json'); const modelDigest = digest(model); const corpusDigest=digest(data);
const split = mode === 'holdout' ? 'holdout' : 'development';
const vectorPath = mode === 'calibrate' ? '.probe-work/t072/development-vectors.json' : `test/fixtures/semantic-memory-v1-${split}-vectors.json`;
const vectorBytes = read(vectorPath); const snapshot=JSON.parse(vectorBytes.toString());
assert.equal(snapshot.split,split); assert.equal(snapshot.entries.length,84);
const port = semanticSnapshotPort(snapshot,{modelDigest,corpusDigest,dimension:JSON.parse(model.toString()).dimension});
const sourcePaths=['src/agent-context.ts','src/semantic-memory.ts','src/embedding.ts','src/retrieval.ts','scripts/semantic-memory-data.ts',
  'scripts/semantic-memory-evaluation.ts','scripts/semantic-memory-evaluate.ts','scripts/semantic-memory-embedding.py'];
const sourceDigests=Object.fromEntries(sourcePaths.map(path=>[path,digest(read(path))]));
const git=(args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
const sourceCommit=git(['rev-parse','HEAD']); const sourceDirty=git(['status','--porcelain']).length>0;
const metadata={corpusDigest,modelDigest,vectorDigest:digest(vectorBytes),sourceCommit,sourceDirty,sourceDigests};
const output=join(root,'.probe-work/t072'); mkdirSync(output,{recursive:true});
if(mode==='calibrate'){
  assert(!sourceDirty,'Commit method and data before first calibration');
  const calibration={...calibrateSemantic(corpus,port),...metadata};
  writeFileSync(join(output,'calibration.json'),JSON.stringify(calibration,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:calibration.status,minimumCorrect:calibration.minimumCorrect,arms:calibration.arms.map(a=>({method:a.method,policy:a.policy})),...metadata})+'\n');
  if(calibration.status!=='admissible')process.exitCode=2;
}else{
  if(split==='holdout')assert(!sourceDirty,'Commit frozen development method/config before first evaluation');
  const calibrationBytes=read('compat/semantic-memory/calibration.json');
  const calibration=JSON.parse(calibrationBytes.toString()) as ReturnType<typeof calibrateSemantic> & typeof metadata;
  assert.equal(calibration.status,'admissible');assert.equal(calibration.sourceDirty,false);
  assert.equal(calibration.corpusDigest,corpusDigest);assert.equal(calibration.modelDigest,modelDigest);
  assert.deepEqual(calibration.sourceDigests,sourceDigests,'Method changed after calibration');
  assert.equal(calibration.vectorDigest,digest(read('test/fixtures/semantic-memory-v1-development-vectors.json')));
  const methods=['source-order','mmr-density','cosine-gate','intent-gate'] as const;
  const results=methods.map(method=>evaluateSemantic(corpus,split,port,method,calibration.arms.find(a=>a.method===method)?.policy as SemanticPolicy|undefined));
  const report={schema:1,kind:'author-visible-local-semantic-memory',split,...metadata,calibrationDigest:digest(calibrationBytes),embedding:snapshot.provenance,paidHttpCalls:0,realModelBenefit:false,results};
  writeFileSync(join(output,split+'.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({...metadata,split,results:results.map(({rows,...summary})=>({...summary,rows:rows.length}))})+'\n');
}
