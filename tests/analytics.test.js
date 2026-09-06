'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAnalytics } = require('../analytics.js');
const { readFileSync } = require('node:fs');

function setup(overrides = {}) {
  const calls = [];
  const stored = new Map();
  const env = { navigator: {}, innerWidth: 375, crypto: { randomUUID },
    location: { origin: 'https://ahmad-alalili.github.io', pathname: '/BB_QM/' },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    setTimeout, clearTimeout,
    fetch: async (url, options) => { calls.push({ url, ...options }); return new Response('{}', { status: 201 }); },
    ...overrides };
  const client = createAnalytics(env);
  return { client, calls, stored, env };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('measurement is off by default and stores only the consent preference', async () => {
  const { client, calls, stored } = setup();
  client.start(); await client.track('prompt_created', { counts: { MC: 2 } });
  assert.equal(calls.length, 0);
  client.setConsent('yes'); await settle();
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).event_name, 'page_view');
  assert.deepEqual([...stored.values()], ['yes']);
  client.start(); assert.equal(calls.length, 1);
  client.setConsent('no'); await client.track('prompt_copied');
  assert.equal(calls.length, 1);
});
test('DNT, GPC, localhost and unrelated paths never emit telemetry', async () => {
  for (const overrides of [
    { navigator: { doNotTrack: '1' } }, { navigator: { globalPrivacyControl: true } },
    { location: { origin: 'http://127.0.0.1:61045', pathname: '/' } },
    { location: { origin: 'https://ahmad-alalili.github.io', pathname: '/other/' } },
  ]) {
    const { client, calls } = setup(overrides);
    client.setConsent('yes'); await client.track('prompt_copied');
    assert.equal(calls.length, 0);
  }
});
test('no content, point values, or unknown metadata can enter a payload', async () => {
  const { client, calls } = setup(); client.setConsent('yes');
  await client.track('response_validated', { batch: randomUUID(), format: 'native-test',
    counts: { MC: 3, TF: 2, secret: 'private' }, question: 'secret text', points: 42,
    source: 'secret source', provider: 'not permitted', email: 'private' });
  const data = JSON.parse(calls.at(-1).body);
  assert.equal(data.question_count, 5); assert.deepEqual(data.question_types, { MC: 3, TF: 2 });
  assert.doesNotMatch(calls.at(-1).body, /private|secret|email|source/);
  assert.equal(Object.hasOwn(data, 'points'), false);
  assert.equal(calls.at(-1).credentials, 'omit');
  assert.equal(calls.at(-1).referrerPolicy, 'no-referrer');
});
test('revalidation and repeated export do not inflate per-page batch totals', async () => {
  const { client, calls } = setup(); client.setConsent('yes');
  const input = { batch: randomUUID(), counts: { ESS: 1 }, format: 'native-bank' };
  await client.track('response_validated', input);
  await client.track('response_validated', { ...input, format: 'native-test' });
  await client.track('export_created', input); await client.track('export_created', input);
  await client.track('export_created', { ...input, format: 'native-test' });
  assert.deepEqual(calls.map(c => JSON.parse(c.body).event_name), ['page_view', 'response_validated', 'export_created', 'export_created']);
});
test('bounded retries reuse the same event ID; failures never reject to the app', async () => {
  const { client, calls, env } = setup(); client.setConsent('yes'); await settle();
  env.fetch = async (url, options) => { calls.push({ url, ...options }); throw new Error('offline'); };
  await client.track('prompt_copied');
  assert.equal(calls.length, 3); assert.equal(calls[1].body, calls[2].body);
});
test('invalid enums and oversized counts are not sent', async () => {
  const { client, calls } = setup(); client.setConsent('yes');
  for (const [name, input] of [['unknown', {}], ['provider_opened', { provider: 'unknown' }],
    ['prompt_created', { counts: { MC: 251 } }], ['prompt_created', { counts: { MC: 1.5 } }],
    ['export_created', { counts: { MC: 1 }, format: 'qti', batch: randomUUID() }]]) await client.track(name, input);
  assert.equal(calls.length, 1);
});
test('blocked browser storage and malformed statistics fail safely', async () => {
  const { client } = setup({ localStorage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  client.setConsent('yes'); await client.track('prompt_copied');
  await assert.rejects(client.totals());
});
test('public totals are fetched read-only and unavailable is not shown as zero', async () => {
  const { client, calls, env } = setup();
  env.fetch = async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ ok: true, totals: { page_views: 0, validated_questions: 12, exports_prepared: 3 } })); };
  assert.equal((await client.totals()).totals.validated_questions, 12);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/public-stats$/); assert.equal(calls[0].body, undefined);
});
test('analytics UI is separate from workflow and exposes equal opt-in/opt-out controls', () => {
  const html = readFileSync(require.resolve('../index.html'), 'utf8');
  assert.match(html, /id="analytics-allow" class="button secondary"/);
  assert.match(html, /id="analytics-decline" class="button secondary"/);
  assert.match(html, /connect-src https:\/\/bb-qm-analytics-api\.ahmad20xx2020\.workers\.dev;/);
  const source = readFileSync(require.resolve('../analytics.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|document\.cookie|sessionStorage|setInterval/);
  assert.match(html, /تجهيز الملف لا يؤكد حفظه أو استيراده/);
});
