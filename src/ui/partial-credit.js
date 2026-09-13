/* Multiple-answer limits, credit levels, percentages, and their visual editor. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['partial-credit'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {core, elements, all, document} = context;


  function syncMultipleAnswerLimits() {
    if (elements.maChoiceCount.value === '') return false;
    const rawChoices = Number(elements.maChoiceCount.value);
    if (!Number.isFinite(rawChoices)) return false;
    const choiceCount = Math.max(2, Math.min(100, Math.trunc(rawChoices)));
    if (rawChoices !== choiceCount) elements.maChoiceCount.value = String(choiceCount);

    const maximum = choiceCount - 1;
    elements.maCorrectCount.max = String(maximum);
    let correctChanged = false;
    if (elements.maCorrectCount.value !== '') {
      const rawCorrect = Number(elements.maCorrectCount.value);
      if (Number.isFinite(rawCorrect)) {
        const correctCount = Math.max(1, Math.min(maximum, Math.trunc(rawCorrect)));
        if (rawCorrect !== correctCount) {
          elements.maCorrectCount.value = String(correctCount);
          correctChanged = true;
        }
      }
    }

    elements.maSelectionLimit.min = '1';
    elements.maSelectionLimit.max = String(maximum);
    elements.maSelectionLimit.value = elements.maCorrectCount.value;
    return correctChanged;
  }

  function creditRowsProfile() {
    return all('.credit-row', elements.maCreditRows).map((row) => ({
      level: row.querySelector('.ma-credit-level').value,
      percent: row.querySelector('.ma-credit-percent').value,
    }));
  }

  function updateCreditSummary() {
    const profile = creditRowsProfile();
    const parsed = profile.map((entry) => core.parseFiniteNumber(entry.percent));
    const total = parsed.reduce((sum, value) => sum + (value == null ? 0 : value), 0);
    const validNumbers = parsed.every((value) => value != null && value > 0 && value <= 100);
    const exactTotal = Math.round(total * 100000) === 10000000;
    const levels = profile.map((entry) => entry.level);
    const mostCount = levels.filter((level) => level === 'most_correct').length;
    const leastCount = levels.filter((level) => level === 'least_correct').length;
    const correctCount = profile.length;
    const validLevels = correctCount === 1
      ? levels[0] === 'correct'
      : mostCount === 1 && leastCount === 1 && levels.filter((level) => level === 'correct').length === correctCount - 2;
    let ordered = true;
    if (validNumbers && validLevels && correctCount > 1) {
      const most = parsed[levels.indexOf('most_correct')];
      const least = parsed[levels.indexOf('least_correct')];
      ordered = most > least && parsed.every((value, index) => {
        if (levels[index] === 'most_correct' || levels[index] === 'least_correct') return true;
        return most > value && value > least;
      });
    }
    const ready = validNumbers && exactTotal && validLevels && ordered;
    elements.maCreditTotal.textContent = `${Number(total.toFixed(5))}%`;
    elements.maCreditTotal.classList.toggle('mismatch', !ready);
    elements.maCreditState.classList.toggle('mismatch', !ready);
    elements.maCreditState.textContent = ready
      ? 'التوزيع جاهز'
      : (!exactTotal ? 'يجب أن يكون المجموع 100%' : (!validLevels ? 'راجع مستويات الصحة' : 'راجع ترتيب النسب'));
  }

  function renderCreditRows(profile) {
    const entries = Array.isArray(profile) && profile.length === actions.safeCorrectCount()
      ? profile
      : core.smartCreditProfile(actions.safeCorrectCount());
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'credit-row';

      const number = document.createElement('span');
      number.className = 'credit-answer-index';
      number.textContent = `الإجابة ${index + 1}`;

      const levelLabel = document.createElement('label');
      levelLabel.className = 'credit-field';
      levelLabel.textContent = 'مستوى الصحة';
      const level = document.createElement('select');
      level.className = 'ma-credit-level';
      level.dataset.creditControl = 'true';
      level.setAttribute('aria-label', `مستوى صحة الإجابة ${index + 1}`);
      Object.entries(core.CREDIT_LEVEL_LABELS).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = entry.level === value;
        level.appendChild(option);
      });
      levelLabel.appendChild(level);

      const percentLabel = document.createElement('label');
      percentLabel.className = 'credit-field';
      percentLabel.textContent = 'النسبة';
      const percentWrap = document.createElement('span');
      percentWrap.className = 'credit-percent-wrap';
      const percent = document.createElement('input');
      percent.className = 'ma-credit-percent';
      percent.dataset.creditControl = 'true';
      percent.type = 'number';
      percent.inputMode = 'decimal';
      percent.min = '0.00001';
      percent.max = '100';
      percent.step = '0.00001';
      percent.value = String(entry.percent);
      percent.setAttribute('aria-label', `نسبة الإجابة الصحيحة ${index + 1}`);
      const suffix = document.createElement('span');
      suffix.textContent = '%';
      percentWrap.append(percent, suffix);
      percentLabel.appendChild(percentWrap);

      row.append(number, levelLabel, percentLabel);
      fragment.appendChild(row);
    });
    elements.maCreditRows.replaceChildren(fragment);
    updatePartialCreditUi();
    updateCreditSummary();
  }

  function updatePartialCreditUi() {
    const enabled = elements.maPartialCredit.checked;
    elements.maCreditEditor.hidden = !enabled;
    elements.maCreditEditor.classList.toggle('disabled-option', !enabled);
    elements.maCreditEditor.setAttribute('aria-disabled', String(!enabled));
    elements.maSmartDistribute.disabled = !enabled;
    all('[data-credit-control]', elements.maCreditRows).forEach((control) => { control.disabled = !enabled; });
  }

  return Object.freeze({
    syncMultipleAnswerLimits,
    creditRowsProfile,
    updateCreditSummary,
    renderCreditRows,
    updatePartialCreditUi
  });
});
