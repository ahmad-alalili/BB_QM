'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const scripts = [...read('index.html').matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match=>match[1]);

test('deferred browser core modules expose the same API and values as Node without a loader or fetch', () => {
  const sandbox = vm.createContext({window:{}, TextEncoder});
  const loaded = scripts.filter(file=>file.startsWith('src/core/') || file==='core.js');
  for (const file of loaded) vm.runInContext(read(file),sandbox,{filename:file});
  const browser = sandbox.window.BlackboardCore;
  assert.deepEqual(Object.keys(browser).sort(),Object.keys(core).sort());
  assert.equal(browser.MAX_QUESTIONS,250);
  assert.equal(browser.DISPLAY_VERSION,'2.5');
  assert.equal(browser.ValidationError,sandbox.window.BBQuestionModules.shared.ValidationError);
  assert.equal(Object.isFrozen(browser),true);
  const config = {sourceContent:'مادة دراسية',counts:{MC:1},difficulty:{mode:'single',level:3}};
  assert.equal(browser.buildPrompt(config),core.buildPrompt(config));
  assert.deepEqual(JSON.parse(JSON.stringify(browser.parseAIResponse('TF\tعبارة\ttrue'))),core.parseAIResponse('TF\tعبارة\ttrue'));
});

test('controllers create without side effects and every cross-controller action resolves exactly once', () => {
  const context = {core,elements:{},state:{},window:{},document:{},all:()=>[],byId:()=>null};
  const actions = {};
  const files = scripts.filter(file=>file.startsWith('src/ui/') && !file.endsWith('/context.js'));
  for (const file of files) {
    const api = require(path.join(root,file)).create(context,actions);
    for (const [name,fn] of Object.entries(api)) {
      assert.equal(Object.hasOwn(actions,name),false,'Duplicate '+name);
      assert.equal(typeof fn,'function');
      actions[name]=fn;
    }
  }
  for (const file of [...files,'app.js']) {
    for (const [,name] of read(file).matchAll(/actions\.([A-Za-z0-9_]+)/g)) assert.equal(typeof actions[name],'function',`${file}: ${name}`);
  }
});

test('page context owns fresh state and DOM references for each independent initialization', () => {
  const create = require('../src/ui/context.js').create;
  const document = {getElementById:id=>({id}),querySelectorAll:()=>[]};
  const first = create({window:{},document,core});
  const second = create({window:{},document,core});
  assert.notEqual(first.state,second.state);
  first.state.currentPrompt='مسودة';
  assert.equal(second.state.currentPrompt,'');
  assert.equal(first.elements.sourceContent.id,'source-content');
  assert.equal(second.state.pointsDraft,null);
});

test('core stays independent of UI/DOM modules and implementation files remain bounded', () => {
  for (const file of scripts.filter(file=>file.startsWith('src/core/'))) {
    const source=read(file);
    assert.doesNotMatch(source,/\bdocument\.|BBInterfaceModules|require\(['"][^'"]*\/ui\//);
    assert.ok(source.split('\n').length<=650,`${file} needs a responsibility review`);
  }
  assert.ok(read('app.js').split('\n').length<250);
  assert.ok(read('core.js').split('\n').length<120);
});
