'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalytics } = require('../analytics.js');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
function setup(overrides = {}, entries = []) {
  const calls = [], stored = new Map(entries);
  const env = { navigator:{}, location:{ origin:'https://ahmad-alalili.github.io',pathname:'/BB_QM/' },
    localStorage:{ getItem:key => stored.get(key), setItem:(key,value) => stored.set(key,value) }, setTimeout,clearTimeout,
    fetch:async (url,options) => { calls.push({ url,...options }); return new Response('{}',{ status:201 }); }, ...overrides };
  return { client:createAnalytics(env),calls,stored,env };
}
test('aggregate count starts automatically without identities or writing browser identifiers', async () => {
  const { client,calls,stored } = setup(); client.start(); client.start();
  await client.track('prompt_copied');
  assert.equal(calls.length,2); assert.equal(stored.size,0);
  assert.deepEqual(JSON.parse(calls[0].body),{ version:2,site:'BB_QM',event:'page_view' });
  assert.match(calls[0].url,/\/aggregate$/);
});
test('existing refusals and new opt-outs remain effective', async () => {
  for (const key of ['bb-qm:measurement-consent:v1','bb-qm:aggregate-enabled:v2']) {
    const { client,calls,stored } = setup({},[[key,'no']]);
    client.start(); await client.track('prompt_copied'); assert.equal(calls.length,0);
    client.setConsent('yes'); assert.equal(calls.length,1);
    client.setConsent('no'); await client.track('prompt_copied'); assert.equal(calls.length,1);
    assert.equal(stored.get('bb-qm:aggregate-enabled:v2'),'no');
  }
});
test('DNT, GPC, previews and unrelated paths do not emit counters', async () => {
  for (const overrides of [{ navigator:{ doNotTrack:'1' } },{ navigator:{ globalPrivacyControl:true } },
    { location:{ origin:'http://127.0.0.1:61046',pathname:'/' } },
    { location:{ origin:'https://ahmad-alalili.github.io',pathname:'/other/' } }]) {
    const { client,calls } = setup(overrides); client.setConsent('yes'); await client.track('prompt_copied');
    assert.equal(calls.length,0);
  }
});
test('hidden pages wait until visible; opt-out never recounts an existing view', () => {
  const { client,calls,env } = setup({ document:{ visibilityState:'hidden' } });
  client.start(); assert.equal(calls.length,0); env.document.visibilityState='visible'; client.start();
  client.setConsent('no'); client.setConsent('yes'); assert.equal(calls.length,1);
});
test('network contains only allowed counter fields, no content, identities, device or points', async () => {
  const { client,calls } = setup();
  await client.track('response_validated',{ batch:1,counts:{ MC:3,TF:2,secret:'private' },format:'native-test',
    question:'private',points:20,email:'private',session_id:'private',provider:'chatgpt',device:'phone' });
  assert.deepEqual(JSON.parse(calls[0].body),{ version:2,site:'BB_QM',event:'response_validated',counts:{ MC:3,TF:2 } });
  assert.equal(calls[0].credentials,'omit'); assert.equal(calls[0].referrerPolicy,'no-referrer');
});
test('revalidation/export dedup stays in memory only; point changes count operations', async () => {
  const { client,calls } = setup(); const input={ batch:1,counts:{ ESS:1 },format:'native-bank' };
  await client.track('response_validated',input); await client.track('response_validated',input);
  await client.track('export_created',input); await client.track('export_created',input);
  await client.track('export_created',{ ...input,format:'native-test' });
  await client.track('points_changed',input); await client.track('points_changed',input);
  assert.equal(calls.length,5);
  assert.ok(calls.every(call => !call.body.includes('batch')));
});
test('new edit/paste metrics do not include edited or pasted contents', async () => {
  const { client,calls } = setup();
  for (const event of ['prompt_edited','prompt_pasted','response_pasted']) await client.track(event,{ text:'PRIVATE' });
  assert.equal(calls.length,3); assert.ok(calls.every(call => !call.body.includes('PRIVATE')));
  const app=readFileSync(require.resolve('../app.js'),'utf8');
  assert.match(app,/promptOutput\.addEventListener\('change', \(\) => measure\('prompt_edited'\)\)/);
  assert.match(app,/inputType === 'insertFromPaste'\) measure\('prompt_pasted'\)/);
  assert.match(app,/inputType === 'insertFromPaste'\) measure\('response_pasted'\)/);
});
test('failed requests never retry or interrupt the tools', async () => {
  let n=0; const { client }=setup({ fetch:async () => { n++; throw Error('offline'); } });
  await client.track('prompt_copied'); assert.equal(n,1);
});
test('opt-out aborts pending transmission', async () => {
  let signal;
  const { client }=setup({ fetch:async (url,options) => { signal=options.signal; return new Promise(resolve => signal.addEventListener('abort',resolve)); } });
  const pending=client.track('prompt_copied'); client.setConsent('no'); await pending; assert.equal(signal.aborted,true);
});
test('bounded emission and invalid counts fail closed', async () => {
  const { client,calls }=setup();
  for (const [name,data] of [['unknown',{}],['prompt_created',{ counts:{ MC:251 } }],['prompt_created',{ counts:{ MC:1.5 } }],
    ['export_created',{ batch:1,counts:{ MC:1 },format:'invalid' }],['response_validated',{ counts:{ MC:1 } }]]) await client.track(name,data);
  assert.equal(calls.length,0);
  for (let i=0;i<125;i++) await client.track('prompt_copied'); assert.equal(calls.length,120);
});
test('blocked storage does not break default counting or in-page opt-out', async () => {
  const { client,calls }=setup({ localStorage:{ getItem(){ throw Error(); },setItem(){ throw Error(); } } });
  client.start(); assert.equal(calls.length,1); client.setConsent('no'); await client.track('prompt_copied'); assert.equal(calls.length,1);
});
test('public totals are read-only; legacy/malformed data is not displayed as new totals', async () => {
  const { client,calls,env }=setup();
  env.fetch=async (url,options) => { calls.push({url,...options}); return new Response(JSON.stringify({ ok:true,version:2,mode:'aggregate',since:null,
    totals:{ page_views:0,validated_questions:12,exports_prepared:3 } })); };
  assert.equal((await client.totals()).totals.validated_questions,12);
  assert.equal(calls[0].body,undefined);
  env.fetch=async () => new Response('{"ok":true,"version":1}'); await assert.rejects(client.totals());
});
test('notice is concise, visible on load, accessible on mobile and does not gate tools', () => {
  const html=readFileSync(require.resolve('../index.html'),'utf8'), source=readFileSync(require.resolve('../analytics.js'),'utf8');
  const css=readFileSync(require.resolve('../analytics.css'),'utf8');
  assert.match(html,/id="analytics-notice"[^>]+hidden/);
  assert.match(html,/aria-label="تخطي المشاركة في الإحصائيات">تخطي/);
  assert.match(css,/\.analytics-notice \{ position: fixed/);
  assert.match(css,/min-height: 44px; min-width: 44px/);
  assert.match(css,/font-size: \.875rem/);
  const privacy=html.match(/<details id="analytics-privacy">([\s\S]*?)<\/details>/)[1];
  assert.doesNotMatch(privacy,/14|الجديد|UTC|Cloudflare|إعادة إرسال|لكل صيغة/);
  assert.ok(privacy.replace(/<[^>]*>/g,' ').trim().split(/\s+/).length < 100);
  assert.doesNotMatch(source,/randomUUID|session_id|event_id|device_class|innerWidth|\.innerHTML|document\.cookie|sessionStorage|setInterval/);
  assert.doesNotMatch(source,/location\.(?:href|replace|assign)\s*[=(]/);
});

function pageSetup(entries = [], navigator = {}) {
  const calls=[],stored=new Map(entries),elements=new Map();
  const element=id => {
    if (!elements.has(id)) elements.set(id,{hidden:true,disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});
    return elements.get(id);
  };
  const window={navigator,location:{origin:'https://ahmad-alalili.github.io',pathname:'/BB_QM/'},setTimeout,clearTimeout,
    localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
    document:{visibilityState:'visible',getElementById:element,addEventListener(){}},
    fetch:async (url,options)=>{calls.push({url,...options});return new Response(JSON.stringify({ok:true,version:2,mode:'aggregate',since:null,totals:{page_views:0,validated_questions:0,exports_prepared:0}}));}};
  runInNewContext(readFileSync(require.resolve('../analytics.js'),'utf8'),{window,AbortController,Intl});
  return {window,calls,stored,element,click:id=>element(id).listeners.click(),posts:()=>calls.filter(c=>c.method==='POST')};
}
test('opening the notice never counts before a choice; skipping sends nothing and persists refusal', async () => {
  const p=pageSetup([['bb-qm:aggregate-notice:v2','seen']]);
  assert.equal(p.element('analytics-notice').hidden,false); assert.equal(p.posts().length,0);
  await p.window.BBAnalytics.track('prompt_copied'); assert.equal(p.posts().length,0);
  p.click('analytics-notice-stop');
  assert.equal(p.element('analytics-notice').hidden,true);
  assert.equal(p.stored.get('bb-qm:aggregate-enabled:v2'),'no');
  await p.window.BBAnalytics.track('prompt_copied'); assert.equal(p.posts().length,0);
});
test('continue starts one view and preserves the privacy link and subsequent opt-out', async () => {
  const p=pageSetup();
  p.click('analytics-notice-privacy'); assert.equal(p.element('analytics-privacy').open,true); assert.equal(p.posts().length,0);
  p.click('analytics-notice-close'); p.window.BBAnalytics.start();
  assert.equal(p.posts().length,1); assert.equal(p.element('analytics-notice').hidden,true);
  p.click('analytics-decline'); await p.window.BBAnalytics.track('prompt_copied'); assert.equal(p.posts().length,1);
});
test('repeated notice never re-enables past refusal or browser privacy signals', () => {
  for (const entries of [[['bb-qm:aggregate-enabled:v2','no']],[['bb-qm:measurement-consent:v1','no']]]) {
    const p=pageSetup(entries); assert.equal(p.element('analytics-notice').hidden,false);
    p.click('analytics-notice-close'); assert.equal(p.posts().length,0);
    p.click('analytics-allow'); assert.equal(p.posts().length,1);
  }
  for (const nav of [{doNotTrack:'1'},{globalPrivacyControl:true}]) {
    const p=pageSetup([],nav); p.click('analytics-notice-close'); p.click('analytics-allow'); assert.equal(p.posts().length,0);
  }
});
