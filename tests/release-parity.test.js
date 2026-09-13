'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const core=require('../core.js');
const reference=require('./fixtures/release-2.5.json');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const digestFiles=files=>Object.fromEntries(Object.entries(files).map(([name,contents])=>[name,hash(contents)]));

for(const scenario of reference.scenarios) {
  test(`refactor preserves release 2.5 parsing and each Native resource byte-for-byte: ${scenario.name}`,()=>{
    const text=[{schema:core.NATIVE_JSONL_SCHEMA,version:1},...scenario.records].map(row=>JSON.stringify(row)).join('\n');
    const parsed=core.parseAIResponse(text);
    assert.deepEqual(parsed.errors,[]);
    assert.equal(hash(JSON.stringify(parsed)),scenario.parsed);
    for(const mode of ['pool','test'])assert.deepEqual(digestFiles(core.buildNativeFiles(parsed.questions,{...reference.options,mode}).files),scenario[mode]);
  });
}
test('refactor preserves the release prompt, TXT, and internal QTI output',()=>{
  assert.equal(hash(core.buildPrompt(reference.config)),reference.prompt);
  assert.equal(hash(core.buildTxt(reference.txtRecords)),reference.txt);
  assert.deepEqual(digestFiles(core.buildQtiFiles(reference.qtiRecords).files),reference.qti);
});
