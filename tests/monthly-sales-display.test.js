'use strict';
// 月間売上は公式計算の表示だけを利用。祝日と締め日を実働コードから検証。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('index.html','utf8');
const start=src.indexOf('const MONTHLY_HOLIDAYS=');
const end=src.indexOf('async function loadMonthlySales(){',start);
assert.ok(start>0&&end>start,'月間売上の実働関数が見つかる');
const ctx={Date,model:{prefs:{monthlySalesCloseDay:'end'}},
 safeText:String,money:value=>Number(value).toLocaleString('ja-JP')+'円',
 canEditNow:()=>true};
vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
const calc=expression=>vm.runInContext(expression,ctx);
assert.equal(calc("monthlySalesPeriod('2026-10','20').startDate"),'2026-09-21');
assert.equal(calc("monthlySalesPeriod('2027-01','15').startDate"),'2026-12-16');
assert.equal(calc('meterSalesTaxExcludedReference(1100)'),1000);
assert.equal(calc('meterSalesTaxExcludedReference(3200)'),2909);
assert.equal(calc("monthlySalesDayLabel('2026-11-03').holiday"),'文化の日');
assert.equal(calc("monthlySalesDayLabel('2026-11-07').kind"),'saturday');
assert.equal(calc("monthlySalesDayLabel('2026-11-01').kind"),'sunday');
assert.equal(calc("monthlySalesDayLabel('2027-03-22').holiday"),'振替休日');
assert.equal(calc("monthlySalesDayLabel('2028-01-01').holiday"),'','未公表年の祝日を推測しない');
calc("monthlySalesMonth='2026-11';monthlySalesOpened=true");
calc("monthlySalesData={startDate:'2026-11-01',endDate:'2026-11-30',unfinished:1,days:["+
 "{date:'2026-11-01',duties:0,departures:0,unfinished:0,meter:0},"+
 "{date:'2026-11-03',duties:1,departures:1,unfinished:0,meter:1100},"+
 "{date:'2026-11-07',duties:0,departures:1,unfinished:1,meter:0}],"+
 "sum:{duties:1,departures:2,unfinished:1,meter:1100}}");
const html=calc('renderMonthlySales()');
assert.match(html,/data-monthly-sales-panel open/,'開閉状態が維持される');
assert.match(html,/monthly-day-holiday/);
assert.match(html,/11\/03（火・祝）/);
assert.doesNotMatch(html,/文化の日/,'祝日の名称は表に表示しない');
assert.match(html,/monthly-day-saturday/);
assert.match(html,/monthly-day-sunday/);
assert.doesNotMatch(html,/<th scope="col">出庫<\/th>/,'出庫列は設けない');
assert.match(html,/<th scope="col">税込売上<\/th><th scope="col">税別売上<\/th>/);
assert.match(html,/1,100円/);
assert.match(html,/1,000円/);
assert.doesNotMatch(html,/id="monthlySalesCloseDay"/,'締め日を表内から除去');
assert.match(src,/data-driver-profile-settings>[\s\S]*?renderDriverDefaults\(\)/);
assert.match(src,/月間売上の締め日/);
assert.match(src,/html\[data-ui-theme="night"\] \.monthly-sales-table tbody tr\.monthly-day-holiday/);
assert.match(src,/月間売上表 <span class="monthly-report-subtitle">/);
assert.match(src,/<title>TAXIAPP v0\.3\.162 — 乗務日報<\/title>/);
console.log('月間表：締め期間・既存税別表示・曜日/祝日色分け・出庫/入庫前・折りたたみ・設定分離を確認');
