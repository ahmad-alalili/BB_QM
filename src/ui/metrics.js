/* Optional aggregate measurement; never pass question text to the service. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['metrics'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {elements, window} = context;


  const analyticsBatches = new Map();

  let nextAnalyticsBatch = 0;

  function analyticsBatch() {
    const source = elements.aiResponse.value;
    if (!analyticsBatches.has(source)) {
      if (analyticsBatches.size >= 20) analyticsBatches.delete(analyticsBatches.keys().next().value);
      analyticsBatches.set(source, ++nextAnalyticsBatch);
    }
    return analyticsBatches.get(source);
  }

  function measure(name, metadata = {}) {
    try { void window.BBAnalytics?.track(name, metadata); } catch (_) { /* Optional measurement. */ }
  }

  function measureQuestions(name, questions, format) {
    try {
      const counts = {};
      questions.forEach(question => { counts[question.type] = (counts[question.type] || 0) + 1; });
      measure(name, { counts, format, batch: analyticsBatch() });
    } catch (_) { /* No question text is passed to analytics. */ }
  }

  function measurePoints() {
    try { measure('points_changed', { format: actions.selectedFormat(), batch: analyticsBatch() }); } catch (_) { /* Optional. */ }
  }

  return Object.freeze({
    analyticsBatch,
    measure,
    measureQuestions,
    measurePoints
  });
});
