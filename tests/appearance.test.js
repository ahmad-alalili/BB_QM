'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const appearance = require('../appearance.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function fixture(saved, blocked = false, loadFont) {
  const storage = new Map(saved === undefined ? [] : [[appearance.FONT_KEY, saved]]);
  const fields = {source: 'مادة دراسية', prompt: 'برومبت معدّل', response: '{"type":"MC"}', counts: ['2', ''], points: [1, 3]};
  const before = JSON.stringify(fields);
  const picker = {value: 'cairo', events: {}, addEventListener(name, fn) { this.events[name] = fn; }};
  const doc = {documentElement: {dataset: {}}, getElementById(id) { assert.equal(id, 'interface-font'); return picker; }};
  if (loadFont) doc.fonts = {load: loadFont};
  const win = {localStorage: {
    getItem(key) { if (blocked) throw new Error('Unavailable'); return storage.get(key); },
    setItem(key, value) { if (blocked) throw new Error('Unavailable'); storage.set(key, value); },
  }};
  appearance.initialize(doc, win);
  return {doc, picker, fields, before, storage, select(value, event = 'change') { picker.value = value; picker.events[event](); }};
}

test('font input updates immediately without blur, reload or changes to question data', () => {
  const f = fixture();
  for (const font of ['ruqaa', 'naskh', 'cairo', 'plex', 'tajawal', 'system']) {
    f.select(font, 'input');
    assert.equal(f.doc.documentElement.dataset.uiFont, font);
    assert.equal(f.storage.get(appearance.FONT_KEY), font);
    assert.equal(JSON.stringify(f.fields), f.before);
  }
  assert.doesNotMatch(read('appearance.js'), /location|reload\(|setTimeout|debounce/);
});

test('local fonts warm in the background and slow completion cannot overwrite a newer selection', async () => {
  const pending = [];
  const requested = [];
  const f = fixture('naskh', false, (font, sample) => {
    requested.push(font);
    assert.equal(sample, 'مساحة المدرب 0123456789 Blackboard');
    return new Promise(resolve => pending.push(resolve));
  });
  assert.equal(requested.length, 10);
  for (const family of ['BB Cairo', 'BB Tajawal', 'BB Plex', 'BB Naskh', 'BB Ruqaa']) {
    assert.match(read('theme.css'), new RegExp(`font-family: '${family}'`));
    for (const weight of [400, 700]) assert.ok(requested.includes(`${weight} 16px "${family}"`));
  }
  f.select('ruqaa', 'input');
  f.select('plex', 'input');
  for (const resolve of pending.reverse()) resolve([]);
  await Promise.resolve();
  assert.equal(f.doc.documentElement.dataset.uiFont, 'plex');
  assert.equal(f.picker.value, 'plex');
  assert.equal(JSON.stringify(f.fields), f.before);
});

test('failed font loading and blocked storage do not prevent immediate font selection', async () => {
  for (const loader of [undefined, () => { throw new Error('Unavailable'); }, () => Promise.reject(new Error('Unavailable'))]) {
    const f = fixture(undefined, true, loader);
    f.select('ruqaa', 'input');
    assert.equal(f.doc.documentElement.dataset.uiFont, 'ruqaa');
    assert.equal(f.storage.size, 0);
  }
  await Promise.resolve();
});

test('header names the trainer workspace', () => {
  assert.match(read('index.html'), /<p class="eyebrow">مساحة المدرّب<\/p>/);
  assert.doesNotMatch(read('index.html'), /مساحة المدرّس/);
});

test('interface starts in Cairo and remembers only an allowlisted font identifier', () => {
  const f = fixture();
  assert.equal(f.doc.documentElement.dataset.uiFont, 'cairo');
  assert.equal(f.storage.size, 0);
  for (const font of appearance.FONT_CHOICES) {
    f.select(font);
    assert.equal(f.doc.documentElement.dataset.uiFont, font);
    assert.equal(f.storage.get(appearance.FONT_KEY), font);
    assert.equal(JSON.stringify(f.fields), f.before);
  }
  assert.equal(f.storage.size, 1);
});

test('saved font survives reloading and arbitrary values fall back safely', () => {
  for (const font of appearance.FONT_CHOICES) assert.equal(fixture(font).picker.value, font);
  for (const invalid of [undefined, null, '', 'evil', 'url(https://example.com)', '__proto__', {font: 'plex'}]) {
    assert.equal(appearance.normalizeFont(invalid), 'cairo');
    assert.equal(fixture(invalid).picker.value, 'cairo');
  }
});

test('blocked storage still lets the user change the current interface font', () => {
  const f = fixture(undefined, true);
  f.select('tajawal');
  assert.equal(f.doc.documentElement.dataset.uiFont, 'tajawal');
  assert.equal(f.picker.value, 'tajawal');
  assert.equal(f.storage.size, 0);
});

test('font picker is labelled, ordered and independent from question controls', () => {
  const html = read('index.html');
  assert.match(html, /<label class="font-picker" for="interface-font"/);
  assert.match(html, /<select id="interface-font" aria-describedby="font-help"/);
  const options = html.match(/<select id="interface-font"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...options.matchAll(/value="([^"]+)"/g)].map(match => match[1]), [...appearance.FONT_CHOICES]);
  assert.match(options, /value="naskh">النسخ — كلاسيكي<\/option>/);
  assert.match(options, /value="ruqaa">الرقعة — أصيل<\/option>/);
  assert.match(html, /<script defer src="appearance.js"><\/script>/);
  const js = read('appearance.js');
  assert.doesNotMatch(js, /fetch\(|\.innerHTML|\.style\.|BlackboardCore|BBAnalytics|querySelectorAll/);
});

test('all theme fonts are bundled TrueType files with licenses, never remote resources', () => {
  const css = read('theme.css');
  assert.doesNotMatch(css, /url\(\s*["']?https?:/);
  const urls = [...css.matchAll(/url\('([^']+\.ttf)'\)/g)].map(match => match[1]);
  assert.equal(urls.length, 8);
  for (const url of urls) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', url));
    assert.equal(bytes.readUInt32BE(0), 0x00010000);
    assert.ok(bytes.length > 10000);
    assert.match(read(path.join(path.dirname(url), 'OFL.txt')), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  assert.equal((css.match(/font-display: swap/g) || []).length, 8);
  assert.match(css, /html\[data-ui-font="naskh"\] \{ --font-sans: 'BB Naskh'/);
  assert.match(css, /html\[data-ui-font="ruqaa"\] \{ --font-sans: 'BB Ruqaa'/);
});

test('page numbering is chosen before the required pages in reading and tab order', () => {
  const html = read('index.html');
  const fields = html.match(/<div class="source-options">[\s\S]*?<p id="source-pages-help"/)[0];
  const controls = [...fields.matchAll(/<(?:select|input) id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(controls, ['question-language', 'page-numbering', 'source-pages']);
  assert.match(fields, /<label for="page-numbering">طريقة ترقيم الصفحات<\/label>/);
  assert.match(fields, /<label for="source-pages">الصفحات المطلوبة \(اختياري\)<\/label>/);
});

test('paste instructions use the correct Arabic imperative spelling', () => {
  assert.doesNotMatch(read('index.html') + read('app.js'), /الصقه/);
});

test('jewel theme covers dialogs, notices, cards and controls without overriding type selection', () => {
  const css = read('theme.css');
  const html = read('index.html');
  assert.ok(html.indexOf('href="theme.css"') > html.indexOf('href="analytics.css"'));
  for (const token of ['--glass-light', '--glass-soft', '--glass-emerald', '--glass-ruby', '--jewel-green', '--jewel-ruby', '--reflection']) assert.ok(css.includes(token));
  for (const selector of ['.site-header', '.panel', '.button.primary', '.button.clear-field-button', '.guide', '.site-footer', '.analytics-notice', 'dialog.model-advice', '.preview-item', '.analytics-totals']) assert.ok(css.includes(selector));
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /html\[data-layout="mobile"\] \.points-table td:nth-child\(2\),\s*html\[data-layout="mobile"\] \.points-table td:nth-child\(3\) \{ width: auto; min-width: 0; max-width: none; \}/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:hidden|clip)/);
  assert.doesNotMatch(css, /\.count-card\s*\{[^}]*background:/);
});
