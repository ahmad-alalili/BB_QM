/* Clipboard operations and user-initiated provider navigation. */
(function (root, create) {
  'use strict';
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.BBInterfaceModules || (root.BBInterfaceModules = {}))['clipboard'] = api;
})(typeof window !== 'undefined' ? window : null, function create(context, actions) {
  'use strict';
  const {elements, state, PROVIDERS, window, document} = context;
  const navigator = window.navigator;

  function fallbackCopy(text) {
    const activeElement = document.activeElement;
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.setAttribute('readonly', '');
    temporary.setAttribute('aria-hidden', 'true');
    temporary.className = 'clipboard-helper';
    document.body.appendChild(temporary);
    temporary.select();
    let copied = false;
    try {
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } finally {
      temporary.remove();
      if (activeElement && typeof activeElement.focus === 'function') activeElement.focus();
    }
    if (!copied) throw new Error('copy_failed');
  }

  async function writePromptToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_error) {
        // Try the local selection fallback below when clipboard permission is unavailable.
      }
    }
    fallbackCopy(text);
  }

  function selectPromptForManualCopy() {
    elements.promptOutput.focus();
    elements.promptOutput.select();
  }

  function releaseClipboardBusy() {
    window.setTimeout(() => {
      state.clipboardBusy = false;
      actions.updatePromptControls();
    }, 200);
  }

  async function copyPrompt() {
    if (!actions.hasUsablePrompt() || state.clipboardBusy) return;
    const textToCopy = state.currentPrompt;
    const copyRevision = state.promptRevision;
    state.clipboardBusy = true;
    actions.updatePromptControls();
    try {
      await writePromptToClipboard(textToCopy);
      actions.measure('prompt_copied');
      if (copyRevision === state.promptRevision && !state.promptIsStale) {
        actions.setStatus(elements.promptStatus, 'تم نسخ البرومبت. ألصقه في خدمة الذكاء الاصطناعي مع الملفات التي اخترت إرفاقها.', 'success');
      } else {
        actions.setStatus(elements.promptStatus, 'تم نسخ النسخة الموجودة لحظة الضغط، لكن البرومبت تغيّر بعدها. انسخ النسخة الحالية مجددًا.', 'warning');
      }
    } catch (_error) {
      if (copyRevision !== state.promptRevision || state.promptIsStale) {
        actions.setStatus(
          elements.promptStatus,
          state.promptIsStale
            ? 'تغيّرت الإعدادات أثناء محاولة النسخ وتعذر النسخ. أعد إنشاء البرومبت قبل المحاولة مجددًا.'
            : 'تغيّر البرومبت أثناء محاولة النسخ وتعذر نسخ النسخة السابقة. حاول نسخ النسخة الحالية مجددًا.',
          'warning',
        );
      } else {
        actions.setStatus(elements.promptStatus, 'تعذر النسخ التلقائي. حُدّد النص الآن؛ استخدم Ctrl+C لنسخه يدويًا.', 'error');
        selectPromptForManualCopy();
      }
    } finally {
      releaseClipboardBusy();
    }
  }

  function copyAndOpenProvider(event) {
    const link = event.currentTarget;
    const provider = PROVIDERS[link.dataset.provider];
    if (!actions.hasUsablePrompt() || state.clipboardBusy) {
      event.preventDefault();
      actions.setStatus(
        elements.promptStatus,
        state.promptIsStale
          ? 'أعد إنشاء البرومبت بعد تغيير الإعدادات، ثم افتح الخدمة.'
          : 'أنشئ برومبت غير فارغ قبل فتح الخدمة.',
        'warning',
      );
      return;
    }
    const hasAllowedUrl = provider && link.href === new URL(provider.url).href;
    if (!hasAllowedUrl) {
      event.preventDefault();
      actions.setStatus(elements.promptStatus, 'تعذر فتح الخدمة لأن رابطها غير معتمد.', 'error');
      return;
    }

    actions.measure('provider_opened', { provider: link.dataset.provider });
    const textToCopy = state.currentPrompt;
    const copyRevision = state.promptRevision;
    state.clipboardBusy = true;
    elements.copyPrompt.disabled = true;
    elements.restorePrompt.disabled = true;
    elements.undoRestore.disabled = true;
    window.setTimeout(actions.updatePromptControls, 0);
    actions.setStatus(elements.promptStatus, `جارٍ نسخ البرومبت وفتح ${provider.name}…`, 'success');
    writePromptToClipboard(textToCopy)
      .then(() => {
        actions.measure('prompt_copied');
        if (copyRevision === state.promptRevision && !state.promptIsStale) {
          actions.setStatus(elements.promptStatus, `تم نسخ البرومبت. ألصقه داخل ${provider.name} وراجعه قبل الإرسال.`, 'success');
        } else {
          actions.setStatus(
            elements.promptStatus,
            `طُلب فتح ${provider.name}، لكن البرومبت تغيّر بعد الضغط. انسخ النسخة الحالية مجددًا قبل اللصق.`,
            'warning',
          );
        }
      })
      .catch(() => {
        if (copyRevision !== state.promptRevision || state.promptIsStale) {
          actions.setStatus(
            elements.promptStatus,
            state.promptIsStale
              ? `طُلب فتح ${provider.name}، لكن تغيّرت الإعدادات وتعذر النسخ. أعد إنشاء البرومبت قبل المحاولة مجددًا.`
              : `طُلب فتح ${provider.name}، لكن البرومبت تغيّر وتعذر نسخ النسخة السابقة. انسخ النسخة الحالية مجددًا.`,
            'warning',
          );
        } else {
          actions.setStatus(
            elements.promptStatus,
            `طُلب فتح ${provider.name}، لكن تعذر نسخ البرومبت. حُدد النص؛ استخدم Ctrl+C ثم ألصقه يدويًا.`,
            'error',
          );
          selectPromptForManualCopy();
        }
      })
      .finally(() => {
        releaseClipboardBusy();
      });
  }

  return Object.freeze({
    fallbackCopy,
    writePromptToClipboard,
    selectPromptForManualCopy,
    releaseClipboardBusy,
    copyPrompt,
    copyAndOpenProvider
  });
});
