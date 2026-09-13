/* Strict JSONL record parsing, question fields, and response markers. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./arithmetic.js'), require('./prompt-settings.js'), require('./question-text.js'))
    : factory(modules['shared'], modules['arithmetic'], modules['prompt-settings'], modules['question-text']);
  if (node) module.exports = api;
  if (root) modules['question-json'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, arithmetic, promptSettings, questionText) {
  'use strict';

  const { CREDIT_LEVELS, MAX_QUESTIONS, NATIVE_JSONL_SCHEMA, NATIVE_JSONL_TYPES, NATIVE_JSONL_VERSION, ValidationError, hasPointPrecision, isStableDecimal, pointTicks, stripInvalidXmlCharacters, validPoints } = shared;
  const { parseArithmeticFormula } = arithmetic;
  const { creditProfileError } = promptSettings;
  const { createIssue, normalizedUniqueValue } = questionText;

  function findDuplicateJsonKey(source) {
    const stack = [];
    let index = 0;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        const start = index;
        index += 1;
        while (index < source.length) {
          if (source[index] === '\\') {
            index += 2;
            continue;
          }
          if (source[index] === '"') break;
          index += 1;
        }
        const end = index + 1;
        const context = stack[stack.length - 1];
        let lookahead = end;
        while (/\s/.test(source[lookahead] || '')) lookahead += 1;
        if (context && context.type === 'object' && context.expectKey && source[lookahead] === ':') {
          const key = JSON.parse(source.slice(start, end));
          if (context.keys.has(key)) return key;
          context.keys.add(key);
          context.expectKey = false;
        }
        index = end;
        continue;
      }
      if (character === '{') stack.push({ type: 'object', keys: new Set(), expectKey: true });
      else if (character === '[') stack.push({ type: 'array' });
      else if (character === '}' || character === ']') stack.pop();
      else if (character === ',') {
        const context = stack[stack.length - 1];
        if (context && context.type === 'object') context.expectKey = true;
      }
      index += 1;
    }
    return null;
  }

  function parseStrictJsonObject(rawLine, lineNumber) {
    let value;
    try {
      value = JSON.parse(rawLine);
    } catch (_error) {
      return { error: createIssue(lineNumber, 'السطر ليس كائن JSON صالحًا.', 'jsonl_syntax') };
    }
    const duplicateKey = findDuplicateJsonKey(rawLine);
    if (duplicateKey !== null) {
      return { error: createIssue(lineNumber, `مفتاح JSON مكرر: ${duplicateKey}.`, 'jsonl_duplicate_key') };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: createIssue(lineNumber, 'كل سطر بعد الرأس يجب أن يكون كائن JSON.', 'jsonl_record_not_object') };
    }
    return { value };
  }

  function nativeValidationError(code, message) {
    return { code, message };
  }

  function validateObjectKeys(value, allowed, required) {
    const keys = Object.keys(value);
    const unknown = keys.find((key) => !allowed.includes(key) || key === '__proto__' || key === 'constructor' || key === 'prototype');
    if (unknown) return nativeValidationError('jsonl_unknown_field', `المفتاح ${unknown} غير مسموح لهذا النوع.`);
    const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
    return missing ? nativeValidationError('jsonl_missing_field', `الحقل ${missing} مطلوب.`) : null;
  }

  function hasInvalidText(value, maxLength) {
    return typeof value !== 'string'
      || !value.trim()
      || value.length > maxLength
      || /[\u0000-\u001F\u007F]/.test(value)
      || stripInvalidXmlCharacters(value) !== value;
  }

  function hasSingleFibMarker(value) {
    const text = String(value || '');
    const index = text.indexOf('____');
    return index >= 0
      && text.indexOf('____', index + 4) < 0
      && text[index - 1] !== '_'
      && text[index + 4] !== '_';
  }

  function inspectJumbledMarkers(value) {
    const text = String(value || '');
    const ids = [];
    const pattern = /\[\[([A-Za-z][A-Za-z0-9_]{0,31})\]\]/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (text[match.index - 1] === '[' || text[pattern.lastIndex] === ']') return { valid: false, ids: [] };
      ids.push(match[1]);
    }
    const remainder = text.replace(/\[\[[A-Za-z][A-Za-z0-9_]{0,31}\]\]/g, '');
    return { valid: !remainder.includes('[[') && !remainder.includes(']]'), ids };
  }

  function markerCount(text, marker) {
    return String(text).split(marker).length - 1;
  }

  function validateNativeQuestion(value) {
    const commonError = validateObjectKeys(value, ['type', 'question', 'points'], ['type', 'question', 'points']);
    if (commonError && commonError.code === 'jsonl_missing_field') return [commonError];
    if (typeof value.type !== 'string' || !NATIVE_JSONL_TYPES.includes(value.type)) {
      return [nativeValidationError('unsupported_type', `نوع السؤال ${String(value.type || '(فارغ)')} غير مدعوم في JSONL.`)];
    }
    if (hasInvalidText(value.question, 20000)) {
      return [nativeValidationError('jsonl_field_type', 'نص السؤال مطلوب، وحده 20,000 حرف، ولا يقبل محارف تحكم.')];
    }
    if (!validPoints(value.points)) {
      return [nativeValidationError('points_range', 'points يجب أن يكون رقمًا من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.')];
    }

    const base = ['type', 'question', 'points'];
    let keysError;
    if (value.type === 'MC' || value.type === 'MA') {
      keysError = validateObjectKeys(value, value.type === 'MA' ? [...base, 'choices', 'selectionLimit', 'partialCredit'] : [...base, 'choices'], [...base, 'choices']);
      if (keysError) return [keysError];
      const partialCredit = value.type === 'MA' && value.partialCredit === true;
      if (value.type === 'MA' && value.partialCredit != null && typeof value.partialCredit !== 'boolean') {
        return [nativeValidationError('ma_partial_credit', 'partialCredit في MA يجب أن يكون true أو false.')];
      }
      if (!Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 100) {
        return [nativeValidationError(value.type === 'MC' ? 'mc_structure' : 'ma_structure', `${value.type} يحتاج من خيارين إلى 100 خيار.`)];
      }
      const choices = [];
      for (const choice of value.choices) {
        if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
          return [nativeValidationError(value.type === 'MC' ? 'mc_choice' : 'ma_choice', 'كل خيار يجب أن يكون كائنًا يحوي text وcorrect.')];
        }
        const choiceKeys = validateObjectKeys(choice, value.type === 'MA' ? ['text', 'correct', 'percent', 'creditLevel'] : ['text', 'correct'], partialCredit ? ['text', 'correct', 'percent'] : ['text', 'correct']);
        if (choiceKeys) return [choiceKeys];
        if (hasInvalidText(choice.text, 4000) || typeof choice.correct !== 'boolean') {
          return [nativeValidationError(value.type === 'MC' ? 'mc_choice' : 'ma_choice', 'نص الخيار أو علامة correct غير صالحين.')];
        }
        if (!partialCredit && (Object.prototype.hasOwnProperty.call(choice, 'percent') || Object.prototype.hasOwnProperty.call(choice, 'creditLevel'))) {
          return [nativeValidationError('ma_partial_credit', 'لا تضف percent أو creditLevel إلى خيارات MA إلا عند partialCredit=true.')];
        }
        if (partialCredit && (typeof choice.percent !== 'number' || !Number.isFinite(choice.percent) || choice.percent < 0 || choice.percent > 100 || !hasPointPrecision(choice.percent))) {
          return [nativeValidationError('ma_percentage', 'percent في MA يجب أن يكون رقمًا من 0 إلى 100 وبحد أقصى 5 منازل عشرية.')];
        }
        if (partialCredit && choice.creditLevel != null && (!choice.correct || typeof choice.creditLevel !== 'string' || !CREDIT_LEVELS.includes(choice.creditLevel))) {
          return [nativeValidationError('ma_credit_level', 'creditLevel يُضاف إلى الإجابات الصحيحة فقط، ويجب أن يكون most_correct أو correct أو least_correct.')];
        }
        const normalizedChoice = partialCredit
          ? { text: choice.text, correct: choice.correct, percent: choice.percent }
          : { text: choice.text, correct: choice.correct };
        if (partialCredit && choice.creditLevel != null) normalizedChoice.creditLevel = choice.creditLevel;
        choices.push(normalizedChoice);
      }
      const normalized = choices.map((choice) => normalizedUniqueValue(choice.text));
      if (new Set(normalized).size !== normalized.length) {
        return [nativeValidationError(value.type === 'MC' ? 'mc_duplicate_choices' : 'ma_duplicate_choices', 'نصوص الخيارات يجب ألا تكون مكررة.')];
      }
      const correctCount = choices.filter((choice) => choice.correct).length;
      if (value.type === 'MC' && correctCount !== 1) {
        return [nativeValidationError('mc_correct_count', 'MC يجب أن يحتوي على إجابة صحيحة واحدة فقط.')];
      }
      if (value.type === 'MA' && (correctCount < 1 || correctCount === choices.length)) {
        return [nativeValidationError('ma_correct_count', 'MA يحتاج إجابة صحيحة واحدة على الأقل وخيارًا خاطئًا واحدًا على الأقل.')];
      }
      if (partialCredit) {
        const correctChoices = choices.filter((choice) => choice.correct);
        const correctPercent = correctChoices.reduce((sum, choice) => sum + choice.percent, 0);
        if (choices.some((choice) => choice.correct ? choice.percent <= 0 : choice.percent !== 0)) {
          return [nativeValidationError('ma_percentage', 'نسب الإجابات الصحيحة في MA يجب أن تكون موجبة، ونسب الإجابات الخاطئة يجب أن تساوي 0.')];
        }
        if (pointTicks(correctPercent) !== pointTicks(100)) {
          return [nativeValidationError('ma_percentage_total', 'مجموع نسب الإجابات الصحيحة في MA يجب أن يساوي 100%.')];
        }
        const specifiedLevels = correctChoices.filter((choice) => Object.prototype.hasOwnProperty.call(choice, 'creditLevel'));
        if (specifiedLevels.length > 0 && specifiedLevels.length !== correctChoices.length) {
          return [nativeValidationError('ma_credit_level', 'عند استخدام creditLevel يجب إضافته إلى كل الإجابات الصحيحة.')];
        }
        if (specifiedLevels.length === correctChoices.length) {
          const profileError = creditProfileError(
            correctChoices.map((choice) => choice.creditLevel),
            correctChoices.map((choice) => choice.percent),
            correctChoices.length,
          );
          if (profileError) return [nativeValidationError('ma_credit_level', profileError)];
        }
      }
      if (value.selectionLimit != null && (!Number.isInteger(value.selectionLimit) || value.selectionLimit !== correctCount)) {
        return [nativeValidationError('ma_selection_limit', 'selectionLimit يجب أن يساوي عدد الإجابات الصحيحة تمامًا.')];
      }
      const normalizedQuestion = {
        type: value.type,
        question: value.question,
        points: value.points,
        choices,
      };
      if (value.type === 'MA') {
        normalizedQuestion.selectionLimit = value.selectionLimit == null ? correctCount : value.selectionLimit;
        if (partialCredit) normalizedQuestion.partialCredit = true;
      }
      return [{ value: normalizedQuestion }];
    }

    if (value.type === 'TF') {
      keysError = validateObjectKeys(value, [...base, 'answer'], [...base, 'answer']);
      if (keysError) return [keysError];
      if (typeof value.answer !== 'boolean') return [nativeValidationError('tf_answer', 'answer في TF يجب أن يكون true أو false.')];
      return [{ value: { type: 'TF', question: value.question, points: value.points, answer: value.answer } }];
    }

    if (value.type === 'ESS') {
      keysError = validateObjectKeys(value, [...base, 'exampleAnswer', 'rows'], base);
      if (keysError) return [keysError];
      if (value.exampleAnswer != null && value.exampleAnswer !== '' && hasInvalidText(value.exampleAnswer, 20000)) {
        return [nativeValidationError('ess_structure', 'exampleAnswer يجب أن يكون نصًا صالحًا لا يتجاوز 20,000 حرف.')];
      }
      if (value.rows != null && (!Number.isInteger(value.rows) || value.rows < 1 || value.rows > 20)) {
        return [nativeValidationError('ess_structure', 'rows يجب أن يكون عددًا صحيحًا بين 1 و20.')];
      }
      return [{ value: { type: 'ESS', question: value.question, points: value.points, exampleAnswer: value.exampleAnswer || '', rows: value.rows || 3 } }];
    }

    if (value.type === 'FIB') {
      keysError = validateObjectKeys(value, [...base, 'answers'], [...base, 'answers']);
      if (keysError) return [keysError];
      if (!Array.isArray(value.answers) || value.answers.length < 1 || value.answers.length > 100 || value.answers.some((answer) => hasInvalidText(answer, 4000))) {
        return [nativeValidationError('fib_answer', 'answers في FIB يجب أن تكون مصفوفة من 1 إلى 100 نص صالح.')];
      }
      const normalized = value.answers.map(normalizedUniqueValue);
      if (new Set(normalized).size !== normalized.length) return [nativeValidationError('fib_duplicate_answers', 'إجابات FIB البديلة يجب ألا تكون مكررة.')];
      if (!hasSingleFibMarker(value.question)) return [nativeValidationError('fib_marker', 'سؤال FIB في JSONL يجب أن يحتوي علامة ____ مستقلة مرة واحدة.')];
      return [{ value: { type: 'FIB', question: value.question, points: value.points, answers: [...value.answers] } }];
    }

    if (value.type === 'NUM') {
      keysError = validateObjectKeys(value, [...base, 'answer', 'tolerance'], [...base, 'answer', 'tolerance']);
      if (keysError) return [keysError];
      if (typeof value.answer !== 'number' || !Number.isFinite(value.answer)) return [nativeValidationError('num_answer', 'answer في NUM يجب أن يكون رقمًا منتهيًا صالحًا.')];
      if (typeof value.tolerance !== 'number' || !Number.isFinite(value.tolerance) || value.tolerance < 0) return [nativeValidationError('num_tolerance', 'tolerance في NUM يجب أن يكون رقمًا غير سالب.')];
      if (!Number.isFinite(value.answer - value.tolerance) || !Number.isFinite(value.answer + value.tolerance)) return [nativeValidationError('num_range', 'نطاق NUM الناتج من answer ± tolerance يجب أن يبقى رقمًا منتهيًا.')];
      if (!isStableDecimal(value.answer, 12) || !isStableDecimal(value.tolerance, 12)
        || !isStableDecimal(value.answer - value.tolerance, 12) || !isStableDecimal(value.answer + value.tolerance, 12)) {
        return [nativeValidationError('num_precision', 'قيم NUM ونطاقها يجب أن تكون قابلة للتمثيل بدقة ضمن 12 منزلة عشرية ومن دون صيغة أسية.')];
      }
      return [{ value: { type: 'NUM', question: value.question, points: value.points, answer: value.answer, tolerance: value.tolerance } }];
    }

    if (value.type === 'MAT') {
      keysError = validateObjectKeys(value, [...base, 'pairs', 'distractors'], [...base, 'pairs']);
      if (keysError) return [keysError];
      if (!Array.isArray(value.pairs) || value.pairs.length < 2 || value.pairs.length > 100) return [nativeValidationError('mat_structure', 'MAT يحتاج من زوجين إلى 100 زوج.')];
      const pairs = [];
      for (const pair of value.pairs) {
        if (!pair || typeof pair !== 'object' || Array.isArray(pair)) return [nativeValidationError('mat_empty_pair', 'كل زوج MAT يجب أن يكون كائنًا.')];
        const pairKeys = validateObjectKeys(pair, ['prompt', 'match'], ['prompt', 'match']);
        if (pairKeys) return [pairKeys];
        if (hasInvalidText(pair.prompt, 4000) || hasInvalidText(pair.match, 4000)) return [nativeValidationError('mat_empty_pair', 'MAT يحتوي على مطالبة أو مطابقة فارغة أو غير صالحة.')];
        pairs.push({ prompt: pair.prompt, match: pair.match });
      }
      const prompts = pairs.map((pair) => normalizedUniqueValue(pair.prompt));
      const matches = pairs.map((pair) => normalizedUniqueValue(pair.match));
      if (new Set(prompts).size !== prompts.length || new Set(matches).size !== matches.length) return [nativeValidationError('mat_duplicates', 'MAT يجب أن يستخدم مطالبات وإجابات فريدة.')];
      const distractors = value.distractors == null ? [] : value.distractors;
      if (!Array.isArray(distractors) || distractors.length > 98 || distractors.some((text) => hasInvalidText(text, 4000))) {
        return [nativeValidationError('mat_distractors', 'distractors في MAT يجب أن تكون مصفوفة من 0 إلى 98 إجابة نصية صالحة.')];
      }
      if (pairs.length + distractors.length > 100) {
        return [nativeValidationError('mat_structure', 'مجموع أزواج MAT وإجاباتها الخاطئة لا يمكن أن يتجاوز 100 خيار.')];
      }
      const answerOptions = [...matches, ...distractors.map(normalizedUniqueValue)];
      if (new Set(answerOptions).size !== answerOptions.length) {
        return [nativeValidationError('mat_duplicates', 'إجابات MAT الصحيحة والخاطئة يجب ألا تكون مكررة.')];
      }
      return [{ value: { type: 'MAT', question: value.question, points: value.points, pairs, distractors: [...distractors] } }];
    }

    if (value.type === 'EO') {
      keysError = validateObjectKeys(value, [...base, 'pair', 'answer'], [...base, 'pair', 'answer']);
      if (keysError) return [keysError];
      if (!['true_false', 'yes_no', 'correct_incorrect', 'agree_disagree'].includes(value.pair)) return [nativeValidationError('eo_structure', 'pair في EO غير معروف.')];
      if (!['first', 'second'].includes(value.answer)) return [nativeValidationError('eo_answer', 'answer في EO يجب أن يكون first أو second.')];
      return [{ value: { type: 'EO', question: value.question, points: value.points, pair: value.pair, answer: value.answer } }];
    }

    if (value.type === 'JUM') {
      keysError = validateObjectKeys(value, [...base, 'slots'], [...base, 'slots']);
      if (keysError) return [keysError];
      if (!Array.isArray(value.slots) || value.slots.length < 1 || value.slots.length > 100) return [nativeValidationError('jum_structure', 'JUM يحتاج من خانة واحدة إلى 100 خانة.')];
      const slots = [];
      const slotIds = new Set();
      for (const slot of value.slots) {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return [nativeValidationError('jum_structure', 'كل slot يجب أن يكون كائنًا.')];
        const slotKeys = validateObjectKeys(slot, ['id', 'answer', 'distractors'], ['id', 'answer', 'distractors']);
        if (slotKeys) return [slotKeys];
        if (typeof slot.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(slot.id) || slotIds.has(slot.id)) return [nativeValidationError('jum_structure', 'معرّف slot غير صالح أو مكرر.')];
        if (hasInvalidText(slot.answer, 4000) || !Array.isArray(slot.distractors) || slot.distractors.length < 1 || slot.distractors.length > 99 || slot.distractors.some((text) => hasInvalidText(text, 4000))) return [nativeValidationError('jum_structure', 'كل slot يحتاج answer ومشتتًا واحدًا على الأقل.')];
        const values = [slot.answer, ...slot.distractors].map(normalizedUniqueValue);
        if (new Set(values).size !== values.length) return [nativeValidationError('jum_duplicates', 'إجابة JUM ومشتتاتها يجب ألا تكون مكررة.')];
        if (markerCount(value.question, `[[${slot.id}]]`) !== 1) return [nativeValidationError('jum_marker', `العلامة [[${slot.id}]] يجب أن تظهر مرة واحدة.`)];
        slotIds.add(slot.id);
        slots.push({ id: slot.id, answer: slot.answer, distractors: [...slot.distractors] });
      }
      const markerInspection = inspectJumbledMarkers(value.question);
      if (!markerInspection.valid || markerInspection.ids.length !== slots.length || markerInspection.ids.some((id) => !slotIds.has(id))) return [nativeValidationError('jum_marker', 'كل علامة [[id]] في السؤال يجب أن تكون مكتملة ومستقلة وتطابق slot واحدًا.')];
      return [{ value: { type: 'JUM', question: value.question, points: value.points, slots } }];
    }

    keysError = validateObjectKeys(value, [...base, 'formula', 'answer', 'tolerance', 'decimals'], [...base, 'formula', 'answer']);
    if (keysError) return [keysError];
    if (hasInvalidText(value.formula, 1000)) return [nativeValidationError('calc_formula', 'formula مطلوبة، وحدها 1000 حرف، ولا تقبل محارف تحكم.')];
    let parsedFormula;
    try {
      parsedFormula = parseArithmeticFormula(value.formula);
    } catch (error) {
      return [nativeValidationError('calc_formula', error instanceof ValidationError ? error.messages[0] : 'صيغة CALC غير صالحة.')];
    }
    if (typeof value.answer !== 'number' || !Number.isFinite(value.answer)) return [nativeValidationError('calc_answer', 'answer في CALC يجب أن يكون رقمًا منتهيًا صالحًا.')];
    const tolerance = value.tolerance == null ? 0 : value.tolerance;
    const decimals = value.decimals == null ? 2 : value.decimals;
    if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) return [nativeValidationError('calc_settings', 'tolerance في CALC يجب أن يكون رقمًا غير سالب.')];
    if (!isStableDecimal(tolerance, 12)) return [nativeValidationError('calc_settings', 'tolerance في CALC يجب أن يكون قابلًا للتمثيل بدقة ضمن 12 منزلة عشرية ومن دون صيغة أسية.')];
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) return [nativeValidationError('calc_settings', 'decimals في CALC يجب أن يكون عددًا صحيحًا بين 0 و10.')];
    const serializedFormulaAnswer = Number(parsedFormula.value.toFixed(decimals));
    const serializedGivenAnswer = Number(value.answer.toFixed(decimals));
    const comparisonSlack = Number.EPSILON * Math.max(1, Math.abs(serializedFormulaAnswer), Math.abs(serializedGivenAnswer));
    if (!Number.isFinite(serializedGivenAnswer) || Math.abs(value.answer - serializedGivenAnswer) > comparisonSlack) {
      return [nativeValidationError('calc_settings', 'answer في CALC يجب ألا يحتوي منازل عشرية أكثر من قيمة decimals.')];
    }
    if (!Number.isFinite(serializedFormulaAnswer)
      || Math.abs(serializedFormulaAnswer - serializedGivenAnswer) > tolerance + comparisonSlack) {
      return [nativeValidationError('calc_answer_mismatch', 'ناتج formula بعد التقريب لا يطابق answer المتسلسل ضمن هامش الخطأ المحدد.')];
    }
    return [{ value: { type: 'CALC', question: value.question, points: value.points, formula: value.formula, answer: value.answer, tolerance, decimals } }];
  }

  function parseNativeJsonl(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const firstIndex = lines.findIndex((line) => line.trim());
    if (firstIndex < 0) {
      return { questions: [], notes: [], errors: [createIssue(0, 'لم يتم العثور على رأس JSONL.', 'jsonl_header_missing')], warnings: [], receivedCount: 0, acceptedCount: 0, rejectedCount: 0 };
    }
    lines[firstIndex] = lines[firstIndex].replace(/^\uFEFF/, '');
    const headerResult = parseStrictJsonObject(lines[firstIndex].trim(), firstIndex + 1);
    if (headerResult.error) {
      headerResult.error.code = 'jsonl_header_invalid';
      headerResult.error.message = 'رأس JSONL غير صالح.';
      return { questions: [], notes: [], errors: [headerResult.error], warnings: [], receivedCount: 0, acceptedCount: 0, rejectedCount: 0 };
    }
    const header = headerResult.value;
    const headerKeys = Object.keys(header);
    if (headerKeys.length !== 2 || !headerKeys.includes('schema') || !headerKeys.includes('version') || header.schema !== NATIVE_JSONL_SCHEMA) {
      return { questions: [], notes: [], errors: [createIssue(firstIndex + 1, `يجب أن يبدأ JSONL برأس schema=${NATIVE_JSONL_SCHEMA}.`, 'jsonl_header_invalid')], warnings: [], receivedCount: 0, acceptedCount: 0, rejectedCount: 0 };
    }
    if (header.version !== NATIVE_JSONL_VERSION) {
      return { questions: [], notes: [], errors: [createIssue(firstIndex + 1, `إصدار JSONL غير مدعوم؛ المطلوب ${NATIVE_JSONL_VERSION}.`, 'jsonl_version_unsupported')], warnings: [], receivedCount: 0, acceptedCount: 0, rejectedCount: 0 };
    }

    const questions = [];
    const errors = [];
    let receivedCount = 0;
    lines.forEach((rawLine, index) => {
      if (index <= firstIndex || !rawLine.trim()) return;
      receivedCount += 1;
      const parsed = parseStrictJsonObject(rawLine.trim(), index + 1);
      if (parsed.error) {
        errors.push(parsed.error);
        return;
      }
      const validation = validateNativeQuestion(parsed.value);
      const issue = validation.find((entry) => entry.code);
      if (issue) {
        errors.push(createIssue(index + 1, issue.message, issue.code));
        return;
      }
      const question = validation[0].value;
      question.sourceLine = index + 1;
      questions.push(question);
    });
    if (!questions.length && !errors.length) errors.push(createIssue(0, 'لم يتم العثور على أي سؤال صالح.', 'no_questions'));
    if (receivedCount > MAX_QUESTIONS) errors.push(createIssue(0, `عدد الأسئلة يتجاوز الحد الأقصى ${MAX_QUESTIONS}.`, 'too_many_questions'));
    const seen = new Map();
    questions.forEach((question) => {
      const key = normalizedUniqueValue(question.question);
      if (seen.has(key)) errors.push(createIssue(question.sourceLine, `السؤال مكرر مع السطر ${seen.get(key)}.`, 'duplicate_question'));
      else seen.set(key, question.sourceLine);
    });
    return {
      questions,
      notes: [],
      errors,
      warnings: [],
      receivedCount,
      acceptedCount: questions.length,
      rejectedCount: receivedCount - questions.length,
    };
  }

  return Object.freeze({
    findDuplicateJsonKey,
    parseStrictJsonObject,
    nativeValidationError,
    validateObjectKeys,
    hasInvalidText,
    hasSingleFibMarker,
    inspectJumbledMarkers,
    markerCount,
    validateNativeQuestion,
    parseNativeJsonl
  });
});
