/* Recheck generated Native XML, references, answers, and point totals. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./native-serialization.js'))
    : factory(modules['shared'], modules['native-serialization']);
  if (node) module.exports = api;
  if (root) modules['native-validation'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, nativeSerialization) {
  'use strict';

  const { MAX_QUESTIONS, NATIVE_BANK_TEMPLATE, NATIVE_TEST_TEMPLATE, ValidationError, hasPointPrecision, pointTicks, stripInvalidXmlCharacters, sumPointValues, validPoints } = shared;
  const { NATIVE_QUESTION_TYPES, NATIVE_RAW_RESPONSE_ID_PATTERN, NATIVE_VISIBLE_RESPONSE_ID_PATTERN, nativeMatchingPercentages, nativePartialCredit } = nativeSerialization;

  function assertXmlWellFormed(xml, label) {
    if (typeof xml !== 'string' || !xml.trim()) throw new ValidationError(`${label} فارغ.`);
    if (stripInvalidXmlCharacters(xml) !== xml) throw new ValidationError(`${label} يحتوي محارف Unicode غير صالحة في XML.`);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ValidationError(`${label} يحتوي تعريف DOCTYPE أو ENTITY غير مسموح.`);
    if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)/.test(xml)) throw new ValidationError(`${label} يحتوي كيان XML غير صالح.`);
    for (const entity of xml.matchAll(/&#(?:x([0-9A-Fa-f]+)|(\d+));/g)) {
      const codePoint = entity[1] ? Number.parseInt(entity[1], 16) : Number.parseInt(entity[2], 10);
      if (!Number.isInteger(codePoint) || codePoint > 0x10FFFF || stripInvalidXmlCharacters(String.fromCodePoint(codePoint)).length === 0) throw new ValidationError(`${label} يحتوي مرجع محرف XML غير صالح.`);
    }
    if (typeof DOMParser === 'function') {
      const documentNode = new DOMParser().parseFromString(xml, 'application/xml');
      if (documentNode.getElementsByTagName('parsererror').length) throw new ValidationError(`${label} ليس XML صالحًا.`);
      return;
    }
    const predefinedNamespaces = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]);
    const stack = [];
    const tags = xml.match(/<[^>]+>/g) || [];
    let cursor = 0;
    let rootCount = 0;
    tags.forEach((tag) => {
      const start = xml.indexOf(tag, cursor);
      const between = xml.slice(cursor, start);
      if (between.includes('<') || between.includes('>')) throw new ValidationError(`${label} ليس XML صالحًا.`);
      cursor = start + tag.length;
      if (/^<\?/.test(tag)) {
        if (start !== 0 || tag !== '<?xml version="1.0" encoding="UTF-8"?>') throw new ValidationError(`${label} يحوي تعليمة معالجة غير مسموح بها.`);
        return;
      }
      if (/^<!--/.test(tag)) throw new ValidationError(`${label} يحوي تعليق XML غير مسموح به.`);
      const closing = tag.match(/^<\/([A-Za-z_][\w:.-]*)\s*>$/);
      if (closing) {
        const openElement = stack.pop();
        if (!openElement || openElement.name !== closing[1]) throw new ValidationError(`${label} يحوي وسوم XML غير متطابقة.`);
        return;
      }
      const opening = tag.match(/^<([A-Za-z_][\w:.-]*)\b/);
      if (!opening) throw new ValidationError(`${label} يحوي وسم XML غير صالح.`);
      const attributeSource = tag.slice(opening[0].length, tag.length - 1).replace(/\/\s*$/, '').trim();
      const attributes = [];
      const attributeValues = new Map();
      let consumed = '';
      const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g;
      for (const attribute of attributeSource.matchAll(attributePattern)) {
        attributes.push(attribute[1]);
        attributeValues.set(attribute[1], attribute[2].slice(1, -1));
        consumed += `${attribute[0]} `;
      }
      const normalizedSource = attributeSource.replace(/\s+/g, ' ').trim();
      const normalizedConsumed = consumed.replace(/\s+/g, ' ').trim();
      if (normalizedSource !== normalizedConsumed || new Set(attributes).size !== attributes.length) throw new ValidationError(`${label} يحوي سمات XML غير صالحة أو مكررة.`);
      const parentNamespaces = stack.length ? stack[stack.length - 1].namespaces : predefinedNamespaces;
      const namespaces = new Map(parentNamespaces);
      attributes.forEach((name) => {
        if (name === 'xmlns') namespaces.set('', attributeValues.get(name));
        else if (name.startsWith('xmlns:')) {
          const namespacePrefix = name.slice(6);
          if (!namespacePrefix || namespacePrefix.includes(':') || !attributeValues.get(name)) throw new ValidationError(`${label} يحوي تعريف مساحة أسماء غير صالح.`);
          namespaces.set(namespacePrefix, attributeValues.get(name));
        }
      });
      const assertQualifiedName = (name) => {
        const parts = name.split(':');
        if (parts.length > 2 || (parts.length === 2 && !namespaces.has(parts[0]))) throw new ValidationError(`${label} يستخدم بادئة مساحة أسماء غير معرّفة.`);
      };
      assertQualifiedName(opening[1]);
      attributes.forEach((name) => {
        if (name !== 'xmlns' && !name.startsWith('xmlns:')) assertQualifiedName(name);
      });
      if (stack.length === 0) rootCount += 1;
      if (!/\/\s*>$/.test(tag)) stack.push({ name: opening[1], namespaces });
    });
    if (rootCount !== 1 || stack.length || xml.slice(cursor).includes('<') || xml.slice(cursor).includes('>')) throw new ValidationError(`${label} يجب أن يحتوي جذر XML واحدًا مغلقًا.`);
  }

  function manifestAttribute(attributes, name) {
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = attributes.match(new RegExp(`(?:^|\\s)${safeName}="([^"]*)"`));
    return match ? match[1] : null;
  }

  function decodeOneXmlEntityLayer(value) {
    return String(value)
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function validateNativeHtmlBlocks(dat) {
    const openingTags = [...dat.matchAll(/<mat_formattedtext\b[^>]*>/g)].map((match) => match[0]);
    if (openingTags.some((tag) => tag !== '<mat_formattedtext type="HTML">' && tag !== '<mat_formattedtext type="HTML"/>')) {
      throw new ValidationError('وسم HTML أصلي لا يطابق البنية المسموح بها.');
    }
    const blocks = [...dat.matchAll(/<mat_formattedtext\b(?=[^>]*\btype="HTML")(?=[^>]*[^/\s]\s*>)[^>]*>([\s\S]*?)<\/mat_formattedtext>/g)];
    const pairedTagCount = openingTags.filter((tag) => !tag.endsWith('/>')).length;
    if (blocks.length !== pairedTagCount) throw new ValidationError('تعذر فحص كل حقول HTML الأصلية داخل الحزمة.');
    blocks.forEach((block) => {
      const html = decodeOneXmlEntityLayer(block[1]);
      const withoutAnchors = html.replace(/<a data-bbtype="customClass" data-bbfile="\{&quot;className&quot;:&quot;(?:fimb-answer-value|blank-answer-value)&quot;\}">\[BLANK-[1-9][0-9]*\]<\/a>/g, '');
      const withoutParagraphs = withoutAnchors.replace(/<\/?p>/g, '');
      if (/[<>]/.test(withoutParagraphs)) throw new ValidationError('حقل HTML أصلي يحتوي عنصرًا أو سمة خارج قائمة السماح.');
    });
  }

  function parseNativePackageInfo(value) {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError('ملف .bb-package-info فارغ.');
    const properties = new Map();
    value.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separator = trimmed.indexOf('=');
      if (separator < 1) throw new ValidationError('ملف .bb-package-info يحتوي سطر خصائص غير صالح.');
      const key = trimmed.slice(0, separator);
      const propertyValue = trimmed.slice(separator + 1);
      if (properties.has(key)) throw new ValidationError(`ملف .bb-package-info يحتوي الخاصية المكررة ${key}.`);
      properties.set(key, propertyValue);
    });
    const expected = new Map([
      ['cx.config.course.id', 'IMPORT'],
      ['cx.config.file.references', 'false'],
      ['cx.config.operation', 'blackboard.apps.cx.CxConfig$Operation\\:EXPORT'],
      ['cx.package.info.version', '6.0'],
    ]);
    if (properties.size !== expected.size + 1) throw new ValidationError('ملف .bb-package-info يحتوي خصائص زائدة أو ناقصة.');
    expected.forEach((expectedValue, key) => {
      if (properties.get(key) !== expectedValue) throw new ValidationError(`خاصية ${key} في .bb-package-info غير مطابقة.`);
    });
    const packageIdentifier = properties.get('cx.config.package.identifier');
    if (!/^[a-f0-9]{32}$/.test(packageIdentifier || '')) throw new ValidationError('معرّف الحزمة في .bb-package-info غير صالح.');
    return packageIdentifier;
  }

  function nativeRootId(xml, rootName, label) {
    const root = xml.match(new RegExp(`<${rootName}\\b([^>]*)>`));
    const identifier = root ? manifestAttribute(root[1], 'id') : null;
    if (!identifier || !/^_[0-9]+_1$/.test(identifier)) throw new ValidationError(`${label} لا يحتوي معرّف Blackboard صالحًا.`);
    return identifier;
  }

  function nativeValue(xml, tagName, label) {
    const match = xml.match(new RegExp(`<${tagName}\\b([^>]*)\\/>`));
    const value = match ? manifestAttribute(match[1], 'value') : null;
    if (value == null) throw new ValidationError(`${label} لا يحتوي القيمة ${tagName}.`);
    return value;
  }

  function validateNativeFiles(files, options) {
    const settings = Object.assign({ mode: 'pool' }, options || {});
    if (!['pool', 'test'].includes(settings.mode)) throw new ValidationError('وضع حزمة Blackboard Native غير معروف.');
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new ValidationError('ملفات الحزمة الأصلية غير صالحة.');
    const reference = NATIVE_TEST_TEMPLATE.resources;
    const expectedPaths = settings.mode === 'pool'
      ? ['.bb-package-info', 'imsmanifest.xml', 'res00001.dat', 'res00002.dat', 'res00003.dat']
      : ['.bb-package-info', 'imsmanifest.xml', ...Object.values(reference).map((identifier) => `${identifier}.dat`).sort()];
    const actualPaths = Object.keys(files).sort();
    if (actualPaths.length !== expectedPaths.length || actualPaths.some((path, index) => path !== expectedPaths[index])) {
      const expectedCount = settings.mode === 'pool' ? 5 : 14;
      throw new ValidationError(`حزمة Blackboard Native يجب أن تحتوي ملفاتها المسموح بها وعددها ${expectedCount} فقط.`);
    }
    actualPaths.forEach((path) => {
      if (path.length > 100 || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) throw new ValidationError(`مسار غير آمن داخل ZIP: ${path}.`);
    });
    parseNativePackageInfo(files['.bb-package-info']);
    const manifest = files['imsmanifest.xml'];
    const dat = files[`${settings.mode === 'pool' ? NATIVE_BANK_TEMPLATE.resources.assessment : reference.assessment}.dat`];
    assertXmlWellFormed(manifest, 'imsmanifest.xml');
    expectedPaths.filter((path) => path.endsWith('.dat')).forEach((path) => assertXmlWellFormed(files[path], path));
    if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<manifest\b/.test(manifest)
      || !/<manifest\b[^>]*\bxmlns:bb="http:\/\/www\.blackboard\.com\/content-packaging\/"/.test(manifest)
      || !/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<questestinterop>/.test(dat)
      || !/<\/questestinterop>$/.test(dat)) throw new ValidationError('جذر أو مساحة أسماء XML لا تطابق بنية Blackboard Native المتوقعة.');
    validateNativeHtmlBlocks(dat);
    const resources = [...manifest.matchAll(/<resource\b([^>]*)\/>/g)];
    const expectedResourceTypes = settings.mode === 'pool' ? {
      res00001: 'course/x-bb-coursesetting',
      res00002: 'assessment/x-bb-qti-pool',
      res00003: 'course/x-bb-csresourcelinks',
    } : {
      [reference.tocRoot]: 'course/x-bb-coursetoc',
      [reference.tocInteractive]: 'course/x-bb-coursetoc',
      [reference.tocIndirect]: 'course/x-bb-coursetoc',
      [reference.assessment]: 'assessment/x-bb-qti-test',
      [reference.creationSettings]: 'course/x-bb-courseassessmentcreationsettings',
      [reference.rootContent]: 'resource/x-bb-document',
      [reference.testContent]: 'resource/x-bb-document',
      [reference.interactiveContent]: 'resource/x-bb-document',
      [reference.indirectContent]: 'resource/x-bb-document',
      [reference.gradebook]: 'course/x-bb-gradebook',
      [reference.courseAssessment]: 'course/x-bb-courseassessment',
      [reference.link]: 'resource/x-bb-link',
    };
    if (resources.length !== Object.keys(expectedResourceTypes).length) throw new ValidationError('عدد موارد manifest لا يطابق نمط الحزمة.');
    const seenResources = new Set();
    resources.forEach((resource) => {
      const attributes = resource[1];
      const identifier = manifestAttribute(attributes, 'identifier');
      const attributeNames = [...attributes.matchAll(/([A-Za-z_][\w:.-]*)\s*=/g)].map((match) => match[1]).sort();
      const expectedAttributeNames = ['bb:file', 'bb:title', 'identifier', 'type', 'xml:base'].sort();
      if (attributeNames.length !== expectedAttributeNames.length || attributeNames.some((name, index) => name !== expectedAttributeNames[index])) throw new ValidationError('أحد موارد manifest يحتوي سمات غير مسموح بها.');
      if (!identifier || seenResources.has(identifier) || !Object.prototype.hasOwnProperty.call(expectedResourceTypes, identifier)
        || manifestAttribute(attributes, 'type') !== expectedResourceTypes[identifier]
        || manifestAttribute(attributes, 'xml:base') !== identifier
        || manifestAttribute(attributes, 'bb:file') !== `${identifier}.dat`) throw new ValidationError('إحالات manifest لا تطابق موارد Blackboard Native المتوقعة.');
      seenResources.add(identifier);
    });
    if (/<(?:file|dependency)\b/i.test(manifest) || /\bhref\s*=/i.test(manifest)) throw new ValidationError('manifest يحتوي إحالات ملفات إضافية غير مسموح بها.');
    const organizationReferences = [...manifest.matchAll(/\bidentifierref="([^"]+)"/g)].map((match) => match[1]);
    if (settings.mode === 'pool') {
      if (/<item\b/i.test(manifest) || organizationReferences.length) throw new ValidationError('manifest الخاص بالبنك يجب ألا يحتوي عناصر محتوى مرتبطة بالمقرر.');
      if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<COURSE id="_[0-9]+_1"><ULTRASTATUS value="U"\/><\/COURSE>$/.test(files['res00001.dat'])
        || !/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<cms_resource_link_list\/>$/.test(files['res00003.dat'])) throw new ValidationError('إعدادات بنك الأسئلة أو روابط مرفقاته لا تطابق القالب المنقّى.');
    } else {
      const expectedReferences = [reference.tocRoot, reference.rootContent, reference.testContent, reference.tocInteractive, reference.interactiveContent, reference.tocIndirect, reference.indirectContent];
      if (organizationReferences.length !== expectedReferences.length || organizationReferences.some((value, index) => value !== expectedReferences[index])) throw new ValidationError('شجرة محتوى manifest لا تطابق حزمة الاختبار المرتبطة بالمقرر.');
    }
    const assessmentType = settings.mode === 'pool' ? 'Pool' : 'Test';
    const typeValues = [...dat.matchAll(/<bbmd_assessmenttype>([^<]+)<\/bbmd_assessmenttype>/g)].map((match) => match[1]);
    const itemCount = (dat.match(/<item\b/g) || []).length;
    if (itemCount < 1 || itemCount > MAX_QUESTIONS) throw new ValidationError('عدد عناصر مورد Blackboard Native خارج الحد المسموح.');
    if (typeValues.length !== itemCount + 2 || typeValues.some((value) => value !== assessmentType)) throw new ValidationError('نوع Assessment غير متسق بين الحزمة والأقسام والأسئلة.');
    const objectIds = [...dat.matchAll(/<bbmd_asi_object_id>(_[0-9]+_1)<\/bbmd_asi_object_id>/g)].map((match) => match[1]);
    if (objectIds.length !== itemCount + 2 || new Set(objectIds).size !== objectIds.length) throw new ValidationError('معرّفات Blackboard الداخلية مفقودة أو مكررة.');
    const aggregateMetadata = [...dat.matchAll(/<(assessment|section)metadata>[\s\S]*?<bbmd_partialcredit>([^<]*)<\/bbmd_partialcredit>[\s\S]*?<qmd_absolutescore_max>([^<]+)<\/qmd_absolutescore_max>[\s\S]*?<\/\1metadata>/g)];
    const expectedAggregatePartialCredit = '';
    if (aggregateMetadata.length !== 2 || aggregateMetadata.some((entry) => entry[2] !== expectedAggregatePartialCredit)) throw new ValidationError('إعداد partialcredit في assessment وsection غير مطابق للمرجع الرسمي.');
    const itemMatches = [...dat.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)];
    if (itemMatches.length !== itemCount) throw new ValidationError('تعذر فصل عناصر الأسئلة داخل مورد Blackboard Native.');
    const opaqueAnswerIds = new Set();
    const itemScores = itemMatches.map((itemMatch) => {
      const itemAttributes = itemMatch[1].trim();
      const item = itemMatch[0];
      const expectedItemAttributes = 'maxattempts="0"';
      if (itemAttributes !== expectedItemAttributes) throw new ValidationError('سمات item لا تطابق البنية المرجعية لنمط الحزمة.');
      const match = item.match(/<qmd_absolutescore_max>([^<]+)<\/qmd_absolutescore_max>/);
      const value = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(value) || value <= 0) throw new ValidationError('درجة سؤال غير صالحة في مورد Blackboard Native.');
      const decvar = item.match(/<decvar\b[^>]*\bmaxvalue="([^"]+)"[^>]*\/>/);
      const decvarValue = decvar ? Number(decvar[1]) : NaN;
      if (!validPoints(decvarValue) || pointTicks(decvarValue) !== pointTicks(value)) throw new ValidationError('درجة qmd لا تطابق maxvalue داخل السؤال.');
      const questionTypeMatch = item.match(/<bbmd_questiontype>([^<]+)<\/bbmd_questiontype>/);
      const questionType = questionTypeMatch ? questionTypeMatch[1] : '';
      if (!Object.values(NATIVE_QUESTION_TYPES).includes(questionType)) throw new ValidationError('نوع سؤال Native مفقود أو غير مدعوم.');
      const partialCreditMatch = item.match(/<bbmd_partialcredit>([^<]*)<\/bbmd_partialcredit>/);
      const hasNonZeroChoiceScore = [...item.matchAll(/<respcondition><conditionvar><varequal respident="[^"]+" case="No"\/><\/conditionvar><setvar variablename="SCORE" action="Set">([^<]+)<\/setvar><\/respcondition>/g)]
        .some((entry) => Number(entry[1]) !== 0);
      const weightedMultipleAnswer = questionType === 'Multiple Answer'
        && partialCreditMatch
        && partialCreditMatch[1] === 'true'
        && (assessmentType === 'Test' || hasNonZeroChoiceScore);
      const negativePointsMatch = item.match(/<bbmd_negative_points_ind>([^<]+)<\/bbmd_negative_points_ind>/);
      if (questionType === 'Multiple Answer'
        && (!negativePointsMatch || negativePointsMatch[1] !== (weightedMultipleAnswer ? 'Q' : 'N'))) {
        throw new ValidationError('إعداد الرصيد السالب لسؤال الإجابات المتعددة لا يطابق صيغة Blackboard المرجعية.');
      }
      const expectedPartialCredits = questionType === 'Multiple Answer'
        ? ['', 'true']
        : [nativePartialCredit('item', assessmentType, questionType)];
      if (!partialCreditMatch || !expectedPartialCredits.includes(partialCreditMatch[1])) throw new ValidationError(`إعداد partialcredit لا يطابق نوع السؤال ${questionType}.`);
      const responseMap = new Map();
      for (const response of item.matchAll(/<(response_lid|response_str|response_num)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const identifier = manifestAttribute(response[2], 'ident');
        const cardinality = manifestAttribute(response[2], 'rcardinality');
        if (!identifier || responseMap.has(identifier)) throw new ValidationError('معرّف استجابة مفقود أو مكرر داخل السؤال.');
        const labels = [...response[3].matchAll(/<response_label\b[^>]*\bident="([^"]+)"/g)].map((label) => label[1]);
        if (response[1] === 'response_lid' && questionType !== 'Jumbled Sentence' && new Set(labels).size !== labels.length) throw new ValidationError('معرّفات خيارات response_lid مكررة داخل الاستجابة.');
        responseMap.set(identifier, { element: response[1], cardinality, labels: new Set(labels) });
      }
      const declaredResponses = new Set(responseMap.keys());
      const declaredLabels = new Set([...responseMap.values()].flatMap((response) => [...response.labels]));
      if (!declaredResponses.size) throw new ValidationError('السؤال لا يحتوي استجابة معلنة.');
      const detachedResponseIds = new Set();
      if (questionType === 'Matching') {
        const responseEntries = [...responseMap.entries()];
        const rowCount = responseEntries.length;
        const optionCount = responseEntries.length ? responseEntries[0][1].labels.size : 0;
        const matchingConditions = [...item.matchAll(/<respcondition><conditionvar><varequal respident="([^"]+)" case="No">([^<]+)<\/varequal><\/conditionvar><setvar variablename="PartialCreditPercent" action="Set">([^<]+)<\/setvar><setvar variablename="NegativeCreditPercent" action="Set">0<\/setvar><displayfeedback linkrefid="correct" feedbacktype="Response"\/><\/respcondition>/g)];
        if (!rowCount || matchingConditions.length !== rowCount) throw new ValidationError('شروط المطابقة لا تطابق عدد صفوفها في قالب الأرشيف المرجعي.');
        const seenMatchingIds = new Set();
        responseEntries.forEach(([responseId, responseData], index) => {
          const labels = [...responseData.labels];
          const scoringId = matchingConditions[index][1];
          if (!NATIVE_VISIBLE_RESPONSE_ID_PATTERN.test(responseId)
            || optionCount < rowCount
            || labels.length !== optionCount
            || labels.some((identifier) => !NATIVE_RAW_RESPONSE_ID_PATTERN.test(identifier))
            || !NATIVE_RAW_RESPONSE_ID_PATTERN.test(scoringId)
            || seenMatchingIds.has(scoringId)
            || matchingConditions[index][2] !== labels[index]
            || Number(matchingConditions[index][3]) !== nativeMatchingPercentages(rowCount, settings.mode)[index]) {
            throw new ValidationError('معرّفات أو شروط المطابقة لا تطابق قالب الاختبار المرجعي.');
          }
          seenMatchingIds.add(scoringId);
          detachedResponseIds.add(scoringId);
        });
      } else if (questionType === 'Multiple Answer') {
        const scoringConditions = [...item.matchAll(/<respcondition><conditionvar><varequal respident="([^"]+)" case="No"\/><\/conditionvar><setvar variablename="SCORE" action="Set">([^<]+)<\/setvar><\/respcondition>/g)];
        const choiceCount = responseMap.size === 1 ? [...responseMap.values()][0].labels.size : 0;
        const scoringIds = scoringConditions.map((condition) => condition[1]);
        if (!choiceCount || scoringIds.length !== choiceCount || new Set(scoringIds).size !== scoringIds.length || scoringIds.some((identifier) => !NATIVE_RAW_RESPONSE_ID_PATTERN.test(identifier))) {
          throw new ValidationError('معرّفات التصحيح المنفصلة لسؤال الإجابات المتعددة غير مطابقة للقالب المرجعي.');
        }
        scoringIds.forEach((identifier) => detachedResponseIds.add(identifier));
        detachedResponseIds.add('استجابة');
      } else if (settings.mode === 'test' && questionType === 'Either/Or') {
        detachedResponseIds.add('استجابة');
      }
      const references = [...item.matchAll(/\brespident="([^"]+)"/g)].map((reference) => reference[1]);
      if (references.some((reference) => !declaredResponses.has(reference) && !declaredLabels.has(reference) && !detachedResponseIds.has(reference))) throw new ValidationError('يوجد respident لا يطابق استجابة أو خيارًا معلنًا داخل السؤال نفسه.');
      for (const condition of item.matchAll(/<varequal\b([^>]*)>([^<]*)<\/varequal>/g)) {
        const responseId = manifestAttribute(condition[1], 'respident');
        const response = responseMap.get(responseId);
        if (response && response.element === 'response_lid' && questionType !== 'Jumbled Sentence') {
          const expectedLabel = decodeOneXmlEntityLayer(condition[2]);
          if (!response.labels.has(expectedLabel)) throw new ValidationError('إجابة varequal لا تطابق خيارًا معلنًا داخل response_lid.');
        } else if (!response && declaredLabels.has(responseId) && condition[2] !== '') {
          throw new ValidationError('شرط الخيار المباشر يجب أن يكون فارغ القيمة.');
        }
      }
      const responseKinds = [...responseMap.values()];
      if (questionType === 'Multiple Choice') throw new ValidationError('حزمة Ultra يجب أن تمثل سؤال الاختيار المفرد بصيغة Multiple Answer مع علامة single_correct_answer، وليس بنوع Multiple Choice القديم.');
      if (questionType === 'Multiple Choice' && (responseKinds.length !== 1 || responseKinds[0].element !== 'response_lid' || responseKinds[0].cardinality !== 'Single')) throw new ValidationError('بنية استجابة Multiple Choice غير صحيحة.');
      if (questionType === 'Multiple Answer' && (responseKinds.length !== 1 || responseKinds[0].element !== 'response_lid' || responseKinds[0].cardinality !== 'Multiple')) throw new ValidationError('بنية استجابة Multiple Answer غير صحيحة.');
      if (questionType === 'Either/Or' && (responseKinds.length !== 1 || responseKinds[0].element !== 'response_lid' || responseKinds[0].cardinality !== 'Single')) throw new ValidationError('بنية استجابة Either/Or غير صحيحة.');
      if (questionType === 'Numeric' && (responseKinds.length !== 1 || responseKinds[0].element !== 'response_num')) throw new ValidationError('بنية استجابة Numeric غير صحيحة.');
      if (['Calculated', 'Short Response', 'Fill in the Blank Plus'].includes(questionType) && (responseKinds.length !== 1 || responseKinds[0].element !== 'response_str')) throw new ValidationError(`بنية استجابة ${questionType} غير صحيحة.`);
      if (questionType === 'Matching' && responseKinds.some((response) => response.element !== 'response_lid' || response.cardinality !== 'Single')) throw new ValidationError('بنية استجابات Matching غير صحيحة.');
      if (questionType === 'Jumbled Sentence' && responseKinds.some((response) => response.element !== 'response_lid' || response.cardinality !== 'Single')) throw new ValidationError('بنية استجابات Jumbled Sentence غير صحيحة.');
      if (questionType === 'Multiple Choice') {
        const labels = [...responseKinds[0].labels];
        const incorrectLabels = new Set([...item.matchAll(/<not><varequal respident="response" case="No">([^<]+)<\/varequal><\/not>/g)].map((condition) => decodeOneXmlEntityLayer(condition[1])));
        if (labels.some((identifier) => !NATIVE_RAW_RESPONSE_ID_PATTERN.test(identifier))) throw new ValidationError('معرّفات خيارات الاختيار يجب أن تطابق UUID v4 أصليًا بلا شرطات.');
        labels.forEach((identifier) => {
          if (opaqueAnswerIds.has(identifier)) throw new ValidationError('معرّف خيار مكرر بين أسئلة الحزمة.');
          opaqueAnswerIds.add(identifier);
          const safeIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const feedbackCount = (item.match(new RegExp(`<itemfeedback ident="${safeIdentifier}" view="All"><solution\\b`, 'g')) || []).length;
          const conditionCount = (item.match(new RegExp(`<respcondition><conditionvar><varequal respident="${safeIdentifier}" case="No"\\/></conditionvar><setvar variablename="SCORE" action="Set">0</setvar></respcondition>`, 'g')) || []).length;
          const expectedConditionCount = settings.mode === 'test' || incorrectLabels.has(identifier) ? 1 : 0;
          if (feedbackCount !== 1 || conditionCount !== expectedConditionCount) throw new ValidationError('عقد التغذية الراجعة وشروط الخيارات لا تطابق بنية Blackboard الرسمية.');
        });
      } else if (questionType === 'Multiple Answer') {
        const displayIds = [...responseKinds[0].labels];
        const scoringIds = [...detachedResponseIds].filter((identifier) => identifier !== 'استجابة');
        const correctBlock = item.match(/<respcondition title="correct"><conditionvar><and>([\s\S]*?)<\/and><\/conditionvar><setvar variablename="SCORE" action="Set">SCORE\.max<\/setvar>([\s\S]*?)<displayfeedback linkrefid="correct" feedbacktype="Response"\/><\/respcondition>/);
        const expectedClauseIdentifier = settings.mode === 'test' || !weightedMultipleAnswer ? 'استجابة' : 'response';
        const clausePattern = /(?:<not>)?<varequal respident="(استجابة|response)" case="No">([^<]+)<\/varequal>(?:<\/not>)?/g;
        const clauses = correctBlock ? [...correctBlock[1].matchAll(clausePattern)] : [];
        const clauseText = correctBlock ? correctBlock[1].replace(clausePattern, '') : 'invalid';
        const positiveCount = clauses.filter((clause) => !clause[0].startsWith('<not>')).length;
        const extraSetvars = correctBlock ? correctBlock[2] : '';
        const selectionMatches = [...extraSetvars.matchAll(/<setvar variablename="answer_selection_limit" action="Set">([1-9][0-9]*)<\/setvar>/g)];
        const singleMatches = [...extraSetvars.matchAll(/<setvar variablename="single_correct_answer" action="Set">([^<]+)<\/setvar>/g)];
        const unexpectedSetvars = extraSetvars
          .replace(/<setvar variablename="answer_selection_limit" action="Set">[1-9][0-9]*<\/setvar>/g, '')
          .replace(/<setvar variablename="single_correct_answer" action="Set">[^<]+<\/setvar>/g, '');
        if (!correctBlock || clauseText !== '' || clauses.length !== scoringIds.length
          || clauses.some((clause) => clause[1] !== expectedClauseIdentifier)
          || new Set(clauses.map((clause) => clause[2])).size !== scoringIds.length
          || clauses.some((clause) => !detachedResponseIds.has(clause[2]))) {
          throw new ValidationError('شرط الإجابات المتعددة لا يطابق مجموعة معرّفات التصحيح المرجعية.');
        }
        const hasValidSingleFlag = weightedMultipleAnswer || settings.mode === 'pool'
          ? singleMatches.length === 1 && singleMatches[0][1] === (positiveCount === 1 ? 'true' : 'false')
          : (positiveCount === 1
            ? singleMatches.length === 1 && singleMatches[0][1] === 'true'
            : singleMatches.length === 0);
        if (settings.mode === 'pool' || weightedMultipleAnswer) {
          const selectionLimit = selectionMatches.length === 1 ? Number(selectionMatches[0][1]) : NaN;
          // Both MC and MA allow exactly as many selections as correct answers.
          if (unexpectedSetvars !== '' || !Number.isInteger(selectionLimit) || selectionLimit !== positiveCount || !hasValidSingleFlag) {
            throw new ValidationError('حد الاختيار وعلامة الإجابة المفردة لا يطابقان صيغة Blackboard المرجعية.');
          }
        } else if (unexpectedSetvars !== '' || selectionMatches.length !== 0 || !hasValidSingleFlag) {
          throw new ValidationError('اختبار المقرر المباشر لا يقبل حقول حد الاختيار الخاصة ببنك الأسئلة.');
        }
        const rawDisplay = displayIds.every((identifier) => NATIVE_RAW_RESPONSE_ID_PATTERN.test(identifier));
        const sameRawSet = rawDisplay && displayIds.length === scoringIds.length && displayIds.every((identifier) => scoringIds.includes(identifier));
        const separateWeightedTestIds = ((weightedMultipleAnswer && settings.mode === 'test') || (settings.mode === 'pool' && !weightedMultipleAnswer))
          && displayIds.length === scoringIds.length
          && displayIds.every((identifier) => NATIVE_VISIBLE_RESPONSE_ID_PATTERN.test(identifier))
          && scoringIds.every((identifier) => NATIVE_RAW_RESPONSE_ID_PATTERN.test(identifier))
          && displayIds.every((identifier) => !scoringIds.includes(identifier));
        if (!sameRawSet && !separateWeightedTestIds) {
          throw new ValidationError('معرّفات عرض وتصحيح سؤال الإجابات المتعددة لا تطابق الصيغة الرسمية للمسار المحدد.');
        }
        const scoreRows = [...item.matchAll(/<respcondition><conditionvar><varequal respident="([^"]+)" case="No"\/><\/conditionvar><setvar variablename="SCORE" action="Set">([^<]+)<\/setvar><\/respcondition>/g)];
        const scoreById = new Map(scoreRows.map((row) => [row[1], Number(row[2])]));
        if (scoreById.size !== scoringIds.length || scoringIds.some((identifier) => !scoreById.has(identifier))) {
          throw new ValidationError('شروط نسب خيارات الإجابات المتعددة غير مكتملة.');
        }
        const correctIds = new Set(clauses.filter((clause) => !clause[0].startsWith('<not>')).map((clause) => clause[2]));
        if (weightedMultipleAnswer) {
          const values = scoringIds.map((identifier) => scoreById.get(identifier));
          if (values.some((percent) => !Number.isFinite(percent) || percent < 0 || percent > 100 || !hasPointPrecision(percent))
            || scoringIds.some((identifier) => correctIds.has(identifier) ? scoreById.get(identifier) <= 0 : scoreById.get(identifier) !== 0)
            || pointTicks([...correctIds].reduce((sum, identifier) => sum + scoreById.get(identifier), 0)) !== pointTicks(100)) {
            throw new ValidationError('نسب الرصيد الجزئي في سؤال الإجابات المتعددة غير صالحة.');
          }
        } else if (scoringIds.some((identifier) => scoreById.get(identifier) !== 0)) {
          throw new ValidationError('سؤال الإجابات المتعددة غير الموزون يحتوي نسبًا غير متوقعة.');
        }
        [...new Set([...scoringIds, ...displayIds])].forEach((identifier) => {
          if (opaqueAnswerIds.has(identifier)) throw new ValidationError('معرّف خيار مكرر بين أسئلة الحزمة.');
          opaqueAnswerIds.add(identifier);
          const safeIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const feedbackCount = (item.match(new RegExp(`<itemfeedback ident="${safeIdentifier}" view="All"><solution\\b`, 'g')) || []).length;
          const conditionCount = (item.match(new RegExp(`<respcondition><conditionvar><varequal respident="${safeIdentifier}" case="No"\\/><\\/conditionvar><setvar variablename="SCORE" action="Set">[^<]+<\\/setvar><\\/respcondition>`, 'g')) || []).length;
          const expectedConditionCount = scoringIds.includes(identifier) ? 1 : 0;
          if (feedbackCount !== 1 || conditionCount !== expectedConditionCount) throw new ValidationError('تغذية سؤال الإجابات المتعددة أو شروط تصحيحه لا تطابق قالب الأرشيف المرجعي.');
        });
      } else if (questionType === 'Either/Or' && settings.mode === 'test') {
        const labels = [...responseKinds[0].labels];
        const correct = item.match(/<respcondition title="correct"><conditionvar><varequal respident="استجابة" case="No">([^<]+)<\/varequal><\/conditionvar><setvar variablename="SCORE" action="Set">SCORE\.max<\/setvar><displayfeedback linkrefid="correct" feedbacktype="Response"\/><\/respcondition>/);
        if (!correct || !labels.includes(correct[1])) throw new ValidationError('شرط إما/أو لا يطابق صيغة الاستجابة في الأرشيف المرجعي.');
      } else if (questionType === 'Numeric') {
        const numeric = item.match(/<respcondition title="([a-f0-9]+)"><conditionvar><vargte respident="response">([^<]+)<\/vargte><varlte respident="response">([^<]+)<\/varlte><varequal respident="response" case="No">([^<]+)<\/varequal><\/conditionvar><displayfeedback linkrefid="correct" feedbacktype="Response"\/><\/respcondition>/);
        const low = numeric ? Number(numeric[2]) : NaN;
        const high = numeric ? Number(numeric[3]) : NaN;
        const answer = numeric ? Number(numeric[4]) : NaN;
        if (!numeric || !NATIVE_RAW_RESPONSE_ID_PATTERN.test(numeric[1]) || !Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(answer) || low > answer || answer > high) {
          throw new ValidationError('شرط الإجابة الرقمية لا يطابق صيغة الأرشيف المرجعي.');
        }
        if (opaqueAnswerIds.has(numeric[1])) throw new ValidationError('معرّف شرط رقمي مكرر بين أسئلة الحزمة.');
        opaqueAnswerIds.add(numeric[1]);
      }
      return value;
    });
    const aggregateScores = aggregateMetadata.map((match) => Number(match[3]));
    const total = sumPointValues(itemScores);
    const totalTicks = pointTicks(total);
    if (aggregateScores.length !== 2 || aggregateScores.some((value) => !Number.isFinite(value) || !hasPointPrecision(value) || pointTicks(value) !== totalTicks)) throw new ValidationError('مجموع درجات الأسئلة لا يطابق مجموع assessment وsection.');
    if (settings.mode === 'test') {
      const resourcePath = (identifier) => `${identifier}.dat`;
      const creation = files[resourcePath(reference.creationSettings)];
      const tocRoot = files[resourcePath(reference.tocRoot)];
      const tocInteractive = files[resourcePath(reference.tocInteractive)];
      const tocIndirect = files[resourcePath(reference.tocIndirect)];
      const rootContent = files[resourcePath(reference.rootContent)];
      const testContent = files[resourcePath(reference.testContent)];
      const interactiveContent = files[resourcePath(reference.interactiveContent)];
      const indirectContent = files[resourcePath(reference.indirectContent)];
      const gradebook = files[resourcePath(reference.gradebook)];
      const courseAssessment = files[resourcePath(reference.courseAssessment)];
      const courseLink = files[resourcePath(reference.link)];
      if ((creation.match(/<ASSESSMENTCREATIONSETTING\b/g) || []).length !== 1) throw new ValidationError('مورد إعداد إنشاء الاختبار يجب أن يحتوي سجلًا واحدًا فقط.');
      if ((gradebook.match(/<CATEGORY\b/g) || []).length !== 1
        || (gradebook.match(/<SCALE\b/g) || []).length !== 1
        || (gradebook.match(/<OUTCOMEDEFINITION\b/g) || []).length !== 1) {
        throw new ValidationError('دفتر الدرجات المنقّى يجب أن يحتوي فئة ومقياسًا وعمود اختبار واحدًا فقط.');
      }
      const assessmentObjectId = dat.match(/<assessmentmetadata>[\s\S]*?<bbmd_asi_object_id>(_[0-9]+_1)<\/bbmd_asi_object_id>/);
      if (!assessmentObjectId || nativeValue(creation, 'QTIASSESSMENTID', resourcePath(reference.creationSettings)) !== assessmentObjectId[1]) throw new ValidationError('إعدادات إنشاء الاختبار لا تشير إلى Assessment الصحيح.');
      const tocChecks = [[tocRoot, 'ROOT', 'true'], [tocInteractive, 'INTERACTIVE', 'false'], [tocIndirect, 'INDIRECT', 'false']];
      const tocResourceIds = [reference.tocRoot, reference.tocInteractive, reference.tocIndirect];
      tocChecks.forEach(([xml, label, entryPoint], index) => {
        nativeRootId(xml, 'COURSETOC', resourcePath(tocResourceIds[index]));
        if (nativeValue(xml, 'LABEL', 'COURSETOC') !== label || nativeValue(xml, 'ISENTYRPOINT', 'COURSETOC') !== entryPoint) throw new ValidationError(`إعداد COURSETOC ${label} غير صحيح.`);
      });
      const rootContentId = nativeRootId(rootContent, 'CONTENT', resourcePath(reference.rootContent));
      [rootContent, interactiveContent, indirectContent].forEach((xml) => {
        if (nativeValue(xml, 'TITLE', 'مجلد --TOP--') !== '--TOP--' || nativeValue(xml, 'CONTENTHANDLER', 'مجلد --TOP--') !== 'resource/x-bb-folder') throw new ValidationError('أحد مجلدات --TOP-- غير مطابق لبنية Blackboard.');
      });
      nativeRootId(interactiveContent, 'CONTENT', resourcePath(reference.interactiveContent));
      nativeRootId(indirectContent, 'CONTENT', resourcePath(reference.indirectContent));
      nativeRootId(testContent, 'CONTENT', resourcePath(reference.testContent));
      if (nativeValue(testContent, 'PARENTID', resourcePath(reference.testContent)) !== rootContentId
        || nativeValue(testContent, 'CONTENTHANDLER', resourcePath(reference.testContent)) !== 'resource/x-bb-asmt-test-link'
        || nativeValue(testContent, 'ISAVAILABLE', resourcePath(reference.testContent)) !== 'false') throw new ValidationError('رابط الاختبار داخل المحتوى غير متصل بالمجلد الجذر أو غير آمن افتراضيًا.');
      nativeRootId(courseAssessment, 'COURSEASSESSMENT', resourcePath(reference.courseAssessment));
      if (nativeValue(courseAssessment, 'ASMTID', resourcePath(reference.courseAssessment)) !== reference.assessment) throw new ValidationError('COURSEASSESSMENT لا يشير إلى مورد الاختبار.');
      nativeRootId(courseLink, 'LINK', resourcePath(reference.link));
      const referrer = courseLink.match(/<REFERRER\b([^>]*)\/>/);
      const referredTo = courseLink.match(/<REFERREDTO\b([^>]*)\/>/);
      if (!referrer || !referredTo || manifestAttribute(referrer[1], 'id') !== reference.testContent || manifestAttribute(referrer[1], 'type') !== 'CONTENT'
        || manifestAttribute(referredTo[1], 'id') !== reference.courseAssessment || manifestAttribute(referredTo[1], 'type') !== 'COURSE_ASSESSMENT') throw new ValidationError('مورد LINK لا يربط المحتوى بإعدادات الاختبار.');
      const gradebookContentId = nativeValue(gradebook, 'CONTENTID', resourcePath(reference.gradebook));
      const gradebookAssessmentId = nativeValue(gradebook, 'ASIDATAID', resourcePath(reference.gradebook));
      const gradebookPoints = Number(nativeValue(gradebook, 'POINTSPOSSIBLE', resourcePath(reference.gradebook)));
      if (gradebookContentId !== reference.testContent || gradebookAssessmentId !== reference.assessment || !validPoints(gradebookPoints) || pointTicks(gradebookPoints) !== totalTicks) throw new ValidationError('عمود الدرجات لا يشير إلى الاختبار أو لا يطابق مجموع نقاطه.');
      const categoryId = gradebook.match(/<CATEGORY\b[^>]*\bid="(_[0-9]+_1)"/);
      const scaleId = gradebook.match(/<SCALE\b[^>]*\bid="(_[0-9]+_1)"/);
      const outcomeId = gradebook.match(/<OUTCOMEDEFINITION\b[^>]*\bid="(_[0-9]+_1)"/);
      if (!categoryId || !scaleId || !outcomeId
        || nativeValue(gradebook, 'CATEGORYID', resourcePath(reference.gradebook)) !== categoryId[1]
        || nativeValue(gradebook, 'SCALEID', resourcePath(reference.gradebook)) !== scaleId[1]) throw new ValidationError('مراجع الفئة والمقياس داخل عمود الدرجات غير متطابقة.');
      const requiredGradebookSettings = new Map([
        ['DEFAULT_CUSTOM_VIEW_ID', ''], ['DEFAULT_GRADING_PERIOD_ID', ''], ['PUBLIC_ITEM__ID', ''],
        ['PUBLIC_FORCED', 'false'], ['SHOWFIRSTLAST', 'false'], ['SHOWLASTFIRST', 'true'],
        ['SHOWSTUDENTID', 'false'], ['SHOWUSERID', 'false'], ['NUM_FROZEN_COLUMNS', '2'],
        ['HIDE_UNAVAILABLE_STUDENTS', 'false'], ['ENABLE_AUTOMATIC_ZERO', 'false'],
        ['MASTERY_GRADEBOOK_VISIBILITY', 'DISABLED'], ['OUTCOME_VISIBILITY', 'DISABLED'],
        ['DISPLAY_STUDENT_ID', 'true'], ['NAME_DISPLAY_ORDER', 'LAST_NAME_FIRST_NAME'], ['WEIGHTTYPE', 'ITEM'],
      ]);
      requiredGradebookSettings.forEach((expectedValue, tagName) => {
        if (nativeValue(gradebook, tagName, resourcePath(reference.gradebook)) !== expectedValue) throw new ValidationError(`إعداد Gradebook ${tagName} غير مطابق.`);
      });
      const linkedObjectIds = [
        nativeRootId(creation, 'ASSESSMENTCREATIONSETTING', resourcePath(reference.creationSettings)),
        ...tocChecks.map(([xml], index) => nativeRootId(xml, 'COURSETOC', resourcePath(tocResourceIds[index]))),
        rootContentId,
        nativeRootId(testContent, 'CONTENT', resourcePath(reference.testContent)),
        nativeRootId(interactiveContent, 'CONTENT', resourcePath(reference.interactiveContent)),
        nativeRootId(indirectContent, 'CONTENT', resourcePath(reference.indirectContent)),
        nativeRootId(courseAssessment, 'COURSEASSESSMENT', resourcePath(reference.courseAssessment)),
        nativeRootId(courseLink, 'LINK', resourcePath(reference.link)),
      ];
      const gradebookIds = [categoryId[1], scaleId[1], outcomeId[1]];
      if (gradebookIds.length !== 3 || new Set([...objectIds, ...linkedObjectIds, ...gradebookIds]).size !== objectIds.length + linkedObjectIds.length + gradebookIds.length) throw new ValidationError('معرّفات موارد المقرر مفقودة أو مكررة.');
    }
    const xmlPayload = expectedPaths.filter((path) => path.endsWith('.xml') || path.endsWith('.dat')).map((path) => files[path]).join('\n');
    if (/<(?:script|iframe|object|embed|form|meta|base)\b/i.test(xmlPayload) || /\b(?:javascript|data:text\/html)\s*:/i.test(xmlPayload)) throw new ValidationError('حزمة Blackboard Native تحتوي محتوى نشطًا غير مسموح.');
    if (/(?:COURSEMEMBERSHIP|cx\.config\.learn|lms\.elearning\.edu\.sa)/i.test(Object.values(files).join('\n'))) throw new ValidationError('حزمة Blackboard Native تحتوي بيانات مؤسسة أو عضويات غير مسموح بها.');
    return { mode: settings.mode, itemCount, totalPoints: total };
  }

  return Object.freeze({
    assertXmlWellFormed,
    manifestAttribute,
    decodeOneXmlEntityLayer,
    validateNativeHtmlBlocks,
    parseNativePackageInfo,
    nativeRootId,
    nativeValue,
    validateNativeFiles
  });
});
