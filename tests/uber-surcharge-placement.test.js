'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync('index.html','utf8');
assert.match(s,/return Boolean\(app\?\.valid && app\.surcharge>0 && \(uberHasInCabPayment\(row\)\|\|row\?\.raw\?\.N==='U'\)\)/);
const a=s.indexOf('function uberHasInCabPayment(row){');
const b=s.indexOf('function estimatedCashDue(row,settings={},shiftDate=\'\'){',a);
assert.ok(a>=0&&b>a);
const ctx={
 number:v=>v===''||v==null?null:Number(v),
 feeSettings:v=>({uberSurcharge:v?.uberSurcharge??100})
};
vm.createContext(ctx);vm.runInContext(s.slice(a,b),ctx);
function fee(N,displayed='8400'){
 const row={kind:'ride',raw:{E:'U',N,K:'8300'},meta:{uberAppDisplayed:displayed}};
 ctx.row=row;return vm.runInContext('uberDispatchFeeApplies(row,\'\',{uberSurcharge:100})',ctx);
}
assert.equal(fee('U'),true,'even if selected Uber payment, extra displayed 100 must appear as surcharge');
assert.equal(fee('現'),true);
assert.equal(fee('U','0'),false,'zero Uber-only initial value must not apply dispatch fee');
assert.equal(fee('現','8300'),false);
const ride=s.slice(s.indexOf('function renderRideForm('),s.indexOf('function renderEmptyForm('));
const button=ride.indexOf('class="actions settlement-save-first"'),payment=ride.indexOf('${renderPaymentSplit(shift,d)}');
assert.ok(button>=0&&payment>button,'save before payment details');
assert.equal((ride.match(/data-action="saveDraft"/g)||[]).length,1,'only one ride save button');
console.log('Uber surcharge and settlement save placement regressions passed');
