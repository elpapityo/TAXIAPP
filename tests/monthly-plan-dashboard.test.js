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
const model={prefs:{monthlySalesGoals:{'2026-11':50000},monthlyDutyPlans:{'2026-11-12':{status:'work',start:'17:00',end:'06:00'}}},shifts:JSON.parse(originalDuty)};
const fields={monthlyGoalInput:{value:'120000'},monthlyPlanStatus:{value:'work'},monthlyPlanStart:{value:'18:00'},monthlyPlanEnd:{value:'07:00'}};
let saved=0,alerts=[];
const ctx={Date,model,monthlySalesMonth:'2026-11',monthlySalesData:{
 startDate:'2026-11-01',endDate:'2026-11-30',
 sum:{meter:30000,duties:2},
 days:[{date:'2026-11-02',meter:10000,duties:1},{date:'2026-11-04',meter:20000,duties:1}]
},monthlySalesClosingDay:()=> 'end',
monthlySalesPeriod:()=>({startDate:'2026-11-01',endDate:'2026-11-30'}),
monthlySalesDayLabel:()=>({weekday:'月',holiday:false}),
renderMonthlySales:()=>'<details data-monthly-sales-panel></details>',
safeText:String,money:n=>Number(n).toLocaleString('ja-JP')+'円',
dateStamp:()=> '2026-11-01',canEditNow:()=>true,
saveLater:()=>{saved++},render:()=>{},toast:x=>alerts.push(x),
titleBlock:()=>'<h1>月間営業管理</h1>',
document:{getElementById:id=>fields[id]||null}};
vm.createContext(ctx);
vm.runInContext(source,ctx);
const calc=text=>vm.runInContext(text,ctx);
assert.equal(calc('monthlyPlanDates({startDate:"2026-11-01",endDate:"2026-11-30"}).length'),30);
assert.equal(calc('monthlyPlanEntry("2026-11-12").end'),'06:00');
assert.equal(calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"}).gross'),30000);
assert.equal(calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"}).short'),20000);
const screen=calc('renderMonthlyManagement()');
assert.match(screen,/月間目標と営業実績/);
assert.match(screen,/乗務予定カレンダー/);
assert.match(screen,/月末着地予測（参考）/);
assert.match(screen,/別端末との自動同期は未対応/);
assert.match(screen,/data-monthly-sales-panel/);
assert.equal(calc('monthlyPlanDate'),'2026-11-01');
calc('monthlyGoalSave()');
assert.equal(model.prefs.monthlySalesGoals['2026-11'],120000);
calc('monthlyPlanDate="2026-11-13";monthlyPlanSave()');
assert.deepEqual(model.prefs.monthlyDutyPlans['2026-11-13'],{status:'work',start:'18:00',end:'07:00'});
assert.equal(saved,2);
fields.monthlyPlanStatus.value='off';
calc('monthlyPlanSave()');
assert.deepEqual(model.prefs.monthlyDutyPlans['2026-11-13'],{status:'off',start:'',end:''});
fields.monthlyPlanStatus.value='unset';
calc('monthlyPlanSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-13'],undefined);
assert.equal(JSON.stringify(model.shifts),originalDuty,'sales originals never change when editing monthly plans');
assert.match(live,/live:\['◴','集計'\],monthly:\['▦','月間営業管理'\]/);
assert.match(live,/tab==='monthly'\?renderMonthlyManagement\(\)/);
assert.doesNotMatch(live,/return head\+overview\+renderMonthlySales\(\)/);
assert.match(live,/return titleBlock\('月間営業管理'/);
console.log('PASS: 月間画面独立・目標/予定の端末保存・夜勤時刻・既存日報原本の保護');
