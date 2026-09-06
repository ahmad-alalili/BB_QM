(function (root) {
  'use strict';
  const ENDPOINT = 'https://bb-qm-analytics-api.ahmad20xx2020.workers.dev';
  const TYPES = ['MC', 'TF', 'ESS', 'FIB', 'NUM', 'MAT', 'MA', 'EO', 'JUM', 'CALC'];
  const EVENTS = ['page_view', 'prompt_created', 'prompt_copied', 'provider_opened',
    'response_validated', 'validation_failed', 'export_created', 'export_failed', 'points_changed'];
  const ERRORS = ['syntax', 'quota', 'structure', 'duplicate', 'points', 'unsupported_format', 'size_limit', 'package', 'clipboard', 'unknown'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function createAnalytics(env) {
    const key = 'bb-qm:measurement-consent:v1';
    let consent = '';
    let session = '';
    let viewed = false;
    let epoch = 0;
    let sentCount = 0;
    const sent = new Set();
    const active = new Set();
    try { consent = env.localStorage.getItem(key) || ''; } catch (_) { /* Storage may be blocked. */ }
    const privateMode = () => env.navigator.globalPrivacyControl === true || env.navigator.doNotTrack === '1';
    const production = () => env.location.origin === 'https://ahmad-alalili.github.io'
      && /^\/BB_QM\/(?:index\.html)?$/.test(env.location.pathname);
    const enabled = () => consent === 'yes' && !privateMode() && production();
    const uuid = () => env.crypto.randomUUID();

    function makePayload(name, input) {
      if (!EVENTS.includes(name)) return null;
      const counted = ['prompt_created', 'response_validated', 'export_created'].includes(name);
      const questionTypes = {};
      if (counted) {
        for (const type of TYPES) {
          const count = input.counts?.[type];
          if (count === undefined || count === 0) continue;
          if (!Number.isInteger(count) || count < 1 || count > 250) return null;
          questionTypes[type] = count;
        }
      }
      const total = Object.values(questionTypes).reduce((sum, n) => sum + n, 0);
      if (counted && (total < 1 || total > 250)) return null;
      const batched = ['response_validated', 'export_created', 'points_changed'].includes(name);
      if (batched && !UUID.test(input.batch || '')) return null;
      const formatted = ['response_validated', 'export_created', 'points_changed', 'validation_failed', 'export_failed'].includes(name);
      if (formatted && !['native-bank', 'native-test', 'txt'].includes(input.format)) return null;
      if (name === 'points_changed' && input.format === 'txt') return null;
      if (name === 'provider_opened' && !['chatgpt', 'claude', 'gemini'].includes(input.provider)) return null;
      if (!session) session = uuid();
      return {
        version: 1, site: 'BB_QM', event_id: uuid(), event_name: name, session_id: session,
        batch_id: batched ? input.batch : null,
        export_format: formatted ? input.format : '',
        device_class: env.innerWidth < 600 ? 'phone' : env.innerWidth < 1024 ? 'tablet' : 'desktop',
        provider: name === 'provider_opened' ? input.provider : '',
        question_count: total, question_types: questionTypes,
        error_code: ['validation_failed', 'export_failed'].includes(name)
          ? (ERRORS.includes(input.error) ? input.error : 'unknown') : '',
      };
    }

    async function track(name, input = {}) {
      try {
        if (!enabled() || sentCount >= 120) return;
        const payload = makePayload(name, input);
        if (!payload) return;
        // A validation is counted once per response in this page, even across formats.
        const dedup = ['response_validated', 'export_created', 'points_changed'].includes(name)
          ? `${name}:${input.batch}:${name === 'export_created' ? input.format : ''}` : '';
        if (dedup && sent.has(dedup)) return;
        if (dedup) sent.add(dedup);
        sentCount++;
        const started = epoch;
        for (let attempt = 0; attempt < 2 && enabled() && started === epoch; attempt++) {
          const controller = new AbortController();
          active.add(controller);
          const timer = env.setTimeout(() => controller.abort(), 5000);
          let retry = false;
          try {
            const response = await env.fetch(ENDPOINT + '/collect', {
              method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
              keepalive: true, signal: controller.signal,
            });
            retry = response.status >= 500;
          } catch (_) { retry = true; }
          finally { env.clearTimeout(timer); active.delete(controller); }
          if (!retry) break;
        }
      } catch (_) { /* Analytics must never affect editing, copying, or exporting. */ }
    }

    function start() {
      if (enabled() && !viewed) { viewed = true; void track('page_view'); }
    }
    function setConsent(value) {
      consent = value === 'yes' ? 'yes' : 'no';
      epoch++;
      for (const controller of active) controller.abort();
      active.clear();
      if (consent === 'no') { session = ''; sent.clear(); }
      try { env.localStorage.setItem(key, consent); } catch (_) { /* Applies to this page only. */ }
      start();
    }
    async function totals() {
      const controller = new AbortController();
      const timer = env.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await env.fetch(ENDPOINT + '/public-stats', {
          credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
        });
        if (!response.ok) throw new Error('unavailable');
        const text = await response.text();
        if (text.length > 4096) throw new Error('invalid_stats');
        const data = JSON.parse(text);
        if (data.ok !== true || !['page_views', 'validated_questions', 'exports_prepared'].every(field =>
          Number.isSafeInteger(data.totals?.[field]) && data.totals[field] >= 0)) throw new Error('invalid_stats');
        return data;
      } finally { env.clearTimeout(timer); }
    }
    return { track, start, setConsent, totals, status: () => privateMode() ? 'privacy' : consent || 'unset' };
  }

  if (typeof module === 'object' && module.exports) { module.exports = { createAnalytics }; return; }
  const client = createAnalytics(root);
  root.BBAnalytics = client;
  const byId = id => root.document.getElementById(id);
  function showPreference() {
    const state = client.status();
    byId('analytics-preference').textContent = state === 'privacy'
      ? 'جمع الإحصائيات متوقف احترامًا لإشارة الخصوصية في متصفحك.'
      : state === 'yes' ? 'المشاركة مفعّلة؛ يمكنك إيقافها في أي وقت.'
      : state === 'no' ? 'المشاركة متوقفة. جميع أدوات الموقع متاحة لك.'
      : 'المشاركة اختيارية ومتوقفة حتى توافق. جميع الأدوات متاحة دون الموافقة.';
    byId('analytics-allow').disabled = state === 'privacy' || state === 'yes';
    byId('analytics-decline').disabled = state === 'no';
  }
  byId('analytics-allow').addEventListener('click', () => { client.setConsent('yes'); showPreference(); });
  byId('analytics-decline').addEventListener('click', () => { client.setConsent('no'); showPreference(); });
  async function refresh() {
    const button = byId('analytics-refresh');
    button.disabled = true;
    byId('analytics-status').textContent = 'جارٍ جلب الإجماليات…';
    try {
      const data = await client.totals();
      for (const field of ['page_views', 'validated_questions', 'exports_prepared']) {
        byId('total-' + field).textContent = new Intl.NumberFormat('ar-SA').format(data.totals[field]);
      }
      byId('analytics-status').textContent = 'إجماليات المشاركين في القياس فقط؛ قد يتأخر التحديث دقيقة. التفاصيل غير منشورة.';
    } catch (_) {
      for (const field of ['page_views', 'validated_questions', 'exports_prepared']) byId('total-' + field).textContent = '—';
      byId('analytics-status').textContent = 'تعذر جلب الإحصائيات الآن. لا يؤثر ذلك في إنشاء الأسئلة أو تصديرها.';
    } finally { button.disabled = false; }
  }
  byId('analytics-refresh').addEventListener('click', refresh);
  showPreference();
  client.start();
  void refresh();
}(typeof window === 'object' ? window : globalThis));
