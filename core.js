/* Stable public API; implementation lives in src/core/. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./src/core/shared.js'), require('./src/core/arithmetic.js'), require('./src/core/prompt-settings.js'), require('./src/core/prompt-build.js'), require('./src/core/question-text.js'), require('./src/core/question-json.js'), require('./src/core/question-parser.js'), require('./src/core/question-validation.js'), require('./src/core/txt-qti.js'), require('./src/core/native-serialization.js'), require('./src/core/native-package.js'), require('./src/core/native-validation.js'))
    : factory(modules['shared'], modules['arithmetic'], modules['prompt-settings'], modules['prompt-build'], modules['question-text'], modules['question-json'], modules['question-parser'], modules['question-validation'], modules['txt-qti'], modules['native-serialization'], modules['native-package'], modules['native-validation']);
  if (node) module.exports = api;
  if (root) root.BlackboardCore = api;
})(typeof window !== 'undefined' ? window : null, function (shared, arithmetic, promptSettings, promptBuild, questionText, questionJson, questionParser, questionValidation, txtQti, nativeSerialization, nativePackage, nativeValidation) {
  'use strict';

  const { VERSION, DISPLAY_VERSION, TYPE_ORDER, LEGACY_TSV_TYPES, TYPE_LABELS, QTI_SUPPORTED_TYPES, NATIVE_SUPPORTED_TYPES, NATIVE_JSONL_SCHEMA, NATIVE_JSONL_VERSION, MAX_QUESTIONS, MAX_PER_INPUT, MAX_RESPONSE_LENGTH, PROMPT_FINGERPRINT, DEFAULT_QUESTION_SETTINGS, CREDIT_LEVELS, CREDIT_LEVEL_LABELS, NATIVE_TEST_TEMPLATE, NATIVE_BANK_TEMPLATE, DIFFICULTY_LABELS, ValidationError, normalizeArabicDigits, parseFiniteNumber, parsePointValue, applyQuestionPoints, totalQuestionPoints, stripInvalidXmlCharacters, escapeXml } = shared;
  const { parseArithmeticFormula } = arithmetic;
  const { smartCreditProfile, normalizePromptQuestionSettings, validatePromptConfig } = promptSettings;
  const { buildPrompt } = promptBuild;
  const { extractCandidateText, parseQuestionLine } = questionText;
  const { parseNativeJsonl } = questionJson;
  const { parseAIResponse } = questionParser;
  const { validateStructuredQuestion, validateQuestionStructures, validateForFormat } = questionValidation;
  const { buildTxt, buildQtiItem, buildQtiManifest, buildQtiFiles } = txtQti;
  const { buildNativeManifest, buildNativeAssessment } = nativeSerialization;
  const { buildNativeFiles } = nativePackage;
  const { validateNativeFiles } = nativeValidation;

  return Object.freeze({
    VERSION,
    DISPLAY_VERSION,
    TYPE_ORDER,
    LEGACY_TSV_TYPES,
    TYPE_LABELS,
    QTI_SUPPORTED_TYPES,
    NATIVE_SUPPORTED_TYPES,
    NATIVE_JSONL_SCHEMA,
    NATIVE_JSONL_VERSION,
    MAX_QUESTIONS,
    MAX_PER_INPUT,
    MAX_RESPONSE_LENGTH,
    PROMPT_FINGERPRINT,
    DEFAULT_QUESTION_SETTINGS,
    CREDIT_LEVELS,
    CREDIT_LEVEL_LABELS,
    NATIVE_TEST_TEMPLATE,
    NATIVE_BANK_TEMPLATE,
    DIFFICULTY_LABELS,
    ValidationError,
    normalizeArabicDigits,
    parseFiniteNumber,
    parsePointValue,
    applyQuestionPoints,
    totalQuestionPoints,
    parseArithmeticFormula,
    stripInvalidXmlCharacters,
    escapeXml,
    smartCreditProfile,
    normalizePromptQuestionSettings,
    validatePromptConfig,
    buildPrompt,
    extractCandidateText,
    parseQuestionLine,
    parseNativeJsonl,
    parseAIResponse,
    validateStructuredQuestion,
    validateQuestionStructures,
    validateForFormat,
    buildTxt,
    buildQtiItem,
    buildQtiManifest,
    buildQtiFiles,
    buildNativeManifest,
    buildNativeAssessment,
    buildNativeFiles,
    validateNativeFiles,
  });
});
