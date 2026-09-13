/* Recognize response blocks and read legacy tab-separated question records. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'))
    : factory(modules['shared']);
  if (node) module.exports = api;
  if (root) modules['question-text'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared) {
  'use strict';

  const { LEGACY_TSV_TYPES, NATIVE_JSONL_SCHEMA, TEMPLATE_ROWS, TYPE_ORDER, parseFiniteNumber } = shared;

  function extractFencedBlocks(response) {
    const source = String(response || '').replace(/\r\n?/g, '\n');
    const blocks = [];
    const pattern = /```[^\n]*\n([\s\S]*?)```/g;
    let match;
    while ((match = pattern.exec(source)) !== null) blocks.push(match[1]);
    return blocks;
  }

  function extractCandidateText(response) {
    const source = String(response || '').replace(/\r\n?/g, '\n');
    const blocks = extractFencedBlocks(source);
    return blocks.length ? blocks.join('\n') : source;
  }

  function createIssue(line, message, code) {
    return { line, message, code };
  }

  function normalizedUniqueValue(value) {
    return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar');
  }

  function parseQuestionLine(rawLine, lineNumber) {
    const normalized = rawLine.replace(/<TAB>|\[TAB\]/gi, '\t');
    const repairedTabs = normalized !== rawLine;
    if (!normalized.includes('\t')) {
      return { error: createIssue(lineNumber, 'السطر لا يحتوي على فواصل Tab حقيقية.', 'missing_tabs') };
    }

    const fields = normalized.split('\t').map((field) => field.trim());
    if (TEMPLATE_ROWS.has(fields.join('\t'))) {
      return { error: createIssue(lineNumber, 'هذا سطر قالب توضيحي، وليس سؤالًا مكتملًا.', 'template_row') };
    }
    const type = String(fields[0] || '').toUpperCase();
    if (!TYPE_ORDER.includes(type)) {
      return { error: createIssue(lineNumber, `نوع السؤال ${type || '(فارغ)'} غير مدعوم.`, 'unsupported_type') };
    }
    if (!LEGACY_TSV_TYPES.includes(type)) {
      return { error: createIssue(lineNumber, `النوع ${type} يحتاج صيغة JSONL التي تبدأ برأس ${NATIVE_JSONL_SCHEMA}.`, 'type_requires_jsonl') };
    }
    if (!fields[1]) {
      return { error: createIssue(lineNumber, 'نص السؤال فارغ.', 'empty_question') };
    }

    if (type === 'MC') {
      const answerFields = fields.slice(2);
      if (answerFields.length < 4 || answerFields.length % 2 !== 0) {
        return { error: createIssue(lineNumber, 'MC يحتاج خيارين على الأقل، ولكل خيار علامة correct أو incorrect.', 'mc_structure') };
      }
      const choices = [];
      for (let index = 0; index < answerFields.length; index += 2) {
        const text = answerFields[index];
        const marker = String(answerFields[index + 1] || '').toLowerCase();
        if (!text || !['correct', 'incorrect'].includes(marker)) {
          return { error: createIssue(lineNumber, 'أحد خيارات MC فارغ أو علامته غير صحيحة.', 'mc_choice') };
        }
        choices.push({ text, correct: marker === 'correct' });
      }
      if (choices.length > 100) return { error: createIssue(lineNumber, 'MC يتجاوز الحد الأقصى البالغ 100 خيار.', 'too_many_choices') };
      if (choices.filter((choice) => choice.correct).length !== 1) {
        return { error: createIssue(lineNumber, 'MC يجب أن يحتوي على إجابة صحيحة واحدة فقط.', 'mc_correct_count') };
      }
      const normalizedChoices = choices.map((choice) => normalizedUniqueValue(choice.text));
      if (new Set(normalizedChoices).size !== normalizedChoices.length) {
        return { error: createIssue(lineNumber, 'خيارات MC يجب ألا تكون مكررة.', 'mc_duplicate_choices') };
      }
      return {
        question: { type, question: fields[1], choices, sourceLine: lineNumber },
        warning: repairedTabs ? createIssue(lineNumber, 'تم تحويل الرمز <TAB> أو [TAB] إلى فاصل Tab فعلي.', 'tabs_repaired') : null,
      };
    }

    if (type === 'TF') {
      if (fields.length !== 3 || !['true', 'false'].includes(String(fields[2] || '').toLowerCase())) {
        return { error: createIssue(lineNumber, 'TF يجب أن يحتوي على true أو false فقط.', 'tf_answer') };
      }
      return {
        question: { type, question: fields[1], answer: fields[2].toLowerCase() === 'true', sourceLine: lineNumber },
        warning: repairedTabs ? createIssue(lineNumber, 'تم تحويل الرمز <TAB> أو [TAB] إلى فاصل Tab فعلي.', 'tabs_repaired') : null,
      };
    }

    if (type === 'ESS') {
      if (fields.length > 3) return { error: createIssue(lineNumber, 'ESS يقبل نص السؤال وإجابة نموذجية اختيارية فقط.', 'ess_structure') };
      return {
        question: { type, question: fields[1], exampleAnswer: fields[2] || '', sourceLine: lineNumber },
        warning: repairedTabs ? createIssue(lineNumber, 'تم تحويل الرمز <TAB> أو [TAB] إلى فاصل Tab فعلي.', 'tabs_repaired') : null,
      };
    }

    if (type === 'FIB') {
      const answers = fields.slice(2);
      if (!answers.length) return { error: createIssue(lineNumber, 'FIB يحتاج إجابة صحيحة واحدة على الأقل.', 'fib_answer') };
      if (answers.some((answer) => !answer)) return { error: createIssue(lineNumber, 'FIB يحتوي على إجابة فارغة.', 'fib_empty_answer') };
      if (answers.length > 100) return { error: createIssue(lineNumber, 'FIB يتجاوز الحد الأقصى البالغ 100 إجابة.', 'too_many_answers') };
      const normalizedAnswers = answers.map(normalizedUniqueValue);
      if (new Set(normalizedAnswers).size !== normalizedAnswers.length) {
        return { error: createIssue(lineNumber, 'إجابات FIB البديلة يجب ألا تكون مكررة.', 'fib_duplicate_answers') };
      }
      return {
        question: { type, question: fields[1], answers, sourceLine: lineNumber },
        warning: repairedTabs ? createIssue(lineNumber, 'تم تحويل الرمز <TAB> أو [TAB] إلى فاصل Tab فعلي.', 'tabs_repaired') : null,
      };
    }

    if (type === 'NUM') {
      if (fields.length < 3 || fields.length > 4) {
        return { error: createIssue(lineNumber, 'NUM يحتاج إجابة رقمية وهامش خطأ اختياري.', 'num_structure') };
      }
      const answer = parseFiniteNumber(fields[2]);
      const tolerance = fields[3] ? parseFiniteNumber(fields[3]) : 0;
      if (answer === null) return { error: createIssue(lineNumber, 'إجابة NUM ليست رقمًا صالحًا.', 'num_answer') };
      if (tolerance === null || tolerance < 0) return { error: createIssue(lineNumber, 'هامش خطأ NUM يجب أن يكون رقمًا غير سالب.', 'num_tolerance') };
      return {
        question: { type, question: fields[1], answer, tolerance, sourceLine: lineNumber },
        warning: repairedTabs ? createIssue(lineNumber, 'تم تحويل الرمز <TAB> أو [TAB] إلى فاصل Tab فعلي.', 'tabs_repaired') : null,
      };
    }

    const pairFields = fields.slice(2);
    if (pairFields.length < 4 || pairFields.length % 2 !== 0) {
      return { error: createIssue(lineNumber, 'MAT يحتاج زوجين كاملين على الأقل.', 'mat_structure') };
    }
    const pairs = [];
    for (let index = 0; index < pairFields.length; index += 2) {
      if (!pairFields[index] || !pairFields[index + 1]) {
        return { error: createIssue(lineNumber, 'MAT يحتوي على مطالبة أو مطابقة فارغة.', 'mat_empty_pair') };
      }
      pairs.push({ prompt: pairFields[index], match: pairFields[index + 1] });
    }
    if (pairs.length > 100) return { error: createIssue(lineNumber, 'MAT يتجاوز الحد الأقصى البالغ 100 زوج.', 'too_many_pairs') };
    const prompts = pairs.map((pair) => normalizedUniqueValue(pair.prompt));
    const matches = pairs.map((pair) => normalizedUniqueValue(pair.match));
    if (new Set(prompts).size !== prompts.length || new Set(matches).size !== matches.length) {
      return { error: createIssue(lineNumber, 'MAT يجب أن يستخدم مطالبات وإجابات فريدة بعلاقة واحد إلى واحد.', 'mat_duplicates') };
    }
    return {
      question: { type, question: fields[1], pairs, sourceLine: lineNumber },
      warning: repairedTabs ? createIssue(lineNumber, 'تم تحويل الرمز <TAB> أو [TAB] إلى فاصل Tab فعلي.', 'tabs_repaired') : null,
    };
  }

  return Object.freeze({
    extractFencedBlocks,
    extractCandidateText,
    createIssue,
    normalizedUniqueValue,
    parseQuestionLine
  });
});
