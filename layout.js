(function (factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.initialize(document, window);
})(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 820px)';
  function resolveMode(preference, narrow) {
    return preference === 'mobile' || (preference !== 'desktop' && narrow) ? 'mobile' : 'desktop';
  }

  function initialize(doc, win) {
    const root = doc.documentElement;
    const picker = doc.getElementById('layout-mode');
    const nav = doc.getElementById('mobile-step-nav');
    const panels = ['prompt-panel', 'export-panel'].map(id => doc.getElementById(id));
    const tabs = ['step-prompt-tab', 'step-export-tab'].map(id => doc.getElementById(id));
    const headings = ['prompt-section-title', 'export-section-title'].map(id => doc.getElementById(id));
    if (!picker || !nav || [...panels, ...tabs, ...headings].some(node => !node)) return null;
    const media = typeof win.matchMedia === 'function' ? win.matchMedia(MOBILE_QUERY) : null;
    let activeStep = 0;
    let mode = 'desktop';

    function render() {
      const compact = mode === 'mobile';
      root.dataset.layout = mode;
      nav.hidden = !compact;
      panels.forEach((panel, index) => {
        panel.hidden = compact && activeStep !== index;
        panel.setAttribute('role', compact ? 'tabpanel' : 'region');
        panel.setAttribute('aria-labelledby', compact ? tabs[index].id : headings[index].id);
        tabs[index].setAttribute('aria-selected', String(activeStep === index));
        tabs[index].tabIndex = activeStep === index ? 0 : -1;
      });
    }

    function updateMode() {
      // Keep the currently edited step visible across rotation or resizing.
      const focusedStep = panels.findIndex(panel => panel.contains(doc.activeElement));
      if (focusedStep !== -1) activeStep = focusedStep;
      mode = resolveMode(picker.value, media ? media.matches : win.innerWidth <= 820);
      render();
    }

    function selectStep(index, focusHeading) {
      if (index !== 0 && index !== 1) return;
      activeStep = index;
      render();
      if (focusHeading) {
        headings[index].focus({ preventScroll: true });
        panels[index].scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectStep(index, false));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = 1 - index;
        else return;
        event.preventDefault();
        selectStep(next, false);
        tabs[next].focus();
      });
    });
    doc.getElementById('go-to-export').addEventListener('click', () => selectStep(1, true));
    doc.getElementById('back-to-prompt').addEventListener('click', () => selectStep(0, true));
    panels.forEach((panel, index) => panel.addEventListener('focusin', () => { activeStep = index; }));
    picker.addEventListener('change', updateMode);
    if (media && typeof media.addEventListener === 'function') media.addEventListener('change', updateMode);
    else if (media && typeof media.addListener === 'function') media.addListener(updateMode);
    else win.addEventListener('resize', updateMode);

    // Explicit roles preserve the table relationships when CSS presents rows
    // as phone cards. These are the same fields, not a second editable copy.
    doc.querySelectorAll('table').forEach(table => {
      table.setAttribute('role', 'table');
      table.querySelectorAll('thead, tbody, tfoot').forEach(group => group.setAttribute('role', 'rowgroup'));
      table.querySelectorAll('tr').forEach(row => row.setAttribute('role', 'row'));
      table.querySelectorAll('td').forEach(cell => cell.setAttribute('role', 'cell'));
      table.querySelectorAll('th').forEach(cell => cell.setAttribute('role', cell.scope === 'row' ? 'rowheader' : 'columnheader'));
    });
    doc.querySelectorAll('.matrix-cell').forEach(input => {
      const names = { easy: 'سهل', medium: 'متوسط', hard: 'صعب', expert: 'صعب جدًا' };
      input.parentElement.dataset.label = names[input.dataset.level];
    });
    doc.querySelectorAll('.row-total').forEach(output => { output.parentElement.dataset.label = 'المجموع'; });
    updateMode();
    return { selectStep, updateMode };
  }

  return Object.freeze({ MOBILE_QUERY, resolveMode, initialize });
});
