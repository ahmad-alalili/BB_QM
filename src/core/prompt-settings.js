/* Validate question counts, source-page options, and partial-credit settings. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'))
    : factory(modules['shared']);
  if (node) module.exports = api;
  if (root) modules['prompt-settings'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared) {
  'use strict';

  const { CREDIT_LEVELS, DEFAULT_QUESTION_SETTINGS, DIFFICULTY_BUCKETS, MAX_PER_INPUT, MAX_QUESTIONS, MAX_SOURCE_LENGTH, POINT_SCALE, QTI_SUPPORTED_TYPES, TYPE_LABELS, TYPE_ORDER, hasPointPrecision, normalizeArabicDigits, parseFiniteNumber, pointTicks } = shared;

  function protectPromptBoundary(value) {
    return String(value || '').replace(
      /<\s*\/?\s*(?:SOURCE_MATERIAL|USER_REQUIREMENTS)\b[^>]*>/gi,
      '[BOUNDARY_TAG_REMOVED]',
    );
  }

  function promptInteger(value, fallback) {
    if (value === '' || value == null) return fallback;
    const normalized = normalizeArabicDigits(value).trim();
    return /^\d+$/.test(normalized) ? Number(normalized) : NaN;
  }

  function promptPercentages(value, fallback) {
    if (value == null || value === '') return [...fallback];
    const entries = Array.isArray(value)
      ? value
      : String(value).split(/[،,;؛]/).map((entry) => entry.trim()).filter(Boolean);
    return entries.map((entry) => (typeof entry === 'number' ? entry : parseFiniteNumber(entry)));
  }

  function smartCreditProfile(value) {
    const count = Number(value);
    const safeCount = Number.isInteger(count) && count >= 1 && count <= 99 ? count : 1;
    if (safeCount === 1) return [{ level: 'correct', percent: 100 }];
    if (safeCount === 2) {
      return [
        { level: 'most_correct', percent: 75 },
        { level: 'least_correct', percent: 25 },
      ];
    }

    const weights = [15, ...Array.from({ length: safeCount - 2 }, () => 4), 1];
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const totalTicks = 100 * POINT_SCALE;
    let assignedTicks = 0;
    return weights.map((weight, index) => {
      const ticks = index === weights.length - 1
        ? totalTicks - assignedTicks
        : Math.floor((totalTicks * weight) / totalWeight);
      assignedTicks += ticks;
      return {
        level: index === 0 ? 'most_correct' : (index === weights.length - 1 ? 'least_correct' : 'correct'),
        percent: ticks / POINT_SCALE,
      };
    });
  }

  function promptCreditLevels(value, fallback) {
    if (!Array.isArray(value)) return [...fallback];
    return value.map((entry) => String(entry || '').trim());
  }

  function creditProfileError(levels, percentages, correctCount) {
    if (!Array.isArray(levels) || levels.length !== correctCount) {
      return 'عدد مستويات الصحة يجب أن يساوي عدد الإجابات الصحيحة في MA.';
    }
    if (levels.some((level) => !CREDIT_LEVELS.includes(level))) {
      return 'مستوى صحة الإجابة يجب أن يكون most_correct أو correct أو least_correct.';
    }
    if (correctCount === 1) {
      return levels[0] === 'correct' ? '' : 'عند وجود إجابة صحيحة واحدة يجب تصنيفها صحيحة.';
    }

    const mostIndexes = levels.map((level, index) => (level === 'most_correct' ? index : -1)).filter((index) => index >= 0);
    const leastIndexes = levels.map((level, index) => (level === 'least_correct' ? index : -1)).filter((index) => index >= 0);
    const correctIndexes = levels.map((level, index) => (level === 'correct' ? index : -1)).filter((index) => index >= 0);
    if (mostIndexes.length !== 1 || leastIndexes.length !== 1 || correctIndexes.length !== correctCount - 2) {
      return 'اختر إجابة واحدة «الأكثر صحة» وواحدة «الأقل صحة»، وصنّف بقية الإجابات «صحيحة».';
    }
    if (!Array.isArray(percentages) || percentages.length !== correctCount || percentages.some((percent) => !Number.isFinite(percent))) return '';
    const mostTicks = pointTicks(percentages[mostIndexes[0]]);
    const leastTicks = pointTicks(percentages[leastIndexes[0]]);
    const middleTicks = correctIndexes.map((index) => pointTicks(percentages[index]));
    if (mostTicks <= leastTicks || middleTicks.some((ticks) => mostTicks <= ticks || ticks <= leastTicks)) {
      return 'يجب أن تكون نسبة «الأكثر صحة» هي الأعلى، ونسبة «الأقل صحة» هي الأدنى.';
    }
    return '';
  }

  function normalizePromptQuestionSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const matching = source.matching && typeof source.matching === 'object' && !Array.isArray(source.matching) ? source.matching : {};
    const multipleAnswer = source.multipleAnswer && typeof source.multipleAnswer === 'object' && !Array.isArray(source.multipleAnswer) ? source.multipleAnswer : {};
    const jumbled = source.jumbled && typeof source.jumbled === 'object' && !Array.isArray(source.jumbled) ? source.jumbled : {};
    const correctCount = promptInteger(multipleAnswer.correctCount, DEFAULT_QUESTION_SETTINGS.multipleAnswer.correctCount);
    const smartProfile = smartCreditProfile(correctCount);
    return {
      matching: {
        pairCount: promptInteger(matching.pairCount, DEFAULT_QUESTION_SETTINGS.matching.pairCount),
        distractorCount: promptInteger(matching.distractorCount, DEFAULT_QUESTION_SETTINGS.matching.distractorCount),
      },
      multipleAnswer: {
        choiceCount: promptInteger(multipleAnswer.choiceCount, DEFAULT_QUESTION_SETTINGS.multipleAnswer.choiceCount),
        correctCount,
        selectionLimit: promptInteger(multipleAnswer.selectionLimit, correctCount),
        partialCredit: Boolean(multipleAnswer.partialCredit),
        creditLevels: promptCreditLevels(multipleAnswer.creditLevels, smartProfile.map((entry) => entry.level)),
        percentages: promptPercentages(multipleAnswer.percentages, smartProfile.map((entry) => entry.percent)),
      },
      jumbled: {
        distractorCount: promptInteger(jumbled.distractorCount, DEFAULT_QUESTION_SETTINGS.jumbled.distractorCount),
      },
    };
  }

  function normalizedSourcePages(value) {
    const text = String(value == null ? '' : value).trim()
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/،/g, ',').replace(/[–—]/g, '-');
    if (!text) return '';
    if (text.length > 500) return null;
    const ranges = text.split(',').map((part) => part.trim());
    const normalized = [];
    for (const range of ranges) {
      const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(range);
      if (!match) return null;
      const start = Number(match[1]);
      const end = match[2] == null ? start : Number(match[2]);
      if (start < 1 || end < start) return null;
      normalized.push(start === end ? String(start) : `${start}-${end}`);
    }
    return normalized.join(', ');
  }

  function validatePromptConfig(config) {
    const errors = [];
    const counts = config && config.counts ? config.counts : {};
    const difficulty = (config && config.difficulty) || { mode: 'single', level: 3 };
    const questionSettings = normalizePromptQuestionSettings(config && config.questionSettings);
    const maxPerType = difficulty.mode === 'advanced' ? MAX_QUESTIONS : MAX_PER_INPUT;
    let total = 0;

    TYPE_ORDER.forEach((type) => {
      const count = counts[type] === '' || counts[type] == null ? 0 : Number(counts[type]);
      if (!Number.isInteger(count) || count < 0 || count > maxPerType) {
        errors.push(`عدد أسئلة ${TYPE_LABELS[type]} يجب أن يكون عددًا صحيحًا بين 0 و${maxPerType}.`);
      } else {
        total += count;
      }
    });

    if (total < 1) errors.push('حدّد سؤالًا واحدًا على الأقل.');
    if (total > MAX_QUESTIONS) errors.push(`لا يمكن تجاوز ${MAX_QUESTIONS} سؤالًا في دفعة واحدة.`);

    if (config && config.targetFormat === 'qti') {
      const unsupported = TYPE_ORDER.filter((type) => Number(counts[type]) > 0 && !QTI_SUPPORTED_TYPES.includes(type));
      if (unsupported.length) {
        errors.push(`اخترت بنك QTI 2.1، لكن الطلب يتضمن أنواعًا غير متوافقة: ${unsupported.join('، ')}. اجعل عددها صفرًا لإنشاء بنك QTI، أو اختر اختبار Blackboard المباشر للاحتفاظ بجميع الأنواع.`);
      }
      if (Number(counts.MA) > 0 && questionSettings.multipleAnswer.partialCredit) {
        errors.push('بنك QTI يدعم MA من دون نسب متفاوتة. ألغِ تحديد نسبة لكل إجابة لإنشاء بنك QTI، أو اختر اختبار Blackboard المباشر للحفاظ على نسب الرصيد الجزئي.');
      }
    }

    if (Number(counts.MAT || 0) > 0) {
      const { pairCount, distractorCount } = questionSettings.matching;
      if (!Number.isInteger(pairCount) || pairCount < 2 || pairCount > 100) {
        errors.push('عدد أزواج المطابقة يجب أن يكون عددًا صحيحًا بين 2 و100.');
      }
      if (!Number.isInteger(distractorCount) || distractorCount < 0 || distractorCount > 98) {
        errors.push('عدد الإجابات الخاطئة في المطابقة يجب أن يكون عددًا صحيحًا بين 0 و98.');
      } else if (Number.isInteger(pairCount) && pairCount + distractorCount > 100) {
        errors.push('مجموع أزواج المطابقة وإجاباتها الخاطئة لا يمكن أن يتجاوز 100 خيار.');
      }
    }

    if (Number(counts.MA || 0) > 0) {
      const settings = questionSettings.multipleAnswer;
      if (!Number.isInteger(settings.choiceCount) || settings.choiceCount < 2 || settings.choiceCount > 100) {
        errors.push('عدد خيارات الإجابات المتعددة يجب أن يكون عددًا صحيحًا بين 2 و100.');
      }
      if (!Number.isInteger(settings.correctCount) || settings.correctCount < 1 || settings.correctCount >= settings.choiceCount) {
        errors.push('عدد الإجابات الصحيحة في MA يجب أن يكون من 1 إلى أقل من عدد الخيارات.');
      }
      if (!Number.isInteger(settings.selectionLimit) || settings.selectionLimit !== settings.correctCount) {
        errors.push('حد اختيار الطالب في MA يجب أن يساوي عدد الإجابات الصحيحة.');
      }
      if (settings.partialCredit) {
        if (settings.percentages.length !== settings.correctCount) {
          errors.push('عدد نسب الرصيد الجزئي يجب أن يساوي عدد الإجابات الصحيحة في MA.');
        } else if (settings.percentages.some((percent) => typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100 || !hasPointPrecision(percent))) {
          errors.push('نسب الرصيد الجزئي يجب أن تكون أرقامًا موجبة حتى 100 وبحد أقصى 5 منازل عشرية.');
        } else if (pointTicks(settings.percentages.reduce((sum, percent) => sum + percent, 0)) !== pointTicks(100)) {
          errors.push('مجموع نسب الإجابات الصحيحة في MA يجب أن يساوي 100%.');
        } else {
          const profileError = creditProfileError(settings.creditLevels, settings.percentages, settings.correctCount);
          if (profileError) errors.push(profileError);
        }
      }
    }

    if (Number(counts.JUM || 0) > 0) {
      const { distractorCount } = questionSettings.jumbled;
      if (!Number.isInteger(distractorCount) || distractorCount < 1 || distractorCount > 99) {
        errors.push('عدد الإجابات الخاطئة لكل قائمة منسدلة يجب أن يكون عددًا صحيحًا بين 1 و99.');
      }
    }

    const sourceContent = String((config && config.sourceContent) || '').trim();
    const additionalInstructions = String((config && config.additionalInstructions) || '').trim();
    const hasAttachment = Boolean(config && config.hasAttachment);
    if (!['ar', 'en', 'source'].includes((config && config.questionLanguage) || 'ar')) {
      errors.push('اختر لغة الأسئلة من الخيارات المتاحة.');
    }
    if (!['file', 'book'].includes((config && config.pageNumbering) || 'file')) {
      errors.push('اختر طريقة ترقيم الصفحات من الخيارات المتاحة.');
    }
    if (normalizedSourcePages(config && config.sourcePages) === null) {
      errors.push('الصفحات المطلوبة غير صالحة. استخدم أرقامًا موجبة ونطاقًا تصاعديًا مثل 3, 7, 10-15، وبحد أقصى 500 حرف.');
    }

    if (!sourceContent && !hasAttachment) {
      errors.push('ألصق المادة الدراسية أو فعّل خيار وجود ملف مرفق.');
    }
    if (sourceContent.length > MAX_SOURCE_LENGTH) {
      errors.push(`المادة الدراسية أطول من الحد المسموح (${MAX_SOURCE_LENGTH.toLocaleString('en-US')} حرف).`);
    }
    if (additionalInstructions.length > 10000) {
      errors.push('التعليمات الإضافية طويلة جدًا؛ اختصرها إلى أقل من 10,000 حرف.');
    }

    if (difficulty.mode === 'single') {
      if (!Number.isInteger(Number(difficulty.level)) || Number(difficulty.level) < 1 || Number(difficulty.level) > 5) {
        errors.push('اختر مستوى صعوبة صحيحًا من 1 إلى 5.');
      }
    } else if (difficulty.mode === 'mixed') {
      const mixIsObject = difficulty.mix && typeof difficulty.mix === 'object' && !Array.isArray(difficulty.mix);
      const mix = mixIsObject ? difficulty.mix : {};
      if (!mixIsObject) errors.push('توزيع الصعوبة المختلط يجب أن يكون كائنًا صالحًا.');
      const unknownMixKeys = Object.keys(mix).filter((key) => !DIFFICULTY_BUCKETS.includes(key));
      if (unknownMixKeys.length) errors.push(`توزيع الصعوبة المختلط يحتوي مستويات غير معروفة: ${unknownMixKeys.join('، ')}.`);
      const mixTotal = DIFFICULTY_BUCKETS.reduce((sum, key) => {
        const value = Number(mix[key] || 0);
        if (!Number.isInteger(value) || value < 0 || value > MAX_PER_INPUT) {
          errors.push(`قيم توزيع الصعوبة يجب أن تكون أعدادًا صحيحة بين 0 و${MAX_PER_INPUT}.`);
        }
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      if (mixTotal !== total) errors.push(`مجموع توزيع الصعوبة (${mixTotal}) يجب أن يساوي مجموع الأسئلة (${total}).`);
    } else if (difficulty.mode === 'progressive') {
      const start = Number(difficulty.start);
      const end = Number(difficulty.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 5) {
        errors.push('حدود التدرج في الصعوبة غير صحيحة.');
      } else if (start > end) {
        errors.push('بداية التدرج يجب ألا تكون أصعب من نهايته.');
      }
    } else if (difficulty.mode === 'advanced') {
      const matrixIsObject = difficulty.matrix && typeof difficulty.matrix === 'object' && !Array.isArray(difficulty.matrix);
      const matrix = matrixIsObject ? difficulty.matrix : {};
      if (!matrixIsObject) errors.push('مصفوفة النوع × الصعوبة يجب أن تكون كائنًا صالحًا.');
      const unknownTypeKeys = Object.keys(matrix).filter((key) => !TYPE_ORDER.includes(key));
      if (unknownTypeKeys.length) errors.push(`مصفوفة الصعوبة تحتوي أنواعًا غير معروفة: ${unknownTypeKeys.join('، ')}.`);
      let matrixTotal = 0;
      TYPE_ORDER.forEach((type) => {
        const rowIsObject = matrix[type] == null || (typeof matrix[type] === 'object' && !Array.isArray(matrix[type]));
        const row = rowIsObject && matrix[type] ? matrix[type] : {};
        if (!rowIsObject) errors.push(`صف مصفوفة ${TYPE_LABELS[type]} يجب أن يكون كائنًا صالحًا.`);
        const unknownLevelKeys = Object.keys(row).filter((key) => !DIFFICULTY_BUCKETS.includes(key));
        if (unknownLevelKeys.length) errors.push(`صف ${TYPE_LABELS[type]} يحتوي مستويات غير معروفة: ${unknownLevelKeys.join('، ')}.`);
        DIFFICULTY_BUCKETS.forEach((level) => {
          const value = Number(row[level] || 0);
          if (!Number.isInteger(value) || value < 0 || value > MAX_PER_INPUT) {
            errors.push(`قيمة ${TYPE_LABELS[type]} × ${level} يجب أن تكون بين 0 و${MAX_PER_INPUT}.`);
          } else {
            matrixTotal += value;
          }
        });
      });
      if (matrixTotal !== total) errors.push('إجمالي المصفوفة لا يطابق إجمالي أنواع الأسئلة.');
    } else {
      errors.push('نمط الصعوبة غير معروف.');
    }

    return { errors: [...new Set(errors)], total, questionSettings };
  }

  return Object.freeze({
    protectPromptBoundary,
    promptInteger,
    promptPercentages,
    smartCreditProfile,
    promptCreditLevels,
    creditProfileError,
    normalizePromptQuestionSettings,
    normalizedSourcePages,
    validatePromptConfig
  });
});
