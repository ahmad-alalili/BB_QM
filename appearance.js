(function (factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.initialize(document, window);
})(function () {
  'use strict';

  const FONT_KEY = 'bb-qm:interface-font:v1';
  const FONT_CHOICES = Object.freeze(['cairo', 'tajawal', 'plex', 'naskh', 'ruqaa', 'system']);
  const normalizeFont = value => FONT_CHOICES.includes(value) ? value : 'cairo';

  function prepareFonts(doc) {
    if (!doc.fonts || typeof doc.fonts.load !== 'function') return;
    // Warm the same-origin font cache without waiting or delaying interaction.
    // Never apply a font from a load callback: a later choice must always win.
    for (const family of ['BB Cairo', 'BB Tajawal', 'BB Plex', 'BB Naskh', 'BB Ruqaa']) {
      for (const weight of [400, 700]) {
        try {
          Promise.resolve(doc.fonts.load(`${weight} 16px "${family}"`, 'مساحة المدرب 0123456789 Blackboard')).catch(() => {});
        } catch (_) { /* The system fallback remains usable if a font is unavailable. */ }
      }
    }
  }

  function initialize(doc, win) {
    const picker = doc.getElementById('interface-font');
    if (!picker) return null;
    let saved;
    try { saved = win.localStorage.getItem(FONT_KEY); } catch (_) { /* Device preferences are optional. */ }

    function apply(value, remember) {
      const font = normalizeFont(value);
      doc.documentElement.dataset.uiFont = font;
      picker.value = font;
      if (remember) {
        try { win.localStorage.setItem(FONT_KEY, font); } catch (_) { /* Selection still applies to this page. */ }
      }
      return font;
    }

    apply(saved, false);
    const applySelection = () => apply(picker.value, true);
    picker.addEventListener('input', applySelection);
    picker.addEventListener('change', applySelection);
    prepareFonts(doc);
    // An appearance-only preference never reads or modifies question fields.
    return { apply };
  }

  return { FONT_KEY, FONT_CHOICES, normalizeFont, initialize };
});
