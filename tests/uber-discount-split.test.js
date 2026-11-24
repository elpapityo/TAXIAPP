'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('function realHighwayCharge(row){'),b=html.indexOf('function splitPaymentRows(',a);
assert.ok(a>0&&b>a);
const c={window:{TAXIAPP_HIGHWAY_SECTIONS:require('../highway-sections.js')},amount:x=>Number(x)||0,goCollectionFee:()=>0,number:x=>x==null||x===''?null:Number(x),amountDiscount:r=>Number(r.AR||0),feeSettings:()=>({uberSurcharge:100}),uberHasInCabPayment:r=>r.raw.N!=='U',
 driverCollects:type=>type==='現',hasEmptyHighway:()=>false,
 deriveRaw:row=>({...row.raw,...(Array.isArray(row.meta.highwaySections)?c.window.TAXIAPP_HIGHWAY_SECTIONS.project(row.raw,row.meta.highwaySections):{})})};
vm.createContext(c);vm.runInContext(html.slice(a,b),c);
const sample=(shown,pay='現',discount='620')=>({kind:'ride',raw:{E:'U',N:pay,K:'6200',O:'シ',AR:discount},meta:{uberAppDisplayed:shown}});
function get(x){c.row=x;return vm.runInContext('uberAppAmounts(row,{})',c)}
const result=get(sample('5680'));
assert.equal(result.appPaid,0,'discount is not an Uber app payment');
assert.equal(result.surcharge,100);
assert.equal(result.valid,true);
c.row=sample('5680');
assert.equal(vm.runInContext('uberDispatchFeeApplies(row,\'\',{})',c),true);
const paid=get(sample('0','U'));
assert.equal(paid.appPaid,5580,'app settles discounted fare');
assert.equal(paid.surcharge,0);
const partial=get(sample('5000'));
assert.equal(partial.appPaid,580,'partial app settlement is measured after discount');
assert.equal(partial.valid,true);
assert.equal(get(sample('6300','現','620')).valid,false,'discount ignored by display would be an invalid extra charge');
const tollRide=(displayed,withToll=true)=>({kind:'ride',status:'complete',
 raw:{E:'U',N:'現',K:'10170',O:'',AR:'0',W:'400'},
 meta:{uberAppDisplayed:displayed,...withToll&&{uberAppDisplayedIncludesToll:true}}});
for(const [input,marked] of [['10670',true],['10270',false]]){
 const row=tollRide(input,marked);
 const split=c.paymentBreakdown(row);
 assert.equal(split.due,10670);
 assert.equal(split.firstAmount,10670);
 assert.equal(split.uber.surcharge,100);
 assert.equal(split.uber.appPaid,0);
 assert.deepEqual(Array.from(c.validatePaymentBreakdown(row)),[]);
 const settlement=c.settledTenderAmounts(row,{},'2026-11-25');
 assert.equal(settlement.fees.meter,10170);
 assert.equal(settlement.fees.realToll,400);
 assert.equal(settlement.fees.customerBill,10670);
 assert.equal(settlement.items[0].received,10670);
 assert.equal(settlement.items[0].company,10570);
}
const sections=tollRide('10570');
sections.raw.W='999';
sections.meta.highwaySections=[{mode:'実',fee:'250'},{mode:'実',fee:'150'},{mode:'空',fee:'300'}];
assert.equal(c.paymentBreakdown(sections).due,10570);
assert.equal(c.paymentBreakdown(sections).uber.surcharge,0);
sections.meta.uberAppDisplayed='10370';
assert.equal(c.paymentBreakdown(sections).uber.appPaid,200);
assert.equal(c.paymentBreakdown(sections).firstAmount,10370);
sections.raw.N='U';
sections.meta.uberAppDisplayed='0';
assert.equal(c.paymentBreakdown(sections).firstAmount,10570);
assert.equal(c.paymentBreakdown(sections).uber.surcharge,0);
assert.equal(c.validatePaymentBreakdown(tollRide('10770')).length,1);
console.log('Uber discount, ETC, dispatch fee and legacy records passed');
