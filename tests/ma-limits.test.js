'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const partialCredit = require('../src/ui/partial-credit.js');

function uiLimits(choiceCount = 4, correctCount = 2) {
  const elements = {
    maChoiceCount: { value: String(choiceCount) },
    maCorrectCount: { value: String(correctCount) },
    maSelectionLimit: { value: '' },
  };
  const controller = partialCredit.create({elements, window: {}}, {});
  return { elements, sync: controller.syncMultipleAnswerLimits };
}

function question(correctCount, partialCredit = false) {
  const profile = core.smartCreditProfile(correctCount);
  return {
    type: 'MA', question: 'اختر الإجابات الصحيحة.', points: 6,
    choices: Array.from({ length: correctCount + 3 }, (_, index) => ({
      text: `الخيار ${index + 1}`, correct: index < correctCount,
      ...(partialCredit ? { percent: index < correctCount ? profile[index].percent : 0 } : {}),
    })),
    ...(partialCredit ? { partialCredit: true } : {}),
  };
}

function parse(questionData) {
  return core.parseAIResponse([
    JSON.stringify({ schema: core.NATIVE_JSONL_SCHEMA, version: core.NATIVE_JSONL_VERSION }),
    JSON.stringify(questionData),
  ].join('\n'));
}

test('student selection field follows correct answers, not total options', () => {
  const { elements, sync } = uiLimits();
  sync();
  assert.equal(elements.maSelectionLimit.value, '2');
  elements.maCorrectCount.value = '3';
  sync();
  assert.equal(elements.maSelectionLimit.value, '3');
  elements.maChoiceCount.value = '8';
  sync();
  assert.equal(elements.maSelectionLimit.value, '3');
  elements.maCorrectCount.value = '1';
  sync();
  assert.equal(elements.maSelectionLimit.value, '1');
});

test('reducing options clamps correct answers and synchronizes the selection field', () => {
  const { elements, sync } = uiLimits(8, 7);
  sync();
  elements.maChoiceCount.value = '3';
  assert.equal(sync(), true);
  assert.equal(elements.maCorrectCount.max, '2');
  assert.equal(elements.maCorrectCount.value, '2');
  assert.equal(elements.maSelectionLimit.value, '2');
  elements.maCorrectCount.value = '20';
  sync();
  assert.equal(elements.maCorrectCount.value, '2');
  assert.equal(elements.maSelectionLimit.value, '2');
  elements.maChoiceCount.value = '2';
  sync();
  assert.equal(elements.maSelectionLimit.value, '1');
});

test('selection field does not retain a stale value while correct count is cleared', () => {
  const { elements, sync } = uiLimits();
  sync();
  elements.maCorrectCount.value = '';
  sync();
  assert.equal(elements.maSelectionLimit.value, '');
  elements.maCorrectCount.value = '0';
  sync();
  assert.equal(elements.maCorrectCount.value, '1');
  assert.equal(elements.maSelectionLimit.value, '1');
});

test('prompt defaults and exact structures derive the selection limit from correct count', () => {
  assert.equal(core.DEFAULT_QUESTION_SETTINGS.multipleAnswer.selectionLimit, 2);
  for (const correctCount of [1, 2, 3, 7]) {
    const questionSettings = { multipleAnswer: { choiceCount: correctCount + 3, correctCount } };
    const settings = core.normalizePromptQuestionSettings(questionSettings);
    assert.equal(settings.multipleAnswer.selectionLimit, correctCount);
    const config = {
      hasAttachment: false, sourceContent: 'مادة دراسية', counts: { MA: 1 },
      difficulty: { mode: 'single', level: 3 }, questionSettings,
    };
    assert.deepEqual(core.validatePromptConfig(config).errors, []);
    assert.ok(core.buildPrompt(config).includes(`"choices":${correctCount + 3},"correct":${correctCount},"selectionLimit":${correctCount}`));
    assert.deepEqual(core.validateQuestionStructures([question(correctCount)], questionSettings), []);
    for (const limit of [correctCount - 1, correctCount + 1]) {
      const invalid = { ...config, questionSettings: { multipleAnswer: { ...questionSettings.multipleAnswer, selectionLimit: limit } } };
      assert.ok(core.validatePromptConfig(invalid).errors.some((error) => error.includes('حد اختيار الطالب')));
    }
  }
});

test('MA parser derives absent limits and rejects explicit limits above or below correct count', () => {
  for (const correctCount of [1, 2, 3]) {
    for (const partialCredit of [false, true]) {
      const data = question(correctCount, partialCredit);
      for (const input of [data, { ...data, selectionLimit: correctCount }]) {
        const parsed = parse(input);
        assert.deepEqual(parsed.errors, []);
        assert.equal(parsed.questions[0].selectionLimit, correctCount);
      }
      for (const selectionLimit of [0, correctCount - 1, correctCount + 1, data.choices.length - 1, 1.5]) {
        const invalid = { ...data, selectionLimit };
        assert.ok(parse(invalid).errors.some((error) => error.code === 'ma_selection_limit'));
        assert.ok(core.validateStructuredQuestion(invalid).some((error) => error.includes('حد اختيارات MA')));
        assert.throws(() => core.buildNativeFiles([invalid], { mode: 'pool' }), core.ValidationError);
        assert.throws(() => core.buildNativeFiles([invalid], { mode: 'test' }), core.ValidationError);
      }
    }
  }
});

test('native bank and weighted test export limits equal the actual correct count', () => {
  for (const correctCount of [1, 2, 3]) {
    for (const partialCredit of [false, true]) {
      for (const explicitLimit of [false, true]) {
        const data = question(correctCount, partialCredit);
        if (explicitLimit) data.selectionLimit = correctCount;
        for (const mode of ['pool', 'test']) {
          const output = core.buildNativeFiles([data], { mode, idSeed: 927 });
          const assessmentPath = mode === 'pool' ? 'res00002.dat' : 'res00015.dat';
          const xml = output.files[assessmentPath];
          if (mode === 'pool' || partialCredit) {
            const field = `answer_selection_limit" action="Set">${correctCount}</setvar>`;
            assert.ok(xml.includes(field));
            for (const wrongLimit of [correctCount - 1, correctCount + 1, data.choices.length - 1]) {
              const changed = { ...output.files, [assessmentPath]: xml.replace(field, `answer_selection_limit" action="Set">${wrongLimit}</setvar>`) };
              assert.throws(() => core.validateNativeFiles(changed, { mode }), core.ValidationError);
            }
          } else {
            // The unweighted direct-test reference must not gain pool-only fields.
            assert.doesNotMatch(xml, /answer_selection_limit/);
          }
          assert.equal(core.validateNativeFiles(output.files, { mode }).totalPoints, 6);
        }
      }
    }
  }
});

test('QTI internal exporter derives maxChoices from correct answers with multiple distractors', () => {
  for (const correctCount of [1, 2, 3]) {
    const data = question(correctCount);
    for (const input of [data, { ...data, selectionLimit: correctCount }]) {
      const xml = core.buildQtiItem(input, 1).xml;
      assert.ok(xml.includes(`maxChoices="${correctCount}"`));
      assert.equal((xml.match(/<value>CHOICE_/g) || []).length, correctCount);
    }
  }
});
