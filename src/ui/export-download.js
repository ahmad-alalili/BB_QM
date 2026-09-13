/* ZIP verification and downloads after the final question/points review. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['export-download'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {core, elements, all, window, document} = context;


  function fileDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function verifyNativeZip(blob, mode) {
    if (blob.size > 32 * 1024 * 1024) throw new core.ValidationError('حزمة Blackboard Native تتجاوز حد الأمان المحلي البالغ 32 MB.');
    const loaded = await window.JSZip.loadAsync(blob, { checkCRC32: true, createFolders: false });
    const entries = Object.values(loaded.files);
    const paths = entries.map((entry) => entry.name).sort();
    if (entries.some((entry) => entry.dir)) {
      throw new core.ValidationError('فشل فحص محتويات ZIP بعد إنشائها.');
    }
    const files = {};
    for (const path of paths) files[path] = await loaded.file(path).async('string');
    const report = core.validateNativeFiles(files, { mode });
    let fingerprint = '';
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      fingerprint = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
    }
    return { ...report, fingerprint };
  }

  function setExportControlsDisabled(disabled) {
    [
      elements.aiResponse,
      elements.nativeTitle,
      elements.bankTitle,
      elements.validateResponse,
      elements.exportResponse,
      elements.bulkPoints,
      elements.applyPointsAll,
      elements.resetPoints,
      elements.downloadReviewed,
      ...all('input[name="export-format"]'),
      ...all('.question-point', elements.pointsList),
    ].forEach((control) => { control.disabled = disabled; });
  }

  async function exportResponse() {
    const result = actions.validateResponse();
    if (!result.ok) return;
    if (result.pointsInitialized) {
      actions.setStatus(elements.exportStatus, 'ظهرت نقاط الأسئلة للمراجعة. عدّلها أو اتركها كما هي، ثم اضغط «تدقيق وتنزيل» مرة أخرى.', 'warning');
      elements.pointsTitle.focus();
      return;
    }

    setExportControlsDisabled(true);
    try {
      if (result.format === 'txt') {
        const output = core.buildTxt(result.questions);
        downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), `blackboard-questions-${fileDate()}.txt`);
        actions.measureQuestions('export_created', result.questions, result.format);
        actions.setStatus(elements.exportStatus, `تم تنزيل ملف TXT. عدد الأسئلة: ${result.questions.length}.`, 'success');
      } else {
        if (typeof window.JSZip !== 'function') {
          throw new core.ValidationError('تعذر تحميل مكتبة إنشاء ZIP المحلية. تأكد من وجود مجلد vendor كاملًا.');
        }
        const mode = result.format === 'native-bank' ? 'pool' : 'test';
        const processingMessage = mode === 'pool' ? 'جارٍ إنشاء بنك Blackboard الأصلي والتحقق من أسئلته ونقاطه…' : 'جارٍ إنشاء حزمة Blackboard Native تجريبية والتحقق منها قبل التنزيل…';
        actions.setStatus(elements.exportStatus, processingMessage, 'warning');
        actions.setStatus(elements.pointsStatus, processingMessage, 'warning');
        const packageData = core.buildNativeFiles(result.questions, {
          mode,
          title: mode === 'pool' ? elements.bankTitle.value : elements.nativeTitle.value,
          shuffleAnswers: elements.shuffleAnswers.checked,
        });
        const zip = new window.JSZip();
        Object.entries(packageData.files).forEach(([path, content]) => zip.file(path, content));
        const blob = await zip.generateAsync({
          type: 'blob',
          compression: 'STORE',
          platform: 'DOS',
        });
        const report = await verifyNativeZip(blob, mode);
        const label = mode === 'pool' ? 'بنك Blackboard الأصلي' : 'حزمة اختبار مرتبطة بالمقرر وغير متاحة للطلاب افتراضيًا';
        const filename = mode === 'pool' ? 'blackboard-question-bank' : 'blackboard-course-test';
        downloadBlob(blob, `${filename}-${fileDate()}.zip`);
        actions.measureQuestions('export_created', result.questions, result.format);
        const fingerprint = report.fingerprint ? ` بصمة SHA-256 المختصرة: ${report.fingerprint}.` : '';
        const completionMessage = `تم تنزيل ${label}. الأسئلة: ${report.itemCount}، مجموع النقاط: ${report.totalPoints}.${fingerprint} ${mode === 'pool' ? 'استورده من بنوك الأسئلة وراجع النقاط بعد الاستيراد.' : 'اختبره في مقرر تجريبي أولًا.'}`;
        actions.setStatus(elements.exportStatus, completionMessage, 'warning');
        actions.setStatus(elements.pointsStatus, completionMessage, 'warning');
      }
    } catch (error) {
      const messages = error instanceof core.ValidationError ? error.messages : ['تعذر إنشاء الملف بسبب خطأ غير متوقع.'];
      actions.measure('export_failed', { format: result.format, error: 'package' });
      actions.setStatus(elements.exportStatus, messages.join(' '), 'error');
      if (actions.formatHasPoints(result.format)) actions.setStatus(elements.pointsStatus, messages.join(' '), 'error');
    } finally {
      setExportControlsDisabled(false);
    }
  }

  return Object.freeze({
    fileDate,
    downloadBlob,
    verifyNativeZip,
    setExportControlsDisabled,
    exportResponse
  });
});
