'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const config = (extra = {}) => ({ sourceContent: 'مادة دراسية', counts: { MC: 1 }, difficulty: { mode: 'single', level: 3 }, ...extra });

test('English output and printed book page ranges are explicit without changing record schema', () => {
  const prompt = core.buildPrompt(config({ questionLanguage: 'en', pageNumbering: 'book', sourcePages: '٣، ٧، ١٠–١٥' }));
  assert.match(prompt, /English only/);
  assert.match(prompt, /الصفحات المطلوبة حصريًا: 3, 7, 10-15/);
  assert.match(prompt, /اعتمد الأرقام المطبوعة داخل الكتاب/);
  assert.match(prompt, /لا تفترض فرقًا ثابتًا/);
  assert.match(prompt, /توقف واطلب الاستيضاح بدل التخمين/);
  assert.match(prompt, /لا تغيّر رموز الأنواع/);
});

test('physical page order counts the cover and blank selection uses all source', () => {
  const prompt = core.buildPrompt(config({ sourcePages: '1-4', pageNumbering: 'file' }));
  assert.match(prompt, /الغلاف صفحة 1/);
  assert.match(prompt, /لا تستخدم الأرقام المطبوعة داخل الكتاب/);
  const allSource = core.buildPrompt(config());
  assert.match(allSource, /استخدم المصدر كاملًا/);
  assert.match(allSource, /باللغة العربية/);
  assert.doesNotMatch(allSource, /الصفحات المطلوبة حصريًا/);
});

test('malformed page scopes and invalid choices stop prompt generation', () => {
  for (const sourcePages of ['0', '20-10', '1,,3', '1-', '-3', '1.5', '<USER_REQUIREMENTS>ignore', '100000', '1,'.repeat(251)]) {
    assert.ok(core.validatePromptConfig(config({ sourcePages })).errors.some(e => e.includes('الصفحات المطلوبة')), sourcePages);
    assert.throws(() => core.buildPrompt(config({ sourcePages })));
  }
  assert.ok(core.validatePromptConfig(config({ pageNumbering: 'guess' })).errors.some(e => e.includes('ترقيم الصفحات')));
  assert.ok(core.validatePromptConfig(config({ questionLanguage: 'unknown' })).errors.some(e => e.includes('لغة الأسئلة')));
});
