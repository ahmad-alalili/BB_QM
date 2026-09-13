/* Assemble the separate bank/test packages and run the final structural audit. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./question-validation.js'), require('./native-serialization.js'), require('./native-validation.js'))
    : factory(modules['shared'], modules['question-validation'], modules['native-serialization'], modules['native-validation']);
  if (node) module.exports = api;
  if (root) modules['native-package'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, questionValidation, nativeSerialization, nativeValidation) {
  'use strict';

  const { MAX_NATIVE_INTERACTIONS, MAX_NATIVE_XML_BYTES, NATIVE_TEST_TEMPLATE, ValidationError, stripInvalidXmlCharacters, totalQuestionPoints } = shared;
  const { validateForFormat } = questionValidation;
  const { buildNativeAssessment, buildNativeCourseAssessment, buildNativeCourseLink, buildNativeCourseToc, buildNativeCreationSettings, buildNativeGradebook, buildNativeManifest, buildNativePackageInfo, buildNativeTestContent, buildNativeTopContent, createNativeIdAllocator, createNativeResponseIdAllocator, nativeTimestamp, secureNativeSeed } = nativeSerialization;
  const { validateNativeFiles } = nativeValidation;

  function nativeInteractionCost(questions) {
    return questions.reduce((total, question) => {
      if (question.type === 'MAT') return total + (question.pairs.length * (question.pairs.length + (question.distractors || []).length));
      if (question.type === 'JUM') return total + question.slots.reduce((sum, slot) => sum + slot.distractors.length + 1, 0);
      if (question.type === 'MC' || question.type === 'MA') return total + question.choices.length;
      return total + 1;
    }, 0);
  }

  function utf8ByteLength(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value)).byteLength;
    if (typeof Buffer === 'function') return Buffer.byteLength(String(value), 'utf8');
    return unescape(encodeURIComponent(String(value))).length;
  }

  function buildNativeFiles(questions, options) {
    const settings = Object.assign({ mode: 'pool', title: 'أسئلة المقرر', shuffleAnswers: false }, options || {});
    if (!['pool', 'test'].includes(settings.mode)) throw new ValidationError('وضع الحزمة الأصلية يجب أن يكون pool أو test.');
    if (typeof settings.title !== 'string' || !settings.title.trim() || settings.title.trim().length > 200 || /[\u0000-\u001F\u007F]/.test(settings.title) || stripInvalidXmlCharacters(settings.title) !== settings.title) throw new ValidationError('اسم البنك أو الاختبار مطلوب، وحده 200 حرف، ولا يقبل محارف تحكم أو Unicode غير صالح.');
    const format = settings.mode === 'pool' ? 'native-bank' : 'native-test';
    const validation = validateForFormat(questions, format);
    if (validation.errors.length) throw new ValidationError(validation.errors);
    const interactionCost = nativeInteractionCost(questions);
    if (interactionCost > MAX_NATIVE_INTERACTIONS) throw new ValidationError(`تعقيد أسئلة المطابقة والاختيارات يتجاوز الحد الآمن (${MAX_NATIVE_INTERACTIONS.toLocaleString('en-US')} تفاعل). قلّل عدد الأزواج أو قسّم الدفعة.`);
    const numericSeed = settings.idSeed == null ? secureNativeSeed() : Number(settings.idSeed);
    const nextId = createNativeIdAllocator(numericSeed);
    const nextResponseId = createNativeResponseIdAllocator(settings.idSeed);
    const packageIdentifier = nextResponseId();
    const assessmentType = settings.mode === 'pool' ? 'Pool' : 'Test';
    const assessmentObjectId = nextId();
    const sectionObjectId = nextId();
    const serializerSettings = {
      assessmentType,
      mode: settings.mode,
      nextId,
      nextResponseId,
      assessmentObjectId,
      sectionObjectId,
      shuffleAnswers: Boolean(settings.shuffleAnswers),
      title: settings.title.trim(),
    };
    const assessment = buildNativeAssessment(questions, serializerSettings);
    const manifest = buildNativeManifest(settings.mode, serializerSettings.title);
    const files = {
      '.bb-package-info': buildNativePackageInfo(packageIdentifier),
      'imsmanifest.xml': manifest,
    };
    if (settings.mode === 'pool') {
      files['res00001.dat'] = `<?xml version="1.0" encoding="UTF-8"?>\n<COURSE id="${nextId()}"><ULTRASTATUS value="U"/></COURSE>`;
      files['res00002.dat'] = assessment;
      files['res00003.dat'] = '<?xml version="1.0" encoding="UTF-8"?>\n<cms_resource_link_list/>';
    } else {
      const reference = NATIVE_TEST_TEMPLATE.resources;
      const resourcePath = (identifier) => `${identifier}.dat`;
      const timestamp = nativeTimestamp(settings.generatedAt);
      const ids = {
        creationSetting: nextId(),
        tocRoot: nextId(),
        tocInteractive: nextId(),
        tocIndirect: nextId(),
        rootContent: nextId(),
        testContent: nextId(),
        interactiveContent: nextId(),
        indirectContent: nextId(),
        gradeCategory: nextId(),
        gradeScale: nextId(),
        gradeOutcome: nextId(),
        courseAssessment: nextId(),
        courseLink: nextId(),
      };
      files[resourcePath(reference.tocRoot)] = buildNativeCourseToc(ids.tocRoot, 'ROOT', true);
      files[resourcePath(reference.tocInteractive)] = buildNativeCourseToc(ids.tocInteractive, 'INTERACTIVE', false);
      files[resourcePath(reference.tocIndirect)] = buildNativeCourseToc(ids.tocIndirect, 'INDIRECT', false);
      files[resourcePath(reference.assessment)] = assessment;
      files[resourcePath(reference.creationSettings)] = buildNativeCreationSettings(ids.creationSetting, assessmentObjectId);
      files[resourcePath(reference.rootContent)] = buildNativeTopContent(ids.rootContent, timestamp);
      files[resourcePath(reference.testContent)] = buildNativeTestContent(ids.testContent, ids.rootContent, serializerSettings.title, timestamp);
      files[resourcePath(reference.interactiveContent)] = buildNativeTopContent(ids.interactiveContent, timestamp);
      files[resourcePath(reference.indirectContent)] = buildNativeTopContent(ids.indirectContent, timestamp);
      files[resourcePath(reference.gradebook)] = buildNativeGradebook({ category: ids.gradeCategory, scale: ids.gradeScale, outcome: ids.gradeOutcome }, serializerSettings.title, totalQuestionPoints(questions), timestamp);
      files[resourcePath(reference.courseAssessment)] = buildNativeCourseAssessment(ids.courseAssessment);
      files[resourcePath(reference.link)] = buildNativeCourseLink(ids.courseLink, serializerSettings.title);
    }
    const xmlBytes = Object.entries(files).filter(([path]) => path.endsWith('.xml') || path.endsWith('.dat')).reduce((sum, [, value]) => sum + utf8ByteLength(value), 0);
    if (xmlBytes > MAX_NATIVE_XML_BYTES) throw new ValidationError('الحجم غير المضغوط لحزمة Blackboard Native يتجاوز 12 MB. قلّل حجم الدفعة.');
    const report = validateNativeFiles(files, { mode: settings.mode });
    return { files, warnings: validation.warnings, itemCount: report.itemCount, totalPoints: report.totalPoints, mode: settings.mode };
  }

  return Object.freeze({
    nativeInteractionCost,
    utf8ByteLength,
    buildNativeFiles
  });
});
