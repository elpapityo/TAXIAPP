'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const main=fs.readFileSync('index.html','utf8');
const demo=fs.readFileSync('demo/index.html','utf8');
function extract(html){
 const start=html.indexOf('/* 選択された1乗務の履歴サマリー。');
 const end=html.indexOf('function renderHistory(_shift)',start);
 assert.ok(start>0&&end>start,'actual history summary functions found');
 return html.slice(start,end);
}
const productionCode=extract(main);
assert.equal(extract(demo),productionCode,'demo and production summary must match exactly');
const oldSummaryDate='2026-10-20';
const makeRecord=(type,value)=>({kind:'ride',status:'complete',raw:{E:type,K:String(value)}});
const shift={
 id:'old-uid-shift',date:oldSummaryDate,startedAt:'10:00',endedAt:'12:00',
 startedIso:'2026-10-20T10:00:00+09:00',endedIso:'2026-10-20T12:00:00+09:00',
 startingOdo:'10.0',endingOdo:'30.0',settings:{},
 records:[makeRecord('G',1100),makeRecord('D',2200),makeRecord('U',4400),
  makeRecord('乗',3300),{kind:'cancel',status:'complete',raw:{E:'G',K:'0'}}],
 waitSegments:[{startedIso:'2026-10-20T10:00:00+09:00',endedIso:'2026-10-20T10:15:00+09:00'}],
 waiting:null
};
const original=JSON.stringify(shift),referenceDate=new Date('2027-03-01T10:00:00+09:00');
const number=v=>v===null||v===undefined||String(v).trim()===''?null:(Number.isFinite(Number(v))?Number(v):null);
const seconds=(a,b)=>a&&b?Math.max(0,Math.floor((new Date(b)-new Date(a))/1000)):null;
const ctx={
 Date,Math,number,
 money:v=>'¥'+Math.round(v).toLocaleString('ja-JP'),
 safeText:String,
 durationHms:v=>v==null?'計測待ち':[Math.floor(v/3600),Math.floor(v%3600/60),v%60].map(x=>String(x).padStart(2,'0')).join(':'),
 shiftElapsed:(s,now)=>seconds(s.startedIso,s.endedIso||now),
 closedWaitSeconds:s=>(s.waitSegments||[]).reduce((sum,w)=>sum+(seconds(w.startedIso,w.endedIso)||0),0),
 totalWaitSeconds:(s,now)=>(s.waitSegments||[]).reduce((sum,w)=>sum+(seconds(w.startedIso,w.endedIso)||0),0)
  +(s.waiting?(seconds(s.waiting.startedIso,now)||0):0),
 totals:(rows)=>{
  // Test stub matches the already-confirmed canonical totals output.
  assert.equal(rows,shift.records);
  return {meter:11000,rides:4,cancels:1};
 },
 pricing:(row)=>({meter:Number(row.raw.K)||0}),
 meterSalesTaxExcludedReference:gross=>Math.floor(gross*10/11)
};
vm.createContext(ctx);vm.runInContext(productionCode,ctx);
function calc(expr){return vm.runInContext(expr,ctx);}
ctx.shift=shift;ctx.referenceDate=referenceDate;
let v=calc('dutyHistorySummaryValues(shift,referenceDate)');
assert.equal(v.t.meter,11000);assert.equal(v.t.rides,4);assert.equal(v.t.cancels,1);
assert.equal(v.netReference,10000,'reuse existing monthly-sales 10% net reference');
assert.equal(v.elapsed,7200);assert.equal(v.wait,900);assert.equal(v.km,20);
assert.equal(v.yenPerKm,550);assert.equal(v.yenPerHour,5500);
assert.equal(v.sales.app,7700);assert.equal(v.sales.boardingOther,3300);
assert.equal(v.sales.go,1100);assert.equal(v.sales.didi,2200);assert.equal(v.sales.uber,4400);
assert.equal(v.sales.other,0);
let rendered=calc('renderDutyHistorySummary(shift)');
for(const label of ['乗務サマリー','営業時間（出庫～入庫）','営業回数','キャンセル回数','待機時間合計',
 '距離単価','時間単価','メーター売上（税込）','メーター売上（税別参考）',
 'アプリ配車売上','乗込み・その他／無線売上']){
 assert.ok(rendered.includes(label),'missing KPI '+label);
}
for(const amount of ['¥11,000','¥10,000','¥7,700','¥3,300','¥550 /km','¥5,500 /時間'])assert.ok(rendered.includes(amount),amount);
assert.equal(JSON.stringify(shift),original,'view must never modify the selected Firestore/local source report');
const older={...shift,endedIso:'',endedAt:'12:00',waiting:{startedIso:'2026-10-20T11:30:00+09:00'}};
ctx.shift=older;
v=calc('dutyHistorySummaryValues(shift,referenceDate)');
assert.equal(v.elapsed,null,'an old duty without end ISO must not run until current time');
assert.equal(v.yenPerHour,null);assert.equal(v.wait,900,'no phantom wait time after old duty ended');
assert.match(calc('renderDutyHistorySummary(shift)'),/算出不可/);
ctx.shift={...shift,endingOdo:'',startingOdo:''};
v=calc('dutyHistorySummaryValues(shift,referenceDate)');
assert.equal(v.km,null);assert.equal(v.yenPerKm,null,'missing trip odometer must not become 0km');
ctx.shift={...shift,endedIso:'',endedAt:'',waiting:{startedIso:'2027-03-01T09:50:00+09:00'}};
v=calc('dutyHistorySummaryValues(shift,referenceDate)');
assert.equal(v.elapsed>0,true,'active shift uses live elapsed time');
assert.equal(v.wait>900,true,'active wait is counted');
for(const html of [main,demo]){
 assert.match(html,/function renderHistory\(_shift\)\{const shift=selectedHistoryShift\(\)/);
 assert.match(html,/\$\{historyLocationEditHtml\(shift\)\}\$\{historyFoldSection\('summary','乗務サマリー',renderDutyHistorySummary\(shift\)\)\}/,
  'summary must render for the selected dated history, not only the current shift');
 assert.match(html,/\.history-duty-summary-grid\{/,'responsive history KPI CSS');
 assert.match(html,/function meterSalesTaxExcludedReference\(gross\)/);
 assert.match(html,/const t=\{records:records\.length,rides:0,cancels:0/,'canonical totals retained');
}
assert.match(main,/<title>TAXIAPP v0\.3\.220 — 乗務日報<\/title>/);
assert.match(demo,/<title>TAXIAPP v0\.3\.219 — 公開操作デモ<\/title>/);
console.log('PASS: history KPI from canonical totals, past UID duty, completed/ongoing time, missing km, tax and dispatch split, original record immutable');
