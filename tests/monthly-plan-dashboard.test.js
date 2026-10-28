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
const ctx={Date,model,deviceMode:'writer',accountSettingsAuto:{status:()=>({message:'設定の読戻し確認済み'})},monthlyPrefs:()=>model.prefs,
 monthlyViewerPrefs:null,monthlyViewerPrefsMessage:'',
 monthlySalesMonth:'2026-11',monthlySalesBusy:false,monthlySalesMessage:'',monthlySalesData:{
 startDate:'2026-11-01',endDate:'2026-11-30',
 sum:{meter:30000,duties:2},
 days:[{date:'2026-11-02',meter:10000,duties:1,entries:[{id:'duty-2',startedAt:'11/02 17:00',endedAt:'11/03 06:00',duration:46800,meter:10000}]},{date:'2026-11-04',meter:20000,duties:1}]
},monthlySalesClosingDay:()=> 'end',
monthlySalesPeriod:()=>({startDate:'2026-11-01',endDate:'2026-11-30'}),
monthlySalesDayLabel:()=>({weekday:'月',holiday:false}),
renderMonthlySales:()=>'<details data-monthly-sales-panel></details>',
durationHms:seconds=>String(Math.round(seconds/3600))+'時間',
safeText:String,money:n=>Number(n).toLocaleString('ja-JP')+'円',
legacyDiary:()=>false,
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
assert.match(screen,/月間設定の保存を確認/,'writer can request a server readback');
assert.match(screen,/設定の読戻し確認済み/,'monthly page exposes the settings confirmation status');
assert.match(screen,/日別の予定・実績/);
assert.match(screen,/月末着地予測（参考）/);
assert.match(screen,/基本の日別目標/);
assert.match(screen,/予定と確定実績の比較/);
assert.match(screen,/既存アカウント設定同期で他端末と照合/);
assert.match(screen,/data-monthly-sales-panel/);
assert.equal(calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"}).confirmedWorkDays'),2);
assert.equal(calc('monthlyCalendarMoney(34500)'),'3.5万円');
assert.match(screen,/表示方式/);
assert.match(screen,/カレンダー/);
calc("monthlyDayView='list'");
const listing=calc('renderMonthlyManagement()');
assert.match(listing,/日別一覧/);
assert.match(listing,/month-day-list-item/);
assert.match(listing,/10,000円/);
assert.match(listing,/予定 出番/);
calc("monthlyDayView='calendar'");
assert.match(calc('renderMonthlyManagement()'),/month-plan-calendar/);
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
assert.match(actualScreen,/日別目標との差額/);
calc('monthlyPlanDate="2026-11-13";monthlyPlanSave()');
assert.deepEqual(JSON.parse(JSON.stringify(model.prefs.monthlyDutyPlans['2026-11-13'])),{status:'work',start:'18:00',end:'07:00'});
assert.equal(saved,2);
fields.monthlyPlanStatus.value='off';
calc('monthlyPlanSave()');
assert.deepEqual(JSON.parse(JSON.stringify(model.prefs.monthlyDutyPlans['2026-11-13'])),{status:'off',start:'',end:''});
fields.monthlyPlanStatus.value='unset';
calc('monthlyPlanSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-13'],undefined);
// 目標設定ページは一覧表示と独立し、曜日別設定が全月に自動適用される。
calc("monthlyManagementMode='targets'");
const targetScreen=calc('renderMonthlyManagement()');
assert.match(targetScreen,/曜日別の売上目標/);
assert.match(targetScreen,/月間売上目標（円）/);
assert.match(targetScreen,/monthlyWeekdayGoal1/);
assert.doesNotMatch(targetScreen,/日別の予定・実績/);
for(let weekday=0;weekday<7;weekday++)fields['monthlyWeekdayGoal'+weekday]={value:''};
fields.monthlyWeekdayGoal1.value='32000';
fields.monthlyWeekdayGoal4.value='49000';
calc('monthlyWeekdayGoalSave()');
assert.equal(model.prefs.monthlyWeekdaySalesGoals['1'],32000);
assert.equal(model.prefs.monthlyWeekdaySalesGoals['4'],49000);
assert.equal(calc('monthlyDateGoal("2026-11-02").value'),32000);
assert.equal(calc('monthlyDateGoal("2026-12-07").value'),32000,'weekday goals persist across months');
assert.equal(calc('monthlyDateGoal("2026-11-03").value'),26000,'unconfigured weekday falls back to basic goal');
fields.monthlyWeekdayGoal1.value='bad';
calc('monthlyWeekdayGoalSave()');
assert.equal(model.prefs.monthlyWeekdaySalesGoals['1'],32000,'invalid input cannot replace a saved weekday target');
fields.monthlyWeekdayGoal1.value='32000';
fields.monthlyDateGoalInput={value:'55000'};
calc('monthlyPlanDate="2026-11-02";monthlyDateGoalSave()');
assert.equal(calc('monthlyDateGoal("2026-11-02").value'),55000);
assert.equal(calc('monthlyDateGoal("2026-11-02").source'),'個別設定');
assert.equal(calc('monthlyDateGoal("2026-11-09").value'),32000,'single-day override does not alter other Mondays');
calc("monthlyManagementMode='calendar'");
const overrideScreen=calc('renderMonthlyManagement()');
assert.match(overrideScreen,/55,000円/);
assert.match(overrideScreen,/10,000円/,'actual sales unchanged in calendar');
fields.monthlyDateGoalInput.value='';
calc('monthlyDateGoalSave()');
assert.equal(model.prefs.monthlyDateSalesGoals['2026-11-02'],undefined);
assert.equal(calc('monthlyDateGoal("2026-11-02").value'),32000,'blank date restores inherited weekday goal');
assert.equal(JSON.stringify(model.shifts),originalDuty,'sales originals never change when editing monthly plans or targets');
const beforeActuals=JSON.stringify(model.shifts);
fields.monthlyActualStatus={value:'public'};
calc('monthlyPlanDate="2026-11-02";monthlyActualSave()');
assert.equal(model.prefs.monthlyDutyActuals['2026-11-02'].status,'public');
let sales=calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"})');
assert.equal(sales.gross,30000,'source total is never changed');
assert.equal(sales.publicGross,10000);
assert.equal(sales.normalGross,20000);
assert.equal(sales.countedGross,20000,'public sales excluded by default');
assert.equal(sales.short,100000,'monthly target applied to counting-only sales');
calc("monthlyManagementMode='calendar'");
assert.match(calc('renderMonthlyManagement()'),/実績：?公出|実績 公出/);
fields.monthlyPublicIncluded={checked:true};
calc('monthlyPublicGoalSave()');
sales=calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"})');
assert.equal(sales.gross,30000);
assert.equal(sales.countedGross,30000);
assert.equal(sales.short,90000);
fields.monthlyPublicIncluded.checked=false;
calc('monthlyPublicGoalSave()');
fields.monthlyActualStatus.value='absent';
calc('monthlyPlanDate="2026-11-12";monthlyActualSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-12'].status,'work','absence keeps planned shift');
assert.equal(model.prefs.monthlyDutyActuals['2026-11-12'].status,'absent');
assert.equal(calc('monthlyActualLabel("2026-11-12",monthlyPlanEntry("2026-11-12"),null)'), '欠勤（登録済）');
assert.equal(calc('monthlyActualEntry("2026-11-03")'),null,'no record never means automatic absence');
fields.monthlyActualStatus.value='unset';
calc('monthlyActualSave()');
assert.equal(model.prefs.monthlyDutyActuals['2026-11-12'],undefined,'clear actual independently');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-12'].status,'work');
assert.equal(calc('monthlyDefaultDepartureStatus("2026-11-12")'),'normal');
assert.equal(calc('monthlyDefaultDepartureStatus("2026-11-05")'),'');
fields.monthlyPlanStatus.value='public';
fields.monthlyPlanStart.value='18:00';
fields.monthlyPlanEnd.value='07:00';
calc('monthlyPlanDate="2026-11-06";monthlyPlanSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-06'].status,'public');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-06'].end,'07:00');
assert.equal(calc('monthlyDefaultDepartureStatus("2026-11-06")'),'public');
let publicPlanned=calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"})');
assert.equal(publicPlanned.plannedPublic,1);
const beforePublicIncluded=publicPlanned.left;
assert.ok(beforePublicIncluded>=0,'公出予定は初期設定では残り目標対象から除外');
fields.monthlyPublicIncluded.checked=true;
calc('monthlyPublicGoalSave()');
publicPlanned=calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"})');
assert.equal(publicPlanned.plannedPublic,1);
assert.equal(publicPlanned.left,beforePublicIncluded+1,
 '公出売上を含めると未乗務の公出予定1日が残り出番に増える');
model.prefs.monthlyDutyActuals['2026-11-06']={status:'public'};
publicPlanned=calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"})');
assert.equal(publicPlanned.left,beforePublicIncluded+1,
 '実績を公出と登録しても、未乗務の出番は目標算入設定に従う');
fields.monthlyPublicIncluded.checked=false;
calc('monthlyPublicGoalSave()');
assert.equal(calc('monthlyPlanProgress({startDate:"2026-11-01",endDate:"2026-11-30"}).left'),beforePublicIncluded,
 '公出対象をOFFに戻すと未乗務の公出は残り出番から除外');
delete model.prefs.monthlyDutyActuals['2026-11-06'];

const bulkInputs={monthlyBulkStatus:{value:'off'},monthlyBulkStart:{value:''},monthlyBulkEnd:{value:''},monthlyBulkOverwrite:{checked:false}};
for(const [id,val] of Object.entries(bulkInputs))fields[id]=val;
for(let weekday=0;weekday<7;weekday++)fields['monthlyBulkDay'+weekday]={checked:weekday===4};
calc("monthlyManagementMode='bulk'");
assert.match(calc('renderMonthlyManagement()'),/乗務予定の一括登録/);
assert.match(calc('renderMonthlyManagement()'),/既存予定も上書き/);
calc('monthlyPlanBulkSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-05'].status,'off');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-12'].status,'work','bulk keeps individual plan by default');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-19'].status,'off');
fields.monthlyBulkOverwrite.checked=true;
calc('monthlyPlanBulkSave()');
assert.equal(model.prefs.monthlyDutyPlans['2026-11-12'].status,'off','explicit overwrite changes only plans');
assert.equal(model.prefs.monthlyDutyActuals['2026-11-02'].status,'public','bulk must leave actual work records');
fields.monthlyBulkStatus.value='work';
fields.monthlyBulkStart.value='17:00';
fields.monthlyBulkEnd.value='';
const savedBeforeInvalid=saved;
calc('monthlyPlanBulkSave()');
assert.equal(saved,savedBeforeInvalid,'invalid times do not partially commit bulk changes');
assert.equal(JSON.stringify(model.shifts),beforeActuals,'bulk, actuals and public policy do not modify shift originals');
assert.match(live,/id="shiftActualStatus"/);
assert.match(live,/model\.prefs\.monthlyDutyActuals\[dutyDate\]=\{status:selectedStatus\}/);

assert.match(live,/live:\['◴','集計'\],monthly:\['▦','月間営業計画・実績'\]/);
assert.match(live,/tab==='monthly'\?renderMonthlyManagement\(\)/);
assert.doesNotMatch(live,/return head\+overview\+renderMonthlySales\(\)/);
assert.match(live,/return titleBlock\('月間営業計画・実績'/);
console.log('PASS: 月間画面独立・目標/予定の端末保存・夜勤時刻・既存日報原本の保護');


// 閲覧専用PCはクラウドから取得した目標・予定を表示するが端末原本を書き換えない。
const beforeReadOnly=JSON.stringify(model);
ctx.deviceMode='viewer';
ctx.monthlyViewerPrefs={
 monthlySalesGoals:{'2026-11':850000},
 monthlyDutySalesGoals:{'2026-11':35000},
 monthlyDutyPlans:{'2026-11-12':{status:'public',start:'18:00',end:'07:00'}},
 monthlyDutyActuals:{'2026-11-02':{status:'public'}},
 monthlyIncludePublicSales:'on'
};
ctx.monthlyViewerPrefsMessage='月間設定をFirestoreから取得しました';
ctx.monthlyPrefs=()=>ctx.monthlyViewerPrefs;
assert.equal(calc('monthlyPlanGoal()'),850000);
assert.equal(calc('monthlyDutyGoal()'),35000);
assert.equal(calc('monthlyPlanEntry("2026-11-12").status'),'public');
assert.equal(calc('monthlyActualEntry("2026-11-02")'),'public');
assert.equal(calc('monthlyPublicGoalIncluded()'),true);
assert.match(calc('renderMonthlyManagement()'),/月間設定を再取得/);
assert.equal(JSON.stringify(model),beforeReadOnly,'閲覧用クラウド設定で端末日報と設定は変更しない');
ctx.deviceMode='writer';
ctx.monthlyPrefs=()=>model.prefs;

assert.match(live,/daily\.entries\.push\(\{/,'monthly aggregation must expose duty time read-only');

// 月間Firestoreの管理者読取テスト：旧Google原本への通信を行わない。
assert.doesNotMatch(live,/function loadMonthlyFromLegacyGoogle\(/);
assert.match(live,/mobileItem\('monthly','▦','月間'\)/);
assert.match(live,/data-tab="monthly">▦ 月間営業計画・実績を開く/);
const readBegin=live.indexOf('function monthlyCanReadFirestore(){');
const readEnd=live.indexOf('// 本人UID別の端末設定にだけ保存する乗務計画',readBegin);
assert.ok(readBegin>0&&readEnd>readBegin);
const requests=[],binds=[];
const readCtx={
 Date,
 window:{TAXIAPP_ACCOUNT_DIARY:{create:()=>({
  bind:(user,options)=>binds.push({user,options}),
  request:(action,period)=>{
   requests.push({action,period});
   return Promise.resolve({...period,shifts:[]});
  }
 })}},
 accountScope:{kind:'legacy',uid:'test-admin-uid'},
 currentLoginScope:{uid:'test-admin-uid',admin:true,firebase:{
  auth:{currentUser:{uid:'test-admin-uid'}},f:{},db:{}
 }},
 accountScopeGeneration:4,monthlySalesBusy:false,monthlySalesEpoch:0,
 monthlySalesData:null,monthlySalesMessage:'',monthlySalesMonth:'2026-11',
 monthlySalesClosingDay:()=> 'end',
 monthlySalesPeriod:()=>({startDate:'2026-11-01',endDate:'2026-11-30'}),
 render:()=>{}
};
vm.createContext(readCtx);
vm.runInContext(live.slice(readBegin,readEnd),readCtx);
Promise.resolve(vm.runInContext('loadMonthlySales()',readCtx)).then(()=>{
 assert.equal(binds.length,1);
 assert.equal(binds[0].user.uid,'test-admin-uid');
 assert.equal(binds[0].options.admin,true);
 assert.equal(binds[0].options.storageBackend,'firestore');
 assert.equal(binds[0].options.readOnly,true);
 assert.equal(requests.length,1);
 assert.equal(requests[0].action,'syncHistoryRange');
 assert.equal(requests[0].period.startDate,'2026-11-01');
 assert.equal(requests[0].period.endDate,'2026-11-30');
 assert.equal(readCtx.monthlySalesData?.source,'firestore');
 assert.equal(readCtx.monthlySalesData?.sum?.duties,0);
 console.log('月間：管理者も本人UIDのFirestoreだけを読取り、スマホ直通入口を確認');
}).catch(e=>{console.error(e);process.exitCode=1;});
