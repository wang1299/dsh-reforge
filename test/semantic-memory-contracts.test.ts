import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSemanticContracts } from '../scripts/semantic-memory-contracts.js';

test('all twelve authored task contracts reject original and edge-case counterexample implementations and accept references', {timeout:180000},()=>{
  const report=checkSemanticContracts();assert.equal(report.passed,true,JSON.stringify(report.rows.filter(r=>!r.matched)));
  assert.equal(report.rows.length,36);assert.equal(report.rows.filter(r=>r.kind==='reference'&&r.matched).length,12);
  assert.equal(report.paidHttpCalls,0);assert.equal(report.modelTasks,0);assert.equal(report.sourceQualifiedExperiences,0);
});
