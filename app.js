(function () {
  'use strict';

  const core = window.BlackboardCore;
  const analyticsBatches = new Map();
  let nextAnalyticsBatch = 0;
  function analyticsBatch() {
    const source = elements.aiResponse.value;
    if (!analyticsBatches.has(source)) {
      if (analyticsBatches.size >= 20) analyticsBatches.delete(analyticsBatches.keys().next().value);
      analyticsBatches.set(source, ++nextAnalyticsBatch);
    }
    return analyticsBatches.get(source);
  }
  function measure(name, metadata = {}) {
    try { void window.BBAnalytics?.track(name, metadata); } catch (_) { /* Optional measurement. */ }
  }
  function measureQuestions(name, questions, format) {
    try {
      const counts = {};
      questions.forEach(question => { counts[question.type] = (counts[question.type] || 0) + 1; });
      measure(name, { counts, format, batch: analyticsBatch() });
    } catch (_) { /* No question text is passed to analytics. */ }
  }
  function measurePoints() {
    try { measure('points_changed', { format: selectedFormat(), batch: analyticsBatch() }); } catch (_) { /* Optional. */ }
  }
  if (!core) {
    const fallback = document.getElementById('export-status');
    if (fallback) {
      fallback.textContent = 'تعذر تحميل نواة التطبيق. تأكد من وجود ملف core.js بجانب الصفحة.';
      fallback.className = 'status error';
      fallback.setAttribute('role', 'alert');
    }
    return;
  }

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

  let advancedModeActive = false;
  let generatedBasePrompt = '';
  let currentPrompt = '';
  let promptIsStale = false;
  let restoredDraft = null;
  let clipboardBusy = false;
  let promptRevision = 0;
  let generatedRequestedCounts = null;
  let requestedCounts = null;
  let generatedQuestionSettings = null;
  let requestedQuestionSettings = null;
  let pointsDraft = null;

  function numericValue(input) {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : 0;
  }

  function cloneQuestionSettings(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function safeCorrectCount() {
    const choices = Number(elements.maChoiceCount.value);
    const maximum = Number.isInteger(choices) && choices >= 2 && choices <= 100 ? choices - 1 : 99;
    return Math.max(1, Math.min(maximum, Math.trunc(numericValue(elements.maCorrectCount)) || 1));
  }

  function syncMultipleAnswerLimits() {
    if (elements.maChoiceCount.value === '') return false;
    const rawChoices = Number(elements.maChoiceCount.value);
    if (!Number.isFinite(rawChoices)) return false;
    const choiceCount = Math.max(2, Math.min(100, Math.trunc(rawChoices)));
    if (rawChoices !== choiceCount) elements.maChoiceCount.value = String(choiceCount);

    const maximum = choiceCount - 1;
    elements.maCorrectCount.max = String(maximum);
    let correctChanged = false;
    if (elements.maCorrectCount.value !== '') {
      const rawCorrect = Number(elements.maCorrectCount.value);
      if (Number.isFinite(rawCorrect)) {
        const correctCount = Math.max(1, Math.min(maximum, Math.trunc(rawCorrect)));
        if (rawCorrect !== correctCount) {
          elements.maCorrectCount.value = String(correctCount);
          correctChanged = true;
        }
      }
    }

    elements.maSelectionLimit.min = '1';
    elements.maSelectionLimit.max = String(maximum);
    elements.maSelectionLimit.value = elements.maCorrectCount.value;
    return correctChanged;
  }

  function creditRowsProfile() {
    return all('.credit-row', elements.maCreditRows).map((row) => ({
      level: row.querySelector('.ma-credit-level').value,
      percent: row.querySelector('.ma-credit-percent').value,
    }));
  }

  function updateCreditSummary() {
    const profile = creditRowsProfile();
    const parsed = profile.map((entry) => core.parseFiniteNumber(entry.percent));
    const total = parsed.reduce((sum, value) => sum + (value == null ? 0 : value), 0);
    const validNumbers = parsed.every((value) => value != null && value > 0 && value <= 100);
    const exactTotal = Math.round(total * 100000) === 10000000;
    const levels = profile.map((entry) => entry.level);
    const mostCount = levels.filter((level) => level === 'most_correct').length;
    const leastCount = levels.filter((level) => level === 'least_correct').length;
    const correctCount = profile.length;
    const validLevels = correctCount === 1
      ? levels[0] === 'correct'
      : mostCount === 1 && leastCount === 1 && levels.filter((level) => level === 'correct').length === correctCount - 2;
    let ordered = true;
    if (validNumbers && validLevels && correctCount > 1) {
      const most = parsed[levels.indexOf('most_correct')];
      const least = parsed[levels.indexOf('least_correct')];
      ordered = most > least && parsed.every((value, index) => {
        if (levels[index] === 'most_correct' || levels[index] === 'least_correct') return true;
        return most > value && value > least;
      });
    }
    const ready = validNumbers && exactTotal && validLevels && ordered;
    elements.maCreditTotal.textContent = `${Number(total.toFixed(5))}%`;
    elements.maCreditTotal.classList.toggle('mismatch', !ready);
    elements.maCreditState.classList.toggle('mismatch', !ready);
    elements.maCreditState.textContent = ready
      ? 'التوزيع جاهز'
      : (!exactTotal ? 'يجب أن يكون المجموع 100%' : (!validLevels ? 'راجع مستويات الصحة' : 'راجع ترتيب النسب'));
  }

  function renderCreditRows(profile) {
    const entries = Array.isArray(profile) && profile.length === safeCorrectCount()
      ? profile
      : core.smartCreditProfile(safeCorrectCount());
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'credit-row';

      const number = document.createElement('span');
      number.className = 'credit-answer-index';
      number.textContent = `الإجابة ${index + 1}`;

      const levelLabel = document.createElement('label');
      levelLabel.className = 'credit-field';
      levelLabel.textContent = 'مستوى الصحة';
      const level = document.createElement('select');
      level.className = 'ma-credit-level';
      level.dataset.creditControl = 'true';
      level.setAttribute('aria-label', `مستوى صحة الإجابة ${index + 1}`);
      Object.entries(core.CREDIT_LEVEL_LABELS).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = entry.level === value;
        level.appendChild(option);
      });
      levelLabel.appendChild(level);

      const percentLabel = document.createElement('label');
      percentLabel.className = 'credit-field';
      percentLabel.textContent = 'النسبة';
      const percentWrap = document.createElement('span');
      percentWrap.className = 'credit-percent-wrap';
      const percent = document.createElement('input');
      percent.className = 'ma-credit-percent';
      percent.dataset.creditControl = 'true';
      percent.type = 'number';
      percent.inputMode = 'decimal';
      percent.min = '0.00001';
      percent.max = '100';
      percent.step = '0.00001';
      percent.value = String(entry.percent);
      percent.setAttribute('aria-label', `نسبة الإجابة الصحيحة ${index + 1}`);
      const suffix = document.createElement('span');
      suffix.textContent = '%';
      percentWrap.append(percent, suffix);
      percentLabel.appendChild(percentWrap);

      row.append(number, levelLabel, percentLabel);
      fragment.appendChild(row);
    });
    elements.maCreditRows.replaceChildren(fragment);
    updatePartialCreditUi();
    updateCreditSummary();
  }

  function updatePartialCreditUi() {
    const enabled = elements.maPartialCredit.checked;
    elements.maCreditEditor.hidden = !enabled;
    elements.maCreditEditor.classList.toggle('disabled-option', !enabled);
    elements.maCreditEditor.setAttribute('aria-disabled', String(!enabled));
    elements.maSmartDistribute.disabled = !enabled;
    all('[data-credit-control]', elements.maCreditRows).forEach((control) => { control.disabled = !enabled; });
  }

  function setStatus(element, message, kind) {
    const isError = kind === 'error';
    element.setAttribute('role', isError ? 'alert' : 'status');
    element.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    element.className = `status${kind ? ` ${kind}` : ''}`;
    element.textContent = message || '';
  }

  function clearInvalid() {
    all('[aria-invalid="true"]').forEach((element) => element.removeAttribute('aria-invalid'));
  }

  function markInvalid(element) {
    if (!element) return;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    }
    element.setAttribute('aria-invalid', 'true');
    element.focus();
  }

  function updateSimpleTotal() {
    return all('.type-count').reduce((sum, input) => sum + Math.max(0, numericValue(input)), 0);
  }

  function updateMatrixTotals() {
    let grandTotal = 0;
    core.TYPE_ORDER.forEach((type) => {
      const rowTotal = all(`.matrix-cell[data-type="${type}"]`).reduce(
        (sum, input) => sum + Math.max(0, numericValue(input)),
        0,
      );
      const output = document.querySelector(`.row-total[data-type="${type}"]`);
      output.value = String(rowTotal);
      output.textContent = String(rowTotal);
      grandTotal += rowTotal;
    });
    elements.matrixTotal.value = String(grandTotal);
    elements.matrixTotal.textContent = String(grandTotal);
    return grandTotal;
  }

  function currentTotal() {
    return advancedModeActive ? updateMatrixTotals() : updateSimpleTotal();
  }

  function nativeJsonlIsRequired() {
    return ['MA', 'EO', 'JUM', 'CALC'].some((type) => {
      if (advancedModeActive) return all(`.matrix-cell[data-type="${type}"]`).some((input) => numericValue(input) > 0);
      return numericValue(byId(`count-${type}`)) > 0;
    });
  }

  function updateReviewNotesAvailability() {
    const disabled = nativeJsonlIsRequired();
    if (disabled) elements.includeReviewNotes.checked = false;
    elements.includeReviewNotes.disabled = disabled;
    elements.includeReviewNotes.closest('label').classList.toggle('disabled-option', disabled);
    elements.includeReviewNotes.closest('label').title = disabled ? 'تعليقات المراجعة غير متاحة داخل عقد JSONL الصارم.' : '';
  }

  function updateTotals() {
    const total = currentTotal();
    elements.questionTotal.value = String(total);
    elements.questionTotal.textContent = `${total} ${total === 1 ? 'سؤال' : 'أسئلة'}`;

    const mixed = all('.mix-count').reduce((sum, input) => sum + Math.max(0, numericValue(input)), 0);
    elements.mixedTotal.value = String(mixed);
    elements.mixedTotal.textContent = `${mixed} من ${total}`;
    elements.mixedTotal.classList.toggle('mismatch', mixed !== total);
    updateReviewNotesAvailability();
  }

  function normalizedBulkCount(input) {
    const value = Math.trunc(numericValue(input));
    const minimum = Number(input.min || 0);
    const maximum = Number(input.max || 25);
    return Math.max(minimum, Math.min(maximum, value));
  }

  function applySimpleCount() {
    const value = normalizedBulkCount(elements.simpleCountFill);
    elements.simpleCountFill.value = String(value);
    all('.type-count').forEach((input) => { input.value = String(value); });
    updateTotals();
    invalidatePrompt();
    setStatus(elements.promptStatus, `طُبق العدد ${value} على جميع أنواع الأسئلة في الوضع البسيط.`, 'success');
  }

  function applyMatrixColumn(level) {
    const fill = document.querySelector(`.matrix-column-fill[data-level="${level}"]`);
    if (!fill) return;
    const value = normalizedBulkCount(fill);
    fill.value = String(value);
    all(`.matrix-cell[data-level="${level}"]`).forEach((input) => { input.value = String(value); });
    updateTotals();
    invalidatePrompt();
    setStatus(elements.promptStatus, `طُبق العدد ${value} على جميع الأنواع في عمود الصعوبة المحدد.`, 'success');
  }

  function updateDifficultyUi() {
    const selected = document.querySelector('input[name="difficulty-mode"]:checked').value;
    ['single', 'mixed', 'progressive'].forEach((mode) => {
      byId(`difficulty-${mode}`).hidden = selected !== mode;
    });

    const progressive = selected === 'progressive';
    if (progressive) elements.shuffleQuestions.checked = false;
    elements.shuffleQuestions.disabled = progressive;
    elements.shuffleQuestions.closest('label').classList.toggle('disabled-option', progressive);
  }

  function updateDifficultyLabel() {
    const level = Number(elements.singleDifficulty.value);
    const label = core.DIFFICULTY_LABELS[level];
    elements.singleDifficultyLabel.value = label;
    elements.singleDifficultyLabel.textContent = label;
    elements.singleDifficulty.setAttribute('aria-valuetext', label);
  }

  function syncSimpleToMatrixIfEmpty() {
    if (updateMatrixTotals() !== 0) return;
    core.TYPE_ORDER.forEach((type) => {
      const source = byId(`count-${type}`);
      const target = document.querySelector(`.matrix-cell[data-type="${type}"][data-level="medium"]`);
      target.value = source.value || '0';
    });
  }

  function syncMatrixToSimple() {
    core.TYPE_ORDER.forEach((type) => {
      const total = all(`.matrix-cell[data-type="${type}"]`).reduce(
        (sum, input) => sum + Math.max(0, numericValue(input)),
        0,
      );
      byId(`count-${type}`).value = String(total);
    });
  }

  function setEditorMode(useAdvanced) {
    if (useAdvanced && !advancedModeActive) syncSimpleToMatrixIfEmpty();
    if (!useAdvanced && advancedModeActive) syncMatrixToSimple();
    advancedModeActive = useAdvanced;
    elements.simpleMode.hidden = useAdvanced;
    elements.advancedMode.hidden = !useAdvanced;
    elements.simpleModeButton.classList.toggle('active', !useAdvanced);
    elements.advancedModeButton.classList.toggle('active', useAdvanced);
    elements.simpleModeButton.setAttribute('aria-pressed', String(!useAdvanced));
    elements.advancedModeButton.setAttribute('aria-pressed', String(useAdvanced));
    updateTotals();
  }

  function hasUsablePrompt() {
    return currentPrompt.trim().length > 0 && !promptIsStale;
  }

  function setProviderLinksEnabled(enabled) {
    elements.providerLinks.forEach((link) => {
      const provider = PROVIDERS[link.dataset.provider];
      const available = Boolean(enabled && provider);
      link.classList.toggle('is-disabled', !available);
      link.setAttribute('aria-disabled', String(!available));
      if (available) {
        link.href = provider.url;
        link.removeAttribute('tabindex');
      } else {
        link.removeAttribute('href');
        link.setAttribute('tabindex', '-1');
      }
    });
  }

  function clearRestoreUndo() {
    restoredDraft = null;
    elements.undoRestore.hidden = true;
  }

  function updatePromptControls() {
    const usable = hasUsablePrompt();
    elements.promptLength.textContent = `${currentPrompt.length.toLocaleString('ar')} حرف`;
    elements.copyPrompt.disabled = !usable || clipboardBusy;
    elements.clearPrompt.disabled = currentPrompt.length === 0 || clipboardBusy;
    elements.restorePrompt.disabled = !generatedBasePrompt
      || currentPrompt === generatedBasePrompt
      || clipboardBusy;
    elements.undoRestore.disabled = clipboardBusy;
    elements.promptOutput.classList.toggle('stale', promptIsStale);
    setProviderLinksEnabled(usable && !clipboardBusy);
  }

  function invalidatePrompt() {
    if (!generatedBasePrompt) return;
    const wasStale = promptIsStale;
    promptIsStale = true;
    promptRevision += 1;
    requestedCounts = currentPrompt === generatedBasePrompt && generatedRequestedCounts
      ? { ...generatedRequestedCounts }
      : null;
    requestedQuestionSettings = currentPrompt === generatedBasePrompt && generatedQuestionSettings
      ? cloneQuestionSettings(generatedQuestionSettings)
      : null;
    clearRestoreUndo();
    updatePromptControls();
    if (wasStale) return;
    setStatus(
      elements.promptStatus,
      'تغيّرت الإعدادات. احتُفظ بمسودة البرومبت، لكن يجب إنشاؤه مجددًا قبل النسخ أو فتح أي خدمة.',
      'warning',
    );
  }

  function collectCounts() {
    const counts = {};
    if (advancedModeActive) {
      core.TYPE_ORDER.forEach((type) => {
        counts[type] = all(`.matrix-cell[data-type="${type}"]`).reduce(
          (sum, input) => sum + numericValue(input),
          0,
        );
      });
    } else {
      core.TYPE_ORDER.forEach((type) => { counts[type] = byId(`count-${type}`).value; });
    }
    return counts;
  }

  function collectDifficulty() {
    if (advancedModeActive) {
      const matrix = {};
      core.TYPE_ORDER.forEach((type) => {
        matrix[type] = {};
        all(`.matrix-cell[data-type="${type}"]`).forEach((input) => {
          matrix[type][input.dataset.level] = input.value;
        });
      });
      return { mode: 'advanced', matrix };
    }

    const mode = document.querySelector('input[name="difficulty-mode"]:checked').value;
    if (mode === 'single') return { mode, level: elements.singleDifficulty.value };
    if (mode === 'progressive') {
      return { mode, start: elements.progressiveStart.value, end: elements.progressiveEnd.value };
    }
    const mix = {};
    all('.mix-count').forEach((input) => { mix[input.dataset.level] = input.value; });
    return { mode, mix };
  }

  function collectPromptConfig() {
    const maCreditProfile = creditRowsProfile();
    return {
      hasAttachment: elements.hasAttachment.checked,
      sourceContent: elements.sourceContent.value,
      additionalInstructions: elements.additionalInstructions.value,
      counts: collectCounts(),
      targetFormat: selectedFormat(),
      difficulty: collectDifficulty(),
      questionSettings: {
        matching: {
          pairCount: elements.matPairCount.value,
          distractorCount: elements.matDistractorCount.value,
        },
        multipleAnswer: {
          choiceCount: elements.maChoiceCount.value,
          correctCount: elements.maCorrectCount.value,
          selectionLimit: elements.maSelectionLimit.value,
          partialCredit: elements.maPartialCredit.checked,
          creditLevels: maCreditProfile.map((entry) => entry.level),
          percentages: maCreditProfile.map((entry) => entry.percent),
        },
        jumbled: {
          distractorCount: elements.jumDistractorCount.value,
        },
      },
      options: {
        shuffleQuestions: elements.shuffleQuestions.checked && !elements.shuffleQuestions.disabled,
        shuffleAnswers: elements.shuffleAnswers.checked,
        includeReviewNotes: elements.includeReviewNotes.checked,
      },
    };
  }

  function focusPromptError(config, messages) {
    const joined = messages.join(' ');
    if (!config.sourceContent.trim() && !config.hasAttachment) return markInvalid(elements.sourceContent);
    if (joined.includes('التعليمات الإضافية')) return markInvalid(elements.additionalInstructions);
    const activeInputs = advancedModeActive ? all('.matrix-cell') : all('.type-count');
    const invalidInput = activeInputs.find((input) => !input.checkValidity());
    if (invalidInput) return markInvalid(invalidInput);
    if (config.difficulty.mode === 'mixed' && joined.includes('توزيع الصعوبة')) return markInvalid(elements.mixedTotal);
    if (config.difficulty.mode === 'progressive' && joined.includes('التدرج')) return markInvalid(elements.progressiveStart);
    if (joined.includes('أزواج المطابقة')) return markInvalid(elements.matPairCount);
    if (joined.includes('الخاطئة في المطابقة') || joined.includes('أزواج المطابقة وإجاباتها')) return markInvalid(elements.matDistractorCount);
    if (joined.includes('خيارات الإجابات المتعددة')) return markInvalid(elements.maChoiceCount);
    if (joined.includes('الإجابات الصحيحة في MA')) return markInvalid(elements.maCorrectCount);
    if (joined.includes('حد اختيار الطالب')) return markInvalid(elements.maSelectionLimit);
    if (joined.includes('مستوى') || joined.includes('مستويات الصحة') || joined.includes('تصنيف') || joined.includes('الأكثر صحة') || joined.includes('الأقل صحة')) {
      return markInvalid(elements.maCreditRows.querySelector('.ma-credit-level'));
    }
    if (joined.includes('نسب الرصيد الجزئي') || joined.includes('مجموع نسب')) {
      return markInvalid(elements.maCreditRows.querySelector('.ma-credit-percent'));
    }
    if (joined.includes('قائمة منسدلة')) return markInvalid(elements.jumDistractorCount);
    return markInvalid(elements.questionTotal);
  }

  function generatePrompt() {
    clearInvalid();
    const config = collectPromptConfig();
    try {
      const nextPrompt = core.buildPrompt(config);
      generatedBasePrompt = nextPrompt;
      currentPrompt = nextPrompt;
      promptIsStale = false;
      promptRevision += 1;
      clearRestoreUndo();
      generatedRequestedCounts = Object.fromEntries(core.TYPE_ORDER.map((type) => [type, Number(config.counts[type] || 0)]));
      requestedCounts = { ...generatedRequestedCounts };
      generatedQuestionSettings = core.normalizePromptQuestionSettings(config.questionSettings);
      requestedQuestionSettings = cloneQuestionSettings(generatedQuestionSettings);
      elements.promptOutput.value = currentPrompt;
      elements.promptOutput.readOnly = false;
      updatePromptControls();
      measure('prompt_created', { counts: generatedRequestedCounts });
      setStatus(
        elements.promptStatus,
        `تم إنشاء البرومبت. عدد الأسئلة المطلوبة: ${currentTotal()}. يمكنك تعديله، ثم نسخه أو فتح الخدمة المطلوبة.`,
        'success',
      );
    } catch (error) {
      requestedCounts = currentPrompt === generatedBasePrompt && generatedRequestedCounts
        ? { ...generatedRequestedCounts }
        : null;
      requestedQuestionSettings = currentPrompt === generatedBasePrompt && generatedQuestionSettings
        ? cloneQuestionSettings(generatedQuestionSettings)
        : null;
      if (generatedBasePrompt && !promptIsStale) promptRevision += 1;
      promptIsStale = Boolean(generatedBasePrompt);
      clearRestoreUndo();
      if (!generatedBasePrompt) {
        currentPrompt = '';
        elements.promptOutput.value = '';
        elements.promptOutput.readOnly = true;
      }
      updatePromptControls();
      const messages = error instanceof core.ValidationError ? error.messages : ['تعذر إنشاء البرومبت بسبب خطأ غير متوقع.'];
      setStatus(elements.promptStatus, messages.join(' '), 'error');
      focusPromptError(config, messages);
    }
  }

  function editPrompt() {
    if (!generatedBasePrompt) return;
    const previousState = currentPrompt.length === 0
      ? 'empty'
      : (currentPrompt === generatedBasePrompt ? 'generated' : 'edited');
    currentPrompt = elements.promptOutput.value;
    requestedCounts = currentPrompt === generatedBasePrompt && generatedRequestedCounts
      ? { ...generatedRequestedCounts }
      : null;
    requestedQuestionSettings = currentPrompt === generatedBasePrompt && generatedQuestionSettings
      ? cloneQuestionSettings(generatedQuestionSettings)
      : null;
    promptRevision += 1;
    clearRestoreUndo();
    updatePromptControls();

    if (promptIsStale) return;
    const nextState = currentPrompt.length === 0
      ? 'empty'
      : (currentPrompt === generatedBasePrompt ? 'generated' : 'edited');
    if (nextState === previousState) return;
    if (nextState === 'empty') {
      setStatus(elements.promptStatus, 'البرومبت فارغ الآن. استخدم الاستعادة أو اكتب نصًا قبل النسخ.', 'warning');
    } else if (nextState === 'generated') {
      setStatus(elements.promptStatus, 'النص يطابق آخر نسخة مولّدة.', 'success');
    } else {
      setStatus(elements.promptStatus, 'تم تعديل البرومبت، وسيستخدم النسخ النص المعدّل. أُوقفت مقارنة توزيع الرد وبنية الأنواع تلقائيًا؛ راجع الإحصاءات قبل التنزيل.', 'warning');
    }
  }

  function clearSource() {
    if (!elements.sourceContent.value) return;
    elements.sourceContent.value = '';
    elements.sourceContent.removeAttribute('aria-invalid');
    elements.clearSource.disabled = true;
    invalidatePrompt();
    elements.sourceContent.focus();
  }

  function clearPrompt() {
    if (!currentPrompt || clipboardBusy) return;
    currentPrompt = '';
    requestedCounts = null;
    requestedQuestionSettings = null;
    restoredDraft = null;
    promptRevision += 1;
    elements.promptOutput.value = '';
    elements.promptOutput.readOnly = !generatedBasePrompt;
    elements.undoRestore.hidden = true;
    updatePromptControls();
    setStatus(
      elements.promptStatus,
      generatedBasePrompt ? 'تم مسح البرومبت. يمكنك استعادة آخر نسخة مولّدة.' : 'تم مسح البرومبت.',
      'warning',
    );
  }

  function clearAiResponse() {
    if (!elements.aiResponse.value) return;
    elements.aiResponse.value = '';
    elements.clearAiResponse.disabled = true;
    clearPointsDraft();
    renderIssues([], [], []);
    renderStats([]);
    renderPreview([]);
    updateFormatNote();
    setStatus(elements.exportStatus, 'تم مسح رد الذكاء الاصطناعي.', 'warning');
    elements.aiResponse.focus();
  }

  function restorePrompt() {
    if (!generatedBasePrompt || currentPrompt === generatedBasePrompt || clipboardBusy) return;
    restoredDraft = currentPrompt;
    currentPrompt = generatedBasePrompt;
    requestedCounts = generatedRequestedCounts ? { ...generatedRequestedCounts } : null;
    requestedQuestionSettings = cloneQuestionSettings(generatedQuestionSettings);
    promptRevision += 1;
    elements.promptOutput.value = currentPrompt;
    elements.undoRestore.hidden = false;
    updatePromptControls();
    setStatus(
      elements.promptStatus,
      promptIsStale
        ? 'استُعيدت النسخة المولّدة، لكن الإعدادات تغيّرت؛ أعد إنشاء البرومبت قبل نسخه.'
        : 'استُعيدت آخر نسخة مولّدة. يمكنك التراجع عن الاستعادة.',
      promptIsStale ? 'warning' : 'success',
    );
  }

  function undoPromptRestore() {
    if (restoredDraft === null || clipboardBusy) return;
    currentPrompt = restoredDraft;
    requestedCounts = currentPrompt === generatedBasePrompt && generatedRequestedCounts
      ? { ...generatedRequestedCounts }
      : null;
    requestedQuestionSettings = currentPrompt === generatedBasePrompt && generatedQuestionSettings
      ? cloneQuestionSettings(generatedQuestionSettings)
      : null;
    restoredDraft = null;
    promptRevision += 1;
    elements.promptOutput.value = currentPrompt;
    elements.undoRestore.hidden = true;
    updatePromptControls();
    setStatus(
      elements.promptStatus,
      promptIsStale
        ? 'عادت مسودتك المعدّلة. ما زال يلزم إنشاء البرومبت مجددًا بعد تغيير الإعدادات.'
        : 'عادت مسودتك المعدّلة.',
      promptIsStale ? 'warning' : 'success',
    );
    elements.promptOutput.focus();
  }

  function fallbackCopy(text) {
    const activeElement = document.activeElement;
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.setAttribute('readonly', '');
    temporary.setAttribute('aria-hidden', 'true');
    temporary.className = 'clipboard-helper';
    document.body.appendChild(temporary);
    temporary.select();
    let copied = false;
    try {
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } finally {
      temporary.remove();
      if (activeElement && typeof activeElement.focus === 'function') activeElement.focus();
    }
    if (!copied) throw new Error('copy_failed');
  }

  async function writePromptToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_error) {
        // Try the local selection fallback below when clipboard permission is unavailable.
      }
    }
    fallbackCopy(text);
  }

  function selectPromptForManualCopy() {
    elements.promptOutput.focus();
    elements.promptOutput.select();
  }

  function releaseClipboardBusy() {
    window.setTimeout(() => {
      clipboardBusy = false;
      updatePromptControls();
    }, 200);
  }

  async function copyPrompt() {
    if (!hasUsablePrompt() || clipboardBusy) return;
    const textToCopy = currentPrompt;
    const copyRevision = promptRevision;
    clipboardBusy = true;
    updatePromptControls();
    try {
      await writePromptToClipboard(textToCopy);
      measure('prompt_copied');
      if (copyRevision === promptRevision && !promptIsStale) {
        setStatus(elements.promptStatus, 'تم نسخ البرومبت. ألصقه في خدمة الذكاء الاصطناعي مع الملفات التي اخترت إرفاقها.', 'success');
      } else {
        setStatus(elements.promptStatus, 'تم نسخ النسخة الموجودة لحظة الضغط، لكن البرومبت تغيّر بعدها. انسخ النسخة الحالية مجددًا.', 'warning');
      }
    } catch (_error) {
      if (copyRevision !== promptRevision || promptIsStale) {
        setStatus(
          elements.promptStatus,
          promptIsStale
            ? 'تغيّرت الإعدادات أثناء محاولة النسخ وتعذر النسخ. أعد إنشاء البرومبت قبل المحاولة مجددًا.'
            : 'تغيّر البرومبت أثناء محاولة النسخ وتعذر نسخ النسخة السابقة. حاول نسخ النسخة الحالية مجددًا.',
          'warning',
        );
      } else {
        setStatus(elements.promptStatus, 'تعذر النسخ التلقائي. حُدّد النص الآن؛ استخدم Ctrl+C لنسخه يدويًا.', 'error');
        selectPromptForManualCopy();
      }
    } finally {
      releaseClipboardBusy();
    }
  }

  function copyAndOpenProvider(event) {
    const link = event.currentTarget;
    const provider = PROVIDERS[link.dataset.provider];
    if (!hasUsablePrompt() || clipboardBusy) {
      event.preventDefault();
      setStatus(
        elements.promptStatus,
        promptIsStale
          ? 'أعد إنشاء البرومبت بعد تغيير الإعدادات، ثم افتح الخدمة.'
          : 'أنشئ برومبت غير فارغ قبل فتح الخدمة.',
        'warning',
      );
      return;
    }
    const hasAllowedUrl = provider && link.href === new URL(provider.url).href;
    if (!hasAllowedUrl) {
      event.preventDefault();
      setStatus(elements.promptStatus, 'تعذر فتح الخدمة لأن رابطها غير معتمد.', 'error');
      return;
    }

    measure('provider_opened', { provider: link.dataset.provider });
    const textToCopy = currentPrompt;
    const copyRevision = promptRevision;
    clipboardBusy = true;
    elements.copyPrompt.disabled = true;
    elements.restorePrompt.disabled = true;
    elements.undoRestore.disabled = true;
    window.setTimeout(updatePromptControls, 0);
    setStatus(elements.promptStatus, `جارٍ نسخ البرومبت وفتح ${provider.name}…`, 'success');
    writePromptToClipboard(textToCopy)
      .then(() => {
        measure('prompt_copied');
        if (copyRevision === promptRevision && !promptIsStale) {
          setStatus(elements.promptStatus, `تم نسخ البرومبت. الصقه داخل ${provider.name} وراجعه قبل الإرسال.`, 'success');
        } else {
          setStatus(
            elements.promptStatus,
            `طُلب فتح ${provider.name}، لكن البرومبت تغيّر بعد الضغط. انسخ النسخة الحالية مجددًا قبل اللصق.`,
            'warning',
          );
        }
      })
      .catch(() => {
        if (copyRevision !== promptRevision || promptIsStale) {
          setStatus(
            elements.promptStatus,
            promptIsStale
              ? `طُلب فتح ${provider.name}، لكن تغيّرت الإعدادات وتعذر النسخ. أعد إنشاء البرومبت قبل المحاولة مجددًا.`
              : `طُلب فتح ${provider.name}، لكن البرومبت تغيّر وتعذر نسخ النسخة السابقة. انسخ النسخة الحالية مجددًا.`,
            'warning',
          );
        } else {
          setStatus(
            elements.promptStatus,
            `طُلب فتح ${provider.name}، لكن تعذر نسخ البرومبت. حُدد النص؛ استخدم Ctrl+C ثم الصقه يدويًا.`,
            'error',
          );
          selectPromptForManualCopy();
        }
      })
      .finally(() => {
        releaseClipboardBusy();
      });
  }

  function selectedFormat() {
    return document.querySelector('input[name="export-format"]:checked').value;
  }

  function formatHasPoints(format) {
    return format === 'native-bank' || format === 'native-test';
  }

  function updateExportActionLabel() {
    const format = selectedFormat();
    const pointsReady = pointsDraft && pointsDraft.source === elements.aiResponse.value;
    elements.exportResponse.textContent = formatHasPoints(format) && !pointsReady ? 'تدقيق ومراجعة النقاط' : 'تدقيق وتنزيل';
    elements.downloadReviewed.textContent = format === 'native-bank' ? 'تدقيق وتنزيل بنك Blackboard بالنقاط المحددة' : 'تدقيق وتنزيل اختبار المقرر';
  }

  function updateFormatNote() {
    const format = selectedFormat();
    const native = format === 'native-test';
    elements.nativeOptions.hidden = !native;
    elements.bankOptions.hidden = format !== 'native-bank';
    if (format === 'native-bank') {
      elements.formatNote.textContent = 'بنك Blackboard الأصلي: حزمة بنك مبنية على ملفك المرجعي، مع تعديل نقاط الأسئلة والاحتفاظ بأنواع الأداة العشرة. استوردها من بنوك الأسئلة وراجع النتيجة؛ لا تنشئ اختبارًا أو عمود درجات. هذه ليست حزمة QTI 2.1 القياسية.';
    } else if (format === 'native-test') {
      elements.formatNote.textContent = 'ينشئ حزمة اختبار مقرر أصلية مستقلة عن QTI 2.1: اختبارًا بلا بنك، ورابط محتوى غير متاح افتراضيًا، وعمود درجات مطابقًا للمجموع. استوردها من مسار استيراد حزمة المقرر.';
    } else {
      elements.formatNote.textContent = 'TXT يدعم الأنواع الأساسية الستة دون نقاط مخصصة. لبنك مع النقاط اختر بنك Blackboard الأصلي؛ ولإدراج اختبار مباشر اختر اختبار داخل المقرر.';
    }
    elements.promptFormatNote.textContent = format === 'native-bank'
      ? 'الهدف الحالي: بنك Blackboard الأصلي. تُراجع نقاط كل سؤال بعد لصق الرد وتدقيقه، دون تغيير أعداد الأنواع المطلوبة.'
      : 'اختر بنك Blackboard الأصلي لحفظ الأسئلة مع نقاطها في بنك، أو اختبار داخل المقرر لإنشاء اختبار مباشر. تبقى الحزمتان مستقلتين.';
    const hasCurrentPoints = pointsDraft && pointsDraft.source === elements.aiResponse.value;
    if (!formatHasPoints(format) && hasCurrentPoints) {
      elements.formatNote.textContent += ' تعديلات النقاط محفوظة في الجلسة، لكنها لا تدخل في TXT.';
    }
    const pointsPurpose = format === 'native-bank'
      ? 'تُحفظ نقاط كل سؤال في بيانات البنك وقواعد التصحيح، ويُحدّث مجموع البنك. هذه نقاط السؤال وليست نسب الإجابات؛ السؤال المقالي يبقى للتصحيح اليدوي.'
      : 'تُطبق هذه القيم على أسئلة اختبار Blackboard المباشر.';
    elements.pointsHelp.textContent = `${pointsPurpose} المسموح من 0.01 إلى 1000 وبحد أقصى خمس منازل عشرية؛ تُقبل الأرقام العربية وعلامة الفصل «٫».`;
    elements.pointsEditor.hidden = !(formatHasPoints(format) && hasCurrentPoints);
    updateExportActionLabel();
  }

  function renderIssues(errors, warnings, notes) {
    elements.issuesList.replaceChildren();
    const entries = [
      ...errors.map((issue) => ({ severity: 'error', issue })),
      ...warnings.map((issue) => ({ severity: 'warning', issue })),
      ...notes.map((note) => ({ severity: 'warning', issue: { line: note.line, message: `ملاحظة المراجعة: ${note.text}` } })),
    ];

    if (!entries.length) {
      elements.issuesPanel.hidden = true;
      elements.issuesPanel.classList.remove('error-state', 'warning-state');
      return;
    }

    entries.forEach(({ severity, issue }) => {
      const item = document.createElement('li');
      item.className = severity;
      const location = issue.line ? `السطر ${issue.line}: ` : '';
      item.textContent = `${location}${issue.message}`;
      elements.issuesList.appendChild(item);
    });
    elements.issuesPanel.hidden = false;
    elements.issuesPanel.classList.toggle('error-state', errors.length > 0);
    elements.issuesPanel.classList.toggle('warning-state', errors.length === 0 && warnings.length + notes.length > 0);
  }

  function renderStats(questions) {
    const mc = questions.filter((question) => question.type === 'MC').length;
    const tf = questions.filter((question) => question.type === 'TF').length;
    elements.statTotal.textContent = String(questions.length);
    elements.statMc.textContent = String(mc);
    elements.statTf.textContent = String(tf);
    elements.statOther.textContent = String(questions.length - mc - tf);
    elements.stats.hidden = questions.length === 0;
  }

  function renderPreview(questions) {
    elements.previewList.replaceChildren();
    questions.forEach((question, index) => {
      const item = document.createElement('li');
      item.className = 'preview-item';
      const badge = document.createElement('span');
      badge.className = 'type-badge';
      badge.textContent = `${index + 1} · ${question.type}`;
      const text = document.createElement('p');
      text.className = 'question-preview';
      text.dir = 'auto';
      text.textContent = question.question;
      item.append(badge, text);
      const details = document.createElement('div');
      details.className = 'preview-answers';
      const add = (label, value, correct = false) => {
        const row = document.createElement('p');
        row.className = correct ? 'preview-answer correct-answer' : 'preview-answer';
        const heading = document.createElement('strong');
        heading.textContent = `${label}: `;
        const content = document.createElement('span');
        content.dir = 'auto';
        content.textContent = String(value);
        row.append(heading, content);
        details.appendChild(row);
      };
      if (question.type === 'MC' || question.type === 'MA') {
        question.choices.forEach((choice, choiceIndex) => {
          const credit = question.partialCredit ? ` — ${choice.percent}% من نقاط السؤال` : '';
          const levels = { most_correct: 'الأكثر صحة', correct: 'صحيحة', least_correct: 'الأقل صحة' };
          const status = choice.correct ? (levels[choice.creditLevel] || 'إجابة صحيحة') : 'إجابة خاطئة';
          add(`الخيار ${choiceIndex + 1} — ${status}${credit}`, choice.text, choice.correct);
        });
        if (question.type === 'MA') {
          add('حد اختيار الطالب', question.selectionLimit);
          add('التصحيح', question.partialCredit ? 'رصيد جزئي حسب النسب الموضحة' : 'مجموعة الإجابات الصحيحة كاملة');
        }
      } else if (question.type === 'TF') {
        add('الخيارات', 'صواب / خطأ');
        add('الإجابة الصحيحة', question.answer ? 'صواب' : 'خطأ', true);
      } else if (question.type === 'ESS') {
        add('إجابة نموذجية للمراجعة', question.exampleAnswer || 'لم تُرفق إجابة نموذجية');
        add('التصحيح', 'يدوي وفق معايير يحددها المدرّب');
      } else if (question.type === 'FIB') {
        question.answers.forEach((answer) => add('إجابة مقبولة', answer, true));
      } else if (question.type === 'MAT') {
        question.pairs.forEach((pair, pairIndex) => add(`الزوج ${pairIndex + 1} — ${pair.prompt}`, pair.match, true));
        (question.distractors || []).forEach((answer) => add('إجابة خاطئة إضافية', answer));
      } else if (question.type === 'EO') {
        const pairs = { true_false: ['صواب', 'خطأ'], yes_no: ['نعم', 'لا'], correct_incorrect: ['صحيح', 'غير صحيح'], agree_disagree: ['أوافق', 'لا أوافق'] };
        const pair = pairs[question.pair];
        add('الخيارات', pair.join(' / '));
        add('الإجابة الصحيحة', pair[question.answer === 'first' ? 0 : 1], true);
      } else if (question.type === 'JUM') {
        question.slots.forEach((slot) => {
          add(`القائمة [[${slot.id}]] — الإجابة الصحيحة`, slot.answer, true);
          slot.distractors.forEach((answer) => add(`القائمة [[${slot.id}]] — إجابة خاطئة`, answer));
        });
      } else if (question.type === 'NUM' || question.type === 'CALC') {
        add('الإجابة الصحيحة', question.answer, true);
        add('هامش الخطأ', question.tolerance);
        if (question.type === 'CALC') {
          add('المعادلة الثابتة', question.formula);
          add('المنازل العشرية', question.decimals);
          add('حدود هذا النوع', 'قيم ثابتة؛ لا ينشئ مسائل بمتغيرات عشوائية');
        }
      }
      const points = document.createElement('p');
      points.className = 'preview-points field-help';
      points.dataset.previewPoints = String(index);
      points.dataset.originalPoints = String(question.points == null ? 1 : question.points);
      details.appendChild(points);
      item.appendChild(details);
      elements.previewList.appendChild(item);
    });
    syncPreviewPoints();
    document.getElementById('preview-count').textContent = `${questions.length} سؤالًا — جميع الأسئلة`;
    elements.previewSection.hidden = questions.length === 0;
  }

  function syncPreviewPoints() {
    all('[data-preview-points]', elements.previewList).forEach((row) => {
      const value = pointsDraft && pointsDraft.source === elements.aiResponse.value
        ? pointsDraft.values[Number(row.dataset.previewPoints)] : row.dataset.originalPoints;
      row.textContent = !formatHasPoints(selectedFormat()) ? 'TXT لا ينقل النقاط المخصصة؛ اضبطها داخل Blackboard.'
        : core.parsePointValue(value) === null ? 'النقاط غير صالحة؛ صححها في محرر النقاط.' : `نقاط السؤال: ${value}`;
    });
  }

  function clearPointsDraft() {
    pointsDraft = null;
    elements.pointsEditor.hidden = true;
    elements.pointsList.replaceChildren();
    elements.pointsTotal.value = '0';
    elements.pointsTotal.textContent = '0';
    elements.bulkPoints.removeAttribute('aria-invalid');
    setStatus(elements.pointsStatus, '', '');
    updateExportActionLabel();
  }

  function updatePointsTotal() {
    syncPreviewPoints();
    if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value) {
      elements.pointsTotal.value = '0';
      elements.pointsTotal.textContent = '0';
      return;
    }
    try {
      const edited = core.applyQuestionPoints(pointsDraft.baseQuestions, pointsDraft.values);
      const total = String(core.totalQuestionPoints(edited));
      elements.pointsTotal.value = total;
      elements.pointsTotal.textContent = total;
    } catch (_error) {
      elements.pointsTotal.value = '—';
      elements.pointsTotal.textContent = '—';
    }
  }

  function syncPointInputs() {
    if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value) return;
    all('.question-point', elements.pointsList).forEach((input, index) => {
      input.value = pointsDraft.values[index];
      input.removeAttribute('aria-invalid');
    });
    updatePointsTotal();
  }

  function renderPointsEditor() {
    elements.pointsList.replaceChildren();
    if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value) {
      elements.pointsEditor.hidden = true;
      return;
    }

    pointsDraft.baseQuestions.forEach((question, index) => {
      const row = document.createElement('tr');
      row.setAttribute('role', 'row');
      const numberCell = document.createElement('th');
      numberCell.scope = 'row';
      numberCell.setAttribute('role', 'rowheader');
      numberCell.dataset.label = 'السؤال';
      numberCell.textContent = String(index + 1);

      const typeCell = document.createElement('td');
      typeCell.setAttribute('role', 'cell');
      typeCell.dataset.label = 'النوع';
      typeCell.textContent = question.type;

      const textCell = document.createElement('td');
      textCell.setAttribute('role', 'cell');
      textCell.dir = 'auto';
      const questionText = String(question.question || '');
      textCell.textContent = questionText.length > 240 ? `${questionText.slice(0, 240)}…` : questionText;

      const pointsCell = document.createElement('td');
      pointsCell.setAttribute('role', 'cell');
      pointsCell.dataset.label = 'النقاط';
      const label = document.createElement('label');
      label.className = 'sr-only';
      label.htmlFor = `question-points-${index + 1}`;
      label.textContent = `نقاط السؤال ${index + 1} من النوع ${question.type}`;
      const input = document.createElement('input');
      input.id = `question-points-${index + 1}`;
      input.className = 'point-input question-point';
      input.type = 'text';
      input.inputMode = 'decimal';
      input.maxLength = 10;
      input.autocomplete = 'off';
      input.dir = 'ltr';
      input.value = pointsDraft.values[index];
      input.setAttribute('aria-describedby', 'points-help points-status');
      input.addEventListener('input', () => {
        if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value) return;
        pointsDraft.values[index] = input.value;
        input.removeAttribute('aria-invalid');
        updatePointsTotal();
        if (core.parsePointValue(input.value) === null) {
          setStatus(elements.pointsStatus, `قيمة نقاط السؤال ${index + 1} غير صالحة؛ صححها قبل التنزيل.`, 'warning');
        } else {
          setStatus(elements.pointsStatus, 'تغيّرت النقاط؛ سيعيد التطبيق تدقيقها قبل التنزيل.', 'warning');
        }
      });
      pointsCell.append(label, input);
      input.addEventListener('change', () => { if (core.parsePointValue(input.value) !== null) measurePoints(); });
      row.append(numberCell, pointsCell, typeCell, textCell);
      elements.pointsList.appendChild(row);
    });

    elements.pointsEditor.hidden = !formatHasPoints(selectedFormat());
    updatePointsTotal();
    updateExportActionLabel();
  }

  function ensurePointsDraft(questions) {
    if (pointsDraft && pointsDraft.source === elements.aiResponse.value && pointsDraft.values.length === questions.length) {
      elements.pointsEditor.hidden = false;
      updateExportActionLabel();
      return false;
    }
    const original = questions.map((question) => (question.points == null ? 1 : question.points));
    pointsDraft = {
      source: elements.aiResponse.value,
      baseQuestions: questions.map((question) => ({ ...question })),
      original,
      values: original.map(String),
    };
    renderPointsEditor();
    return true;
  }

  function applyPointsDraft(questions) {
    const errors = [];
    if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value || pointsDraft.values.length !== questions.length) {
      return {
        questions,
        errors: [{ line: 0, message: 'مسودة النقاط لا تطابق الرد الحالي. أعد التدقيق قبل التصدير.', code: 'points_stale' }],
      };
    }

    const inputs = all('.question-point', elements.pointsList);
    pointsDraft.values.forEach((value, index) => {
      const input = inputs[index];
      if (input) input.removeAttribute('aria-invalid');
      if (core.parsePointValue(value) === null) {
        if (input) input.setAttribute('aria-invalid', 'true');
        errors.push({
          line: questions[index] && questions[index].sourceLine ? questions[index].sourceLine : 0,
          message: `نقاط السؤال ${index + 1} يجب أن تكون من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.`,
          code: 'points_invalid',
        });
      }
    });
    if (errors.length) return { questions, errors };

    try {
      return { questions: core.applyQuestionPoints(questions, pointsDraft.values), errors };
    } catch (error) {
      const messages = error instanceof core.ValidationError ? error.messages : ['تعذر تطبيق نقاط الأسئلة.'];
      return {
        questions,
        errors: messages.map((message) => ({ line: 0, message, code: 'points_invalid' })),
      };
    }
  }

  function applyPointsToAll() {
    if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value) return;
    const value = core.parsePointValue(elements.bulkPoints.value);
    if (value === null) {
      elements.bulkPoints.setAttribute('aria-invalid', 'true');
      setStatus(elements.pointsStatus, 'القيمة الموحّدة يجب أن تكون من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.', 'error');
      elements.bulkPoints.focus();
      return;
    }
    elements.bulkPoints.removeAttribute('aria-invalid');
    pointsDraft.values = pointsDraft.values.map(() => String(value));
    measurePoints();
    syncPointInputs();
    setStatus(elements.pointsStatus, `طُبقت ${value} نقطة على ${pointsDraft.values.length} سؤالًا.`, 'success');
  }

  function resetQuestionPoints() {
    if (!pointsDraft || pointsDraft.source !== elements.aiResponse.value) return;
    pointsDraft.values = pointsDraft.original.map(String);
    measurePoints();
    syncPointInputs();
    setStatus(elements.pointsStatus, 'أُعيدت نقاط الرد الأصلية؛ وأسئلة Tab عادت إلى نقطة واحدة.', 'success');
  }

  function validateResponse() {
    elements.aiResponse.removeAttribute('aria-invalid');
    const parsed = core.parseAIResponse(elements.aiResponse.value);
    const format = selectedFormat();
    const supportsPoints = formatHasPoints(format);
    if (pointsDraft && pointsDraft.source !== elements.aiResponse.value) clearPointsDraft();
    let formatValidation = core.validateForFormat(parsed.questions, format);
    let exportQuestions = parsed.questions;
    let pointErrors = [];
    let pointsInitialized = false;
    if (supportsPoints && parsed.errors.length === 0 && formatValidation.errors.length === 0) {
      pointsInitialized = ensurePointsDraft(parsed.questions);
      const applied = applyPointsDraft(parsed.questions);
      exportQuestions = applied.questions;
      pointErrors = applied.errors;
      if (!pointErrors.length) formatValidation = core.validateForFormat(exportQuestions, format);
    } else {
      elements.pointsEditor.hidden = true;
    }
    const formatErrors = formatValidation.errors.map((message) => ({ line: 0, message, code: 'format_error' }));
    const formatWarnings = formatValidation.warnings.map((message) => ({ line: 0, message, code: 'format_warning' }));
    if (generatedBasePrompt && currentPrompt !== generatedBasePrompt) {
      formatWarnings.push({ line: 0, message: 'عُدّل البرومبت يدويًا؛ لذلك يعرض المدقّق الإحصاءات من دون مقارنة توزيع الأنواع وتفاصيل بنيتها تلقائيًا بإعدادات الحقول.', code: 'distribution_check_skipped' });
    }
    const titleControl = format === 'native-bank' ? elements.bankTitle : elements.nativeTitle;
    if (supportsPoints
      && (!titleControl.value.trim() || titleControl.value.trim().length > 200 || /[\u0000-\u001F\u007F]/.test(titleControl.value) || core.stripInvalidXmlCharacters(titleControl.value) !== titleControl.value)) {
      formatErrors.push({ line: 0, message: 'اسم البنك أو الاختبار مطلوب، وحده 200 حرف، ولا يقبل محارف تحكم.', code: 'native_title' });
    }
    const distributionErrors = [];
    if (requestedCounts && parsed.errors.length === 0) {
      const actualCounts = Object.fromEntries(core.TYPE_ORDER.map((type) => [type, 0]));
      parsed.questions.forEach((question) => { actualCounts[question.type] += 1; });
      core.TYPE_ORDER.forEach((type) => {
        if (actualCounts[type] !== requestedCounts[type]) {
          distributionErrors.push({
            line: 0,
            code: 'requested_distribution_mismatch',
            message: `${type}: طُلب ${requestedCounts[type]} ووصل ${actualCounts[type]}.`,
          });
        }
      });
    }
    const structureErrors = requestedQuestionSettings && parsed.errors.length === 0
      ? core.validateQuestionStructures(parsed.questions, requestedQuestionSettings)
      : [];
    const errors = [...parsed.errors, ...formatErrors, ...pointErrors, ...distributionErrors, ...structureErrors];
    const warnings = [...parsed.warnings, ...formatWarnings];

    renderIssues(errors, warnings, parsed.notes);
    renderStats(exportQuestions);
    renderPreview(exportQuestions);

    if (errors.length) {
      measure('validation_failed', { format, error: pointErrors.length ? 'points'
        : parsed.errors.some(issue => /duplicate/.test(issue.code)) ? 'duplicate'
        : parsed.errors.length ? 'syntax' : distributionErrors.length ? 'quota'
        : structureErrors.length || formatErrors.some(issue => issue.code === 'native_title') ? 'structure' : 'unsupported_format' });
      if (pointErrors.length) setStatus(elements.pointsStatus, pointErrors[0].message, 'error');
      const distributionOnly = distributionErrors.length > 0
        && parsed.errors.length === 0
        && formatErrors.length === 0
        && pointErrors.length === 0
        && structureErrors.length === 0;
      const requestSettingsOnly = structureErrors.length > 0
        && parsed.errors.length === 0
        && formatErrors.length === 0
        && pointErrors.length === 0
        && distributionErrors.length === 0;
      const formatOnly = formatErrors.length > 0
        && parsed.errors.length === 0 && pointErrors.length === 0
        && distributionErrors.length === 0 && structureErrors.length === 0
        && formatErrors.every((issue) => issue.code === 'format_error');
      setStatus(
        elements.exportStatus,
        formatOnly
          ? `تمت قراءة ${parsed.acceptedCount} سؤالًا بنجاح. التصدير متوقف لأن الصيغة المختارة لا تنقل بعض الأنواع أو إعدادات الإجابة؛ راجع التفاصيل أدناه. لم يُحذف أي سؤال.`
          : distributionOnly
          ? `توقف التصدير: السجلات ${parsed.acceptedCount} سليمة من حيث الصيغة، لكن أعداد أنواعها لا تطابق البرومبت. أعد توليد الرد بالبرومبت المحدث، وراجع فروق «طُلب/وصل» أدناه.`
          : (requestSettingsOnly
            ? `توقف التصدير: السجلات سليمة، لكن عدد الأزواج أو الخيارات أو المشتتات أو نسب الدرجات لا يطابق الإعدادات التي أنشأت البرومبت.`
            : `توقف التصدير: فُهم ${parsed.acceptedCount} من ${parsed.receivedCount} سجل مرشح، ووجد المدقّق ${errors.length} خطأ.`),
        'error',
      );
      if (formatOnly) {
        document.querySelector('input[name="export-format"]:checked').focus();
      } else if (parsed.errors.length > 0 || distributionErrors.length > 0 || structureErrors.length > 0 || formatErrors.some((issue) => issue.code !== 'native_title')) {
        elements.aiResponse.setAttribute('aria-invalid', 'true');
        elements.aiResponse.focus();
      } else if (formatErrors.some((issue) => issue.code === 'native_title')) {
        titleControl.setAttribute('aria-invalid', 'true');
        titleControl.focus();
      } else if (pointErrors.length) {
        const firstInvalid = elements.pointsList.querySelector('.question-point[aria-invalid="true"]');
        if (firstInvalid) firstInvalid.focus();
      }
      return { ok: false, parsed, questions: exportQuestions, format, warnings, pointsInitialized };
    }

    elements.nativeTitle.removeAttribute('aria-invalid');
    elements.bankTitle.removeAttribute('aria-invalid');

    const warningText = warnings.length || parsed.notes.length
      ? ` مع ${warnings.length + parsed.notes.length} تنبيه للمراجعة`
      : '';
    const pointsText = supportsPoints ? `، ومجموع النقاط: ${core.totalQuestionPoints(exportQuestions)}` : '';
    const reviewText = pointsInitialized ? ' راجع محرر نقاط الأسئلة قبل التنزيل.' : '';
    setStatus(elements.exportStatus, `نجح التدقيق. عدد الأسئلة الصالحة: ${exportQuestions.length}${pointsText}${warningText}.${reviewText}`, warnings.length || parsed.notes.length || supportsPoints ? 'warning' : 'success');
    measureQuestions('response_validated', exportQuestions, format);
    return { ok: true, parsed, questions: exportQuestions, format, warnings, pointsInitialized };
  }

  function fileDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  async function verifyNativeZip(blob, mode) {
    if (blob.size > 32 * 1024 * 1024) throw new core.ValidationError('حزمة Blackboard Native تتجاوز حد الأمان المحلي البالغ 32 MB.');
    const loaded = await window.JSZip.loadAsync(blob, { checkCRC32: true, createFolders: false });
    const entries = Object.values(loaded.files);
    const paths = entries.map((entry) => entry.name).sort();
    if (entries.some((entry) => entry.dir)) {
      throw new core.ValidationError('فشل فحص محتويات ZIP بعد إنشائها.');
    }
    const files = {};
    for (const path of paths) files[path] = await loaded.file(path).async('string');
    const report = core.validateNativeFiles(files, { mode });
    let fingerprint = '';
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      fingerprint = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
    }
    return { ...report, fingerprint };
  }

  function setExportControlsDisabled(disabled) {
    [
      elements.aiResponse,
      elements.nativeTitle,
      elements.bankTitle,
      elements.validateResponse,
      elements.exportResponse,
      elements.bulkPoints,
      elements.applyPointsAll,
      elements.resetPoints,
      elements.downloadReviewed,
      ...all('input[name="export-format"]'),
      ...all('.question-point', elements.pointsList),
    ].forEach((control) => { control.disabled = disabled; });
  }

  async function exportResponse() {
    const result = validateResponse();
    if (!result.ok) return;
    if (result.pointsInitialized) {
      setStatus(elements.exportStatus, 'ظهرت نقاط الأسئلة للمراجعة. عدّلها أو اتركها كما هي، ثم اضغط «تدقيق وتنزيل» مرة أخرى.', 'warning');
      elements.pointsTitle.focus();
      return;
    }

    setExportControlsDisabled(true);
    try {
      if (result.format === 'txt') {
        const output = core.buildTxt(result.questions);
        downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), `blackboard-questions-${fileDate()}.txt`);
        measureQuestions('export_created', result.questions, result.format);
        setStatus(elements.exportStatus, `تم تنزيل ملف TXT. عدد الأسئلة: ${result.questions.length}.`, 'success');
      } else {
        if (typeof window.JSZip !== 'function') {
          throw new core.ValidationError('تعذر تحميل مكتبة إنشاء ZIP المحلية. تأكد من وجود مجلد vendor كاملًا.');
        }
        const mode = result.format === 'native-bank' ? 'pool' : 'test';
        const processingMessage = mode === 'pool' ? 'جارٍ إنشاء بنك Blackboard الأصلي والتحقق من أسئلته ونقاطه…' : 'جارٍ إنشاء حزمة Blackboard Native تجريبية والتحقق منها قبل التنزيل…';
        setStatus(elements.exportStatus, processingMessage, 'warning');
        setStatus(elements.pointsStatus, processingMessage, 'warning');
        const packageData = core.buildNativeFiles(result.questions, {
          mode,
          title: mode === 'pool' ? elements.bankTitle.value : elements.nativeTitle.value,
          shuffleAnswers: elements.shuffleAnswers.checked,
        });
        const zip = new window.JSZip();
        Object.entries(packageData.files).forEach(([path, content]) => zip.file(path, content));
        const blob = await zip.generateAsync({
          type: 'blob',
          compression: 'STORE',
          platform: 'DOS',
        });
        const report = await verifyNativeZip(blob, mode);
        const label = mode === 'pool' ? 'بنك Blackboard الأصلي' : 'حزمة اختبار مرتبطة بالمقرر وغير متاحة للطلاب افتراضيًا';
        const filename = mode === 'pool' ? 'blackboard-question-bank' : 'blackboard-course-test';
        downloadBlob(blob, `${filename}-${fileDate()}.zip`);
        measureQuestions('export_created', result.questions, result.format);
        const fingerprint = report.fingerprint ? ` بصمة SHA-256 المختصرة: ${report.fingerprint}.` : '';
        const completionMessage = `تم تنزيل ${label}. الأسئلة: ${report.itemCount}، مجموع النقاط: ${report.totalPoints}.${fingerprint} ${mode === 'pool' ? 'استورده من بنوك الأسئلة وراجع النقاط بعد الاستيراد.' : 'اختبره في مقرر تجريبي أولًا.'}`;
        setStatus(elements.exportStatus, completionMessage, 'warning');
        setStatus(elements.pointsStatus, completionMessage, 'warning');
      }
    } catch (error) {
      const messages = error instanceof core.ValidationError ? error.messages : ['تعذر إنشاء الملف بسبب خطأ غير متوقع.'];
      measure('export_failed', { format: result.format, error: 'package' });
      setStatus(elements.exportStatus, messages.join(' '), 'error');
      if (formatHasPoints(result.format)) setStatus(elements.pointsStatus, messages.join(' '), 'error');
    } finally {
      setExportControlsDisabled(false);
    }
  }

  elements.simpleModeButton.addEventListener('click', () => {
    if (!advancedModeActive) return;
    setEditorMode(false);
    invalidatePrompt();
  });
  elements.advancedModeButton.addEventListener('click', () => {
    if (advancedModeActive) return;
    setEditorMode(true);
    invalidatePrompt();
  });
  all('.type-count, .mix-count, .matrix-cell').forEach((input) => input.addEventListener('input', () => { updateTotals(); invalidatePrompt(); }));
  elements.applySimpleCount.addEventListener('click', applySimpleCount);
  all('.matrix-fill-button').forEach((button) => button.addEventListener('click', () => applyMatrixColumn(button.dataset.level)));
  all('.structure-setting:not([type="checkbox"])').forEach((input) => input.addEventListener('input', () => {
    if (input === elements.maChoiceCount) {
      const correctChanged = syncMultipleAnswerLimits();
      if (correctChanged) renderCreditRows(core.smartCreditProfile(safeCorrectCount()));
    } else if (input === elements.maCorrectCount) {
      syncMultipleAnswerLimits();
      renderCreditRows(core.smartCreditProfile(safeCorrectCount()));
    }
    invalidatePrompt();
  }));
  elements.maPartialCredit.addEventListener('change', () => {
    updatePartialCreditUi();
    updateCreditSummary();
    invalidatePrompt();
  });
  elements.maSmartDistribute.addEventListener('click', () => {
    renderCreditRows(core.smartCreditProfile(safeCorrectCount()));
    invalidatePrompt();
  });
  const creditEditorChangeHandler = (event) => {
    if (!event.target.matches('.ma-credit-level, .ma-credit-percent')) return;
    updateCreditSummary();
    invalidatePrompt();
  };
  elements.maCreditRows.addEventListener('input', creditEditorChangeHandler);
  elements.maCreditRows.addEventListener('change', creditEditorChangeHandler);
  all('input[name="difficulty-mode"]').forEach((input) => input.addEventListener('change', () => { updateDifficultyUi(); invalidatePrompt(); }));
  elements.singleDifficulty.addEventListener('input', () => { updateDifficultyLabel(); invalidatePrompt(); });
  [elements.sourceContent, elements.additionalInstructions].forEach((input) => input.addEventListener('input', invalidatePrompt));
  elements.sourceContent.addEventListener('input', () => {
    elements.clearSource.disabled = elements.sourceContent.value.length === 0;
  });
  elements.clearSource.addEventListener('click', clearSource);
  elements.clearSource.disabled = elements.sourceContent.value.length === 0;
  [elements.hasAttachment, elements.shuffleQuestions, elements.shuffleAnswers, elements.includeReviewNotes].forEach((input) => input.addEventListener('change', invalidatePrompt));
  [elements.progressiveStart, elements.progressiveEnd].forEach((input) => input.addEventListener('change', invalidatePrompt));
  all('input[name="export-format"]').forEach((input) => input.addEventListener('change', () => {
    invalidatePrompt();
    updateFormatNote();
    if (elements.aiResponse.value.trim() && !elements.stats.hidden) validateResponse();
  }));
  elements.aiResponse.addEventListener('input', () => {
    elements.clearAiResponse.disabled = elements.aiResponse.value.length === 0;
    const discardedPoints = Boolean(pointsDraft);
    clearPointsDraft();
    renderIssues([], [], []);
    renderStats([]);
    renderPreview([]);
    updateFormatNote();
    setStatus(
      elements.exportStatus,
      discardedPoints ? 'تغيّر الرد، فأُلغيت مسودة النقاط السابقة. أعد التدقيق لإنشاء مسودة مطابقة.' : 'تغيّر الرد. أعد التدقيق قبل التصدير.',
      'warning',
    );
  });
  elements.bulkPoints.addEventListener('input', () => elements.bulkPoints.removeAttribute('aria-invalid'));
  elements.applyPointsAll.addEventListener('click', applyPointsToAll);
  elements.resetPoints.addEventListener('click', resetQuestionPoints);
  elements.downloadReviewed.addEventListener('click', exportResponse);
  elements.generatePrompt.addEventListener('click', generatePrompt);
  elements.copyPrompt.addEventListener('click', copyPrompt);
  elements.clearPrompt.addEventListener('click', clearPrompt);
  elements.restorePrompt.addEventListener('click', restorePrompt);
  elements.undoRestore.addEventListener('click', undoPromptRestore);
  elements.promptOutput.addEventListener('input', editPrompt);
  // Count committed edit sessions, not keystrokes; never inspect clipboard text.
  elements.promptOutput.addEventListener('change', () => measure('prompt_edited'));
  elements.promptOutput.addEventListener('input', event => {
    if (event.inputType === 'insertFromPaste') measure('prompt_pasted');
  });
  elements.aiResponse.addEventListener('input', event => {
    if (event.inputType === 'insertFromPaste') measure('response_pasted');
  });
  elements.clearAiResponse.addEventListener('click', clearAiResponse);
  elements.providerLinks.forEach((link) => {
    const provider = PROVIDERS[link.dataset.provider];
    if (!provider) {
      link.hidden = true;
      return;
    }
    link.href = provider.url;
    link.addEventListener('click', copyAndOpenProvider);
  });
  elements.validateResponse.addEventListener('click', validateResponse);
  elements.exportResponse.addEventListener('click', exportResponse);

  elements.appVersion.textContent = core.DISPLAY_VERSION;
  updatePromptControls();
  syncMultipleAnswerLimits();
  renderCreditRows(core.smartCreditProfile(safeCorrectCount()));
  updatePartialCreditUi();
  updateDifficultyLabel();
  updateDifficultyUi();
  updateFormatNote();
  updateTotals();
})();
