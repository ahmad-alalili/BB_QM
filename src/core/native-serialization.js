/* Blackboard Native question XML, scoring rules, manifests, and course records. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./arithmetic.js'), require('./question-validation.js'))
    : factory(modules['shared'], modules['arithmetic'], modules['question-validation']);
  if (node) module.exports = api;
  if (root) modules['native-serialization'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, arithmetic, questionValidation) {
  'use strict';

  const { NATIVE_TEST_TEMPLATE, ValidationError, decimalText, escapeHtmlText, escapeXml, pointsText, questionPoints, totalQuestionPoints } = shared;
  const { parseArithmeticFormula } = arithmetic;
  const { validateStructuredQuestion } = questionValidation;

  function nativeHtmlMaterial(html) {
    return `<material><mat_extension><mat_formattedtext type="HTML">${escapeXml(html)}</mat_formattedtext></mat_extension></material>`;
  }

  function nativeTextFlow(text, flowClass) {
    return `<flow class="${flowClass || 'FORMATTED_TEXT_BLOCK'}">${nativeHtmlMaterial(`<p>${escapeHtmlText(text)}</p>`)}</flow>`;
  }

  function nativeEmptyFeedback(identifier) {
    return `<itemfeedback ident="${identifier}" view="All"><flow_mat class="Block"><flow_mat class="FORMATTED_TEXT_BLOCK"><material><mat_extension><mat_formattedtext type="HTML"/></mat_extension></material></flow_mat></flow_mat></itemfeedback>`;
  }

  function nativeIncorrectCondition() {
    return '<respcondition title="incorrect"><conditionvar><other/></conditionvar><setvar variablename="SCORE" action="Set">0</setvar><displayfeedback linkrefid="incorrect" feedbacktype="Response"/></respcondition>';
  }

  function nativeCorrectCondition(condition) {
    return `<respcondition title="correct"><conditionvar>${condition || ''}</conditionvar><setvar variablename="SCORE" action="Set">SCORE.max</setvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>`;
  }

  function secureNativeSeed() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const values = new Uint32Array(1);
      globalThis.crypto.getRandomValues(values);
      return values[0];
    }
    if (typeof require === 'function') {
      try {
        const bytes = require('node:crypto').randomBytes(4);
        return bytes.readUInt32BE(0);
      } catch (_error) {
        // The explicit error below is safer than weak identifier randomness.
      }
    }
    throw new ValidationError('تعذر إنشاء معرّفات آمنة للحزمة في هذا المتصفح.');
  }

  function createNativeIdAllocator(seed) {
    const numericSeed = seed == null ? secureNativeSeed() : Number(seed);
    if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 0xFFFFFFFF) throw new ValidationError('بذرة معرّفات الحزمة غير صالحة.');
    let counter = 0;
    const base = 10000000 + (numericSeed % 2000000000);
    return function nextNativeId() {
      counter += 1;
      return `_${base + counter}_1`;
    };
  }

  function createNativeResponseIdAllocator(seed) {
    if (seed == null) {
      return function nextRandomNativeResponseId() {
        let bytes;
        if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
          bytes = new Uint8Array(16);
          globalThis.crypto.getRandomValues(bytes);
        } else if (typeof require === 'function') {
          try {
            bytes = require('node:crypto').randomBytes(16);
          } catch (_error) {
            throw new ValidationError('تعذر إنشاء معرّفات استجابة آمنة للحزمة.');
          }
        } else {
          throw new ValidationError('تعذر إنشاء معرّفات استجابة آمنة للحزمة.');
        }
        bytes[6] = (bytes[6] & 0x0F) | 0x40;
        bytes[8] = (bytes[8] & 0x3F) | 0x80;
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      };
    }
    const numericSeed = Number(seed);
    if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 0xFFFFFFFF) throw new ValidationError('بذرة معرّفات الاستجابة غير صالحة.');
    let counter = 0;
    const hex32 = (value) => (value >>> 0).toString(16).padStart(8, '0');
    const mix = (value) => {
      let mixed = value >>> 0;
      mixed ^= mixed >>> 16;
      mixed = Math.imul(mixed, 0x7FEB352D);
      mixed ^= mixed >>> 15;
      mixed = Math.imul(mixed, 0x846CA68B);
      mixed ^= mixed >>> 16;
      return mixed >>> 0;
    };
    return function nextNativeResponseId() {
      counter += 1;
      const first = mix((numericSeed ^ Math.imul(counter, 0x9E3779B1)) >>> 0);
      const second = mix((numericSeed + Math.imul(counter, 0x85EBCA6B)) >>> 0);
      const third = mix((numericSeed ^ counter ^ 0xC2B2AE35) >>> 0);
      const raw = `${hex32(first)}${hex32(second)}${hex32(third)}${hex32(counter)}`;
      const variant = ['8', '9', 'a', 'b'][counter % 4];
      return `${raw.slice(0, 12)}4${raw.slice(13, 16)}${variant}${raw.slice(17)}`;
    };
  }

  function nativeVisibleResponseId(nextResponseId) {
    const raw = nextResponseId();
    return `new_${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }

  function nativePartialCredit(kind, assessmentType, questionType, question) {
    if (kind !== 'item') return '';
    if (questionType === 'Multiple Answer' && question && question.partialCredit === true) return 'true';
    if (questionType === 'Matching') return 'true';
    if (questionType === 'Calculated' || questionType === 'Jumbled Sentence') return 'false';
    return '';
  }

  function nativeMetadata(kind, assessmentType, objectId, points, questionType, question) {
    const partialCredit = nativePartialCredit(kind, assessmentType, questionType, question);
    const weightedMultipleAnswer = kind === 'item' && questionType === 'Multiple Answer' && question && question.partialCredit === true;
    const negativePoints = questionType === 'Matching' || weightedMultipleAnswer ? 'Q' : 'N';
    return `<${kind}metadata><bbmd_asi_object_id>${objectId}</bbmd_asi_object_id><bbmd_asitype>${kind === 'item' ? 'Item' : (kind === 'section' ? 'Section' : 'Assessment')}</bbmd_asitype><bbmd_assessmenttype>${assessmentType}</bbmd_assessmenttype><bbmd_sectiontype>Subsection</bbmd_sectiontype><bbmd_questiontype>${questionType || 'Multiple Choice'}</bbmd_questiontype><bbmd_is_from_cartridge>false</bbmd_is_from_cartridge><bbmd_is_disabled>false</bbmd_is_disabled><bbmd_negative_points_ind>${negativePoints}</bbmd_negative_points_ind><bbmd_canvas_fullcrdt_ind>false</bbmd_canvas_fullcrdt_ind><bbmd_all_fullcredit_ind>false</bbmd_all_fullcredit_ind><bbmd_numbertype>${questionType === 'Matching' ? 'letter_upper' : 'none'}</bbmd_numbertype><bbmd_partialcredit>${partialCredit}</bbmd_partialcredit><bbmd_orientationtype>vertical</bbmd_orientationtype><bbmd_is_extracredit>false</bbmd_is_extracredit><bbmd_is_metadataenabled>${kind === 'item' ? '' : 'false'}</bbmd_is_metadataenabled><bbmd_ai_state>No</bbmd_ai_state><qmd_absolutescore_max>${pointsText(points, 15)}</qmd_absolutescore_max><qmd_weighting>0</qmd_weighting><qmd_instructornotes/></${kind}metadata>`;
  }

  function nativeOutcomes(points) {
    return `<outcomes><decvar varname="SCORE" vartype="Decimal" defaultval="0" minvalue="0" maxvalue="${pointsText(points, 5)}"/></outcomes>`;
  }

  function nativeQuestionHtml(question) {
    return `<p>${escapeHtmlText(question.question)}</p>`;
  }

  function replaceFibMarker(question) {
    const marker = '<a data-bbtype="customClass" data-bbfile="{&quot;className&quot;:&quot;fimb-answer-value&quot;}">[BLANK-1]</a>';
    if (question.includes('____')) {
      const [before, after] = question.split('____');
      return `<p>${escapeHtmlText(before)}${marker}${escapeHtmlText(after)}</p>`;
    }
    return `<p>${escapeHtmlText(question)} ${marker}</p>`;
  }

  function replaceJumbledMarkers(question, slots) {
    const byId = new Map(slots.map((slot, index) => [slot.id, index + 1]));
    let html = '<p>';
    let position = 0;
    const pattern = /\[\[([A-Za-z][A-Za-z0-9_]{0,31})\]\]/g;
    let match;
    while ((match = pattern.exec(question)) !== null) {
      html += escapeHtmlText(question.slice(position, match.index));
      const slotIndex = byId.get(match[1]);
      html += `<a data-bbtype="customClass" data-bbfile="{&quot;className&quot;:&quot;blank-answer-value&quot;}">[BLANK-${slotIndex}]</a>`;
      position = match.index + match[0].length;
    }
    html += `${escapeHtmlText(question.slice(position))}</p>`;
    return html;
  }

  const NATIVE_QUESTION_TYPES = Object.freeze({
    MC: 'Multiple Choice',
    TF: 'Either/Or',
    ESS: 'Short Response',
    FIB: 'Fill in the Blank Plus',
    NUM: 'Numeric',
    MAT: 'Matching',
    MA: 'Multiple Answer',
    EO: 'Either/Or',
    JUM: 'Jumbled Sentence',
    CALC: 'Calculated',
  });

  const EITHER_OR_PAIRS = Object.freeze({
    true_false: Object.freeze(['true_false.true', 'true_false.false']),
    yes_no: Object.freeze(['yes_no.yes', 'yes_no.no']),
    correct_incorrect: Object.freeze(['correct_incorrect.correct', 'correct_incorrect.incorrect']),
    agree_disagree: Object.freeze(['agree_disagree.agree', 'agree_disagree.disagree']),
  });

  const NATIVE_RAW_RESPONSE_ID_PATTERN = /^[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/;

  const NATIVE_VISIBLE_RESPONSE_ID_PATTERN = /^new_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

  function nativeChoiceFeedback(identifier) {
    return `<itemfeedback ident="${identifier}" view="All"><solution view="All" feedbackstyle="Complete"><solutionmaterial><flow_mat class="Block"/></solutionmaterial></solution></itemfeedback>`;
  }

  function buildNativePoolChoiceResponse(question, multiple, shuffleAnswers, nextResponseId) {
    const labels = question.choices.map((choice) => ({ ...choice, scoringId: nextResponseId(), displayId: nativeVisibleResponseId(nextResponseId) }));
    const response = `<response_lid ident="response" rcardinality="Multiple" rtiming="No"><render_choice shuffle="${shuffleAnswers ? 'Yes' : 'No'}" minnumber="0" maxnumber="0">${labels.map((choice) => `<flow_label class="Block"><response_label ident="${choice.displayId}" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="FORMATTED_TEXT_BLOCK">${nativeHtmlMaterial(`<p>${escapeHtmlText(choice.text)}</p>`)}</flow_mat></response_label></flow_label>`).join('')}</render_choice></response_lid>`;
    const clauses = labels.map((choice) => choice.correct ? `<varequal respident="استجابة" case="No">${choice.scoringId}</varequal>` : `<not><varequal respident="استجابة" case="No">${choice.scoringId}</varequal></not>`).join('');
    const limit = multiple ? (question.selectionLimit == null ? labels.filter((choice) => choice.correct).length : question.selectionLimit) : 1;
    const single = labels.filter((choice) => choice.correct).length === 1;
    const zeroConditions = labels.map((choice) => `<respcondition><conditionvar><varequal respident="${choice.scoringId}" case="No"/></conditionvar><setvar variablename="SCORE" action="Set">0</setvar></respcondition>`).join('');
    const conditions = `<respcondition title="correct"><conditionvar><and>${clauses}</and></conditionvar><setvar variablename="SCORE" action="Set">SCORE.max</setvar><setvar variablename="single_correct_answer" action="Set">${single}</setvar><setvar variablename="answer_selection_limit" action="Set">${limit}</setvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>${nativeIncorrectCondition()}${zeroConditions}`;
    return { response, conditions, additionalFeedback: labels.map((choice) => nativeChoiceFeedback(choice.scoringId) + nativeChoiceFeedback(choice.displayId)).join('') };
  }

  function buildNativeTestChoiceResponse(question, shuffleAnswers, nextResponseId) {
    const labels = question.choices.map((choice) => ({ ...choice, id: nextResponseId() }));
    const choicesXml = labels.map((choice) => `<flow_label class="Block"><response_label ident="${choice.id}" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="FORMATTED_TEXT_BLOCK">${nativeHtmlMaterial(`<p>${escapeHtmlText(choice.text)}</p>`)}</flow_mat></response_label></flow_label>`).join('');
    const response = `<response_lid ident="response" rcardinality="Multiple" rtiming="No"><render_choice shuffle="${shuffleAnswers ? 'Yes' : 'No'}" minnumber="0" maxnumber="0">${choicesXml}</render_choice></response_lid>`;
    const clauses = labels.map((choice) => choice.correct
      ? `<varequal respident="استجابة" case="No">${choice.id}</varequal>`
      : `<not><varequal respident="استجابة" case="No">${choice.id}</varequal></not>`).join('');
    const correctCount = labels.filter((choice) => choice.correct).length;
    const singleCorrect = correctCount === 1 ? '<setvar variablename="single_correct_answer" action="Set">true</setvar>' : '';
    const zeroConditions = labels.map((choice) => `<respcondition><conditionvar><varequal respident="${choice.id}" case="No"/></conditionvar><setvar variablename="SCORE" action="Set">0</setvar></respcondition>`).join('');
    const feedback = labels.map((choice) => nativeChoiceFeedback(choice.id)).join('');
    const conditions = `<respcondition title="correct"><conditionvar><and>${clauses}</and></conditionvar><setvar variablename="SCORE" action="Set">SCORE.max</setvar>${singleCorrect}<displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>${nativeIncorrectCondition()}${zeroConditions}`;
    return { response, conditions, additionalFeedback: feedback };
  }

  function buildNativeWeightedChoiceResponse(question, shuffleAnswers, nextResponseId, mode) {
    const labels = question.choices.map((choice) => {
      const scoringId = nextResponseId();
      return {
        ...choice,
        scoringId,
        displayId: mode === 'test' ? nativeVisibleResponseId(nextResponseId) : scoringId,
      };
    });
    const choicesXml = labels.map((choice) => `<flow_label class="Block"><response_label ident="${choice.displayId}" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="FORMATTED_TEXT_BLOCK">${nativeHtmlMaterial(`<p>${escapeHtmlText(choice.text)}</p>`)}</flow_mat></response_label></flow_label>`).join('');
    const response = `<response_lid ident="response" rcardinality="Multiple" rtiming="No"><render_choice shuffle="${shuffleAnswers ? 'Yes' : 'No'}" minnumber="0" maxnumber="0">${choicesXml}</render_choice></response_lid>`;
    const responseIdentifier = mode === 'test' ? 'استجابة' : 'response';
    const clauses = labels.map((choice) => choice.correct
      ? `<varequal respident="${responseIdentifier}" case="No">${choice.scoringId}</varequal>`
      : `<not><varequal respident="${responseIdentifier}" case="No">${choice.scoringId}</varequal></not>`).join('');
    const correctCount = labels.filter((choice) => choice.correct).length;
    const singleCorrect = `<setvar variablename="single_correct_answer" action="Set">${correctCount === 1 ? 'true' : 'false'}</setvar>`;
    const selectionLimit = question.selectionLimit == null ? correctCount : question.selectionLimit;
    const percentageConditions = labels.map((choice) => `<respcondition><conditionvar><varequal respident="${choice.scoringId}" case="No"/></conditionvar><setvar variablename="SCORE" action="Set">${decimalText(choice.percent, 5)}</setvar></respcondition>`).join('');
    const conditions = `<respcondition title="correct"><conditionvar><and>${clauses}</and></conditionvar><setvar variablename="SCORE" action="Set">SCORE.max</setvar>${singleCorrect}<setvar variablename="answer_selection_limit" action="Set">${selectionLimit}</setvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>${nativeIncorrectCondition()}${percentageConditions}`;
    const feedbackIds = [...labels.map((choice) => choice.scoringId), ...labels.map((choice) => choice.displayId)];
    const feedback = [...new Set(feedbackIds)].map(nativeChoiceFeedback).join('');
    return { response, conditions, additionalFeedback: feedback };
  }

  function buildNativeChoiceResponse(question, multiple, shuffleAnswers, nextResponseId, mode) {
    if (question.type === 'MA' && question.partialCredit === true) {
      return buildNativeWeightedChoiceResponse(question, shuffleAnswers, nextResponseId, mode);
    }
    return mode === 'test'
      ? buildNativeTestChoiceResponse(question, shuffleAnswers, nextResponseId)
      : buildNativePoolChoiceResponse(question, multiple, shuffleAnswers, nextResponseId);
  }

  function buildNativeEitherOrResponse(question, mode) {
    const pair = question.type === 'TF' ? 'true_false' : question.pair;
    const answer = question.type === 'TF' ? (question.answer ? 'first' : 'second') : question.answer;
    const identifiers = EITHER_OR_PAIRS[pair];
    const labels = identifiers.map((identifier) => `<response_label ident="${identifier}" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="Block"><material><mattext charset="us-ascii" texttype="text/plain" xml:space="default">${identifier}</mattext></material></flow_mat></response_label>`).join('');
    const response = `<response_lid ident="response" rcardinality="Single" rtiming="No"><render_choice shuffle="No" minnumber="0" maxnumber="0"><flow_label class="Block">${labels}</flow_label></render_choice></response_lid>`;
    const correctId = identifiers[answer === 'first' ? 0 : 1];
    const responseIdentifier = mode === 'test' ? 'استجابة' : 'response';
    return { response, conditions: `${nativeCorrectCondition(`<varequal respident="${responseIdentifier}" case="No">${correctId}</varequal>`)}${nativeIncorrectCondition()}` };
  }

  function nativeMatchingPercentages(count, mode) {
    if (mode === 'test') return Array(count).fill(Number(decimalText(100 / count, 8)));
    const cents = Math.floor(10000 / count);
    return Array.from({ length: count }, (_, index) => (index === count - 1 ? 10000 - cents * (count - 1) : cents) / 100);
  }

  function buildNativeMatchingResponse(question, nextResponseId, mode) {
    const responseIds = question.pairs.map(() => nativeVisibleResponseId(nextResponseId));
    const answerOptions = [...question.pairs.map((pair) => pair.match), ...(question.distractors || [])];
    const labelIds = question.pairs.map(() => answerOptions.map(() => nextResponseId()));
    const scoringResponseIds = question.pairs.map(() => nextResponseId());
    const responseFlows = question.pairs.map((pair, index) => {
      const labels = labelIds[index].map((identifier) => `<response_label ident="${identifier}" shuffle="Yes" rarea="Ellipse" rrange="Exact"/>`).join('');
      return `<flow class="Block"><response_lid ident="${responseIds[index]}" rcardinality="Single" rtiming="No"><render_choice shuffle="Yes" minnumber="0" maxnumber="0"><flow_label class="Block">${labels}</flow_label></render_choice></response_lid>${nativeTextFlow(pair.prompt)}</flow>`;
    }).join('');
    const rightBlock = `<flow class="RIGHT_MATCH_BLOCK">${answerOptions.map((answer) => `<flow class="Block">${nativeTextFlow(answer)}</flow>`).join('')}</flow>`;
    const percentages = nativeMatchingPercentages(question.pairs.length, mode);
    const conditions = question.pairs.map((_, index) => `<respcondition><conditionvar><varequal respident="${scoringResponseIds[index]}" case="No">${labelIds[index][index]}</varequal></conditionvar><setvar variablename="PartialCreditPercent" action="Set">${percentages[index]}</setvar><setvar variablename="NegativeCreditPercent" action="Set">0</setvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>`).join('');
    return { response: responseFlows, afterResponse: rightBlock, conditions: `${conditions}${nativeIncorrectCondition()}` };
  }

  function buildNativeJumbledResponse(question) {
    const responses = question.slots.map((slot, slotIndex) => {
      const distractors = slot.distractors.map((value) => `<response_label ident="Distractor" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="Block"><material><mattext charset="us-ascii" texttype="text/plain" xml:space="default">${escapeXml(value)}</mattext></material></flow_mat></response_label>`).join('');
      const answer = `<response_label ident="BLANK-${slotIndex + 1}" shuffle="Yes" rarea="Ellipse" rrange="Exact"><flow_mat class="Block"><material><mattext charset="us-ascii" texttype="text/plain" xml:space="default">${escapeXml(slot.answer)}</mattext></material></flow_mat></response_label>`;
      const labels = `${distractors}${answer}`;
      return `<response_lid ident="BLANK-${slotIndex + 1}" rcardinality="Single" rtiming="No"><render_choice shuffle="Yes" minnumber="0" maxnumber="0"><flow_label class="Block">${labels}</flow_label></render_choice></response_lid>`;
    }).join('');
    const correct = question.slots.map((slot, index) => `<varequal respident="BLANK-${index + 1}" case="No">${escapeXml(slot.answer)}</varequal>`).join('');
    return { response: responses, conditions: `${nativeCorrectCondition(`<and>${correct}</and>`)}${nativeIncorrectCondition()}` };
  }

  function buildNativeItem(question, index, settings) {
    const structuredErrors = validateStructuredQuestion(question);
    if (structuredErrors.length) throw new ValidationError(structuredErrors.map((message) => `السؤال ${index}: ${message}`));
    const points = questionPoints(question);
    // Ultra uses Multiple Answer plus single_correct_answer=true for MC too.
    // The legacy Multiple Choice/Single pool encoding imported as blank rows.
    // Pool and course-test response bindings remain independently serialized.
    const questionType = question.type === 'MC'
      ? NATIVE_QUESTION_TYPES.MA
      : NATIVE_QUESTION_TYPES[question.type];
    const metadata = nativeMetadata('item', settings.assessmentType, settings.nextId(), points, questionType, question);
    let questionHtml = nativeQuestionHtml(question);
    let response = '';
    let afterResponse = '';
    let conditions = '';
    let extension = '';
    let additionalFeedback = '';

    if (question.type === 'MC' || question.type === 'MA') {
      const multiple = question.type === 'MA' || settings.mode === 'test';
      ({ response, conditions, additionalFeedback } = buildNativeChoiceResponse(question, multiple, settings.shuffleAnswers, settings.nextResponseId, settings.mode));
    } else if (question.type === 'TF' || question.type === 'EO') {
      ({ response, conditions } = buildNativeEitherOrResponse(question, settings.mode));
    } else if (question.type === 'ESS') {
      response = `<response_str ident="response" rcardinality="Single" rtiming="No"><render_fib charset="us-ascii" encoding="UTF_8" rows="${question.rows || 3}" columns="127" maxchars="0" prompt="Box" fibtype="String" minnumber="0" maxnumber="0"/></response_str>`;
      conditions = `${nativeCorrectCondition('')}${nativeIncorrectCondition()}`;
      const solution = question.exampleAnswer ? nativeHtmlMaterial(`<p>${escapeHtmlText(question.exampleAnswer)}</p>`) : '<material><mat_extension><mat_formattedtext type="HTML"/></mat_extension></material>';
      additionalFeedback = `<itemfeedback ident="solution" view="All"><solution view="All" feedbackstyle="Complete"><solutionmaterial><flow_mat class="Block">${solution}</flow_mat></solutionmaterial></solution></itemfeedback>`;
    } else if (question.type === 'FIB') {
      questionHtml = replaceFibMarker(question.question);
      response = '<response_str ident="BLANK-1" rcardinality="Single" rtiming="No"><render_fib charset="us-ascii" encoding="UTF_8" rows="0" columns="0" maxchars="0" prompt="Box" fibtype="String" minnumber="0" maxnumber="0"/></response_str>';
      const answers = escapeXml(question.answers.join('؛'));
      conditions = `<respcondition title="correct"><conditionvar><and><or><varsubset respident="BLANK-1" case="No" setmatch="Contains">${answers}</varsubset></or></and></conditionvar><setvar variablename="SCORE" action="Set">SCORE.max</setvar><setvar variablename="points_set_on_answers" action="Set">false</setvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>${nativeIncorrectCondition()}`;
    } else if (question.type === 'NUM') {
      response = '<response_num ident="response" rcardinality="Single" rtiming="No"><render_fib charset="us-ascii" encoding="UTF_8" rows="0" columns="0" maxchars="0" prompt="Box" fibtype="Decimal" minnumber="0" maxnumber="0"/></response_num>';
      const low = decimalText(question.answer - question.tolerance, 12);
      const high = decimalText(question.answer + question.tolerance, 12);
      conditions = `<respcondition title="${settings.nextResponseId()}"><conditionvar><vargte respident="response">${low}</vargte><varlte respident="response">${high}</varlte><varequal respident="response" case="No">${decimalText(question.answer, 12)}</varequal></conditionvar><displayfeedback linkrefid="correct" feedbacktype="Response"/></respcondition>${nativeIncorrectCondition()}`;
    } else if (question.type === 'MAT') {
      ({ response, afterResponse, conditions } = buildNativeMatchingResponse(question, settings.nextResponseId, settings.mode));
    } else if (question.type === 'JUM') {
      questionHtml = replaceJumbledMarkers(question.question, question.slots);
      ({ response, conditions } = buildNativeJumbledResponse(question));
    } else {
      const parsedFormula = parseArithmeticFormula(question.formula);
      response = '<response_str ident="response" rcardinality="Single" rtiming="No"><render_fib charset="us-ascii" encoding="UTF_8" rows="0" columns="0" maxchars="0" prompt="Box" fibtype="String" minnumber="0" maxnumber="0"/></response_str>';
      conditions = `${nativeCorrectCondition('')}${nativeIncorrectCondition()}`;
      extension = `<itemproc_extension><calculated><formula>${escapeXml(parsedFormula.mathml)}</formula><answer_scale>${question.decimals}</answer_scale><answer_format>Normal</answer_format><precision>Decimal</precision><answer_tolerance type="numeric">${decimalText(question.tolerance, 12)}</answer_tolerance><unit_value></unit_value><unit_points_percent>0</unit_points_percent><unit_required>false</unit_required><unit_case_sensitive>false</unit_case_sensitive><display_formula_to_student>false</display_formula_to_student><display_rounding_settings_to_student>true</display_rounding_settings_to_student><partial_credit_points_percent>0</partial_credit_points_percent><partial_credit_tolerance type="numeric">0</partial_credit_tolerance><vars/><var_sets><var_set ident="ident-0"><answer>${Number(question.answer).toFixed(question.decimals)}</answer></var_set></var_sets></calculated></itemproc_extension>`;
    }

    const presentation = `<presentation><flow class="Block"><flow class="QUESTION_BLOCK"><flow class="FORMATTED_TEXT_BLOCK">${nativeHtmlMaterial(questionHtml)}</flow></flow><flow class="RESPONSE_BLOCK">${response}</flow>${afterResponse}</flow></presentation>`;
    const resprocessing = `<resprocessing scoremodel="SumOfScores">${nativeOutcomes(points)}${conditions}</resprocessing>`;
    const itemAttributes = 'maxattempts="0"';
    return `<item ${itemAttributes}>${metadata}${presentation}${resprocessing}${nativeEmptyFeedback('correct')}${nativeEmptyFeedback('incorrect')}${additionalFeedback}${extension}</item>`;
  }

  function buildNativeAssessment(questions, settings) {
    const totalPoints = totalQuestionPoints(questions);
    const assessmentMetadata = nativeMetadata('assessment', settings.assessmentType, settings.assessmentObjectId || settings.nextId(), totalPoints, 'Multiple Choice');
    const sectionMetadata = nativeMetadata('section', settings.assessmentType, settings.sectionObjectId || settings.nextId(), totalPoints, 'Multiple Choice');
    const items = questions.map((question, index) => buildNativeItem(question, index + 1, settings)).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<questestinterop><assessment title="${escapeXml(settings.title)}">${assessmentMetadata}<rubric view="All"><flow_mat class="Block"><material><mat_extension><mat_formattedtext type="HTML"/></mat_extension></material></flow_mat></rubric><presentation_material><flow_mat class="Block"><material><mat_extension><mat_formattedtext type="HTML"/></mat_extension></material></flow_mat></presentation_material><section>${sectionMetadata}${items}</section></assessment></questestinterop>`;
  }

  function buildNativeManifest(mode, title) {
    const safeTitle = escapeXml(title);
    if (mode === 'pool') {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<manifest xmlns:bb="http://www.blackboard.com/content-packaging/" identifier="man00001"><organizations/><resources><resource bb:file="res00001.dat" bb:title="إعدادات بنك الأسئلة" identifier="res00001" type="course/x-bb-coursesetting" xml:base="res00001"/><resource bb:file="res00002.dat" bb:title="${safeTitle}" identifier="res00002" type="assessment/x-bb-qti-pool" xml:base="res00002"/><resource bb:file="res00003.dat" bb:title="CSResourceLinks" identifier="res00003" type="course/x-bb-csresourcelinks" xml:base="res00003"/></resources></manifest>`;
    }
    const reference = NATIVE_TEST_TEMPLATE.resources;
    const organization = `<organizations default="toc00001"><organization identifier="toc00001"><item identifier="itm00001" identifierref="${reference.tocRoot}"><title>ROOT</title><item identifier="itm00004" identifierref="${reference.rootContent}"><title>--TOP--</title><item identifier="itm00005" identifierref="${reference.testContent}"><title>${safeTitle}</title></item></item></item><item identifier="itm00002" identifierref="${reference.tocInteractive}"><title>INTERACTIVE</title><item identifier="itm00006" identifierref="${reference.interactiveContent}"><title>--TOP--</title></item></item><item identifier="itm00003" identifierref="${reference.tocIndirect}"><title>INDIRECT</title><item identifier="itm00007" identifierref="${reference.indirectContent}"><title>--TOP--</title></item></item></organization></organizations>`;
    const resources = [
      [reference.tocRoot, 'ROOT', 'course/x-bb-coursetoc'],
      [reference.tocInteractive, 'INTERACTIVE', 'course/x-bb-coursetoc'],
      [reference.tocIndirect, 'INDIRECT', 'course/x-bb-coursetoc'],
      [reference.assessment, safeTitle, 'assessment/x-bb-qti-test'],
      [reference.creationSettings, 'Assessment Creation Settings', 'course/x-bb-courseassessmentcreationsettings'],
      [reference.rootContent, '--TOP--', 'resource/x-bb-document'],
      [reference.testContent, safeTitle, 'resource/x-bb-document'],
      [reference.interactiveContent, '--TOP--', 'resource/x-bb-document'],
      [reference.indirectContent, '--TOP--', 'resource/x-bb-document'],
      [reference.gradebook, 'Gradebook', 'course/x-bb-gradebook'],
      [reference.courseAssessment, 'Course Assessment', 'course/x-bb-courseassessment'],
      [reference.link, safeTitle, 'resource/x-bb-link'],
    ].map(([identifier, resourceTitle, type]) => `<resource bb:file="${identifier}.dat" bb:title="${resourceTitle}" identifier="${identifier}" type="${type}" xml:base="${identifier}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<manifest identifier="man00001" xmlns:bb="http://www.blackboard.com/content-packaging/">${organization}<resources>${resources}</resources></manifest>`;
  }

  function buildNativePackageInfo(packageIdentifier) {
    return `#Bb PackageInfo Property File\ncx.config.course.id=IMPORT\ncx.config.file.references=false\ncx.config.operation=blackboard.apps.cx.CxConfig$Operation\\:EXPORT\ncx.config.package.identifier=${packageIdentifier}\ncx.package.info.version=6.0\n`;
  }

  function nativeTimestamp(value) {
    const date = value == null ? new Date() : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new ValidationError('تاريخ إنشاء حزمة المقرر غير صالح.');
    const iso = date.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
  }

  function buildNativeCreationSettings(settingId, assessmentObjectId) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<ASSESSMENTCREATIONSETTINGS><ASSESSMENTCREATIONSETTING id="${settingId}"><QTIASSESSMENTID value="${assessmentObjectId}"/><ANSWERFEEDBACKENABLED>false</ANSWERFEEDBACKENABLED><QUESTIONATTACHMENTSENABLED>false</QUESTIONATTACHMENTSENABLED><ANSWERATTACHMENTSENABLED>false</ANSWERATTACHMENTSENABLED><QUESTIONMETADATAENABLED>true</QUESTIONMETADATAENABLED><DEFAULTPOINTVALUEENABLED>true</DEFAULTPOINTVALUEENABLED><DEFAULTPOINTVALUE>10.00000</DEFAULTPOINTVALUE><ANSWERPARTIALCREDITENABLED>true</ANSWERPARTIALCREDITENABLED><ANSWERNEGATIVEPOINTSENABLED>true</ANSWERNEGATIVEPOINTSENABLED><ANSWERRANDOMORDERENABLED>true</ANSWERRANDOMORDERENABLED><ANSWERORIENTATIONENABLED>true</ANSWERORIENTATIONENABLED><ANSWERNUMBEROPTIONSENABLED>true</ANSWERNUMBEROPTIONSENABLED><USEPOINTSFROMSOURCEBYDEFAULT>true</USEPOINTSFROMSOURCEBYDEFAULT></ASSESSMENTCREATIONSETTING></ASSESSMENTCREATIONSETTINGS>`;
  }

  function buildNativeCourseToc(objectId, label, entryPoint) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<COURSETOC id="${objectId}"><LABEL value="${label}"/><URL value=""/><TARGETTYPE value="CONTENT"/><INTERNALHANDLE value=""/><FLAGS><LAUNCHINNEWWINDOW value="true"/><ISENABLED value="true"/><ISENTYRPOINT value="${entryPoint ? 'true' : 'false'}"/><ALLOWOBSERVERS value="true"/><ALLOWGUESTS value="false"/></FLAGS></COURSETOC>`;
  }

  function buildNativeTopContent(objectId, timestamp) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CONTENT id="${objectId}"><TITLE value="--TOP--"/><TITLECOLOR value="#000000"/><DESCRIPTION value=""/><BODY><TEXT/><TYPE value="S"/></BODY><DATES><CREATED value="${timestamp}"/><UPDATED value="${timestamp}"/><START value=""/><END value=""/></DATES><FLAGS><ISAVAILABLE value="true"/><ISFROMCARTRIDGE value="false"/><ISFOLDER value="true"/><ISDESCRIBED value="false"/><ISTRACKED value="true"/><ISLESSON value="false"/><ISSEQUENTIAL value="false"/><ALLOWGUESTS value="true"/><ALLOWOBSERVERS value="true"/><LAUNCHINNEWWINDOW value="false"/><ISREVIEWABLE value="false"/><ISGROUPCONTENT value="false"/><ISSAMPLECONTENT value="false"/><PARTIALLYVISIBLE value="false"/><HASTHUMBNAIL value="false"/></FLAGS><CONTENTHANDLER value="resource/x-bb-folder"/><RENDERTYPE value="REGULAR"/><FOLDERTYPE value="BB_FOLDER"/><URL value=""/><VIEWMODE value="TEXT_ICON_ONLY"/><OFFLINENAME value=""/><OFFLINEPATH value=""/><LINKREF value=""/><PARENTID value="{unset id}"/><REVIEWABLEREASON value="NONE"/><VERSION value="3"/><THUMBNAILALT value=""/><AISTATE value="No"/><AIACCEPTINGUSER value=""/><EXTENDEDDATA/><FILES/></CONTENT>`;
  }

  function buildNativeTestContent(objectId, parentObjectId, title, timestamp) {
    const safeTitle = escapeXml(title);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<CONTENT id="${objectId}"><TITLE value="${safeTitle}"/><TITLECOLOR value="#000000"/><DESCRIPTION value=""/><BODY><TEXT/><TYPE value="H"/></BODY><DATES><CREATED value="${timestamp}"/><UPDATED value="${timestamp}"/><START value=""/><END value=""/></DATES><FLAGS><ISAVAILABLE value="false"/><ISFROMCARTRIDGE value="false"/><ISFOLDER value="false"/><ISDESCRIBED value="false"/><ISTRACKED value="true"/><ISLESSON value="false"/><ISSEQUENTIAL value="false"/><ALLOWGUESTS value="true"/><ALLOWOBSERVERS value="true"/><LAUNCHINNEWWINDOW value="true"/><ISREVIEWABLE value="true"/><ISGROUPCONTENT value="false"/><ISSAMPLECONTENT value="false"/><PARTIALLYVISIBLE value="false"/><HASTHUMBNAIL value="false"/></FLAGS><CONTENTHANDLER value="resource/x-bb-asmt-test-link"/><RENDERTYPE value="LINK"/><FOLDERTYPE value=""/><URL value=""/><VIEWMODE value="TEXT_ICON_ONLY"/><OFFLINENAME value=""/><OFFLINEPATH value=""/><LINKREF value=""/><PARENTID value="${parentObjectId}"/><REVIEWABLEREASON value="PROGRESS_TRACKING"/><VERSION value="3"/><THUMBNAILALT value=""/><AISTATE value="No"/><AIACCEPTINGUSER value=""/><EXTENDEDDATA><ENTRY key="ULTRA_ASSESSMENT_MARKER">true</ENTRY></EXTENDEDDATA><FILES/></CONTENT>`;
  }

  function buildNativeCourseAssessment(objectId) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<COURSEASSESSMENT id="${objectId}"><ASMTID value="${NATIVE_TEST_TEMPLATE.resources.assessment}"/><DELIVERYTYPE value="ALL_AT_ONCE"/><PASSWORD value=""/><TIMELIMIT value=""/><SOFTTIMELIMIT value=""/><TIMERCOMPLETION value="CONTINUAL"/><ATTEMPTCOUNT value="1"/><FEEDBACKSETTINGS value="as:f,ua,aa|aag:s"/><RANDOMIZEANSWERS value="PER_QUESTION"/><ALLOWEDFILERULES value=""/><FLAGS><ALLOWMULTIPLEATTEMPTS value="false"/><ISPASSWORDPROTECTED value="false"/><LAUNCHINNEWWINDOW value="false"/><FORCECOMPLETION value="false"/><ISBACKTRACKPROHIBITED value="false"/><RANDOMIZEQUESTIONS value="false"/><RANDOMIZEPAGES value="false"/><KEEPFIRSTPAGEFIRST value="false"/><COLLECT_EXT_SUBS value="false"/><SHOWSCORE value="false"/><SHOWUSERANSWER value="false"/><SHOWCORRECTANSWER value="false"/><SHOWFEEDBACK value="false"/><ISUNLIMITEDATTEMPTS value="false"/><SHOWINSTINSTRUCTIONS value="false"/><SHOWINSTDESCRIPTION value="false"/><ALLOWLATESUBMISSION value="false"/><ENFORCEDUEDATE value="false"/><IP_FILTER value="false"/><REQSECBROWSERTOTAKE value="false"/><REQSECBROWSERTOREVIEW value="false"/><REQWEBCAM value="false"/><ALLOWSTUDENTSUBMISSION value="false"/><ALLOWFILESUBMISSION value="true"/><ALLOWTEXTSUBMISSION value="true"/></FLAGS></COURSEASSESSMENT>`;
  }

  function buildNativeCourseLink(objectId, title) {
    const reference = NATIVE_TEST_TEMPLATE.resources;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<LINK id="${objectId}"><TITLE value="${escapeXml(title)}"/><FLAGS><ISAVAILABLE value="false"/></FLAGS><REFERRER id="${reference.testContent}" type="CONTENT"/><REFERREDTO id="${reference.courseAssessment}" type="COURSE_ASSESSMENT"/></LINK>`;
  }

  function buildNativeGradebook(ids, title, totalPoints, timestamp) {
    const safeTitle = escapeXml(title);
    const reference = NATIVE_TEST_TEMPLATE.resources;
    const settings = '<SETTINGS><DEFAULT_CUSTOM_VIEW_ID value=""/><DEFAULT_GRADING_PERIOD_ID value=""/><PUBLIC_ITEM__ID value=""/><PUBLIC_FORCED value="false"/><SHOWFIRSTLAST value="false"/><SHOWLASTFIRST value="true"/><SHOWSTUDENTID value="false"/><SHOWUSERID value="false"/><NUM_FROZEN_COLUMNS value="2"/><HIDE_UNAVAILABLE_STUDENTS value="false"/><ENABLE_AUTOMATIC_ZERO value="false"/><MASTERY_GRADEBOOK_VISIBILITY value="DISABLED"/><OUTCOME_VISIBILITY value="DISABLED"/><DISPLAY_STUDENT_ID value="true"/><NAME_DISPLAY_ORDER value="LAST_NAME_FIRST_NAME"/><WEIGHTTYPE value="ITEM"/></SETTINGS>';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<GRADEBOOK><CATEGORIES><CATEGORY id="${ids.category}"><TITLE value="Test.name"/><DESCRIPTION/><ISUSERDEFINED value="false"/><ISCALCULATED value="false"/><ISSCORABLE value="false"/></CATEGORY></CATEGORIES><SCALES><SCALE id="${ids.scale}"><TITLE value="Score.title"/><DESCRIPTION/><ISUSERDEFINED value="false"/><ISTABULARSCALE value="false"/><ISPERCENTAGE value="false"/><ISNUMERIC value="true"/><USESYMBOLINCALCIND value="false"/><TYPE value="SCORE"/><VERSION value="1"/></SCALE></SCALES><GRADING_PERIODS/><PERFORMANCE_CODES/><TERM_SOURCEDID_ID value=""/><OUTCOMEDEFINITIONS><OUTCOMEDEFINITION id="${ids.outcome}"><CATEGORYID value="${ids.category}"/><SCALEID value="${ids.scale}"/><SECONDARY_SCALEID value=""/><CONTENTID value="${reference.testContent}"/><GRADING_PERIODID value=""/><ASIDATAID value="${reference.assessment}"/><DATES><CREATED value="${timestamp}"/><UPDATED value="${timestamp}"/><DUE value=""/><ANON_GRADING_REL_DATE value=""/></DATES><TITLE value="${safeTitle}"/><DISPLAY_TITLE value=""/><ENFORCE_DUE_DATE value="false"/><FORMATIVE_IND value="NOT_FORMATIVE"/><SIGNATURE_TYPE value="NOT_SIGNATURE"/><POSITION value="1"/><VERSION value="1"/><DELETED value="false"/><EXTERNALREF value=""/><HANDLERURL value=""/><ANALYSISURL value=""/><WEIGHT value="0"/><POINTSPOSSIBLE value="${pointsText(totalPoints, 15)}"/><ISVISIBLE value="false"/><VISIBLE_BOOK value="true"/><VISIBLE_ALL_TERMS value="false"/><SHOW_STATS_TO_STUDENT value="false"/><HIDEATTEMPT value="false"/><AGGREGATIONMODEL value="Last"/><SCORE_PROVIDER_HANDLE value="resource/x-bb-assessment"/><SINGLE_ATTEMPT value="false"/><LTI_DOMAIN_ID value=""/><LTI_RESOURCE_ID value=""/><LTI_TAG value=""/><CALCULATIONTYPE value="NON_CALCULATED"/><ISCALCULATED value="false"/><ISSCORABLE value="true"/><ISUSERCREATED value="false"/><MULTIPLEATTEMPTS value="1"/><ACTIVITY_COUNT_COL_DEFS/><IS_DELEGATED_GRADING value="false"/><IS_ANONYMOUS_GRADING value="false"/><IS_PERMANENT_ANONYMOUS value="false"/><IS_DISTRIBUTED_GRADING value="false"/><GROUPATTEMPTS/><OUTCOMES/><IS_AUTO_POST_GRADES value="true"/><IS_PEER_GRADING value="false"/><ALLOW_LATE_PEER_REVIEWS value="false"/></OUTCOMEDEFINITION></OUTCOMEDEFINITIONS><FORMULAE/><CUSTOM_VIEWS/>${settings}<STUDENT_INFO_LAYOUTS/></GRADEBOOK>`;
  }

  return Object.freeze({
    nativeHtmlMaterial,
    nativeTextFlow,
    nativeEmptyFeedback,
    nativeIncorrectCondition,
    nativeCorrectCondition,
    secureNativeSeed,
    createNativeIdAllocator,
    createNativeResponseIdAllocator,
    nativeVisibleResponseId,
    nativePartialCredit,
    nativeMetadata,
    nativeOutcomes,
    nativeQuestionHtml,
    replaceFibMarker,
    replaceJumbledMarkers,
    NATIVE_QUESTION_TYPES,
    EITHER_OR_PAIRS,
    NATIVE_RAW_RESPONSE_ID_PATTERN,
    NATIVE_VISIBLE_RESPONSE_ID_PATTERN,
    nativeChoiceFeedback,
    buildNativePoolChoiceResponse,
    buildNativeTestChoiceResponse,
    buildNativeWeightedChoiceResponse,
    buildNativeChoiceResponse,
    buildNativeEitherOrResponse,
    nativeMatchingPercentages,
    buildNativeMatchingResponse,
    buildNativeJumbledResponse,
    buildNativeItem,
    buildNativeAssessment,
    buildNativeManifest,
    buildNativePackageInfo,
    nativeTimestamp,
    buildNativeCreationSettings,
    buildNativeCourseToc,
    buildNativeTopContent,
    buildNativeTestContent,
    buildNativeCourseAssessment,
    buildNativeCourseLink,
    buildNativeGradebook
  });
});
