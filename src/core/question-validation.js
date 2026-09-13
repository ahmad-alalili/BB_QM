/* Validate normalized questions, requested structures, and export compatibility. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./arithmetic.js'), require('./prompt-settings.js'), require('./question-text.js'), require('./question-json.js'))
    : factory(modules['shared'], modules['arithmetic'], modules['prompt-settings'], modules['question-text'], modules['question-json']);
  if (node) module.exports = api;
  if (root) modules['question-validation'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, arithmetic, promptSettings, questionText, questionJson) {
  'use strict';

  const { CREDIT_LEVEL_LABELS, LEGACY_TSV_TYPES, MAX_QUESTIONS, NATIVE_SUPPORTED_TYPES, QTI_SUPPORTED_TYPES, TYPE_ORDER, ValidationError, hasPointPrecision, isStableDecimal, pointTicks, validPoints } = shared;
  const { parseArithmeticFormula } = arithmetic;
  const { creditProfileError, normalizePromptQuestionSettings } = promptSettings;
  const { createIssue, normalizedUniqueValue } = questionText;
  const { hasInvalidText, inspectJumbledMarkers, markerCount } = questionJson;

  function validateStructuredQuestion(question) {
    const errors = [];
    if (!question || typeof question !== 'object') return ['بيانات السؤال ليست كائنًا صالحًا.'];
    if (!TYPE_ORDER.includes(question.type)) return [`نوع السؤال ${question.type || '(فارغ)'} غير مدعوم.`];
    if (hasInvalidText(question.question, 20000)) errors.push('نص السؤال فارغ أو يتجاوز الحد أو يحتوي Unicode غير صالح.');
    if (question.points != null && !validPoints(question.points)) errors.push('درجة السؤال يجب أن تكون رقمًا من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.');

    if (question.type === 'MC' || question.type === 'MA') {
      if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 100) {
        errors.push(`${question.type} يحتاج من خيارين إلى 100 خيار.`);
      } else {
        if (question.choices.some((choice) => !choice || hasInvalidText(choice.text, 4000) || typeof choice.correct !== 'boolean')) {
          errors.push(`${question.type} يحتوي على خيار غير صالح.`);
        }
        const correctCount = question.choices.filter((choice) => choice && choice.correct === true).length;
        if (question.type === 'MC' && correctCount !== 1) {
          errors.push('MC يجب أن يحتوي على إجابة صحيحة واحدة فقط.');
        }
        if (question.type === 'MA' && (correctCount < 1 || correctCount === question.choices.length)) {
          errors.push('MA يحتاج إجابة صحيحة واحدة على الأقل وخيارًا خاطئًا واحدًا على الأقل.');
        }
        if (question.type === 'MA' && question.selectionLimit != null && (!Number.isInteger(question.selectionLimit) || question.selectionLimit !== correctCount)) {
          errors.push('حد اختيارات MA يجب أن يساوي عدد الإجابات الصحيحة.');
        }
        if (question.type === 'MA') {
          const partialCredit = question.partialCredit === true;
          if (question.partialCredit != null && typeof question.partialCredit !== 'boolean') errors.push('partialCredit في MA يجب أن يكون true أو false.');
          if (partialCredit) {
            const invalidPercent = question.choices.some((choice) => !choice || typeof choice.percent !== 'number' || !Number.isFinite(choice.percent) || choice.percent < 0 || choice.percent > 100 || !hasPointPrecision(choice.percent));
            if (invalidPercent) errors.push('نسب خيارات MA يجب أن تكون من 0 إلى 100 وبحد أقصى 5 منازل عشرية.');
            else {
              if (question.choices.some((choice) => choice.correct ? choice.percent <= 0 : choice.percent !== 0)) errors.push('نسب الإجابات الصحيحة في MA يجب أن تكون موجبة، ونسب الخاطئة 0.');
              const correctChoices = question.choices.filter((choice) => choice.correct);
              const correctPercent = correctChoices.reduce((sum, choice) => sum + choice.percent, 0);
              if (pointTicks(correctPercent) !== pointTicks(100)) errors.push('مجموع نسب الإجابات الصحيحة في MA يجب أن يساوي 100%.');
              const specifiedLevels = correctChoices.filter((choice) => choice && Object.prototype.hasOwnProperty.call(choice, 'creditLevel'));
              if (question.choices.some((choice) => choice && !choice.correct && Object.prototype.hasOwnProperty.call(choice, 'creditLevel'))) {
                errors.push('creditLevel مسموح للإجابات الصحيحة فقط.');
              } else if (specifiedLevels.length > 0 && specifiedLevels.length !== correctChoices.length) {
                errors.push('عند استخدام creditLevel يجب إضافته إلى كل الإجابات الصحيحة.');
              } else if (specifiedLevels.length === correctChoices.length) {
                const profileError = creditProfileError(
                  correctChoices.map((choice) => choice.creditLevel),
                  correctChoices.map((choice) => choice.percent),
                  correctChoices.length,
                );
                if (profileError) errors.push(profileError);
              }
            }
          } else if (question.choices.some((choice) => choice && (Object.prototype.hasOwnProperty.call(choice, 'percent') || Object.prototype.hasOwnProperty.call(choice, 'creditLevel')))) {
            errors.push('لا يجوز وجود percent أو creditLevel في MA من دون partialCredit=true.');
          }
        }
        const values = question.choices.map((choice) => normalizedUniqueValue(choice && choice.text));
        if (new Set(values).size !== values.length) errors.push(`خيارات ${question.type} يجب ألا تكون مكررة.`);
      }
    } else if (question.type === 'TF') {
      if (typeof question.answer !== 'boolean') errors.push('إجابة TF يجب أن تكون قيمة منطقية true أو false.');
    } else if (question.type === 'ESS') {
      if (question.exampleAnswer != null && question.exampleAnswer !== '' && hasInvalidText(question.exampleAnswer, 20000)) errors.push('الإجابة النموذجية في ESS غير صالحة.');
      if (question.rows != null && (!Number.isInteger(question.rows) || question.rows < 1 || question.rows > 20)) errors.push('عدد صفوف ESS يجب أن يكون من 1 إلى 20.');
    } else if (question.type === 'FIB') {
      if (!Array.isArray(question.answers) || question.answers.length < 1 || question.answers.length > 100) {
        errors.push('FIB يحتاج من إجابة واحدة إلى 100 إجابة.');
      } else {
        if (question.answers.some((answer) => hasInvalidText(answer, 4000))) errors.push('FIB يحتوي على إجابة فارغة أو غير صالحة.');
        const values = question.answers.map(normalizedUniqueValue);
        if (new Set(values).size !== values.length) errors.push('إجابات FIB البديلة يجب ألا تكون مكررة.');
      }
      if ((String(question.question || '').match(/_{4,}/g) || []).some((run) => run.length !== 4)) errors.push('علامة FIB يجب أن تكون أربع شرطات سفلية مستقلة بالضبط.');
    } else if (question.type === 'NUM') {
      if (!Number.isFinite(question.answer)) errors.push('إجابة NUM ليست رقمًا منتهيًا صالحًا.');
      if (!Number.isFinite(question.tolerance) || question.tolerance < 0) errors.push('هامش خطأ NUM يجب أن يكون رقمًا غير سالب.');
      if (Number.isFinite(question.answer) && Number.isFinite(question.tolerance)
        && (!Number.isFinite(question.answer - question.tolerance) || !Number.isFinite(question.answer + question.tolerance))) errors.push('نطاق NUM الناتج من الإجابة ± الهامش غير منتهٍ.');
      if (Number.isFinite(question.answer) && Number.isFinite(question.tolerance)
        && (!isStableDecimal(question.answer, 12) || !isStableDecimal(question.tolerance, 12)
          || !isStableDecimal(question.answer - question.tolerance, 12) || !isStableDecimal(question.answer + question.tolerance, 12))) errors.push('قيم NUM ونطاقها تتجاوز دقة 12 منزلة عشرية أو تحتاج صيغة أسية.');
    } else if (question.type === 'MAT') {
      if (!Array.isArray(question.pairs) || question.pairs.length < 2 || question.pairs.length > 100) {
        errors.push('MAT يحتاج من زوجين إلى 100 زوج.');
      } else {
        if (question.pairs.some((pair) => !pair || hasInvalidText(pair.prompt, 4000) || hasInvalidText(pair.match, 4000))) {
          errors.push('MAT يحتوي على زوج فارغ أو غير صالح.');
        }
        const prompts = question.pairs.map((pair) => normalizedUniqueValue(pair && pair.prompt));
        const matches = question.pairs.map((pair) => normalizedUniqueValue(pair && pair.match));
        if (new Set(prompts).size !== prompts.length || new Set(matches).size !== matches.length) {
          errors.push('MAT يجب أن يستخدم مطالبات وإجابات فريدة بعلاقة واحد إلى واحد.');
        }
        const distractors = question.distractors == null ? [] : question.distractors;
        if (!Array.isArray(distractors) || distractors.length > 98 || distractors.some((text) => hasInvalidText(text, 4000))) {
          errors.push('إجابات MAT الخاطئة يجب أن تكون مصفوفة صالحة من 0 إلى 98 عنصرًا.');
        } else if (question.pairs.length + distractors.length > 100) {
          errors.push('مجموع أزواج MAT وإجاباتها الخاطئة لا يمكن أن يتجاوز 100 خيار.');
        } else {
          const answers = [...matches, ...distractors.map(normalizedUniqueValue)];
          if (new Set(answers).size !== answers.length) errors.push('إجابات MAT الصحيحة والخاطئة يجب ألا تكون مكررة.');
        }
      }
    } else if (question.type === 'EO') {
      if (!['true_false', 'yes_no', 'correct_incorrect', 'agree_disagree'].includes(question.pair)) errors.push('زوج EO غير معروف.');
      if (!['first', 'second'].includes(question.answer)) errors.push('إجابة EO يجب أن تكون first أو second.');
    } else if (question.type === 'JUM') {
      if (!Array.isArray(question.slots) || question.slots.length < 1 || question.slots.length > 100) {
        errors.push('JUM يحتاج من خانة واحدة إلى 100 خانة.');
      } else {
        const ids = new Set();
        question.slots.forEach((slot) => {
          if (!slot || typeof slot.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(slot.id) || ids.has(slot.id)) errors.push('JUM يحتوي معرّف خانة غير صالح أو مكرر.');
          else ids.add(slot.id);
          if (!slot || hasInvalidText(slot.answer, 4000) || !Array.isArray(slot.distractors) || slot.distractors.length < 1 || slot.distractors.length > 99 || slot.distractors.some((text) => hasInvalidText(text, 4000))) errors.push('JUM يحتوي إجابة أو مشتتات غير صالحة.');
          else {
            const values = [slot.answer, ...slot.distractors].map(normalizedUniqueValue);
            if (new Set(values).size !== values.length) errors.push('إجابة JUM ومشتتاتها يجب ألا تكون مكررة.');
          }
          if (slot && typeof slot.id === 'string' && markerCount(question.question, `[[${slot.id}]]`) !== 1) errors.push(`علامة JUM [[${slot.id}]] يجب أن تظهر مرة واحدة.`);
        });
        const markerInspection = inspectJumbledMarkers(question.question);
        if (!markerInspection.valid || markerInspection.ids.length !== question.slots.length || markerInspection.ids.some((id) => !ids.has(id))) errors.push('علامات JUM غير مكتملة أو لا تطابق الخانات.');
      }
    } else if (question.type === 'CALC') {
      if (typeof question.formula !== 'string' || !question.formula.trim()) errors.push('صيغة CALC فارغة.');
      else {
        try {
          const parsed = parseArithmeticFormula(question.formula);
          const decimals = question.decimals == null ? 2 : question.decimals;
          const tolerance = question.tolerance == null ? 0 : question.tolerance;
          if (Number.isFinite(question.answer) && Number.isFinite(tolerance) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 10) {
            const serializedFormulaAnswer = Number(parsed.value.toFixed(decimals));
            const serializedGivenAnswer = Number(question.answer.toFixed(decimals));
            const comparisonSlack = Number.EPSILON * Math.max(1, Math.abs(serializedFormulaAnswer), Math.abs(serializedGivenAnswer));
            if (!Number.isFinite(serializedGivenAnswer) || Math.abs(question.answer - serializedGivenAnswer) > comparisonSlack) errors.push('إجابة CALC تحتوي منازل عشرية أكثر من إعداد decimals.');
            else if (!Number.isFinite(serializedFormulaAnswer)
              || Math.abs(serializedFormulaAnswer - serializedGivenAnswer) > tolerance + comparisonSlack) errors.push('ناتج صيغة CALC بعد التقريب لا يطابق الإجابة المتسلسلة.');
          }
        } catch (error) {
          errors.push(error instanceof ValidationError ? error.messages[0] : 'صيغة CALC غير صالحة.');
        }
      }
      if (!Number.isFinite(question.answer)) errors.push('إجابة CALC ليست رقمًا منتهيًا صالحًا.');
      if (!Number.isFinite(question.tolerance) || question.tolerance < 0) errors.push('هامش CALC يجب أن يكون رقمًا غير سالب.');
      else if (!isStableDecimal(question.tolerance, 12)) errors.push('هامش CALC يتجاوز دقة 12 منزلة عشرية أو يحتاج صيغة أسية.');
      if (!Number.isInteger(question.decimals) || question.decimals < 0 || question.decimals > 10) errors.push('منازل CALC العشرية يجب أن تكون من 0 إلى 10.');
    }
    return [...new Set(errors)];
  }

  function validateQuestionStructures(questions, requestedSettings) {
    if (!Array.isArray(questions)) return [createIssue(0, 'بيانات الأسئلة ليست مصفوفة صالحة لفحص البنية.', 'requested_structure_mismatch')];
    const settings = normalizePromptQuestionSettings(requestedSettings);
    const issues = [];
    questions.forEach((question, index) => {
      const line = question && question.sourceLine ? question.sourceLine : 0;
      const number = index + 1;
      if (!question || typeof question !== 'object') return;
      if (question.type === 'MAT') {
        const pairCount = Array.isArray(question.pairs) ? question.pairs.length : 0;
        const distractorCount = Array.isArray(question.distractors) ? question.distractors.length : 0;
        if (pairCount !== settings.matching.pairCount || distractorCount !== settings.matching.distractorCount) {
          issues.push(createIssue(line, `السؤال ${number} (MAT): المطلوب ${settings.matching.pairCount} أزواج و${settings.matching.distractorCount} إجابات خاطئة، ووصل ${pairCount} و${distractorCount}.`, 'requested_structure_mismatch'));
        }
      } else if (question.type === 'MA') {
        const choices = Array.isArray(question.choices) ? question.choices : [];
        const correct = choices.filter((choice) => choice && choice.correct === true);
        const actualLimit = question.selectionLimit == null ? correct.length : question.selectionLimit;
        if (choices.length !== settings.multipleAnswer.choiceCount
          || correct.length !== settings.multipleAnswer.correctCount
          || actualLimit !== settings.multipleAnswer.selectionLimit) {
          issues.push(createIssue(line, `السؤال ${number} (MA): المطلوب ${settings.multipleAnswer.choiceCount} خيارات، منها ${settings.multipleAnswer.correctCount} صحيحة، وحد اختيار ${settings.multipleAnswer.selectionLimit}.`, 'requested_structure_mismatch'));
        }
        if (Boolean(question.partialCredit) !== settings.multipleAnswer.partialCredit) {
          issues.push(createIssue(line, `السؤال ${number} (MA): إعداد الرصيد الجزئي لا يطابق خيار المستخدم.`, 'requested_structure_mismatch'));
        } else if (settings.multipleAnswer.partialCredit) {
          const actualPercentages = correct.map((choice) => choice.percent);
          const actualLevels = correct.map((choice) => choice.creditLevel);
          const percentagesMatch = actualPercentages.length === settings.multipleAnswer.percentages.length
            && actualPercentages.every((percent, percentIndex) => pointTicks(percent) === pointTicks(settings.multipleAnswer.percentages[percentIndex]));
          const levelsMatch = actualLevels.length === settings.multipleAnswer.creditLevels.length
            && actualLevels.every((level, levelIndex) => level === settings.multipleAnswer.creditLevels[levelIndex]);
          if (!percentagesMatch || !levelsMatch) {
            const requestedProfile = settings.multipleAnswer.creditLevels
              .map((level, profileIndex) => `${CREDIT_LEVEL_LABELS[level] || level} ${settings.multipleAnswer.percentages[profileIndex]}%`)
              .join('، ');
            issues.push(createIssue(line, `السؤال ${number} (MA): مستويات ونسب الإجابات الصحيحة يجب أن تكون ${requestedProfile} بالترتيب.`, 'requested_structure_mismatch'));
          }
        }
      } else if (question.type === 'JUM' && Array.isArray(question.slots)) {
        question.slots.forEach((slot, slotIndex) => {
          const actual = slot && Array.isArray(slot.distractors) ? slot.distractors.length : 0;
          if (actual !== settings.jumbled.distractorCount) {
            issues.push(createIssue(line, `السؤال ${number} (JUM)، القائمة ${slotIndex + 1}: المطلوب ${settings.jumbled.distractorCount} إجابات خاطئة ووصل ${actual}.`, 'requested_structure_mismatch'));
          }
        });
      }
    });
    return issues;
  }

  function validateForFormat(questions, format) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(questions)) return { errors: ['بيانات الأسئلة ليست مصفوفة صالحة للتصدير.'], warnings };
    if (!questions.length) errors.push('لا توجد أسئلة للتصدير.');
    if (questions.length > MAX_QUESTIONS) errors.push(`لا يمكن تصدير أكثر من ${MAX_QUESTIONS} سؤالًا دفعة واحدة.`);
    questions.forEach((question, index) => {
      validateStructuredQuestion(question).forEach((message) => errors.push(`السؤال ${index + 1}: ${message}`));
    });

    if (format === 'qti') {
      const unsupported = [...new Set((questions || []).filter((question) => !question || !QTI_SUPPORTED_TYPES.includes(question.type)).map((question) => (question && question.type) || '(فارغ)'))];
      if (unsupported.length) {
        const txtCompatible = questions.every((question) => question && LEGACY_TSV_TYPES.includes(question.type)
          && !(question.type === 'MAT' && Array.isArray(question.distractors) && question.distractors.length > 0));
        const alternative = txtCompatible
          ? 'يمكن نقل هذه الدفعة عبر TXT لرفع الأسئلة داخل اختبار، أو عبر اختبار Blackboard المباشر.'
          : 'لن ينقل TXT هذه الدفعة كاملة. للاحتفاظ بالأنواع جميعها اختر «Blackboard Native — اختبار داخل المقرر»؛ هذا ينشئ اختبارًا مباشرًا، وليس بنك QTI.';
        errors.push(`الأنواع ${unsupported.join('، ')} غير مدعومة في مسار استيراد بنك QTI في Blackboard. ${alternative}`);
      }
      if (questions.some((question) => question && question.type === 'MA' && question.partialCredit === true)) {
        errors.push('نسب MA المتفاوتة لا تُنقل بأمان عبر مستورد QTI في Blackboard. اختر اختبار Blackboard المباشر للحفاظ عليها، أو أعد توليد السؤال من دون نسب جزئية إذا أردت بنك QTI.');
      }
      const multiAnswerFib = (questions || []).filter((question) => question && question.type === 'FIB' && Array.isArray(question.answers) && question.answers.length !== 1);
      if (multiAnswerFib.length) errors.push(`يوجد ${multiAnswerFib.length} سؤال FIB بإجابات بديلة. مُصدّر QTI في الأداة يقبل إجابة واحدة لكل فراغ حاليًا؛ أعد توليد سؤال بإجابة واحدة لبنك QTI، أو احتفظ بالبدائل عبر اختبار Blackboard المباشر. يدعم TXT بدائل FIB إذا كانت بقية الأنواع متوافقة معه.`);
      const multipleMarkers = (questions || []).filter((question) => question && question.type === 'FIB' && typeof question.question === 'string' && (question.question.match(/____/g) || []).length > 1);
      if (multipleMarkers.length) errors.push('مُصدّر QTI في الأداة يدعم موضع فراغ واحدًا لكل سؤال FIB. قسّم السؤال إلى أسئلة مستقلة لكل فراغ.');
      if ((questions || []).some((question) => question && question.type === 'TF')) {
        warnings.push('قد يستورد Blackboard أسئلة صح/خطأ كاختيار من متعدد مع بقاء النص والإجابة محفوظين.');
      }
      if (questions.some((question) => question && question.type === 'MA' && question.partialCredit !== true)) {
        warnings.push('يُصدّر MA إلى بنك QTI بجميع الإجابات الصحيحة وبتصحيح المجموعة كاملة. راجع حد اختيار الطالب بعد الاستيراد؛ قد تختلف إعدادات Blackboard عن إعدادات الحزمة.');
      }
      warnings.push('تُكتب نقاط الأسئلة في MAXSCORE وقواعد التصحيح داخل QTI. تحقّق من النقاط بعد الاستيراد إلى Blackboard؛ قد يعيد المستورد ضبطها. السؤال المقالي يبقى للتصحيح اليدوي.');
    } else if (format === 'txt') {
      const unsupported = [...new Set((questions || []).filter((question) => !question || !LEGACY_TSV_TYPES.includes(question.type)).map((question) => (question && question.type) || '(فارغ)'))];
      if (unsupported.length) errors.push(`TXT لا يدعم الأنواع التالية: ${unsupported.join('، ')}. استخدم إحدى صيغ Blackboard Native.`);
      if ((questions || []).some((question) => question && question.type === 'MAT' && Array.isArray(question.distractors) && question.distractors.length > 0)) {
        errors.push('TXT لا ينقل الإجابات الخاطئة الإضافية في سؤال MAT؛ استخدم اختبار Blackboard المباشر.');
      }
    } else if (format === 'native-bank' || format === 'native-test') {
      const unsupported = [...new Set((questions || []).filter((question) => !question || !NATIVE_SUPPORTED_TYPES.includes(question.type)).map((question) => (question && question.type) || '(فارغ)'))];
      if (unsupported.length) errors.push(`Blackboard Native لا يدعم الأنواع التالية في هذه الأداة: ${unsupported.join('، ')}.`);
      const invalidFibs = (questions || []).filter((question) => question && question.type === 'FIB' && typeof question.question === 'string' && (question.question.match(/____/g) || []).length > 1);
      if (invalidFibs.length) errors.push('Blackboard Native يدعم موضع فراغ واحد فقط لكل سؤال FIB في هذه النسخة.');
      const ambiguousFibAnswers = questions.filter((question) => question && question.type === 'FIB' && Array.isArray(question.answers) && question.answers.some((answer) => String(answer).includes('؛')));
      if (ambiguousFibAnswers.length) errors.push('إجابات FIB في Native لا يمكن أن تحتوي الفاصلة المنقوطة العربية «؛» لأنها فاصل الإجابات في صيغة Blackboard.');
      warnings.push(format === 'native-test'
        ? 'حزمة اختبار المقرر تجريبية؛ تُنشئ رابط محتوى غير متاح افتراضيًا وعمود درجات، ويجب استيرادها أولًا في مقرر تجريبي عبر مسار استيراد حزمة المقرر.'
        : 'حزمة بنك الأسئلة الأصلية تجريبية ويجب اختبارها أولًا في مقرر تجريبي.');
      if (format === 'native-test' && (questions || []).some((question) => question && question.type === 'MA' && question.partialCredit !== true)) {
        warnings.push('أسئلة MA غير الموزونة تُصحح وفق مجموعة الإجابات الصحيحة كاملة. عند تفعيل partialCredit ينقل الاختبار المباشر حد الاختيار ونسب كل إجابة.');
      }
      if ((questions || []).some((question) => question && question.type === 'EO' && question.pair !== 'true_false')) {
        warnings.push('أزواج EO غير true_false مبنية على معرفات Blackboard المستنتجة من واجهة النوع وتحتاج تحققًا داخل بيئة المؤسسة.');
      }
    } else {
      errors.push('صيغة التصدير غير معروفة.');
    }

    return { errors, warnings };
  }

  return Object.freeze({
    validateStructuredQuestion,
    validateQuestionStructures,
    validateForFormat
  });
});
