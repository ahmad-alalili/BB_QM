/* Format notes, complete previews, error reports, and response auditing. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['response-review'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {core, elements, state, document} = context;


  function updateExportActionLabel() {
    const format = actions.selectedFormat();
    const pointsReady = state.pointsDraft && state.pointsDraft.source === elements.aiResponse.value;
    elements.exportResponse.textContent = actions.formatHasPoints(format) && !pointsReady ? 'تدقيق ومراجعة النقاط' : 'تدقيق وتنزيل';
    elements.downloadReviewed.textContent = format === 'native-bank' ? 'تدقيق وتنزيل بنك Blackboard بالنقاط المحددة' : 'تدقيق وتنزيل اختبار المقرر';
  }

  function updateFormatNote() {
    const format = actions.selectedFormat();
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
    const hasCurrentPoints = state.pointsDraft && state.pointsDraft.source === elements.aiResponse.value;
    if (!actions.formatHasPoints(format) && hasCurrentPoints) {
      elements.formatNote.textContent += ' تعديلات النقاط محفوظة في الجلسة، لكنها لا تدخل في TXT.';
    }
    const pointsPurpose = format === 'native-bank'
      ? 'تُحفظ نقاط كل سؤال في بيانات البنك وقواعد التصحيح، ويُحدّث مجموع البنك. هذه نقاط السؤال وليست نسب الإجابات؛ السؤال المقالي يبقى للتصحيح اليدوي.'
      : 'تُطبق هذه القيم على أسئلة اختبار Blackboard المباشر.';
    elements.pointsHelp.textContent = `${pointsPurpose} المسموح من 0.01 إلى 1000 وبحد أقصى خمس منازل عشرية؛ تُقبل الأرقام العربية وعلامة الفصل «٫».`;
    elements.pointsEditor.hidden = !(actions.formatHasPoints(format) && hasCurrentPoints);
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
    actions.syncPreviewPoints();
    document.getElementById('preview-count').textContent = `${questions.length} سؤالًا — جميع الأسئلة`;
    elements.previewSection.hidden = questions.length === 0;
  }

  function validateResponse() {
    elements.aiResponse.removeAttribute('aria-invalid');
    const parsed = core.parseAIResponse(elements.aiResponse.value);
    const format = actions.selectedFormat();
    const supportsPoints = actions.formatHasPoints(format);
    if (state.pointsDraft && state.pointsDraft.source !== elements.aiResponse.value) actions.clearPointsDraft();
    let formatValidation = core.validateForFormat(parsed.questions, format);
    let exportQuestions = parsed.questions;
    let pointErrors = [];
    let pointsInitialized = false;
    if (supportsPoints && parsed.errors.length === 0 && formatValidation.errors.length === 0) {
      pointsInitialized = actions.ensurePointsDraft(parsed.questions);
      const applied = actions.applyPointsDraft(parsed.questions);
      exportQuestions = applied.questions;
      pointErrors = applied.errors;
      if (!pointErrors.length) formatValidation = core.validateForFormat(exportQuestions, format);
    } else {
      elements.pointsEditor.hidden = true;
    }
    const formatErrors = formatValidation.errors.map((message) => ({ line: 0, message, code: 'format_error' }));
    const formatWarnings = formatValidation.warnings.map((message) => ({ line: 0, message, code: 'format_warning' }));
    if (state.generatedBasePrompt && state.currentPrompt !== state.generatedBasePrompt) {
      formatWarnings.push({ line: 0, message: 'عُدّل البرومبت يدويًا؛ لذلك يعرض المدقّق الإحصاءات من دون مقارنة توزيع الأنواع وتفاصيل بنيتها تلقائيًا بإعدادات الحقول.', code: 'distribution_check_skipped' });
    }
    const titleControl = format === 'native-bank' ? elements.bankTitle : elements.nativeTitle;
    if (supportsPoints
      && (!titleControl.value.trim() || titleControl.value.trim().length > 200 || /[\u0000-\u001F\u007F]/.test(titleControl.value) || core.stripInvalidXmlCharacters(titleControl.value) !== titleControl.value)) {
      formatErrors.push({ line: 0, message: 'اسم البنك أو الاختبار مطلوب، وحده 200 حرف، ولا يقبل محارف تحكم.', code: 'native_title' });
    }
    const distributionErrors = [];
    if (state.requestedCounts && parsed.errors.length === 0) {
      const actualCounts = Object.fromEntries(core.TYPE_ORDER.map((type) => [type, 0]));
      parsed.questions.forEach((question) => { actualCounts[question.type] += 1; });
      core.TYPE_ORDER.forEach((type) => {
        if (actualCounts[type] !== state.requestedCounts[type]) {
          distributionErrors.push({
            line: 0,
            code: 'requested_distribution_mismatch',
            message: `${type}: طُلب ${state.requestedCounts[type]} ووصل ${actualCounts[type]}.`,
          });
        }
      });
    }
    const structureErrors = state.requestedQuestionSettings && parsed.errors.length === 0
      ? core.validateQuestionStructures(parsed.questions, state.requestedQuestionSettings)
      : [];
    const errors = [...parsed.errors, ...formatErrors, ...pointErrors, ...distributionErrors, ...structureErrors];
    const warnings = [...parsed.warnings, ...formatWarnings];

    renderIssues(errors, warnings, parsed.notes);
    renderStats(exportQuestions);
    renderPreview(exportQuestions);

    if (errors.length) {
      actions.measure('validation_failed', { format, error: pointErrors.length ? 'points'
        : parsed.errors.some(issue => /duplicate/.test(issue.code)) ? 'duplicate'
        : parsed.errors.length ? 'syntax' : distributionErrors.length ? 'quota'
        : structureErrors.length || formatErrors.some(issue => issue.code === 'native_title') ? 'structure' : 'unsupported_format' });
      if (pointErrors.length) actions.setStatus(elements.pointsStatus, pointErrors[0].message, 'error');
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
      actions.setStatus(
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
    actions.setStatus(elements.exportStatus, `نجح التدقيق. عدد الأسئلة الصالحة: ${exportQuestions.length}${pointsText}${warningText}.${reviewText}`, warnings.length || parsed.notes.length || supportsPoints ? 'warning' : 'success');
    actions.measureQuestions('response_validated', exportQuestions, format);
    return { ok: true, parsed, questions: exportQuestions, format, warnings, pointsInitialized };
  }

  return Object.freeze({
    updateExportActionLabel,
    updateFormatNote,
    renderIssues,
    renderStats,
    renderPreview,
    validateResponse
  });
});
