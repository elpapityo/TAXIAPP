'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('// Seven-purpose operations dashboard.');
const end=html.indexOf('function renderLiveStatus(',begin);
assert.ok(begin>0&&end>begin,'operations dashboard helpers found');
const script=html.slice(begin,end);
new Function(script);
const realBreak=html.slice(html.indexOf('function breakSeconds('),html.indexOf('function endBreak(',html.indexOf('function breakSeconds(')));
new Function(realBreak);
assert.match(html,/<title>TAXIAPP v0\.3\.110 — 乗務日報<\/title>/);
const fixedDate=new Date('2026-10-20T01:00:00.000Z');
const shift={
 id:'test-shift',date:'2026-10-19',startedAt:'07:00',startedIso:'2026-10-19T07:00:00Z',
 records:[],settings:{},gpsTrip:{tripKm:20,realKm:10,emptyKm:10},waitSegments:[],
 breakSessions:[
  {id:'break1',startedIso:'2026-10-19T07:30:00Z',endedIso:'2026-10-19T07:41:00Z',startedAt:'07:30',endedAt:'07:41',place:'駅前'},
  {id:'break2',startedIso:'2026-10-19T08:00:00Z',endedIso:'2026-10-19T08:09:30Z',startedAt:'08:00',endedAt:'08:09',place:'公園'}
 ],
 breakActive:{id:'break3',startedIso:'2026-10-20T00:55:00Z',startedAt:'00:55',place:'北本町1'}
};
const snapshot=JSON.stringify(shift);
const t={
 meter:12000,rides:4,reconciliationDifference:150,
 paymentAllocated:11850,discount:0,cashRemittance:7000,goFee:400,
 etcRemittance:800,totalRemittance:7800,
 cashReceived:6000,uberSurcharge:100,cancels:1,emptyHighways:1,cancellation:0,
 realToll:800,printedDetail:12800,emptyToll:100,paymentTotals:{cash:6000,card:5850}
};
const ctx={
 window:{TAXIAPP_HIGHWAY_REPORT:{collect:()=>({
  count:1,real:{count:1},empty:{count:0},sectionKm:12,exemptKm:9,chargeYen:800,
  unknownDistances:0,entries:[{no:'4',mode:'実',entryIC:'入口',exitIC:'出口',sectionKm:12,exemptKm:9,chargeYen:800}]
 })}},
 operationPanelOpen:{},shift,
 titleBlock:()=>'<h1>営業状況・日報集計</h1>',
 friendlyDate:()=> '2026年10月19日',safeText:String,
 durationHms:n=>n==null?'—':String(Math.floor(n/3600)).padStart(2,'0')+':'+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0'),
 durationJapanese:()=> '5分',shortTime:s=>String(s||'').slice(0,5)||'--:--',
 money:n=>Number(n).toLocaleString('ja-JP')+'円',
 liveBusinessNumbers:()=>({elapsed:64800,t,liveDuration:10000,waitDuration:4000,
  unclassified:50800,pace:700,planned:null,remaining:null,referenceEstimate:null}),
 meterCheckValues:()=>({total:12500,count:0,cancelCount:1,reference:500}),
 totals:()=>t,elapsedSinceLastPayment:()=>300,dailyReferenceStrip:()=>'<section>13時間基準</section>',
 dailyReferenceDetails:()=>'<section>距離基準</section>',dailyReferenceFor:()=>({}),
 gpsDistanceSummary:()=>'<section>GPS実車・空車</section>',metrics:()=>'<section>精算KPI</section>',
 LABELS:{cash:'現金',card:'カード'},liveBusinessRows:()=>[{time:'08:12',kind:'精算',detail:'№1'}],
 waitMinutes:()=>12,deriveRaw:()=>({}),Date,console
};
vm.createContext(ctx);vm.runInContext(realBreak+script,ctx);
function render(){return vm.runInContext('renderOperations(shift)',ctx)}
const first=render();
if(process.env.TAXIAPP_OPS_FIXTURE==='1'){
 const styles=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
 assert.ok(styles,'production CSS missing');
 // Browser fixture is generated from the real production renderer and its exact CSS.
 // A synthetic shift is used; no production user record is loaded or overwritten.
 const htmlFixture='<!doctype html><html lang="ja" data-ui-theme="day"><head><meta charset="utf-8">'
  +'<meta name="viewport" content="width=device-width,initial-scale=1">'
  +'<title>TAXIAPP v0.3.110 operations test</title><style>'+styles+'</style></head>'
  +'<body><div id="ops-e2e-host" class="layout">'+first+'</div></body></html>';
 fs.writeFileSync('tests/operations_dashboard_fixture.html',htmlFixture);
}

assert.match(first,/aria-label="主要な営業情報"/);
const tiles=first.match(/class="operations-kpi"/g)||[];
assert.equal(tiles.length,4,'2x2 overview has exactly four metrics');
for(const label of ['メーター売上','営業回数','乗務経過','休憩合計'])assert.ok(first.includes(label),label);
const titles=['勤務時間・営業状況','休憩時間・休憩履歴','売上・営業実績',
 '日報集計・精算','GPS・走行距離','営業時系列・待機履歴','高速道路利用明細'];
for(const title of titles)assert.ok(first.includes('<summary>'+title+'</summary>'),title);
assert.equal((first.match(/name="operations-dashboard"/g)||[]).length,7,'seven native single-open panels');
assert.equal((first.match(/data-operation-panel=/g)||[]).length,7);
assert.equal((first.match(/data-operation-panel="[^"]+" open/g)||[]).length,0,'all closed on initial overview');
const secs=vm.runInContext('opsBreakSeconds(shift,new Date("2026-10-20T01:00:00Z"))',ctx);
assert.equal(secs,11*60+9*60+30+5*60,'ended + active breaks summed in seconds');
assert.equal(vm.runInContext('opsBreakText(shift,new Date("2026-10-20T01:00:00Z"))',ctx),'00:25');
const htmlBreak=vm.runInContext('opsBreakPanel(shift,new Date("2026-10-20T01:00:00Z"))',ctx);
for(const label of ['駅前','公園','北本町1','07:30 ～ 07:41','00:55 ～ 休憩中'])
 assert.ok(htmlBreak.includes(label),'break history missing '+label);
assert.equal((htmlBreak.match(/class="operations-history-item"/g)||[]).length,3,'two ended and one active');
assert.match(htmlBreak,/data-ops-break-active/);
const clock=vm.runInContext('opsTimePanel(shift,new Date("2026-10-20T01:00:00Z"))',ctx);
assert.match(clock,/空車・迎車等の残時間（参考）/);
assert.match(clock,/data-ops-time-break/);
assert.ok(clock.includes('00:25:30'),'break seconds separate from unclassified time');
assert.match(first,/売上と決済内訳に差額があります/,'top-level warnings visible even when folded');
assert.match(first,/支払方法別（精算内訳）/);
assert.match(first,/入口 → 出口/);
assert.match(first,/GPS実車・空車/);
ctx.operationPanelOpen={time:false,break:true,sales:false};
const second=render();
assert.match(second,/data-operation-panel="break" open/);
assert.equal((second.match(/data-operation-panel="[^"]+" open/g)||[]).length,1);
assert.equal(JSON.stringify(shift),snapshot,'no change to business data / break history');
assert.match(html,/name="operations-dashboard"/);
assert.match(html,/data-ops-break-total/);
assert.match(html,/set\('\[data-ops-break-active-list\]'/);
console.log('PASS operations seven panels: four KPIs, native accordion, settlement warning, active+ended breaks, history, GPS/highway, readonly');
