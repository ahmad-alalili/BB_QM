'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const layout = require('../layout.js');
const {read} = require('./helpers/sources.js');

// Unit-test doubles: these check state, focus and semantics, not browser pixels.
function fixture(width = 390, mediaApi = 'modern') {
  const nodes = new Map();
  const doc = { documentElement: { dataset: {} }, activeElement: null, getElementById: id => nodes.get(id), selectors: {}, querySelectorAll(selector) { return this.selectors[selector] || []; } };
  function node(id, parent = null) {
    const value = {
      id, parentElement: parent, dataset: {}, hidden: false, attributes: {}, events: {}, selectors: {}, value: '',
      setAttribute(name, text) { this.attributes[name] = String(text); },
      addEventListener(name, listener) { (this.events[name] ||= []).push(listener); },
      emit(name, event = {}) { (this.events[name] || []).forEach(listener => listener(event)); },
      querySelectorAll(selector) { return this.selectors[selector] || []; },
      contains(target) { for (let current = target; current; current = current.parentElement) if (current === this) return true; return false; },
      focus() { doc.activeElement = this; for (let current = this; current; current = current.parentElement) current.emit('focusin'); },
      scrollIntoView(options) { this.scrollOptions = options; },
    };
    nodes.set(id, value);
    return value;
  }
  const picker = node('layout-mode');
  picker.value = 'auto';
  const nav = node('mobile-step-nav');
  node('step-prompt-tab', nav);
  node('step-export-tab', nav);
  const prompt = node('prompt-panel');
  const exp = node('export-panel');
  node('prompt-section-title', prompt);
  node('export-section-title', exp);
  node('go-to-export', prompt);
  node('back-to-prompt', exp);
  node('source-content', prompt).value = 'مادة دراسية لم تُرسل';
  node('prompt-output', prompt).value = 'برومبت معدل';
  node('ai-response', exp).value = 'رد محفوظ';
  node('question-points-1', exp).value = '٢٫٧٥';
  const media = { matches: width <= 820, events: {}, emit() { this.events.change?.(); } };
  const win = { innerWidth: width, events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  if (mediaApi !== 'none') {
    if (mediaApi === 'legacy') media.addListener = callback => { media.events.change = callback; };
    else media.addEventListener = (name, callback) => { media.events[name] = callback; };
    win.matchMedia = query => { assert.equal(query, '(max-width: 820px)'); return media; };
  }
  const start = () => layout.initialize(doc, win);
  return { doc, win, media, node, nodes, picker, prompt, exp, nav, start };
}

test('layout defaults to the viewport and supports explicit phone and desktop preferences', () => {
  assert.equal(layout.resolveMode('auto', true), 'mobile');
  assert.equal(layout.resolveMode('auto', false), 'desktop');
  assert.equal(layout.resolveMode('mobile', false), 'mobile');
  assert.equal(layout.resolveMode('desktop', true), 'desktop');
  assert.equal(layout.resolveMode('unknown', true), 'mobile');
});

test('phone shows exactly one accessible step; desktop shows both regions', () => {
  const f = fixture(); f.start();
  assert.equal(f.doc.documentElement.dataset.layout, 'mobile');
  assert.equal(f.nav.hidden, false);
  assert.equal(f.prompt.hidden, false);
  assert.equal(f.exp.hidden, true);
  assert.equal(f.prompt.attributes.role, 'tabpanel');
  assert.equal(f.prompt.attributes['aria-labelledby'], 'step-prompt-tab');
  f.picker.value = 'desktop'; f.picker.emit('change');
  assert.equal(f.nav.hidden, true);
  assert.equal(f.prompt.hidden, false);
  assert.equal(f.exp.hidden, false);
  assert.equal(f.exp.attributes.role, 'region');
  assert.equal(f.exp.attributes['aria-labelledby'], 'export-section-title');
});

test('changing mode, step and orientation keeps the exact same fields and draft values', () => {
  const f = fixture(); const api = f.start();
  const ids = ['source-content', 'prompt-output', 'ai-response', 'question-points-1'];
  const fields = ids.map(id => f.nodes.get(id));
  const values = fields.map(field => field.value);
  for (let round = 0; round < 4; round += 1) {
    api.selectStep(1, false);
    f.media.matches = false; f.media.emit();
    f.media.matches = true; f.media.emit();
    assert.equal(f.exp.hidden, false);
    f.picker.value = 'desktop'; f.picker.emit('change');
    f.picker.value = 'mobile'; f.picker.emit('change');
    api.selectStep(0, false);
  }
  assert.deepEqual(ids.map(id => f.nodes.get(id)), fields);
  assert.deepEqual(fields.map(field => field.value), values);
});

test('resizing or manually choosing phone keeps the last edited desktop step visible', () => {
  const f = fixture(1440); f.start();
  f.nodes.get('ai-response').focus();
  f.picker.focus();
  f.picker.value = 'mobile'; f.picker.emit('change');
  assert.equal(f.exp.hidden, false);
  assert.equal(f.prompt.hidden, true);
  f.picker.value = 'auto'; f.picker.emit('change');
  f.nodes.get('source-content').focus();
  f.media.matches = true; f.media.emit();
  assert.equal(f.prompt.hidden, false);
  assert.equal(f.exp.hidden, true);
});

test('phone tab keyboard navigation has a single tab stop and supports arrows, Home and End', () => {
  const f = fixture(); f.start();
  const first = f.nodes.get('step-prompt-tab');
  const second = f.nodes.get('step-export-tab');
  let prevented = 0;
  first.emit('keydown', { key: 'ArrowLeft', preventDefault() { prevented += 1; } });
  assert.equal(second.tabIndex, 0);
  assert.equal(first.tabIndex, -1);
  assert.equal(f.doc.activeElement, second);
  assert.equal(second.attributes['aria-selected'], 'true');
  second.emit('keydown', { key: 'Home', preventDefault() { prevented += 1; } });
  assert.equal(f.doc.activeElement, first);
  first.emit('keydown', { key: 'End', preventDefault() { prevented += 1; } });
  assert.equal(f.doc.activeElement, second);
  second.emit('keydown', { key: 'ArrowRight', preventDefault() { prevented += 1; } });
  assert.equal(f.doc.activeElement, first);
  first.emit('keydown', { key: 'Tab', preventDefault() { throw new Error('Do not trap Tab'); } });
  assert.equal(prevented, 4);
});

test('phone next and back buttons expose and focus the destination without losing state', () => {
  const f = fixture(); const api = f.start();
  f.nodes.get('go-to-export').emit('click');
  assert.equal(f.exp.hidden, false);
  assert.equal(f.doc.activeElement.id, 'export-section-title');
  assert.deepEqual(f.exp.scrollOptions, { block: 'start', behavior: 'auto' });
  f.nodes.get('back-to-prompt').emit('click');
  assert.equal(f.prompt.hidden, false);
  assert.equal(f.doc.activeElement.id, 'prompt-section-title');
  api.selectStep(99, false);
  assert.equal(f.prompt.hidden, false);
});

test('legacy media listeners and the no-matchMedia fallback keep automatic resizing usable', () => {
  for (const mediaApi of ['legacy', 'none']) {
    const f = fixture(390, mediaApi); f.start();
    assert.equal(f.doc.documentElement.dataset.layout, 'mobile');
    f.win.innerWidth = 1200;
    f.media.matches = false;
    if (mediaApi === 'legacy') f.media.emit(); else f.win.events.resize();
    assert.equal(f.doc.documentElement.dataset.layout, 'desktop');
  }
});

test('card-based tables keep explicit table roles and meaningful difficulty labels', () => {
  const f = fixture();
  const table = f.node('test-table'); const body = f.node('test-body');
  const row = f.node('test-row'); const th = f.node('test-th'); th.scope = 'row';
  const td = f.node('test-td'); const input = f.node('test-input', td); input.dataset.level = 'medium';
  const totalTd = f.node('test-total-cell'); const total = f.node('test-total', totalTd);
  table.selectors = { 'thead, tbody, tfoot': [body], tr: [row], td: [td, totalTd], th: [th] };
  f.doc.selectors = { table: [table], '.matrix-cell': [input], '.row-total': [total] };
  f.start();
  assert.equal(table.attributes.role, 'table');
  assert.equal(body.attributes.role, 'rowgroup');
  assert.equal(row.attributes.role, 'row');
  assert.equal(th.attributes.role, 'rowheader');
  assert.equal(td.attributes.role, 'cell');
  assert.equal(td.dataset.label, 'متوسط');
  assert.equal(totalTd.dataset.label, 'المجموع');
});

test('responsive controls and assets are present, local and reference unique elements', () => {
  const html = read('index.html'); const js = read('layout.js');
  for (const asset of ['layout.js', 'responsive.css']) assert.ok(html.includes(`="${asset}"`));
  for (const option of ['auto', 'mobile', 'desktop']) assert.match(html, new RegExp(`<option value="${option}"`));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of js.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(ids.has(match[1]));
  assert.match(html, /id="mobile-step-nav"[^>]*hidden/);
  assert.doesNotMatch(html, /id="(?:prompt-panel|export-panel)"[^>]*\bhidden\b/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|innerHTML|outerHTML|fetch\(|replaceChildren/);
});

test('compact CSS removes table minimum widths and nested points scrolling without masking page overflow', () => {
  const css = read('responsive.css');
  assert.match(css, /html\[data-layout="mobile"\] table \{[^}]*min-width: 0/);
  assert.match(css, /html\[data-layout="mobile"\] \.points-table-scroll \{[^}]*max-height: none; overflow: visible/);
  assert.match(css, /html\[data-layout="mobile"\] \.matrix-cell \{[^}]*width: 100% !important/);
  assert.match(css, /html\[data-layout="mobile"\] \.points-table tbody tr \{[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /width: min\(32rem, calc\(100% - 1\.25rem\)\)/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:hidden|clip)/);
  assert.doesNotMatch(css, /position:\s*(?:fixed|sticky)/);
  assert.match(css, /font-size: 1rem; border-color/);
  assert.match(css, /\.button, \.segment, summary \{ min-height: 2\.875rem/);
});

test('optional details start collapsed and invalid fields are revealed before focus', () => {
  const html = read('index.html'); const app = read('app.js');
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /class="disclosure supplementary"/);
  assert.match(html, /class="disclosure extra-options"/);
  assert.match(app, /ancestor\.tagName === 'DETAILS'\) ancestor\.open = true;[\s\S]*?element\.focus\(\)/);
  assert.match(app, /elements\.maCreditEditor\.hidden = !enabled/);
  assert.match(app, /pointsCell\.dataset\.label = 'النقاط'/);
});

test('HTML remains explicitly balanced after adding responsive wrappers', () => {
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const tag = match[2].toLowerCase();
    if (voidTags.has(tag)) continue;
    if (match[1]) assert.equal(stack.pop(), tag, `Unbalanced </${tag}> near offset ${match.index}`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, []);
});
