'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../core.js');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const PROVIDER_URLS = Object.freeze([
  'https://chatgpt.com/',
  'https://claude.ai/new',
  'https://gemini.google.com/app',
]);
const FEEDBACK_URL = 'https://forms.cloud.microsoft/r/XcRLkytgSc';

function attributeValues(source, attribute) {
  const pattern = new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'gi');
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function cssBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  const end = source.indexOf('}', start);
  assert.notEqual(end, -1, `unterminated CSS selector: ${selector}`);
  return source.slice(start, end + 1);
}

test('the webpage has no remote runtime dependency', () => {
  const html = read('index.html');
  const styles = read('styles.css');
  const remoteSources = attributeValues(html, 'src').filter((value) => /^https?:\/\//i.test(value));
  const remoteLinks = attributeValues(html, 'href').filter((value) => /^https?:\/\//i.test(value));

  assert.deepEqual(remoteSources, []);
  assert.deepEqual([...new Set(remoteLinks)].sort(), [...PROVIDER_URLS, FEEDBACK_URL].sort());
  assert.doesNotMatch(html, /<link\b[^>]*href=["']https?:\/\//i);
  assert.doesNotMatch(html, /<(?:iframe|object|embed|source|video|audio|form)\b[^>]*(?:src|data|action)=["']https?:\/\//i);
  assert.doesNotMatch(styles, /url\(\s*["']?https?:\/\//i);
  assert.match(html, /src="vendor\/jszip\.min\.js"/);
  assert.match(html, /default-src 'none'/);
  assert.ok(fs.existsSync(path.join(root, 'vendor', 'jszip.min.js')));
  assert.ok(fs.existsSync(path.join(root, 'vendor', 'JSZip-LICENSE.md')));
  const vendorBytes = fs.readFileSync(path.join(root, 'vendor', 'jszip.min.js'));
  assert.equal(
    crypto.createHash('sha256').update(vendorBytes).digest('hex'),
    'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e',
  );
});

test('the visible, package, and core versions stay synchronized', () => {
  const html = read('index.html');
  const packageData = JSON.parse(read('package.json'));
  const lockData = JSON.parse(read('package-lock.json'));
  assert.equal(core.VERSION, packageData.version);
  assert.equal(lockData.version, packageData.version);
  assert.equal(lockData.packages[''].version, packageData.version);
  assert.match(html, new RegExp(`id="app-version">${core.VERSION.replace(/\./g, '\\.')}`));
});

test('footer credits the engineer and links safely to the exact feedback form', () => {
  const footer = read('index.html').match(/<footer\b[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /© 2026 المهندس <strong>أحمد سعيد العليلي<\/strong>/);
  assert.match(footer, /جميع الحقوق محفوظة/);
  const anchor = footer.match(/<a\b[^>]*class="feedback-link"[^>]*>/)[0];
  assert.deepEqual(attributeValues(anchor, 'href'), [FEEDBACK_URL]);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="noopener noreferrer"/);
  assert.match(anchor, /aria-describedby="feedback-hint"/);
  assert.match(footer, /id="feedback-hint">يفتح نموذج Microsoft Forms في تبويب جديد/);
  assert.doesNotMatch(anchor, /data-provider|\?/);
  const css = cssBlock(read('styles.css'), '.site-footer .feedback-link');
  assert.match(css, /min-height: 44px/);
  assert.match(css, /white-space: normal/);
  assert.match(css, /max-width: 100%/);
  assert.match(read('styles.css'), /\.feedback-link:focus-visible/);
});

test('the interface uses the modern glass visual system with a solid fallback', () => {
  const css = read('styles.css');
  assert.match(css, /backdrop-filter:\s*blur\(var\(--blur\)\)/);
  assert.match(css, /--glass-border:/);
  assert.match(css, /linear-gradient\(145deg, #f6fbfd/);
  assert.match(css, /@supports not \(\(backdrop-filter:/);
});

test('the generated prompt becomes editable and its restore control starts disabled', () => {
  const html = read('index.html');
  const app = read('app.js');
  const promptField = html.match(/<textarea\b[^>]*\bid=["']prompt-output["'][^>]*>/i);
  const restoreButton = html.match(/<button\b[^>]*\bid=["']restore-prompt["'][^>]*>/i);

  assert.ok(promptField, 'prompt-output must be a textarea');
  assert.match(promptField[0], /\breadonly\b/i);
  assert.doesNotMatch(promptField[0], /\bdisabled\b/i);
  assert.ok(restoreButton, 'restore-prompt button is required');
  assert.match(restoreButton[0], /\bdisabled\b/i);
  assert.match(app, /restorePrompt:\s*byId\(["']restore-prompt["']\)/);
  assert.match(app, /promptOutput\.readOnly\s*=\s*false/);
  assert.match(app, /promptOutput\.addEventListener\(["']input["']/);
  assert.match(app, /restorePrompt\.addEventListener\(["']click["']/);
  assert.match(app, /distribution_check_skipped/);
  assert.match(app, /currentPrompt !== generatedBasePrompt/);
  assert.match(app, /let generatedRequestedCounts = null/);
  assert.match(app, /requestedCounts = currentPrompt === generatedBasePrompt && generatedRequestedCounts/);
  assert.doesNotMatch(app, /generatedBasePrompt && !promptIsStale && currentPrompt !== generatedBasePrompt/);
});

test('distribution-only failures explain that syntax passed and the AI quota did not', () => {
  const app = read('app.js');
  assert.match(app, /const distributionOnly = distributionErrors\.length > 0/);
  assert.match(app, /سليمة من حيث الصيغة، لكن أعداد أنواعها لا تطابق البرومبت/);
  assert.match(app, /فروق «طُلب\/وصل»/);
});

test('provider links are fixed, complete, and safe to open in a new tab', () => {
  const html = read('index.html');
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);

  PROVIDER_URLS.forEach((url) => {
    const anchor = anchors.find((candidate) => attributeValues(candidate, 'href')[0] === url);
    assert.ok(anchor, `missing provider link: ${url}`);
    assert.match(anchor, /\btarget=["']_blank["']/i);
    const rel = attributeValues(anchor, 'rel')[0] || '';
    assert.match(rel, /(?:^|\s)noopener(?:\s|$)/i);
    assert.match(rel, /(?:^|\s)noreferrer(?:\s|$)/i);
  });
  const app = read('app.js');
  assert.match(app, /removeAttribute\(['"]href['"]\)/);
  assert.match(app, /const copyRevision = promptRevision/);
  assert.match(app, /copyRevision === promptRevision && !promptIsStale/);
});

test('application code avoids dangerous DOM insertion and anti-devtools behavior', () => {
  const source = `${read('index.html')}\n${read('app.js')}\n${read('styles.css')}`;
  assert.doesNotMatch(source, /\.innerHTML\b/);
  assert.doesNotMatch(source, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(source, /protectApp|devtools|contextmenu|keydown|setInterval/);
  assert.doesNotMatch(source, /user-select\s*:\s*none/i);
});

test('key accessibility regions and local privacy disclosure are present', () => {
  const html = read('index.html');
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<main\b/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<caption class="sr-only">/);
  assert.match(html, /لن ترسل الصفحة هذا النص تلقائيًا/);
  assert.match(html, /لا يُلصق النص ولا يُرسل تلقائيًا/);
  assert.match(html, /أزرار الخدمات تنسخ البرومبت وتفتح الموقع فقط/);
});

test('every supported question type has simple and advanced controls', () => {
  const html = read('index.html');
  core.TYPE_ORDER.forEach((type) => {
    assert.match(html, new RegExp(`id=["']count-${type}["']`));
    assert.match(html, new RegExp(`data-row-type=["']${type}["']`));
    ['easy', 'medium', 'hard', 'expert'].forEach((level) => {
      assert.match(html, new RegExp(`data-type=["']${type}["'][^>]*data-level=["']${level}["']`));
    });
  });
});

test('question structure controls expose matching extras, smart MA credit rows, and dropdown distractors', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of [
    'mat-pair-count',
    'mat-distractor-count',
    'ma-choice-count',
    'ma-correct-count',
    'ma-selection-limit',
    'ma-partial-credit',
    'ma-credit-editor',
    'ma-credit-rows',
    'ma-credit-total',
    'ma-credit-state',
    'ma-smart-distribute',
    'jum-distractor-count',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`byId\\(["']${id}["']\\)`));
  }
  assert.doesNotMatch(html, /id="ma-percentages"/);
  assert.match(html, /id="ma-smart-distribute"[^>]*disabled/);
  assert.match(app, /core\.smartCreditProfile/);
  assert.match(app, /className = 'credit-row'/);
  assert.match(app, /className = 'ma-credit-level'/);
  assert.match(app, /className = 'ma-credit-percent'/);
  assert.match(app, /updatePartialCreditUi/);
  assert.match(html, /id="ma-selection-limit"[^>]*readonly[^>]*aria-readonly="true"/);
  assert.match(app, /function syncMultipleAnswerLimits\(\)/);
  assert.match(app, /elements\.maCorrectCount\.max = String\(maximum\)/);
  assert.match(app, /elements\.maSelectionLimit\.value = String\(maximum\)/);
  const percentWrap = cssBlock(read('styles.css'), '.credit-percent-wrap');
  const percentSuffix = cssBlock(read('styles.css'), '.credit-percent-wrap > span');
  assert.match(percentWrap, /display:\s*flex/);
  assert.doesNotMatch(percentSuffix, /position:\s*absolute/);
  assert.match(app, /core\.validateQuestionStructures/);
});

test('the reference bank replaces public QTI while the course test stays separate', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /value="native-bank" checked/);
  assert.doesNotMatch(html, /value="qti"/);
  assert.doesNotMatch(app, /core\.buildQtiFiles/);
  assert.match(html, /id="bank-title"[^>]*maxlength="200"/);
  assert.match(app, /result.format === 'native-bank' \? 'pool' : 'test'/);
  assert.match(app, /blackboard-question-bank/);
  assert.match(html, /value="native-test"/);
  assert.match(html, /id="native-title"[^>]*maxlength="200"/);
  assert.match(html, /اختبار داخل المقرر/);
  assert.match(html, /عمود درجات مطابقًا لمجموع النقاط/);
  assert.match(html, /<fieldset class="format-fieldset" aria-describedby="format-note">/);
  assert.match(html, /id="format-note"[^>]*aria-live="polite"/);
  assert.match(app, /checkCRC32:\s*true/);
  assert.match(app, /core\.validateNativeFiles/);
  assert.match(app, /compression:\s*'STORE'/);
  assert.match(app, /blackboard-course-test/);
  assert.match(app, /تم تنزيل \$\{label\}[\s\S]*?'warning'/);
});

test('Native bank and course test share the accessible points review step', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id="points-editor"[^>]*aria-labelledby="points-title"[^>]*hidden/);
  assert.match(html, /id="points-total"[^>]*aria-live="polite"/);
  assert.match(html, /id="bulk-points"[^>]*inputmode="decimal"/);
  assert.match(html, /id="apply-points-all"/);
  assert.match(html, /id="reset-points"/);
  assert.match(html, /id="download-reviewed"/);
  assert.match(html, /<caption class="sr-only">تعديل نقاط كل سؤال<\/caption>/);
  assert.match(app, /aiResponse\.addEventListener\('input',[\s\S]*clearPointsDraft\(\)/);
  assert.match(app, /core\.applyQuestionPoints\(questions, pointsDraft\.values\)/);
  assert.match(app, /result\.pointsInitialized[\s\S]*ظهرت نقاط الأسئلة للمراجعة/);
  assert.match(app, /core\.buildNativeFiles\(result\.questions/);
  assert.match(app, /return format === 'native-bank' \|\| format === 'native-test'/);
  assert.match(app, /if \(supportsPoints && parsed.errors.length === 0 && formatValidation.errors.length === 0\)/);
  assert.match(app, /verifyNativeZip\(blob, mode\)/);
  assert.match(app, /setExportControlsDisabled\(true\)/);
  assert.match(app, /label\.htmlFor = `question-points-\$\{index \+ 1\}`/);
  assert.match(app, /textCell\.textContent/);
});

test('HTML ids are unique and every app byId reference resolves', () => {
  const html = read('index.html');
  const app = read('app.js');
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const idSet = new Set(ids);
  const referenced = [...app.matchAll(/byId\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  referenced.forEach((id) => assert.ok(idSet.has(id), `missing #${id}`));
});
