/* Editable question points and synchronized preview totals. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['points-editor'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {core, elements, state, all, document} = context;


  function syncPreviewPoints() {
    all('[data-preview-points]', elements.previewList).forEach((row) => {
      const value = state.pointsDraft && state.pointsDraft.source === elements.aiResponse.value
        ? state.pointsDraft.values[Number(row.dataset.previewPoints)] : row.dataset.originalPoints;
      row.textContent = !actions.formatHasPoints(actions.selectedFormat()) ? 'TXT لا ينقل النقاط المخصصة؛ اضبطها داخل Blackboard.'
        : core.parsePointValue(value) === null ? 'النقاط غير صالحة؛ صححها في محرر النقاط.' : `نقاط السؤال: ${value}`;
    });
  }

  function clearPointsDraft() {
    state.pointsDraft = null;
    elements.pointsEditor.hidden = true;
    elements.pointsList.replaceChildren();
    elements.pointsTotal.value = '0';
    elements.pointsTotal.textContent = '0';
    elements.bulkPoints.removeAttribute('aria-invalid');
    actions.setStatus(elements.pointsStatus, '', '');
    actions.updateExportActionLabel();
  }

  function updatePointsTotal() {
    syncPreviewPoints();
    if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value) {
      elements.pointsTotal.value = '0';
      elements.pointsTotal.textContent = '0';
      return;
    }
    try {
      const edited = core.applyQuestionPoints(state.pointsDraft.baseQuestions, state.pointsDraft.values);
      const total = String(core.totalQuestionPoints(edited));
      elements.pointsTotal.value = total;
      elements.pointsTotal.textContent = total;
    } catch (_error) {
      elements.pointsTotal.value = '—';
      elements.pointsTotal.textContent = '—';
    }
  }

  function syncPointInputs() {
    if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value) return;
    all('.question-point', elements.pointsList).forEach((input, index) => {
      input.value = state.pointsDraft.values[index];
      input.removeAttribute('aria-invalid');
    });
    updatePointsTotal();
  }

  function renderPointsEditor() {
    elements.pointsList.replaceChildren();
    if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value) {
      elements.pointsEditor.hidden = true;
      return;
    }

    state.pointsDraft.baseQuestions.forEach((question, index) => {
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
      input.value = state.pointsDraft.values[index];
      input.setAttribute('aria-describedby', 'points-help points-status');
      input.addEventListener('input', () => {
        if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value) return;
        state.pointsDraft.values[index] = input.value;
        input.removeAttribute('aria-invalid');
        updatePointsTotal();
        if (core.parsePointValue(input.value) === null) {
          actions.setStatus(elements.pointsStatus, `قيمة نقاط السؤال ${index + 1} غير صالحة؛ صححها قبل التنزيل.`, 'warning');
        } else {
          actions.setStatus(elements.pointsStatus, 'تغيّرت النقاط؛ سيعيد التطبيق تدقيقها قبل التنزيل.', 'warning');
        }
      });
      pointsCell.append(label, input);
      input.addEventListener('change', () => { if (core.parsePointValue(input.value) !== null) actions.measurePoints(); });
      row.append(numberCell, pointsCell, typeCell, textCell);
      elements.pointsList.appendChild(row);
    });

    elements.pointsEditor.hidden = !actions.formatHasPoints(actions.selectedFormat());
    updatePointsTotal();
    actions.updateExportActionLabel();
  }

  function ensurePointsDraft(questions) {
    if (state.pointsDraft && state.pointsDraft.source === elements.aiResponse.value && state.pointsDraft.values.length === questions.length) {
      elements.pointsEditor.hidden = false;
      actions.updateExportActionLabel();
      return false;
    }
    const original = questions.map((question) => (question.points == null ? 1 : question.points));
    state.pointsDraft = {
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
    if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value || state.pointsDraft.values.length !== questions.length) {
      return {
        questions,
        errors: [{ line: 0, message: 'مسودة النقاط لا تطابق الرد الحالي. أعد التدقيق قبل التصدير.', code: 'points_stale' }],
      };
    }

    const inputs = all('.question-point', elements.pointsList);
    state.pointsDraft.values.forEach((value, index) => {
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
      return { questions: core.applyQuestionPoints(questions, state.pointsDraft.values), errors };
    } catch (error) {
      const messages = error instanceof core.ValidationError ? error.messages : ['تعذر تطبيق نقاط الأسئلة.'];
      return {
        questions,
        errors: messages.map((message) => ({ line: 0, message, code: 'points_invalid' })),
      };
    }
  }

  function applyPointsToAll() {
    if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value) return;
    const value = core.parsePointValue(elements.bulkPoints.value);
    if (value === null) {
      elements.bulkPoints.setAttribute('aria-invalid', 'true');
      actions.setStatus(elements.pointsStatus, 'القيمة الموحّدة يجب أن تكون من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.', 'error');
      elements.bulkPoints.focus();
      return;
    }
    elements.bulkPoints.removeAttribute('aria-invalid');
    state.pointsDraft.values = state.pointsDraft.values.map(() => String(value));
    actions.measurePoints();
    syncPointInputs();
    actions.setStatus(elements.pointsStatus, `طُبقت ${value} نقطة على ${state.pointsDraft.values.length} سؤالًا.`, 'success');
  }

  function resetQuestionPoints() {
    if (!state.pointsDraft || state.pointsDraft.source !== elements.aiResponse.value) return;
    state.pointsDraft.values = state.pointsDraft.original.map(String);
    actions.measurePoints();
    syncPointInputs();
    actions.setStatus(elements.pointsStatus, 'أُعيدت نقاط الرد الأصلية؛ وأسئلة Tab عادت إلى نقطة واحدة.', 'success');
  }

  return Object.freeze({
    syncPreviewPoints,
    clearPointsDraft,
    updatePointsTotal,
    syncPointInputs,
    renderPointsEditor,
    ensurePointsDraft,
    applyPointsDraft,
    applyPointsToAll,
    resetQuestionPoints
  });
});
