/* Small shared UI helpers and export-format predicates. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['helpers'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {elements, all, document} = context;


  function numericValue(input) {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : 0;
  }

  function cloneQuestionSettings(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function safeCorrectCount() {
    const choices = Number(elements.maChoiceCount.value);
    const maximum = Number.isInteger(choices) && choices >= 2 && choices <= 100 ? choices - 1 : 99;
    return Math.max(1, Math.min(maximum, Math.trunc(numericValue(elements.maCorrectCount)) || 1));
  }

  function setStatus(element, message, kind) {
    const isError = kind === 'error';
    element.setAttribute('role', isError ? 'alert' : 'status');
    element.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    element.className = `status${kind ? ` ${kind}` : ''}`;
    element.textContent = message || '';
  }

  function clearInvalid() {
    all('[aria-invalid="true"]').forEach((element) => element.removeAttribute('aria-invalid'));
  }

  function markInvalid(element) {
    if (!element) return;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    }
    element.setAttribute('aria-invalid', 'true');
    element.focus();
  }

  function selectedFormat() {
    return document.querySelector('input[name="export-format"]:checked').value;
  }

  function formatHasPoints(format) {
    return format === 'native-bank' || format === 'native-test';
  }

  return Object.freeze({
    numericValue,
    cloneQuestionSettings,
    safeCorrectCount,
    setStatus,
    clearInvalid,
    markInvalid,
    selectedFormat,
    formatHasPoints
  });
});
