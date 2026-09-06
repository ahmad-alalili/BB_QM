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
test('entry screen hides all tools before first paint with a readable mobile-friendly choice', () => {
  const html=readFileSync(require.resolve('../index.html'),'utf8'), source=readFileSync(require.resolve('../analytics.js'),'utf8');
  const css=readFileSync(require.resolve('../analytics.css'),'utf8');
  assert.match(html,/<section id="analytics-gate"[^>]*aria-labelledby="analytics-notice-title"/);
  assert.doesNotMatch(html,/<section id="analytics-gate"[^>]*\bhidden\b/);
  assert.match(html,/<div id="site-content" hidden inert>/);
  assert.ok(html.indexOf('id="analytics-gate"') < html.indexOf('id="site-content"'));
  assert.ok(html.indexOf('id="site-content"') < html.indexOf('<header'));
  assert.match(html,/<\/footer>\s*<\/div>\s*<\/body>/);
  assert.match(html,/id="analytics-notice-title" tabindex="-1">نطوّر الموقع معك<\/h2>/);
  assert.match(html,/تساعدنا إحصائيات الاستخدام الإجمالية في تحسين الأدوات وتطوير خدمات الموقع\. لا تشمل الإحصائيات محتوى أسئلتك أو إجاباتك\./);
  assert.match(html,/id="analytics-notice-close"[^>]*>موافقة ومتابعة<\/button>/);
  assert.match(html,/aria-label="تخطي المشاركة في الإحصائيات" disabled>تخطي/);
  assert.match(css,/#site-content\[hidden\], \.analytics-gate\[hidden\] \{ display: none !important/);
  assert.match(css,/min-height: 100svh/);
  assert.doesNotMatch(css,/position: fixed/);
  assert.match(css,/min-height: 44px; min-width: 44px/);
  assert.match(css,/font-size: \.875rem/);
  const privacy=html.match(/<details id="analytics-privacy">([\s\S]*?)<\/details>/)[1];
  const entryPrivacy=html.match(/<details id="analytics-notice-privacy"[^>]*>([\s\S]*?)<\/details>/)[1];
  const paragraphs=privacy.match(/<p>[\s\S]*?<\/p>/g);
  assert.deepEqual(entryPrivacy.match(/<p>[\s\S]*?<\/p>/g),paragraphs);
  assert.doesNotMatch(privacy,/14|الجديد|UTC|Cloudflare|إعادة إرسال|لكل صيغة/);
  assert.ok(privacy.replace(/<[^>]*>/g,' ').trim().split(/\s+/).length < 100);
  assert.doesNotMatch(source,/randomUUID|session_id|event_id|device_class|innerWidth|\.innerHTML|document\.cookie|sessionStorage|setInterval/);
  assert.doesNotMatch(source,/location\.(?:href|replace|assign)\s*[=(]/);
});

function pageSetup(entries = [], navigator = {}) {
  const calls=[],stored=new Map(entries),elements=new Map(),focuses=[],scrolls=[];
  const element=id => {
    if (!elements.has(id)) elements.set(id,{hidden:['site-content','analytics-notice-status'].includes(id),inert:id==='site-content',disabled:['analytics-notice-close','analytics-notice-stop'].includes(id),textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},focus(){focuses.push(id);}});
    return elements.get(id);
  };
  const window={navigator,location:{origin:'https://ahmad-alalili.github.io',pathname:'/BB_QM/'},setTimeout,clearTimeout,scrollTo:options=>scrolls.push(options),
    localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
    document:{visibilityState:'visible',getElementById:element,addEventListener(){}},
    fetch:async (url,options)=>{calls.push({url,...options});return new Response(JSON.stringify({ok:true,version:2,mode:'aggregate',since:null,totals:{page_views:0,validated_questions:0,exports_prepared:0}}));}};
  runInNewContext(readFileSync(require.resolve('../analytics.js'),'utf8'),{window,AbortController,Intl});
  return {window,calls,stored,element,focuses,scrolls,click:id=>element(id).listeners.click(),posts:()=>calls.filter(c=>c.method==='POST')};
}
test('opening the notice never counts before a choice; skipping sends nothing and persists refusal', async () => {
  const p=pageSetup([['bb-qm:aggregate-notice:v2','seen']]);
  assert.equal(p.element('analytics-gate').hidden,false); assert.equal(p.calls.length,0);
  assert.equal(p.element('site-content').hidden,true); assert.equal(p.element('site-content').inert,true);
  assert.deepEqual(p.focuses,['analytics-notice-title']);
  assert.equal(p.element('analytics-notice-close').disabled,false); assert.equal(p.element('analytics-notice-stop').disabled,false);
  await p.window.BBAnalytics.track('prompt_copied'); assert.equal(p.posts().length,0);
  p.click('analytics-notice-stop');
  assert.equal(p.element('analytics-gate').hidden,true);
  assert.equal(p.element('site-content').hidden,false); assert.equal(p.element('site-content').inert,false);
  assert.equal(p.focuses.at(-1),'main-content'); assert.equal(p.scrolls.length,1);
  assert.equal(p.stored.get('bb-qm:aggregate-enabled:v2'),'no');
  await p.window.BBAnalytics.track('prompt_copied'); assert.equal(p.posts().length,0);
});
test('approval opens the same tools and starts one view; reading privacy alone does not open the site', async () => {
  const p=pageSetup();
  // The native details element opens independently, without approving or showing the tools.
  p.element('analytics-notice-privacy').open=true;
  assert.equal(p.element('site-content').hidden,true); assert.equal(p.calls.length,0);
  p.click('analytics-notice-close'); p.window.BBAnalytics.start();
  assert.equal(p.posts().length,1); assert.equal(p.element('analytics-gate').hidden,true);
  assert.equal(p.element('site-content').hidden,false); assert.equal(p.element('site-content').inert,false);
  assert.deepEqual(p.focuses,['analytics-notice-title','main-content']);
  p.click('analytics-decline'); await p.window.BBAnalytics.track('prompt_copied'); assert.equal(p.posts().length,1);
  assert.equal(p.focuses.length,2); assert.equal(p.scrolls.length,1);
  assert.equal(p.calls.filter(c=>c.url.endsWith('/public-stats')).length,1);
});
test('explicit approval updates prior refusal but never overrides browser privacy signals', () => {
  for (const entries of [[['bb-qm:aggregate-enabled:v2','no']],[['bb-qm:measurement-consent:v1','no']]]) {
    const p=pageSetup(entries); assert.equal(p.element('analytics-gate').hidden,false);
    assert.equal(p.posts().length,0); p.click('analytics-notice-stop'); assert.equal(p.posts().length,0);
    p.click('analytics-notice-close'); assert.equal(p.posts().length,1);
    assert.equal(p.stored.get('bb-qm:aggregate-enabled:v2'),'yes');
    p.click('analytics-allow'); assert.equal(p.posts().length,1);
  }
  for (const nav of [{doNotTrack:'1'},{globalPrivacyControl:true}]) {
    const p=pageSetup([],nav); p.click('analytics-notice-close'); p.click('analytics-allow'); assert.equal(p.posts().length,0);
    assert.equal(p.element('site-content').hidden,false);
  }
});

test('opening tools never depends on the analytics network and preserves the existing form nodes', async () => {
  const p=pageSetup(), field=p.element('source-content'); field.value='مسودة محفوظة';
  p.window.fetch=async()=>{throw Error('offline');};
  p.click('analytics-notice-stop');
  assert.equal(p.element('site-content').hidden,false); assert.equal(p.element('analytics-gate').hidden,true);
  assert.equal(p.element('source-content'),field); assert.equal(field.value,'مسودة محفوظة');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(p.element('analytics-status').textContent,/تعذر جلب الإحصائيات/);
  assert.equal(p.element('site-content').hidden,false);
});
