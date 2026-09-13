/* Create the DOM references and a fresh, in-memory page state. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['context'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {window, document, core} = context;
  const byId = (id) => document.getElementById(id);

  const all = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const PROVIDERS = Object.freeze({
    chatgpt: Object.freeze({ name: 'ChatGPT', url: 'https://chatgpt.com/' }),
    claude: Object.freeze({ name: 'Claude', url: 'https://claude.ai/new' }),
    gemini: Object.freeze({ name: 'Gemini', url: 'https://gemini.google.com/app' }),
  });

  const elements = {
    hasAttachment: byId('has-attachment'),
    sourceContent: byId('source-content'),
    clearSource: byId('clear-source'),
    additionalInstructions: byId('additional-instructions'),
    questionLanguage: byId('question-language'),
    sourcePages: byId('source-pages'),
    pageNumbering: byId('page-numbering'),
    simpleModeButton: byId('simple-mode-button'),
    advancedModeButton: byId('advanced-mode-button'),
    simpleMode: byId('simple-mode'),
    advancedMode: byId('advanced-mode'),
    simpleCountFill: byId('simple-count-fill'),
    applySimpleCount: byId('apply-simple-count'),
    questionTotal: byId('question-total'),
    singleDifficulty: byId('single-difficulty'),
    singleDifficultyLabel: byId('single-difficulty-label'),
    mixedTotal: byId('mixed-total'),
    progressiveStart: byId('progressive-start'),
    progressiveEnd: byId('progressive-end'),
    matrixTotal: byId('matrix-total'),
    matPairCount: byId('mat-pair-count'),
    matDistractorCount: byId('mat-distractor-count'),
    maChoiceCount: byId('ma-choice-count'),
    maCorrectCount: byId('ma-correct-count'),
    maSelectionLimit: byId('ma-selection-limit'),
    maPartialCredit: byId('ma-partial-credit'),
    maCreditEditor: byId('ma-credit-editor'),
    maCreditRows: byId('ma-credit-rows'),
    maCreditTotal: byId('ma-credit-total'),
    maCreditState: byId('ma-credit-state'),
    maSmartDistribute: byId('ma-smart-distribute'),
    jumDistractorCount: byId('jum-distractor-count'),
    shuffleQuestions: byId('shuffle-questions'),
    shuffleAnswers: byId('shuffle-answers'),
    includeReviewNotes: byId('include-review-notes'),
    generatePrompt: byId('generate-prompt'),
    modelAdvice: byId('model-advice-dialog'),
    modelAdviceRemember: byId('model-advice-remember'),
    modelAdviceClose: byId('model-advice-close'),
    copyPrompt: byId('copy-prompt'),
    clearPrompt: byId('clear-prompt'),
    restorePrompt: byId('restore-prompt'),
    undoRestore: byId('undo-restore'),
    promptStatus: byId('prompt-status'),
    promptFormatNote: byId('prompt-format-note'),
    promptOutput: byId('prompt-output'),
    promptLength: byId('prompt-length'),
    providerLinks: all('.provider-link'),
    aiResponse: byId('ai-response'),
    clearAiResponse: byId('clear-ai-response'),
    formatNote: byId('format-note'),
    nativeOptions: byId('native-options'),
    nativeTitle: byId('native-title'),
    bankOptions: byId('bank-options'),
    bankTitle: byId('bank-title'),
    validateResponse: byId('validate-response'),
    exportResponse: byId('export-response'),
    exportStatus: byId('export-status'),
    issuesPanel: byId('issues-panel'),
    issuesList: byId('issues-list'),
    stats: byId('stats'),
    statTotal: byId('stat-total'),
    statMc: byId('stat-MC'),
    statTf: byId('stat-TF'),
    statOther: byId('stat-other'),
    pointsEditor: byId('points-editor'),
    pointsTitle: byId('points-title'),
    pointsTotal: byId('points-total'),
    bulkPoints: byId('bulk-points'),
    applyPointsAll: byId('apply-points-all'),
    resetPoints: byId('reset-points'),
    pointsList: byId('points-list'),
    pointsStatus: byId('points-status'),
    downloadReviewed: byId('download-reviewed'),
    pointsHelp: byId('points-help'),
    previewSection: byId('preview-section'),
    previewList: byId('preview-list'),
    appVersion: byId('app-version'),
  };

  const state = {
    advancedModeActive: false,
    generatedBasePrompt: '',
    currentPrompt: '',
    promptIsStale: false,
    restoredDraft: null,
    clipboardBusy: false,
    promptRevision: 0,
    generatedRequestedCounts: null,
    requestedCounts: null,
    generatedQuestionSettings: null,
    requestedQuestionSettings: null,
    pointsDraft: null,
    modelAdviceDismissed: false,
  };
  return {window, document, core, byId, all, PROVIDERS, elements, state};
});
