/* Shared constants, text/number helpers, point precision, and one ValidationError identity. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory()
    : factory();
  if (node) module.exports = api;
  if (root) modules['shared'] = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';



  const VERSION = '2.16.2';

  const DISPLAY_VERSION = '2.5';

  const LEGACY_TSV_TYPES = Object.freeze(['MC', 'TF', 'ESS', 'FIB', 'NUM', 'MAT']);

  const NATIVE_JSONL_TYPES = Object.freeze(['MC', 'TF', 'ESS', 'FIB', 'NUM', 'MAT', 'MA', 'EO', 'JUM', 'CALC']);

  const TYPE_ORDER = NATIVE_JSONL_TYPES;

  const QTI_SUPPORTED_TYPES = Object.freeze(['MC', 'TF', 'ESS', 'FIB', 'MA']);

  const NATIVE_SUPPORTED_TYPES = NATIVE_JSONL_TYPES;

  const NATIVE_JSONL_SCHEMA = 'blackboard-native-jsonl';

  const NATIVE_JSONL_VERSION = 1;

  const MAX_QUESTIONS = 250;

  const MAX_PER_INPUT = 50;

  const MAX_SOURCE_LENGTH = 200000;

  const MAX_RESPONSE_LENGTH = 2000000;

  const MAX_NATIVE_INTERACTIONS = 50000;

  const MAX_NATIVE_XML_BYTES = 12 * 1024 * 1024;

  const POINT_SCALE = 100000;

  const PROMPT_FINGERPRINT = 'BLACKBOARD_PROMPT_REQUEST_V3';

  const CREDIT_LEVELS = Object.freeze(['most_correct', 'correct', 'least_correct']);

  const CREDIT_LEVEL_LABELS = Object.freeze({
    most_correct: 'الأكثر صحة',
    correct: 'صحيحة',
    least_correct: 'الأقل صحة',
  });

  const DEFAULT_QUESTION_SETTINGS = Object.freeze({
    matching: Object.freeze({ pairCount: 4, distractorCount: 0 }),
    multipleAnswer: Object.freeze({
      choiceCount: 4,
      correctCount: 2,
      selectionLimit: 2,
      partialCredit: false,
      creditLevels: Object.freeze(['most_correct', 'least_correct']),
      percentages: Object.freeze([75, 25]),
    }),
    jumbled: Object.freeze({ distractorCount: 2 }),
  });

  const NATIVE_BANK_TEMPLATE = Object.freeze({
    sourceSha256: 'A92D83BC76902AF727A511B016CFFDA43401DAE8025DC484B338015EA3D08ECA',
    resources: Object.freeze({ course: 'res00001', assessment: 'res00002', resourceLinks: 'res00003' }),
  });

  const NATIVE_TEST_TEMPLATE = Object.freeze({
    sourceSha256: 'EB2E9B89A29A1F65768B350BA5F6CB19B997160245A4F733F7A7EC906B00AAF1',
    resources: Object.freeze({
      tocRoot: 'res00006',
      tocInteractive: 'res00007',
      tocIndirect: 'res00008',
      assessment: 'res00015',
      creationSettings: 'res00016',
      rootContent: 'res00018',
      testContent: 'res00019',
      interactiveContent: 'res00020',
      indirectContent: 'res00021',
      gradebook: 'res00023',
      courseAssessment: 'res00025',
      link: 'res00026',
    }),
  });

  const DIFFICULTY_BUCKETS = Object.freeze(['easy', 'medium', 'hard', 'expert']);

  const TEMPLATE_ROWS = new Set([
    'MC\tنص السؤال\tالخيار الأول\tcorrect\tالخيار الثاني\tincorrect',
    'TF\tنص السؤال\ttrue',
    'ESS\tنص السؤال\tإجابة نموذجية اختيارية',
    'FIB\tنص السؤال وفيه ____\tالإجابة',
    'NUM\tنص السؤال\tالإجابة الرقمية\tهامش الخطأ',
    'MAT\tنص السؤال\tالمطالبة الأولى\tمطابقتها\tالمطالبة الثانية\tمطابقتها',
  ]);

  const TYPE_LABELS = Object.freeze({
    MC: 'اختيار من متعدد',
    TF: 'صح/خطأ',
    ESS: 'مقالي',
    FIB: 'ملء الفراغ',
    NUM: 'إجابة رقمية',
    MAT: 'مطابقة',
    MA: 'اختيار متعدد الإجابات',
    EO: 'إما/أو',
    JUM: 'جملة مبعثرة',
    CALC: 'معادلة محسوبة',
  });

  const DIFFICULTY_LABELS = Object.freeze({
    1: 'سهل جدًا (تذكر)',
    2: 'سهل (فهم)',
    3: 'متوسط (تطبيق)',
    4: 'صعب (تحليل)',
    5: 'صعب جدًا (تقييم/إبداع)',
  });

  class ValidationError extends Error {
    constructor(messages) {
      const list = Array.isArray(messages) ? messages : [String(messages)];
      super(list.join('\n'));
      this.name = 'ValidationError';
      this.messages = list;
    }
  }

  function normalizeArabicDigits(value) {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    return String(value)
      .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
      .replace(/٫/g, '.');
  }

  function parseFiniteNumber(value) {
    const normalized = normalizeArabicDigits(value).trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function stripInvalidXmlCharacters(value) {
    return Array.from(String(value)).filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === 0x09
        || codePoint === 0x0A
        || codePoint === 0x0D
        || (codePoint >= 0x20 && codePoint <= 0xD7FF)
        || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
        || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    }).join('');
  }

  function escapeXml(value) {
    return stripInvalidXmlCharacters(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function pointTicks(value) {
    return Math.round(value * POINT_SCALE);
  }

  function hasPointPrecision(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const restored = pointTicks(value) / POINT_SCALE;
    const slack = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(restored)) * 4;
    return Math.abs(value - restored) <= slack;
  }

  function validPoints(value) {
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0.01
      && value <= 1000
      && hasPointPrecision(value);
  }

  function parsePointValue(value) {
    const normalized = normalizeArabicDigits(value).trim();
    if (!/^\d+(?:\.\d{1,5})?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return validPoints(parsed) ? parsed : null;
  }

  function sumPointValues(values) {
    let ticks = 0;
    values.forEach((value) => {
      if (!validPoints(value)) throw new ValidationError('درجة السؤال يجب أن تكون رقمًا من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.');
      ticks += pointTicks(value);
    });
    return ticks / POINT_SCALE;
  }

  function applyQuestionPoints(questions, values) {
    if (!Array.isArray(questions) || !Array.isArray(values) || questions.length !== values.length) {
      throw new ValidationError('عدد قيم النقاط لا يطابق عدد الأسئلة. أعد التدقيق قبل التصدير.');
    }
    const parsedValues = values.map((value, index) => {
      const parsed = typeof value === 'number' && validPoints(value) ? value : parsePointValue(value);
      if (parsed === null) throw new ValidationError(`نقاط السؤال ${index + 1} يجب أن تكون من 0.01 إلى 1000 وبحد أقصى 5 منازل عشرية.`);
      return parsed;
    });
    return questions.map((question, index) => ({ ...question, points: parsedValues[index] }));
  }

  function isStableDecimal(value, maximumDecimals) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const fixed = value.toFixed(maximumDecimals);
    if (/[eE]/.test(fixed)) return false;
    const restored = Number(fixed);
    const slack = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(restored)) * 4;
    return Number.isFinite(restored) && Math.abs(restored - value) <= slack;
  }

  function questionPoints(question) {
    return question.points == null ? 1 : question.points;
  }

  function totalQuestionPoints(questions) {
    if (!Array.isArray(questions)) throw new ValidationError('بيانات الأسئلة ليست مصفوفة صالحة لحساب النقاط.');
    return sumPointValues(questions.map(questionPoints));
  }

  function decimalText(value, maximumDecimals) {
    if (!Number.isFinite(Number(value))) throw new ValidationError('تعذر تسلسل قيمة رقمية غير منتهية داخل الحزمة.');
    const fixed = Number(value).toFixed(maximumDecimals == null ? 12 : maximumDecimals);
    return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  }

  function pointsText(value, decimals) {
    if (!Number.isFinite(Number(value))) throw new ValidationError('تعذر تسلسل درجة غير منتهية داخل الحزمة.');
    return Number(value).toFixed(decimals);
  }

  function escapeHtmlText(value) {
    return stripInvalidXmlCharacters(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return Object.freeze({
    VERSION,
    DISPLAY_VERSION,
    LEGACY_TSV_TYPES,
    NATIVE_JSONL_TYPES,
    TYPE_ORDER,
    QTI_SUPPORTED_TYPES,
    NATIVE_SUPPORTED_TYPES,
    NATIVE_JSONL_SCHEMA,
    NATIVE_JSONL_VERSION,
    MAX_QUESTIONS,
    MAX_PER_INPUT,
    MAX_SOURCE_LENGTH,
    MAX_RESPONSE_LENGTH,
    MAX_NATIVE_INTERACTIONS,
    MAX_NATIVE_XML_BYTES,
    POINT_SCALE,
    PROMPT_FINGERPRINT,
    CREDIT_LEVELS,
    CREDIT_LEVEL_LABELS,
    DEFAULT_QUESTION_SETTINGS,
    NATIVE_BANK_TEMPLATE,
    NATIVE_TEST_TEMPLATE,
    DIFFICULTY_BUCKETS,
    TEMPLATE_ROWS,
    TYPE_LABELS,
    DIFFICULTY_LABELS,
    ValidationError,
    normalizeArabicDigits,
    parseFiniteNumber,
    stripInvalidXmlCharacters,
    escapeXml,
    pointTicks,
    hasPointPrecision,
    validPoints,
    parsePointValue,
    sumPointValues,
    applyQuestionPoints,
    isStableDecimal,
    questionPoints,
    totalQuestionPoints,
    decimalText,
    pointsText,
    escapeHtmlText
  });
});
