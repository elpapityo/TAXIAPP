'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
assert.ok(scripts.length>=2);
for(const source of scripts) new vm.Script(source); // Parse all inline scripts.

// Exactly six fixed bottom-menu items; management belongs in the Settings screen.
const nav=html.match(/const labels=\{([^}]+)\};/);
assert.ok(nav);
assert.deepEqual([...nav[1].matchAll(/([a-z]+):\[/g)].map(x=>x[1]),
 ['drive','live','history','print','shift','settings']);
assert.match(html,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
assert.doesNotMatch(html,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\);overflow:visible/);
assert.doesNotMatch(html,/tab==='data'\?/);
assert.match(html,/data-data-management><summary>データ管理（乗務単位の削除）<\/summary>/);
assert.match(html,/dataManagementWasOpen/);
assert.match(html,/data-action="deleteShift"/);
assert.doesNotMatch(html,/data-tab="data"/);
assert.doesNotMatch(html,/テストデータを削除（出庫〜入庫の乗務単位/);

const start=html.indexOf('function renderDataManagement(){');
const end=html.indexOf('function renderDeviceManagementPanel(){',start);
assert.ok(start>0&&end>start);
const closed={
 id:'shift-closed',date:'2026-10-16',startedAt:'08:00',endedAt:'20:00',
 startedIso:'2026-10-15T23:00:00.000Z',records:[{raw:{K:6400},kind:'ride'}],
 settings:{},driver:'ドライバー',gpsTrip:{tripKm:12},waitSegments:[{place:'神戸'}]
};
const ongoing={
 id:'shift-open',date:'2026-10-16',startedAt:'21:00',endedAt:'',
 startedIso:'2026-10-16T12:00:00.000Z',records:[{raw:{K:15100},kind:'ride'}],
 settings:{},driver:'\"><script>alert(1)</script>'
};
const model={version:1,activeId:'shift-open',prefs:{driver:'他の設定は保持'},
 shifts:[closed,ongoing]};
const before=JSON.stringify(model);
const ctx={
 model,Array,String,
 titleBlock:(title)=>'<h1>'+title+'</h1>',
 shortTime:(s)=>String(s||'').slice(0,5),
 safeText:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;"),
 totals:recs=>({meter:recs.reduce((s,r)=>s+Number(r.raw.K||0),0)}),
 money:x=>Number(x).toLocaleString('ja-JP')+'円'
};
vm.createContext(ctx);
vm.runInContext(html.slice(start,end),ctx);
const displayed=ctx.renderDataManagement();
assert.ok(displayed.includes('端末に保存された乗務'));
assert.ok(displayed.includes('shift-closed'));
assert.ok(displayed.includes('shift-open'));
assert.ok(displayed.includes('6,400円'));
assert.ok(displayed.includes('15,100円'));
assert.ok(displayed.includes('未入庫'));
assert.ok(displayed.includes('入庫済み'));
assert.ok(displayed.includes('乗務中'));
assert.equal((displayed.match(/data-action="deleteShift"/g)||[]).length,2);
assert.ok(displayed.indexOf('shift-open')<displayed.indexOf('shift-closed'));
assert.ok(!displayed.includes('<script>alert(1)</script>'));
assert.ok(displayed.includes('JSONバックアップ'));
assert.ok(displayed.includes('Googleスプレッドシートに送信済みのデータは消しません'));
assert.equal(JSON.stringify(model),before);
ctx.model={...model,activeId:null,shifts:[]};
const empty=ctx.renderDataManagement();
assert.ok(empty.includes('削除する乗務はありません'));
assert.ok(!empty.includes('data-action="deleteShift"'));

require('../device-management.js');
const device=globalThis.TAXIAPP_DEVICE_DATA;
const after=device.deleteShift(model,'shift-closed');
assert.equal(after.model.shifts.length,1);
assert.equal(after.model.shifts[0].id,'shift-open');
assert.equal(after.model.prefs.driver,'他の設定は保持');
assert.equal(after.deleted.waitSegments[0].place,'神戸');
assert.equal(after.deleted.gpsTrip.tripKm,12);
assert.throws(()=>device.deleteShift(model,'shift-open'),/入庫/);
const deletingOpen=device.deleteShift(model,'shift-open',{allowUnfinished:true});
assert.equal(deletingOpen.model.activeId,null);
assert.equal(deletingOpen.model.shifts[0].id,'shift-closed');
console.log('Mobile data-management test passed: navigation, whole-duty cards, confirmations, safety, empty state and inline-script parsing.');
