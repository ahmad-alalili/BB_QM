/* Selected question types, totals, bulk counts, and difficulty modes. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['question-counts'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {core, elements, state, all, byId, document} = context;


  function updateSimpleTotal() {
    return all('.type-count').reduce((sum, input) => sum + Math.max(0, actions.numericValue(input)), 0);
  }

  function updateMatrixTotals() {
    let grandTotal = 0;
    core.TYPE_ORDER.forEach((type) => {
      const rowTotal = all(`.matrix-cell[data-type="${type}"]`).reduce(
        (sum, input) => sum + Math.max(0, actions.numericValue(input)),
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
    return state.advancedModeActive ? updateMatrixTotals() : updateSimpleTotal();
  }

  function nativeJsonlIsRequired() {
    return ['MA', 'EO', 'JUM', 'CALC'].some((type) => {
      if (state.advancedModeActive) return all(`.matrix-cell[data-type="${type}"]`).some((input) => actions.numericValue(input) > 0);
      return actions.numericValue(byId(`count-${type}`)) > 0;
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

    const mixed = all('.mix-count').reduce((sum, input) => sum + Math.max(0, actions.numericValue(input)), 0);
    elements.mixedTotal.value = String(mixed);
    elements.mixedTotal.textContent = `${mixed} من ${total}`;
    elements.mixedTotal.classList.toggle('mismatch', mixed !== total);
    updateReviewNotesAvailability();
  }

  function normalizedBulkCount(input) {
    const value = Math.trunc(actions.numericValue(input));
    const minimum = Number(input.min || 0);
    const maximum = Number(input.max || 25);
    return Math.max(minimum, Math.min(maximum, value));
  }

  function setQuestionTypeSelected(type, selected) {
    all('.bulk-type-choice').filter((peer) => peer.value === type).forEach((peer) => { peer.checked = selected; });
    all(`.type-count[data-type="${type}"], .matrix-cell[data-type="${type}"]`).forEach((input) => {
      const wasDisabled = input.disabled;
      input.disabled = !selected;
      if (!selected) {
        input.value = '';
        input.removeAttribute('aria-invalid');
      } else if (wasDisabled || input.value === '') {
        input.value = '0';
      }
    });
  }

  function refreshQuestionSelection() {
    updateMatrixTotals();
    updateTotals();
    actions.invalidatePrompt();
  }

  function applySimpleCount() {
    const selected = [...new Set(all('.bulk-type-choice:checked').map((input) => input.value))];
    if (!selected.length) {
      actions.setStatus(elements.promptStatus, 'حدد نوعًا واحدًا على الأقل لتطبيق العدد الموحّد.', 'warning');
      return;
    }
    const value = normalizedBulkCount(elements.simpleCountFill);
    elements.simpleCountFill.value = String(value);
    all('.type-count').filter((input) => selected.includes(input.dataset.type)).forEach((input) => { input.value = String(value); });
    updateTotals();
    actions.invalidatePrompt();
    actions.setStatus(elements.promptStatus, `طُبق العدد ${value} على ${selected.length} من الأنواع المحددة. أعد إنشاء البرومبت لتضمين التوزيع الجديد.`, 'success');
  }

  function applyMatrixColumn(level) {
    const selected = [...new Set(all('.bulk-type-choice:checked').map((input) => input.value))];
    if (!selected.length) {
      actions.setStatus(elements.promptStatus, 'حدد نوعًا واحدًا على الأقل لتطبيق العدد الموحّد.', 'warning');
      return;
    }
    const fill = document.querySelector(`.matrix-column-fill[data-level="${level}"]`);
    if (!fill) return;
    const value = normalizedBulkCount(fill);
    fill.value = String(value);
    all(`.matrix-cell[data-level="${level}"]`).filter((input) => selected.includes(input.dataset.type)).forEach((input) => { input.value = String(value); });
    updateTotals();
    actions.invalidatePrompt();
    actions.setStatus(elements.promptStatus, `طُبق العدد ${value} على ${selected.length} من الأنواع المحددة في عمود الصعوبة. أعد إنشاء البرومبت لتضمين التوزيع الجديد.`, 'success');
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
      target.value = target.disabled ? '' : (source.value || '0');
    });
  }

  function syncMatrixToSimple() {
    core.TYPE_ORDER.forEach((type) => {
      const total = all(`.matrix-cell[data-type="${type}"]`).reduce(
        (sum, input) => sum + Math.max(0, actions.numericValue(input)),
        0,
      );
      const target = byId(`count-${type}`);
      target.value = target.disabled ? '' : String(total);
    });
  }

  function setEditorMode(useAdvanced) {
    if (useAdvanced && !state.advancedModeActive) syncSimpleToMatrixIfEmpty();
    if (!useAdvanced && state.advancedModeActive) syncMatrixToSimple();
    state.advancedModeActive = useAdvanced;
    elements.simpleMode.hidden = useAdvanced;
    elements.advancedMode.hidden = !useAdvanced;
    elements.simpleModeButton.classList.toggle('active', !useAdvanced);
    elements.advancedModeButton.classList.toggle('active', useAdvanced);
    elements.simpleModeButton.setAttribute('aria-pressed', String(!useAdvanced));
    elements.advancedModeButton.setAttribute('aria-pressed', String(useAdvanced));
    updateTotals();
  }

  return Object.freeze({
    updateSimpleTotal,
    updateMatrixTotals,
    currentTotal,
    nativeJsonlIsRequired,
    updateReviewNotesAvailability,
    updateTotals,
    normalizedBulkCount,
    setQuestionTypeSelected,
    refreshQuestionSelection,
    applySimpleCount,
    applyMatrixColumn,
    updateDifficultyUi,
    updateDifficultyLabel,
    syncSimpleToMatrixIfEmpty,
    syncMatrixToSimple,
    setEditorMode
  });
});
