/* TXT export and the legacy internal QTI implementation (not a public export option). */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'), require('./question-validation.js'))
    : factory(modules['shared'], modules['question-validation']);
  if (node) module.exports = api;
  if (root) modules['txt-qti'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared, questionValidation) {
  'use strict';

  const { VERSION, ValidationError, decimalText, escapeXml, questionPoints, totalQuestionPoints } = shared;
  const { validateForFormat } = questionValidation;

  function buildTxt(questions) {
    const validation = validateForFormat(questions, 'txt');
    if (validation.errors.length) throw new ValidationError(validation.errors);

    function flat(value, label) {
      const text = String(value == null ? '' : value);
      if (/\t|\r|\n/.test(text)) throw new ValidationError(`${label} يحتوي على Tab أو سطر جديد ولا يمكن تصديره بأمان.`);
      return text;
    }

    const lines = questions.map((question) => {
      if (question.type === 'MC') {
        const fields = ['MC', flat(question.question, 'نص السؤال')];
        question.choices.forEach((choice) => fields.push(flat(choice.text, 'نص الخيار'), choice.correct ? 'correct' : 'incorrect'));
        return fields.join('\t');
      }
      if (question.type === 'TF') return ['TF', flat(question.question, 'نص السؤال'), question.answer ? 'true' : 'false'].join('\t');
      if (question.type === 'ESS') {
        const fields = ['ESS', flat(question.question, 'نص السؤال')];
        if (question.exampleAnswer) fields.push(flat(question.exampleAnswer, 'الإجابة النموذجية'));
        return fields.join('\t');
      }
      if (question.type === 'FIB') return ['FIB', flat(question.question, 'نص السؤال'), ...question.answers.map((answer) => flat(answer, 'إجابة الفراغ'))].join('\t');
      if (question.type === 'NUM') return ['NUM', flat(question.question, 'نص السؤال'), String(question.answer), String(question.tolerance)].join('\t');
      const fields = ['MAT', flat(question.question, 'نص السؤال')];
      question.pairs.forEach((pair) => fields.push(flat(pair.prompt, 'مطالبة المطابقة'), flat(pair.match, 'إجابة المطابقة')));
      return fields.join('\t');
    });
    return `\uFEFF${lines.join('\r\n')}`;
  }

  function qtiScoreOutcomes(points) {
    const maximum = decimalText(points, 5);
    return `<outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float" normalMinimum="0" normalMaximum="${maximum}"><defaultValue><value>0</value></defaultValue></outcomeDeclaration><outcomeDeclaration identifier="MAXSCORE" cardinality="single" baseType="float"><defaultValue><value>${maximum}</value></defaultValue></outcomeDeclaration>`;
  }

  function qtiMatchMaximumProcessing() {
    // match_correct always awards 0/1; an explicit rule preserves the chosen points.
    return '<responseProcessing><responseCondition><responseIf><match><variable identifier="RESPONSE"/><correct identifier="RESPONSE"/></match><setOutcomeValue identifier="SCORE"><variable identifier="MAXSCORE"/></setOutcomeValue></responseIf><responseElse><setOutcomeValue identifier="SCORE"><baseValue baseType="float">0</baseValue></setOutcomeValue></responseElse></responseCondition></responseProcessing>';
  }

  function buildQtiItem(question, index, options) {
    const validation = validateForFormat([question], 'qti');
    if (validation.errors.length) throw new ValidationError(validation.errors);
    const settings = Object.assign({ shuffleAnswers: false }, options || {});
    const itemId = `ITEM_${String(index).padStart(5, '0')}`;
    const fileId = `assessmentItem${String(index).padStart(5, '0')}`;
    const outcomes = qtiScoreOutcomes(questionPoints(question));
    const titleText = Array.from(question.question.replace(/\s+/g, ' ').trim()).slice(0, 80).join('') || `سؤال ${index}`;
    const title = escapeXml(`سؤال ${index}: ${titleText}`);
    const namespace = 'xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1p1.xsd"';
    let declarations = '';
    let body = '';
    let responseProcessing = '';

    if (question.type === 'MC' || question.type === 'TF' || question.type === 'MA') {
      const choices = question.type === 'TF'
        ? [
            { text: 'صواب', correct: question.answer === true },
            { text: 'خطأ', correct: question.answer === false },
          ]
        : question.choices;
      const multiple = question.type === 'MA';
      const correctValues = choices.map((choice, choiceIndex) => choice.correct ? `<value>CHOICE_${choiceIndex + 1}</value>` : '').join('');
      declarations = `<responseDeclaration identifier="RESPONSE" cardinality="${multiple ? 'multiple' : 'single'}" baseType="identifier"><correctResponse>${correctValues}</correctResponse></responseDeclaration>${outcomes}`;
      const choicesXml = choices.map((choice, choiceIndex) => `<simpleChoice identifier="CHOICE_${choiceIndex + 1}">${escapeXml(choice.text)}</simpleChoice>`).join('');
      const maxChoices = multiple ? (question.selectionLimit == null ? choices.filter((choice) => choice.correct).length : question.selectionLimit) : 1;
      body = `<itemBody><choiceInteraction responseIdentifier="RESPONSE" shuffle="${settings.shuffleAnswers ? 'true' : 'false'}" maxChoices="${maxChoices}"><prompt>${escapeXml(question.question)}</prompt>${choicesXml}</choiceInteraction></itemBody>`;
      responseProcessing = qtiMatchMaximumProcessing();
    } else if (question.type === 'ESS') {
      declarations = `<responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"/>${outcomes}`;
      body = `<itemBody><p>${escapeXml(question.question)}</p><extendedTextInteraction responseIdentifier="RESPONSE"/></itemBody>`;
    } else if (question.type === 'FIB') {
      declarations = `<responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"><correctResponse><value>${escapeXml(question.answers[0])}</value></correctResponse></responseDeclaration>${outcomes}`;
      const markerIndex = question.question.indexOf('____');
      let prompt;
      if (markerIndex >= 0) {
        const before = question.question.slice(0, markerIndex);
        const after = question.question.slice(markerIndex + 4);
        prompt = `${escapeXml(before)}<textEntryInteraction responseIdentifier="RESPONSE" expectedLength="${Math.max(1, question.answers[0].length)}"/>${escapeXml(after)}`;
      } else {
        prompt = `${escapeXml(question.question)} <textEntryInteraction responseIdentifier="RESPONSE" expectedLength="${Math.max(1, question.answers[0].length)}"/>`;
      }
      body = `<itemBody><p>${prompt}</p></itemBody>`;
      responseProcessing = qtiMatchMaximumProcessing();
    } else {
      throw new ValidationError(`نوع ${question.type} غير مدعوم في QTI.`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<assessmentItem ${namespace} identifier="${itemId}" title="${title}" xml:lang="ar" adaptive="false" timeDependent="false" toolName="Blackboard Questions Generator" toolVersion="${VERSION}">${declarations}${body}${responseProcessing}</assessmentItem>`;
    return { itemId, path: `qti21/${fileId}.xml`, xml };
  }

  function buildQtiManifest(items) {
    const dependencies = items.map((item) => `<dependency identifierref="RES_${item.itemId}"/>`).join('');
    const bankResource = `<resource identifier="question_bank00001" type="imsqti_test_xmlv2p1" href="qti21/question_bank00001.xml"><file href="qti21/question_bank00001.xml"/>${dependencies}</resource>`;
    const resources = items.map((item) => `<resource identifier="RES_${item.itemId}" type="imsqti_item_xmlv2p1" href="${item.path}"><file href="${item.path}"/></resource>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="MANIFEST_BLACKBOARD_QUESTIONS" xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/qtiv2p1_imscpv1p2_v1p0.xsd"><metadata><schema>QTIv2.1 Package</schema><schemaversion>1.0.0</schemaversion></metadata><organizations/><resources>${bankResource}${resources}</resources></manifest>`;
  }

  function buildQtiBank(items) {
    const refs = items.map((item) => `<assessmentItemRef identifier="${item.itemId}" href="${item.path.slice('qti21/'.length)}"/>`).join('');
    // Standard QTI grouping, like the supplied bank export; never a Native course test.
    return `<?xml version="1.0" encoding="UTF-8"?>\n<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/qti/qtiv2p1/imsqti_v2p1p1.xsd" identifier="question_bank00001" title="بنك أسئلة Blackboard"><testPart identifier="question_bank00001_1" navigationMode="nonlinear" submissionMode="simultaneous"><assessmentSection identifier="question_bank00001_1_1" visible="false" title="Section 1">${refs}</assessmentSection></testPart></assessmentTest>`;
  }

  function buildQtiFiles(questions, options) {
    const settings = Object.assign({ shuffleAnswers: false }, options || {});
    const validation = validateForFormat(questions, 'qti');
    if (validation.errors.length) throw new ValidationError(validation.errors);

    const items = questions.map((question, index) => buildQtiItem(question, index + 1, settings));
    const files = { 'imsmanifest.xml': buildQtiManifest(items), 'qti21/question_bank00001.xml': buildQtiBank(items) };
    items.forEach((item) => { files[item.path] = item.xml; });
    return { files, warnings: validation.warnings, itemCount: items.length, totalPoints: totalQuestionPoints(questions) };
  }

  return Object.freeze({
    buildTxt,
    qtiScoreOutcomes,
    qtiMatchMaximumProcessing,
    buildQtiItem,
    buildQtiManifest,
    buildQtiBank,
    buildQtiFiles
  });
});
