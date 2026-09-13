(function () {
  'use strict';

  const core = window.BlackboardCore;
  if (!core) {
    const fallback = document.getElementById('export-status');
    if (fallback) {
      fallback.textContent = 'تعذر تحميل نواة التطبيق. تأكد من وجود ملف core.js بجانب الصفحة.';
      fallback.className = 'status error';
      fallback.setAttribute('role', 'alert');
    }
    return;
  }

  // Assemble controllers once. Top-level page events are wired here;
  // editors own the listeners on the dynamic fields they create.
  const modules = window.BBInterfaceModules;
  const context = modules.context.create({window, document, core});
  const {elements, state, all, byId, PROVIDERS} = context;
  const actions = {};
  const controllerNames = ["metrics","helpers","partial-credit","question-counts","prompt-editor","clipboard","response-review","points-editor","export-download"];
  for (const name of controllerNames) {
    const controller = modules[name].create(context, actions);
    for (const key of Object.keys(controller)) {
      if (Object.hasOwn(actions, key)) throw new Error('Duplicate UI action: ' + key);
      actions[key] = controller[key];
    }
  }
  Object.freeze(actions);

  elements.simpleModeButton.addEventListener('click', () => {
    if (!state.advancedModeActive) return;
    actions.setEditorMode(false);
    actions.invalidatePrompt();
  });
  elements.advancedModeButton.addEventListener('click', () => {
    if (state.advancedModeActive) return;
    actions.setEditorMode(true);
    actions.invalidatePrompt();
  });
  all('.type-count, .mix-count, .matrix-cell').forEach((input) => input.addEventListener('input', () => { actions.updateTotals(); actions.invalidatePrompt(); }));
  elements.applySimpleCount.addEventListener('click', actions.applySimpleCount);
  all('.bulk-type-choice').forEach((input) => input.addEventListener('change', () => {
    actions.setQuestionTypeSelected(input.value, input.checked);
    actions.refreshQuestionSelection();
  }));
  byId('bulk-types-all').addEventListener('click', () => {
    core.TYPE_ORDER.forEach((type) => actions.setQuestionTypeSelected(type, true));
    actions.refreshQuestionSelection();
  });
  byId('bulk-types-none').addEventListener('click', () => {
    core.TYPE_ORDER.forEach((type) => actions.setQuestionTypeSelected(type, false));
    actions.refreshQuestionSelection();
  });
  elements.sourcePages.addEventListener('input', actions.invalidatePrompt);
  [elements.questionLanguage, elements.pageNumbering].forEach((input) => input.addEventListener('change', actions.invalidatePrompt));
  all('.matrix-fill-button').forEach((button) => button.addEventListener('click', () => actions.applyMatrixColumn(button.dataset.level)));
  all('.structure-setting:not([type="checkbox"])').forEach((input) => input.addEventListener('input', () => {
    if (input === elements.maChoiceCount) {
      const correctChanged = actions.syncMultipleAnswerLimits();
      if (correctChanged) actions.renderCreditRows(core.smartCreditProfile(actions.safeCorrectCount()));
    } else if (input === elements.maCorrectCount) {
      actions.syncMultipleAnswerLimits();
      actions.renderCreditRows(core.smartCreditProfile(actions.safeCorrectCount()));
    }
    actions.invalidatePrompt();
  }));
  elements.maPartialCredit.addEventListener('change', () => {
    actions.updatePartialCreditUi();
    actions.updateCreditSummary();
    actions.invalidatePrompt();
  });
  elements.maSmartDistribute.addEventListener('click', () => {
    actions.renderCreditRows(core.smartCreditProfile(actions.safeCorrectCount()));
    actions.invalidatePrompt();
  });
  const creditEditorChangeHandler = (event) => {
    if (!event.target.matches('.ma-credit-level, .ma-credit-percent')) return;
    actions.updateCreditSummary();
    actions.invalidatePrompt();
  };
  elements.maCreditRows.addEventListener('input', creditEditorChangeHandler);
  elements.maCreditRows.addEventListener('change', creditEditorChangeHandler);
  all('input[name="difficulty-mode"]').forEach((input) => input.addEventListener('change', () => { actions.updateDifficultyUi(); actions.invalidatePrompt(); }));
  elements.singleDifficulty.addEventListener('input', () => { actions.updateDifficultyLabel(); actions.invalidatePrompt(); });
  [elements.sourceContent, elements.additionalInstructions].forEach((input) => input.addEventListener('input', actions.invalidatePrompt));
  elements.sourceContent.addEventListener('input', () => {
    elements.clearSource.disabled = elements.sourceContent.value.length === 0;
  });
  elements.clearSource.addEventListener('click', actions.clearSource);
  elements.clearSource.disabled = elements.sourceContent.value.length === 0;
  [elements.hasAttachment, elements.shuffleQuestions, elements.shuffleAnswers, elements.includeReviewNotes].forEach((input) => input.addEventListener('change', actions.invalidatePrompt));
  [elements.progressiveStart, elements.progressiveEnd].forEach((input) => input.addEventListener('change', actions.invalidatePrompt));
  all('input[name="export-format"]').forEach((input) => input.addEventListener('change', () => {
    actions.invalidatePrompt();
    actions.updateFormatNote();
    if (elements.aiResponse.value.trim() && !elements.stats.hidden) actions.validateResponse();
  }));
  elements.aiResponse.addEventListener('input', () => {
    elements.clearAiResponse.disabled = elements.aiResponse.value.length === 0;
    const discardedPoints = Boolean(state.pointsDraft);
    actions.clearPointsDraft();
    actions.renderIssues([], [], []);
    actions.renderStats([]);
    actions.renderPreview([]);
    actions.updateFormatNote();
    actions.setStatus(
      elements.exportStatus,
      discardedPoints ? 'تغيّر الرد، فأُلغيت مسودة النقاط السابقة. أعد التدقيق لإنشاء مسودة مطابقة.' : 'تغيّر الرد. أعد التدقيق قبل التصدير.',
      'warning',
    );
  });
  elements.bulkPoints.addEventListener('input', () => elements.bulkPoints.removeAttribute('aria-invalid'));
  elements.applyPointsAll.addEventListener('click', actions.applyPointsToAll);
  elements.resetPoints.addEventListener('click', actions.resetQuestionPoints);
  elements.downloadReviewed.addEventListener('click', actions.exportResponse);
  elements.generatePrompt.addEventListener('click', actions.generatePrompt);
  elements.modelAdviceClose.addEventListener('click', () => elements.modelAdvice.close());
  elements.modelAdvice.addEventListener('close', actions.rememberModelAdviceChoice);
  elements.copyPrompt.addEventListener('click', actions.copyPrompt);
  elements.clearPrompt.addEventListener('click', actions.clearPrompt);
  elements.restorePrompt.addEventListener('click', actions.restorePrompt);
  elements.undoRestore.addEventListener('click', actions.undoPromptRestore);
  elements.promptOutput.addEventListener('input', actions.editPrompt);
  elements.promptOutput.addEventListener('change', () => actions.measure('prompt_edited'));
  elements.promptOutput.addEventListener('input', event => {
    if (event.inputType === 'insertFromPaste') actions.measure('prompt_pasted');
  });
  elements.aiResponse.addEventListener('input', event => {
    if (event.inputType === 'insertFromPaste') actions.measure('response_pasted');
  });
  elements.clearAiResponse.addEventListener('click', actions.clearAiResponse);
  elements.providerLinks.forEach((link) => {
    const provider = PROVIDERS[link.dataset.provider];
    if (!provider) {
      link.hidden = true;
      return;
    }
    link.href = provider.url;
    link.addEventListener('click', actions.copyAndOpenProvider);
  });
  elements.validateResponse.addEventListener('click', actions.validateResponse);
  elements.exportResponse.addEventListener('click', actions.exportResponse);
  elements.appVersion.textContent = core.DISPLAY_VERSION;
  actions.updatePromptControls();
  actions.syncMultipleAnswerLimits();
  actions.renderCreditRows(core.smartCreditProfile(actions.safeCorrectCount()));
  actions.updatePartialCreditUi();
  actions.updateDifficultyLabel();
  actions.updateDifficultyUi();
  actions.updateFormatNote();
  actions.updateTotals();
})();
