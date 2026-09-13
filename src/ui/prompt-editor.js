/* Prompt generation, advice dialog, edits, clear, restore, and stale-request state. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['prompt-editor'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {core, elements, state, all, byId, PROVIDERS, window, document} = context;


  const MODEL_ADVICE_PREFERENCE = 'bb-qm:model-advice-dismissed:v1';

  function hasUsablePrompt() {
    return state.currentPrompt.trim().length > 0 && !state.promptIsStale;
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
    state.restoredDraft = null;
    elements.undoRestore.hidden = true;
  }

  function updatePromptControls() {
    const usable = hasUsablePrompt();
    elements.promptLength.textContent = `${state.currentPrompt.length.toLocaleString('ar')} حرف`;
    elements.copyPrompt.disabled = !usable || state.clipboardBusy;
    elements.clearPrompt.disabled = state.currentPrompt.length === 0 || state.clipboardBusy;
    elements.restorePrompt.disabled = !state.generatedBasePrompt
      || state.currentPrompt === state.generatedBasePrompt
      || state.clipboardBusy;
    elements.undoRestore.disabled = state.clipboardBusy;
    elements.promptOutput.classList.toggle('stale', state.promptIsStale);
    setProviderLinksEnabled(usable && !state.clipboardBusy);
  }

  function invalidatePrompt() {
    if (!state.generatedBasePrompt) return;
    const wasStale = state.promptIsStale;
    state.promptIsStale = true;
    state.promptRevision += 1;
    state.requestedCounts = state.currentPrompt === state.generatedBasePrompt && state.generatedRequestedCounts
      ? { ...state.generatedRequestedCounts }
      : null;
    state.requestedQuestionSettings = state.currentPrompt === state.generatedBasePrompt && state.generatedQuestionSettings
      ? actions.cloneQuestionSettings(state.generatedQuestionSettings)
      : null;
    clearRestoreUndo();
    updatePromptControls();
    if (wasStale) return;
    actions.setStatus(
      elements.promptStatus,
      'تغيّرت الإعدادات. احتُفظ بمسودة البرومبت، لكن يجب إنشاؤه مجددًا قبل النسخ أو فتح أي خدمة.',
      'warning',
    );
  }

  function collectCounts() {
    const counts = {};
    if (state.advancedModeActive) {
      core.TYPE_ORDER.forEach((type) => {
        counts[type] = all(`.matrix-cell[data-type="${type}"]`).reduce(
          (sum, input) => sum + actions.numericValue(input),
          0,
        );
      });
    } else {
      core.TYPE_ORDER.forEach((type) => { counts[type] = byId(`count-${type}`).value; });
    }
    return counts;
  }

  function collectDifficulty() {
    if (state.advancedModeActive) {
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
    const maCreditProfile = actions.creditRowsProfile();
    return {
      hasAttachment: elements.hasAttachment.checked,
      sourceContent: elements.sourceContent.value,
      additionalInstructions: elements.additionalInstructions.value,
      questionLanguage: elements.questionLanguage.value,
      sourcePages: elements.sourcePages.value,
      pageNumbering: elements.pageNumbering.value,
      counts: collectCounts(),
      targetFormat: actions.selectedFormat(),
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
    if (joined.includes('الصفحات المطلوبة')) return actions.markInvalid(elements.sourcePages);
    if (joined.includes('ترقيم الصفحات')) return actions.markInvalid(elements.pageNumbering);
    if (joined.includes('لغة الأسئلة')) return actions.markInvalid(elements.questionLanguage);
    if (!config.sourceContent.trim() && !config.hasAttachment) return actions.markInvalid(elements.sourceContent);
    if (joined.includes('التعليمات الإضافية')) return actions.markInvalid(elements.additionalInstructions);
    const activeInputs = state.advancedModeActive ? all('.matrix-cell') : all('.type-count');
    const invalidInput = activeInputs.find((input) => !input.checkValidity());
    if (invalidInput) return actions.markInvalid(invalidInput);
    if (config.difficulty.mode === 'mixed' && joined.includes('توزيع الصعوبة')) return actions.markInvalid(elements.mixedTotal);
    if (config.difficulty.mode === 'progressive' && joined.includes('التدرج')) return actions.markInvalid(elements.progressiveStart);
    if (joined.includes('أزواج المطابقة')) return actions.markInvalid(elements.matPairCount);
    if (joined.includes('الخاطئة في المطابقة') || joined.includes('أزواج المطابقة وإجاباتها')) return actions.markInvalid(elements.matDistractorCount);
    if (joined.includes('خيارات الإجابات المتعددة')) return actions.markInvalid(elements.maChoiceCount);
    if (joined.includes('الإجابات الصحيحة في MA')) return actions.markInvalid(elements.maCorrectCount);
    if (joined.includes('حد اختيار الطالب')) return actions.markInvalid(elements.maSelectionLimit);
    if (joined.includes('مستوى') || joined.includes('مستويات الصحة') || joined.includes('تصنيف') || joined.includes('الأكثر صحة') || joined.includes('الأقل صحة')) {
      return actions.markInvalid(elements.maCreditRows.querySelector('.ma-credit-level'));
    }
    if (joined.includes('نسب الرصيد الجزئي') || joined.includes('مجموع نسب')) {
      return actions.markInvalid(elements.maCreditRows.querySelector('.ma-credit-percent'));
    }
    if (joined.includes('قائمة منسدلة')) return actions.markInvalid(elements.jumDistractorCount);
    return actions.markInvalid(elements.questionTotal);
  }

  function showModelAdvice() {
    if (state.modelAdviceDismissed) return;
    try {
      if (window.localStorage.getItem(MODEL_ADVICE_PREFERENCE) === 'yes') return;
    } catch (_) { /* The reminder also works when browser storage is unavailable. */ }
    if (!elements.modelAdvice.open && typeof elements.modelAdvice.showModal === 'function') {
      elements.modelAdviceRemember.checked = false;
      elements.modelAdvice.showModal();
    }
  }

  function rememberModelAdviceChoice() {
    if (!elements.modelAdviceRemember.checked) return;
    state.modelAdviceDismissed = true;
    try {
      window.localStorage.setItem(MODEL_ADVICE_PREFERENCE, 'yes');
    } catch (_) { /* Keep the choice for this page even if it cannot be saved. */ }
  }

  function generatePrompt() {
    actions.clearInvalid();
    const config = collectPromptConfig();
    try {
      const nextPrompt = core.buildPrompt(config);
      state.generatedBasePrompt = nextPrompt;
      state.currentPrompt = nextPrompt;
      state.promptIsStale = false;
      state.promptRevision += 1;
      clearRestoreUndo();
      state.generatedRequestedCounts = Object.fromEntries(core.TYPE_ORDER.map((type) => [type, Number(config.counts[type] || 0)]));
      state.requestedCounts = { ...state.generatedRequestedCounts };
      state.generatedQuestionSettings = core.normalizePromptQuestionSettings(config.questionSettings);
      state.requestedQuestionSettings = actions.cloneQuestionSettings(state.generatedQuestionSettings);
      elements.promptOutput.value = state.currentPrompt;
      elements.promptOutput.readOnly = false;
      updatePromptControls();
      actions.measure('prompt_created', { counts: state.generatedRequestedCounts });
      actions.setStatus(
        elements.promptStatus,
        `تم إنشاء البرومبت. عدد الأسئلة المطلوبة: ${actions.currentTotal()}. يمكنك تعديله، ثم نسخه أو فتح الخدمة المطلوبة.`,
        'success',
      );
      showModelAdvice();
    } catch (error) {
      state.requestedCounts = state.currentPrompt === state.generatedBasePrompt && state.generatedRequestedCounts
        ? { ...state.generatedRequestedCounts }
        : null;
      state.requestedQuestionSettings = state.currentPrompt === state.generatedBasePrompt && state.generatedQuestionSettings
        ? actions.cloneQuestionSettings(state.generatedQuestionSettings)
        : null;
      if (state.generatedBasePrompt && !state.promptIsStale) state.promptRevision += 1;
      state.promptIsStale = Boolean(state.generatedBasePrompt);
      clearRestoreUndo();
      if (!state.generatedBasePrompt) {
        state.currentPrompt = '';
        elements.promptOutput.value = '';
        elements.promptOutput.readOnly = true;
      }
      updatePromptControls();
      const messages = error instanceof core.ValidationError ? error.messages : ['تعذر إنشاء البرومبت بسبب خطأ غير متوقع.'];
      actions.setStatus(elements.promptStatus, messages.join(' '), 'error');
      focusPromptError(config, messages);
    }
  }

  function editPrompt() {
    if (!state.generatedBasePrompt) return;
    const previousState = state.currentPrompt.length === 0
      ? 'empty'
      : (state.currentPrompt === state.generatedBasePrompt ? 'generated' : 'edited');
    state.currentPrompt = elements.promptOutput.value;
    state.requestedCounts = state.currentPrompt === state.generatedBasePrompt && state.generatedRequestedCounts
      ? { ...state.generatedRequestedCounts }
      : null;
    state.requestedQuestionSettings = state.currentPrompt === state.generatedBasePrompt && state.generatedQuestionSettings
      ? actions.cloneQuestionSettings(state.generatedQuestionSettings)
      : null;
    state.promptRevision += 1;
    clearRestoreUndo();
    updatePromptControls();

    if (state.promptIsStale) return;
    const nextState = state.currentPrompt.length === 0
      ? 'empty'
      : (state.currentPrompt === state.generatedBasePrompt ? 'generated' : 'edited');
    if (nextState === previousState) return;
    if (nextState === 'empty') {
      actions.setStatus(elements.promptStatus, 'البرومبت فارغ الآن. استخدم الاستعادة أو اكتب نصًا قبل النسخ.', 'warning');
    } else if (nextState === 'generated') {
      actions.setStatus(elements.promptStatus, 'النص يطابق آخر نسخة مولّدة.', 'success');
    } else {
      actions.setStatus(elements.promptStatus, 'تم تعديل البرومبت، وسيستخدم النسخ النص المعدّل. أُوقفت مقارنة توزيع الرد وبنية الأنواع تلقائيًا؛ راجع الإحصاءات قبل التنزيل.', 'warning');
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
    if (!state.currentPrompt || state.clipboardBusy) return;
    state.currentPrompt = '';
    state.requestedCounts = null;
    state.requestedQuestionSettings = null;
    state.restoredDraft = null;
    state.promptRevision += 1;
    elements.promptOutput.value = '';
    elements.promptOutput.readOnly = !state.generatedBasePrompt;
    elements.undoRestore.hidden = true;
    updatePromptControls();
    actions.setStatus(
      elements.promptStatus,
      state.generatedBasePrompt ? 'تم مسح البرومبت. يمكنك استعادة آخر نسخة مولّدة.' : 'تم مسح البرومبت.',
      'warning',
    );
  }

  function clearAiResponse() {
    if (!elements.aiResponse.value) return;
    elements.aiResponse.value = '';
    elements.clearAiResponse.disabled = true;
    actions.clearPointsDraft();
    actions.renderIssues([], [], []);
    actions.renderStats([]);
    actions.renderPreview([]);
    actions.updateFormatNote();
    actions.setStatus(elements.exportStatus, 'تم مسح رد الذكاء الاصطناعي.', 'warning');
    elements.aiResponse.focus();
  }

  function restorePrompt() {
    if (!state.generatedBasePrompt || state.currentPrompt === state.generatedBasePrompt || state.clipboardBusy) return;
    state.restoredDraft = state.currentPrompt;
    state.currentPrompt = state.generatedBasePrompt;
    state.requestedCounts = state.generatedRequestedCounts ? { ...state.generatedRequestedCounts } : null;
    state.requestedQuestionSettings = actions.cloneQuestionSettings(state.generatedQuestionSettings);
    state.promptRevision += 1;
    elements.promptOutput.value = state.currentPrompt;
    elements.undoRestore.hidden = false;
    updatePromptControls();
    actions.setStatus(
      elements.promptStatus,
      state.promptIsStale
        ? 'استُعيدت النسخة المولّدة، لكن الإعدادات تغيّرت؛ أعد إنشاء البرومبت قبل نسخه.'
        : 'استُعيدت آخر نسخة مولّدة. يمكنك التراجع عن الاستعادة.',
      state.promptIsStale ? 'warning' : 'success',
    );
  }

  function undoPromptRestore() {
    if (state.restoredDraft === null || state.clipboardBusy) return;
    state.currentPrompt = state.restoredDraft;
    state.requestedCounts = state.currentPrompt === state.generatedBasePrompt && state.generatedRequestedCounts
      ? { ...state.generatedRequestedCounts }
      : null;
    state.requestedQuestionSettings = state.currentPrompt === state.generatedBasePrompt && state.generatedQuestionSettings
      ? actions.cloneQuestionSettings(state.generatedQuestionSettings)
      : null;
    state.restoredDraft = null;
    state.promptRevision += 1;
    elements.promptOutput.value = state.currentPrompt;
    elements.undoRestore.hidden = true;
    updatePromptControls();
    actions.setStatus(
      elements.promptStatus,
      state.promptIsStale
        ? 'عادت مسودتك المعدّلة. ما زال يلزم إنشاء البرومبت مجددًا بعد تغيير الإعدادات.'
        : 'عادت مسودتك المعدّلة.',
      state.promptIsStale ? 'warning' : 'success',
    );
    elements.promptOutput.focus();
  }

  return Object.freeze({
    hasUsablePrompt,
    setProviderLinksEnabled,
    clearRestoreUndo,
    updatePromptControls,
    invalidatePrompt,
    collectCounts,
    collectDifficulty,
    collectPromptConfig,
    focusPromptError,
    showModelAdvice,
    rememberModelAdviceChoice,
    generatePrompt,
    editPrompt,
    clearSource,
    clearPrompt,
    clearAiResponse,
    restorePrompt,
    undoPromptRestore
  });
});
