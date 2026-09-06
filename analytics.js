(function (root) {
  'use strict';
  const ENDPOINT = 'https://bb-qm-analytics-api.ahmad20xx2020.workers.dev';
  const TYPES = ['MC','TF','ESS','FIB','NUM','MAT','MA','EO','JUM','CALC'];
  const EVENTS = ['page_view','prompt_created','prompt_copied','prompt_edited','prompt_pasted',
    'response_pasted','provider_opened','response_validated','validation_failed','export_created','export_failed','points_changed'];
  const ERRORS = ['syntax','quota','structure','duplicate','points','unsupported_format','size_limit','package','clipboard','unknown'];
  function createAnalytics(env) {
    const key = 'bb-qm:aggregate-enabled:v2';
    let choice = 'yes', viewed = false, sentCount = 0;
    const sent = new Set(), active = new Set();
    try {
      const saved = env.localStorage.getItem(key);
      if (saved === 'yes' || saved === 'no') choice = saved;
      else if (env.localStorage.getItem('bb-qm:measurement-consent:v1') === 'no') choice = 'no';
    } catch (_) { /* No persistent tracking state is required. */ }
    const privateMode = () => env.navigator.globalPrivacyControl === true || env.navigator.doNotTrack === '1';
    const production = () => env.location.origin === 'https://ahmad-alalili.github.io'
      && /^\/BB_QM\/(?:index\.html)?$/.test(env.location.pathname);
    const enabled = () => choice === 'yes' && !privateMode() && production();
    function makePayload(name, input) {
      if (!EVENTS.includes(name)) return null;
      const payload = { version:2, site:'BB_QM', event:name };
      if (['prompt_created','response_validated','export_created'].includes(name)) {
        const counts = {};
        for (const type of TYPES) {
          const n = input.counts?.[type];
          if (n === undefined || n === 0) continue;
          if (!Number.isInteger(n) || n < 1 || n > 250) return null;
          counts[type] = n;
        }
        const total = Object.values(counts).reduce((sum,n) => sum+n,0);
        if (total < 1 || total > 250) return null;
        payload.counts = counts;
      }
      if (name === 'export_created') {
        if (!['native-bank','native-test','txt'].includes(input.format)) return null;
        payload.format = input.format;
      }
      if (['validation_failed','export_failed'].includes(name)) payload.error = ERRORS.includes(input.error) ? input.error : 'unknown';
      return payload;
    }
    async function track(name, input = {}) {
      try {
        if (!enabled() || sentCount >= 120) return;
        const payload = makePayload(name,input);
        if (!payload) return;
        // Optional local-only batch key: never placed in the network payload.
        const batched = ['response_validated','export_created'].includes(name);
        if (batched && !Number.isSafeInteger(input.batch)) return;
        const dedup = batched ? `${name}:${input.batch}:${name === 'export_created' ? input.format : ''}` : '';
        if (dedup && sent.has(dedup)) return;
        if (dedup) sent.add(dedup);
        sentCount++;
        const controller = new AbortController();
        active.add(controller);
        const timer = env.setTimeout(() => controller.abort(),5000);
        try {
          // One attempt only: a lost acknowledgement must not double a counter.
          await env.fetch(ENDPOINT+'/aggregate', { method:'POST', credentials:'omit', referrerPolicy:'no-referrer',
            headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload), keepalive:true, signal:controller.signal });
        } finally { env.clearTimeout(timer); active.delete(controller); }
      } catch (_) { /* Counting never blocks copying, editing or exporting. */ }
    }
    function start() {
      if (enabled() && !viewed && env.document?.visibilityState !== 'hidden') {
        viewed = true; void track('page_view');
      }
    }
    function setConsent(value) {
      choice = value === 'yes' ? 'yes' : 'no';
      if (choice === 'no') { for (const controller of active) controller.abort(); active.clear(); }
      try { env.localStorage.setItem(key,choice); } catch (_) { /* This page still respects the choice. */ }
      start();
    }
    async function totals() {
      const controller = new AbortController(), timer = env.setTimeout(() => controller.abort(),5000);
      try {
        const response = await env.fetch(ENDPOINT+'/public-stats', { credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const text = await response.text();
        if (text.length > 4096) throw new Error('invalid_stats');
        const data = JSON.parse(text);
        if (data.ok !== true || data.version !== 2 || data.mode !== 'aggregate'
          || !['page_views','validated_questions','exports_prepared'].every(k => Number.isSafeInteger(data.totals?.[k]) && data.totals[k] >= 0)
          || (data.since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data.since))) throw new Error('invalid_stats');
        return data;
      } finally { env.clearTimeout(timer); }
    }
    return { track,start,setConsent,totals,status:() => privateMode() ? 'privacy' : !production() ? 'local' : choice };
  }
  if (typeof module === 'object' && module.exports) { module.exports = { createAnalytics }; return; }
  const client = createAnalytics(root);
  root.BBAnalytics = client;
  const byId = id => root.document.getElementById(id);
  function showPreference() {
    const state = client.status();
    const message = state === 'privacy' ? 'العدّ متوقف احترامًا لإشارة الخصوصية في متصفحك.'
      : state === 'local' ? 'هذه معاينة محلية؛ لا تُرسل منها أرقام استخدام.'
      : state === 'no' ? 'العدّ متوقف حسب اختيارك المحفوظ. جميع الأدوات متاحة.'
      : 'العدّ الإجمالي مفعّل. يمكنك إيقافه دون تعطيل أي أداة.';
    byId('analytics-preference').textContent = message;
    byId('analytics-notice-status').textContent = message;
    byId('analytics-allow').disabled = state === 'privacy' || state === 'local' || state === 'yes';
    byId('analytics-decline').disabled = state === 'no' || state === 'privacy' || state === 'local';
  }
  byId('analytics-allow').addEventListener('click',() => { client.setConsent('yes'); showPreference(); });
  byId('analytics-decline').addEventListener('click',() => { client.setConsent('no'); showPreference(); });
  byId('analytics-notice-stop').addEventListener('click',() => { client.setConsent('no'); showPreference(); });
  const notice = byId('analytics-notice'), noticeKey = 'bb-qm:aggregate-notice:v2';
  try { notice.hidden = root.localStorage.getItem(noticeKey) === 'seen'; } catch (_) { notice.hidden = false; }
  byId('analytics-notice-close').addEventListener('click',() => {
    notice.hidden = true;
    try { root.localStorage.setItem(noticeKey,'seen'); } catch (_) { /* Informational notice only. */ }
  });
  async function refresh() {
    const button = byId('analytics-refresh'); button.disabled = true;
    byId('analytics-status').textContent = 'جارٍ جلب الإجماليات…';
    try {
      const data = await client.totals();
      for (const field of ['page_views','validated_questions','exports_prepared']) byId('total-'+field).textContent = new Intl.NumberFormat('ar-SA').format(data.totals[field]);
      byId('analytics-status').textContent = data.since
        ? `إجماليات العدّ الجديد منذ ${data.since} (UTC). قد يتأخر التحديث دقيقة؛ التفاصيل اليومية خاصة بمالك الموقع.`
        : 'بدأ نظام العدّ الإجمالي الجديد؛ لا توجد أرقام مسجّلة فيه بعد.';
    } catch (_) {
      for (const field of ['page_views','validated_questions','exports_prepared']) byId('total-'+field).textContent = '—';
      byId('analytics-status').textContent = 'تعذر جلب الإحصائيات الآن. لا يؤثر ذلك في إنشاء الأسئلة أو تصديرها.';
    } finally { button.disabled = false; }
  }
  byId('analytics-refresh').addEventListener('click',refresh);
  root.document.addEventListener('visibilitychange',() => client.start());
  showPreference(); client.start(); void refresh();
}(typeof window === 'object' ? window : globalThis));
