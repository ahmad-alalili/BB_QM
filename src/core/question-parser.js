/* Assemble and audit an entire pasted response; enforce batch limits. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./question-text.js'), require('./question-json.js'))
    : factory(modules['shared'], modules['question-text'], modules['question-json']);
  if (node) module.exports = api;
  if (root) modules['question-parser'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, questionText, questionJson) {
  'use strict';

  const { MAX_QUESTIONS, MAX_RESPONSE_LENGTH, NATIVE_JSONL_SCHEMA, PROMPT_FINGERPRINT, TYPE_ORDER } = shared;
  const { createIssue, extractCandidateText, extractFencedBlocks, normalizedUniqueValue, parseQuestionLine } = questionText;
  const { parseNativeJsonl, parseStrictJsonObject } = questionJson;

  function parseAIResponse(response) {
    const original = String(response || '');
    if (original.length > MAX_RESPONSE_LENGTH) {
      return {
        questions: [],
        notes: [],
        errors: [createIssue(0, `الرد أطول من الحد المسموح (${MAX_RESPONSE_LENGTH.toLocaleString('en-US')} حرف).`, 'response_too_large')],
        warnings: [],
        receivedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
      };
    }
    if (original.includes(PROMPT_FINGERPRINT) || (original.includes('<SOURCE_MATERIAL>') && original.includes('<USER_REQUIREMENTS>'))) {
      return {
        questions: [],
        notes: [],
        errors: [createIssue(0, 'يبدو أنك لصقت البرومبت نفسه بدل رد الأسئلة.', 'prompt_pasted')],
        warnings: [],
        receivedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
      };
    }

    const fencedBlocks = extractFencedBlocks(original);
    const hasNativeJsonlFence = fencedBlocks.some((block) => {
      const firstLineIndex = block.split('\n').findIndex((line) => line.trim());
      if (firstLineIndex < 0) return false;
      const candidate = parseStrictJsonObject(block.split('\n')[firstLineIndex].replace(/^\uFEFF/, '').trim(), firstLineIndex + 1);
      return !candidate.error && candidate.value && candidate.value.schema === NATIVE_JSONL_SCHEMA;
    });
    if (fencedBlocks.length > 1 && hasNativeJsonlFence) {
      return {
        questions: [],
        notes: [],
        errors: [createIssue(0, 'يجب أن يكون رد JSONL كاملًا داخل كتلة code واحدة فقط.', 'jsonl_multiple_blocks')],
        warnings: [],
        receivedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
      };
    }

    const text = extractCandidateText(original);
    const firstContentLine = text.split('\n').find((line) => line.trim());
    if (firstContentLine && firstContentLine.replace(/^\uFEFF/, '').trim().startsWith('{')) {
      return parseNativeJsonl(text);
    }
    const questions = [];
    const notes = [];
    const errors = [];
    const warnings = [];
    let receivedCount = 0;

    text.split('\n').forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const trimmed = rawLine.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('#')) {
        notes.push({ line: lineNumber, text: trimmed.replace(/^#+\s*/, '') });
        return;
      }

      const prefix = (trimmed.match(/^([A-Za-z_]+)/) || [])[1];
      const hasSeparator = /\t|<TAB>|\[TAB\]/i.test(rawLine);
      if (!prefix) {
        if (hasSeparator) {
          receivedCount += 1;
          const result = parseQuestionLine(rawLine, lineNumber);
          errors.push(result.error || createIssue(lineNumber, 'السطر لا يبدأ بنوع سؤال صالح.', 'unsupported_type'));
        } else {
          warnings.push(createIssue(lineNumber, 'تم تجاهل سطر شرح خارج صيغة الأسئلة.', 'ignored_text'));
        }
        return;
      }

      const upperPrefix = prefix.toUpperCase();
      if (!TYPE_ORDER.includes(upperPrefix) && !hasSeparator) {
        if (/^[A-Z_]{2,}$/.test(prefix)) {
          receivedCount += 1;
          errors.push(createIssue(lineNumber, `نوع السؤال ${prefix} غير مدعوم.`, 'unsupported_type'));
        }
        else warnings.push(createIssue(lineNumber, 'تم تجاهل سطر غير مطابق للصيغة.', 'ignored_text'));
        return;
      }

      receivedCount += 1;
      const result = parseQuestionLine(rawLine, lineNumber);
      if (result.error) errors.push(result.error);
      else {
        questions.push(result.question);
        if (result.warning) warnings.push(result.warning);
        if (prefix !== upperPrefix) warnings.push(createIssue(lineNumber, `تم تطبيع النوع ${prefix} إلى ${upperPrefix}.`, 'type_normalized'));
      }
    });

    if (!questions.length) errors.push(createIssue(0, 'لم يتم العثور على أي سؤال صالح.', 'no_questions'));
    if (questions.length > MAX_QUESTIONS) errors.push(createIssue(0, `عدد الأسئلة يتجاوز الحد الأقصى ${MAX_QUESTIONS}.`, 'too_many_questions'));

    const seen = new Map();
    questions.forEach((question) => {
      const key = normalizedUniqueValue(question.question);
      if (seen.has(key)) {
        errors.push(createIssue(question.sourceLine, `السؤال مكرر مع السطر ${seen.get(key)}.`, 'duplicate_question'));
      } else {
        seen.set(key, question.sourceLine);
      }
    });

    return {
      questions,
      notes,
      errors,
      warnings,
      receivedCount,
      acceptedCount: questions.length,
      rejectedCount: receivedCount - questions.length,
    };
  }

  return Object.freeze({
    parseAIResponse
  });
});
