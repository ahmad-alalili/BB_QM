'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function functionsBetween(first, last) {
  const start = app.indexOf(`  function ${first}(`);
  const end = app.indexOf(`  function ${last}(`, start);
  assert.ok(start >= 0 && end > start);
  return app.slice(start, end);
}

// Run the production UI functions with small DOM doubles; browser tests cover pixels.
function selectionFixture() {
  const levels = ['easy', 'medium', 'hard', 'expert'];
  const choices = core.TYPE_ORDER.flatMap(value => ['simple', 'advanced'].map(mode => ({value, checked: true, dataset: {mode}})));
  const counts = core.TYPE_ORDER.map(type => ({id: `count-${type}`, className: 'type-count', dataset: {type}}));
  const cells = core.TYPE_ORDER.flatMap(type => levels.map(level => ({className: 'matrix-cell', dataset: {type, level}})));
  const fields = [...counts, ...cells];
  fields.forEach(field => Object.assign(field, {value: '0', disabled: false, attributes: {}, removeAttribute(name) { delete this.attributes[name]; }}));
  const all = selector => {
    if (selector === '.bulk-type-choice') return choices;
    if (selector === '.bulk-type-choice:checked') return choices.filter(choice => choice.checked);
    return [...new Set(selector.split(', ').flatMap(part => fields.filter(field =>
      part.startsWith(`.${field.className}`) && [...part.matchAll(/\[data-(type|level)="([^"]+)"\]/g)].every(([, key, value]) => field.dataset[key] === value)
    )))];
  };
  const byId = id => fields.find(field => field.id === id);
  const fills = levels.map(level => ({dataset: {level}, value: '0', min: '0', max: '25'}));
  const elements = {simpleCountFill: {value: '0', min: '0', max: '50'}, promptStatus: {}};
  const context = vm.createContext({core, all, byId, elements,
    numericValue: input => Number(input.value) || 0,
    document: {querySelector: selector => selector.startsWith('.matrix-column-fill') ? fills.find(fill => selector.includes(fill.dataset.level)) : all(selector)[0]},
    updateMatrixTotals: () => cells.reduce((sum, cell) => sum + Number(cell.value), 0),
    updateTotals() {}, invalidatePrompt() {}, setStatus() {},
  });
  vm.runInContext(functionsBetween('normalizedBulkCount', 'updateDifficultyUi') + functionsBetween('syncSimpleToMatrixIfEmpty', 'setEditorMode'), context);
  return {choices, counts, cells, fields, fills, elements, all, run: script => vm.runInContext(script, context)};
}

test('unchecking clears and disables all five fields and both checkboxes for every type', () => {
  const f = selectionFixture();
  f.fields.forEach(field => { field.value = '3'; field.attributes['aria-invalid'] = 'true'; });
  for (const type of core.TYPE_ORDER) {
    f.run(`setQuestionTypeSelected('${type}', false)`);
    for (const field of f.fields.filter(field => field.dataset.type === type)) {
      assert.equal(field.value, '');
      assert.equal(field.disabled, true);
      assert.equal(field.attributes['aria-invalid'], undefined);
    }
    assert.ok(f.choices.filter(choice => choice.value === type).every(choice => !choice.checked));
  }
});

test('reselecting starts at zero without restoring old values or clearing other active types', () => {
  const f = selectionFixture();
  f.fields.forEach(field => { field.value = '7'; });
  f.run("setQuestionTypeSelected('JUM', false); setQuestionTypeSelected('JUM', true)");
  assert.ok(f.fields.filter(field => field.dataset.type === 'JUM').every(field => field.value === '0' && !field.disabled));
  f.run('core.TYPE_ORDER.forEach(type => setQuestionTypeSelected(type, true))');
  assert.ok(f.fields.filter(field => field.dataset.type !== 'JUM').every(field => field.value === '7'));
  assert.ok(f.choices.every(choice => choice.checked));
});

test('mode synchronization leaves deselected inputs blank with empty or populated matrices', () => {
  const f = selectionFixture();
  f.counts[0].value = '9';
  f.run("setQuestionTypeSelected('CALC', false); syncSimpleToMatrixIfEmpty()");
  assert.equal(f.cells.find(cell => cell.dataset.type === 'MC' && cell.dataset.level === 'medium').value, '9');
  for (let repeat = 0; repeat < 3; repeat += 1) {
    f.run('syncMatrixToSimple(); syncSimpleToMatrixIfEmpty()');
    assert.ok(f.fields.filter(field => field.dataset.type === 'CALC').every(field => field.value === '' && field.disabled));
  }
  f.run("setQuestionTypeSelected('CALC', true)");
  assert.ok(f.fields.filter(field => field.dataset.type === 'CALC').every(field => field.value === '0' && !field.disabled));
});

test('bulk fill never writes into unchecked types in either editor', () => {
  const f = selectionFixture();
  f.run("setQuestionTypeSelected('JUM', false); setQuestionTypeSelected('CALC', false)");
  f.elements.simpleCountFill.value = '4';
  f.run('applySimpleCount()');
  for (const fill of f.fills) { fill.value = '2'; f.run(`applyMatrixColumn('${fill.dataset.level}')`); }
  for (const field of f.fields) {
    assert.equal(field.value, ['JUM', 'CALC'].includes(field.dataset.type) ? '' : field.className === 'type-count' ? '4' : '2');
  }
  f.run('core.TYPE_ORDER.forEach(type => setQuestionTypeSelected(type, false)); applySimpleCount()');
  assert.ok(f.fields.every(field => field.value === '' && field.disabled));
  f.run('core.TYPE_ORDER.forEach(type => setQuestionTypeSelected(type, true))');
  assert.ok(f.fields.every(field => field.value === '0' && !field.disabled));
});

function reminderFixture(storage = new Map(), blocked = false) {
  const dialog = {open: false, shown: 0, showModal() { this.open = true; this.shown += 1; }};
  const checkbox = {checked: false};
  const context = vm.createContext({
    elements: {modelAdvice: dialog, modelAdviceRemember: checkbox},
    window: {localStorage: {getItem(key) { if (blocked) throw new Error('Storage blocked'); return storage.get(key); }, setItem(key, value) { if (blocked) throw new Error('Storage blocked'); storage.set(key, value); }}},
  });
  vm.runInContext("const MODEL_ADVICE_PREFERENCE = 'bb-qm:model-advice-dismissed:v1'; let modelAdviceDismissed = false;" + functionsBetween('showModelAdvice', 'generatePrompt'), context);
  return {dialog, checkbox, storage, show: () => vm.runInContext('showModelAdvice()', context), close: () => {dialog.open = false; vm.runInContext('rememberModelAdviceChoice()', context);}};
}

test('model note appears after successful generation only, not on initial load or validation failure', () => {
  const f = reminderFixture();
  assert.equal(f.dialog.shown, 0);
  f.show(); f.show();
  assert.equal(f.dialog.shown, 1);
  f.close(); f.show();
  assert.equal(f.dialog.shown, 2);
  assert.equal(f.storage.size, 0);
  const generate = functionsBetween('generatePrompt', 'editPrompt');
  assert.match(generate, /core\.buildPrompt\(config\)[\s\S]+showModelAdvice\(\);\s*} catch/);
  assert.equal((app.match(/showModelAdvice\(\);/g) || []).length, 1);
  assert.match(html, /<dialog id="model-advice-dialog"[^>]*aria-labelledby="model-advice-title"/);
  assert.doesNotMatch(html.match(/<dialog id="model-advice-dialog"[^>]*>/)[0], /\bopen\b/);
});

test('do-not-remind preference persists on close and across reloads', () => {
  const f = reminderFixture();
  f.show(); f.checkbox.checked = true; f.close(); f.show();
  assert.equal(f.dialog.shown, 1);
  const nextPage = reminderFixture(f.storage);
  nextPage.show();
  assert.equal(nextPage.dialog.shown, 0);
  assert.match(app, /modelAdvice\.addEventListener\('close', rememberModelAdviceChoice\)/);
});

test('blocked storage never prevents prompting and preference still lasts for the page', () => {
  const f = reminderFixture(new Map(), true);
  assert.doesNotThrow(f.show);
  f.close(); f.show();
  assert.equal(f.dialog.shown, 2);
  f.checkbox.checked = true;
  assert.doesNotThrow(f.close);
  f.show();
  assert.equal(f.dialog.shown, 2);
});
