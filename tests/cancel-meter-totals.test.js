'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const ctx={CANCEL_METER_CHECK_AMOUNT:700,number:v=>v==null||v===''?null:Number(v),
 pricing:r=>({meter:r.kind==='ride'?100510:0,realToll:0,emptyToll:0,cancellation:0,goFee:0,uberFee:0,uberSurcharge:0,uberCrewShare:0,reservation:0,tip:0,discount:0,customerBill:r.kind==='ride'?100510:0,printedDetail:r.kind==='ride'?100510:0}),
 settledTenderAmounts:()=>({items:[{type:'現',received:100510,company:100510}],unallocatedFees:0}),hasEmptyHighway:()=>false,
 deriveRaw:r=>({...r.raw}),Number,Math,Object};
vm.createContext(ctx);
function load(name,next){const a=html.indexOf('function '+name+'('),b=html.indexOf(next,a);assert.ok(a>0&&b>a);vm.runInContext(html.slice(a,b),ctx);}
load('meterCheckValues','function stamp(');
load('totals','/* The old A:AR schema');
load('googleShiftPacket','// POST through');
const ride={kind:'ride',status:'complete',raw:{K:100510},meta:{}};
const cancel=n=>({kind:'cancel',status:'complete',raw:{K:0},meta:n==null?{}:{cancelMeterAdjustment:n}});
for(const [rows,expected] of [[[ride],0],[[ride,cancel(700)],700],[[ride,cancel(0)],0],[[ride,cancel(700),cancel(500)],1200],[[ride,cancel()],700],[[ride,{...cancel(700),status:'draft'}],0]]){
 const snapshot=JSON.stringify(rows),t=ctx.totals(rows);
 assert.equal(t.meterTotal,100510+expected);assert.equal(t.cancelMeterDeduction,expected);
 assert.equal(t.actualSales,100510);assert.equal(t.meterTotal-t.cancelMeterDeduction,t.actualSales);
 assert.equal(t.cashRemittance,100510);assert.equal(t.totalRemittance,100510);assert.equal(t.cancellation,0);
 assert.equal(JSON.stringify(rows),snapshot,'原本を書き換えない');
 const packet=ctx.googleShiftPacket({records:rows,settings:{},date:'2026-11-21'});
 assert.equal(packet.summary.meterTotal,t.meterTotal);assert.equal(packet.summary.meter,100510);
}
assert.ok(!html.includes('check=meterCheckValues(v.t),'),'乗務データなしの呼出しを残さない');
console.log('キャンセル累計・控除・実売上・納金・転送の整合確認成功');
