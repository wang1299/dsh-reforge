import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/domain.js';

test('fresh Git checkout filters preserve the original optional Windows lock byte identity on every OS',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const path='compat/retrieval-embedding/requirements-win-py310.lock';
  const calibration=JSON.parse(readFileSync(new URL('../../compat/semantic-memory/calibration.json',import.meta.url),'utf8'));
  const checkout=execFileSync('git',['-C',root,'cat-file','--filters','HEAD:'+path],{windowsHide:true});
  assert.equal(digest(checkout),calibration.sourceDigests[path],'A fresh checkout must reproduce the first lock bytes');
  assert.equal(checkout.includes(Buffer.from('\r\n')),true);
});
