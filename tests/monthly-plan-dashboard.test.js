'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const live=fs.readFileSync('index.html','utf8');
const demo=fs.readFileSync('demo/index.html','utf8');
const start=live.indexOf('// 本人UID別の端末設定にだけ保存する乗務計画');
const end=live.indexOf('function renderOperations(shift){',start);
assert.ok(start>0&&end>start);
const source=live.slice(start,end);
assert.equal(demo.slice(demo.indexOf('// 本人UID別の端末設定にだけ保存する乗務計画'),demo.indexOf('function renderOperations(shift){',demo.indexOf('// 本人UID別の端末設定にだけ保存する乗務計画'))),source);
const originalDuty=JSON.stringify([{id:'duty-1',records:[{id:'ride-1',raw:{K:'1000'}}]}]);
const model={prefs:{monthlySalesGoals:{'2026-11':50000},monthlyDutySalesGoals:{'2026-11':20000},monthlyDutyPlans:{'2026-11-12':{status:'work',start:'17:00',end:'06:00'}}},shifts:JSON.parse(originalDuty)};
const fields={monthlyGoalInput:{value:'120000'},monthlyDutyGoalInput:{value:'26000'},monthlyPlanStatus:{value:'work'},monthlyPlanStart:{value:'18:00'},monthlyPlanEnd:{value:'07:00'}};
let saved=0,alerts=[];
const ctx={Date,model,monthlySalesMonth:'2026-11',monthlySalesBusy:false,monthlySalesMessage:'',monthlySalesData:{
 startDate:'2026-11-01',endDate:'2026-11-30',
 sum:{meter:30000,duties:2},
 days:[{date:'2026-11-02',meter:10000,duties:1,entries:[{id:'duty-2',startedAt:'11/02 17:00',endedAt:'11/03 06:00',duration:46800,meter:10000}]},{date:'2026-11-04',meter:20000,duties:1}]
},monthlySalesClosingDay:()=> 'end',
monthlySalesPeriod:()=>({startDate:'2026-11-01',endDate:'2026-11-30'}),
monthlySalesDayLabel:()=>({weekday:'月',holiday:false}),
renderMonthlySales:()=>'<details data-monthly-sales-panel></details>',
durationHms:seconds=>String(Math.round(seconds/3600))+'時間',
safeText:String,money:n=>Number(n).toLocaleString('ja-JP')+'円',
dateStamp:()=> '2026-11-01',canEditNow:()=>true,
saveLater:()=>{saved++},render:()=>{},toast:x=>alerts.push(x),
titleBlock:()=>'<h1>月間営業計画・実績</h1>',
document:{getElementById:id=>fields[id]||null}};
vm.createContext(ctx);
vm.runInContext(source,ctx);
const calc=text=>vm.runInContext(text,ctx);
assert.equal(calc('monthlyPlanDates({startDate:"2026-11-01",endDate:"2026-11-30"}).length'),30);
assert.equal(calc('monthlyPlanEntry("2026-11-12").end'),'06:00');
assert.equal(calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"}).gross'),30000);
assert.equal(calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"}).short'),20000);
assert.equal(calc('monthlyDutyGoal()'),20000);
assert.equal(calc('monthlyPlanActualClock("2026-11-02T17:00:00+09:00","")').includes('17:00'),true);
assert.equal(calc('monthlyPlanActualClock("","18:45")'),'18:45');
assert.equal(calc('monthlyPlanActualClock("","")'),'記録なし');
const screen=calc('renderMonthlyManagement()');
assert.match(screen,/月間目標と営業実績/);
assert.match(screen,/乗務予定カレンダー/);
assert.match(screen,/月末着地予測（参考）/);
assert.match(screen,/1乗務の売上目標/);
assert.match(screen,/予定と確定実績の比較/);
assert.match(screen,/別端末との自動同期は未対応/);
assert.match(screen,/data-monthly-sales-panel/);
assert.equal(calc('monthlyPlanDate'),'2026-11-01');
calc('monthlyGoalSave()');
assert.equal(model.prefs.monthlySalesGoals['2026-11'],120000);
assert.equal(model.prefs.monthlyDutySalesGoals['2026-11'],26000);
fields.monthlyDutyGoalInput.value='abc';
fields.monthlyGoalInput.value='990000';
calc('monthlyGoalSave()');
assert.equal(model.prefs.monthlySalesGoals['2026-11'],120000,'invalid duty goal cannot partially change monthly goal');
assert.equal(model.prefs.monthlyDutySalesGoals['2026-11'],26000);
fields.monthlyDutyGoalInput.value='26000';
fields.monthlyGoalInput.value='120000';
calc('monthlyPlanDate="2026-11-02"');
const actualScreen=calc('renderMonthlyManagement()');
assert.match(actualScreen,/実際の出庫/);
assert.match(actualScreen,/11\/02 17:00/);
assert.match(actualScreen,/11\/03 06:00/);
assert.match(actualScreen,/1乗務目標との差額/);
calc('monthlyPlanDate="2026-11-13";monthlyPlanSave()');
assert.deepEqual(JSON.parse(JSON.stringify(model.prefs.monthlyDutyPlans['2026-11-13'])),{status:'work',start:'18:00',end:'07:00'});
assert.equal(saved,2);
fields.monthlyPlanStatus.value='off';
calc('monthlyPlanSave()');
assert.deepEqual(JSON.parse(JSON.stringify(model.prefs.monthlyDutyPlans['2026-11-13'])),{status:'off',start:'',end:''});
fields.monthlyPlanStatus.value='unset';
calc('monthlyPlanSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-13'],undefined);
assert.equal(JSON.stringify(model.shifts),originalDuty,'sales originals never change when editing monthly plans');
assert.match(live,/live:\['◴','集計'\],monthly:\['▦','月間営業計画・実績'\]/);
assert.match(live,/tab==='monthly'\?renderMonthlyManagement\(\)/);
assert.doesNotMatch(live,/return head\+overview\+renderMonthlySales\(\)/);
assert.match(live,/return titleBlock\('月間営業計画・実績'/);
console.log('PASS: 月間画面独立・目標/予定の端末保存・夜勤時刻・既存日報原本の保護');

assert.match(live,/daily\.entries\.push\(\{/,'monthly aggregation must expose duty time read-only');
