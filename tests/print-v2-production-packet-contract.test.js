'use strict';
/**
 * Stage14 — production HTML googleShiftPacket and totals contract.
 * This evaluates the ACTUAL function bodies from index.html, but supplies
 * synthetic prices/payment splits (browser dependencies and live data absent).
 * It is not a test of Firebase, Google credentials or deployed Apps Script.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {projectTrustedPacket}=require('../server-drafts/print-stage-legacy-rows.js');
const {prepareV2,decodeV2}=require('../server-drafts/print-stage-v2.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function extract(name){
 const start=html.indexOf('function '+name+'(');
 assert.ok(start>=0,'production function missing '+name);
 const bodyStart=html.indexOf('{',start);
 let level=0,stop=-1;
 for(let i=bodyStart;i<html.length;i++){
  if(html[i]==='{')level++;
  if(html[i]==='}'&&--level===0){stop=i+1;break;}
 }
 assert.ok(stop>bodyStart,'unclosed '+name);
 return html.slice(start,stop);
}
const bodies=['googleShiftPacket','totals','pricing','settledTenderAmounts']
 .map(extract).join('\n');
const ctx={
 deriveRaw:row=>({...row.raw}),
 feeSettings:x=>x,
 amount:x=>Number(x||0),
 hasEmptyHighway:()=>false,
 uberDispatchFeeApplies:(record)=>record.raw?.E==='U',
 driverCollects:code=>['現','カ','QR'].includes(code),
 paymentBreakdown:row=>({items:row.meta?.syntheticSplit||[]}),
 dateStamp:()=> '2026-10-21',
 uberAppAmounts:()=>null,
 number:value=>value===''||value==null?null:Number(value)
};
vm.createContext(ctx);vm.runInContext(bodies,ctx);
const uid='synthetic-contract-owner',id='shift-1792500000000-contract';
const original={
 id,date:'2026-10-21',startedAt:'08:00',endedAt:'18:00',
 startedIso:'2026-10-20T23:00:00.000Z',endedIso:'2026-10-21T09:00:00.000Z',
 settings:{uberSurcharge:100},
 records:[
  {kind:'ride',status:'complete',
   raw:{A:1,E:'G',N:'現',K:1000,AQ:200,AR:0,W:0,AI:0,AL:'【合成】迎車地',AM:'【合成】降車地'},
   meta:{syntheticSplit:[{type:'現',amount:700},{type:'QR',amount:500}]}},
  {kind:'cancel',status:'complete',
   raw:{A:2,E:'G',N:'',K:0,AQ:0,AR:0,W:0,AI:0,AL:'【合成】キャンセル'},
   meta:{cancelAt:'09:55',dispatchAt:'09:50'}}
 ]
};
const before=JSON.stringify(original);
const packet=vm.runInContext('googleShiftPacket',ctx)(original);
assert.equal(JSON.stringify(original),before,'original duty must stay immutable');
assert.equal(packet.kind,'TAXIAPP_SHIFT_V1');
assert.ok(packet.shift.records[0].amounts,'real browser packet carries pricing() result');
for(const key of ['meter','discount','goFee','uberSurcharge','cashReceived',
 'cashRemittance','etcRemittance','totalRemittance','paymentAllocated']){
 assert.ok(Object.hasOwn(packet.summary,key),'real browser totals must contain '+key);
}
assert.equal(packet.summary.meter,1000);
assert.equal(packet.summary.goFee,200);
assert.equal(packet.summary.cashReceived,700);
assert.equal(packet.summary.paymentAllocated,1200);
assert.equal(packet.summary.cashRemittance,700);
assert.equal(packet.summary.totalRemittance,700);
assert.equal(packet.shift.records[0].payments.length,2);
assert.equal(packet.shift.records[0].payments[0].company,700);
assert.equal(packet.shift.records[0].payments[1].company,500);
const projected=projectTrustedPacket({packet,sourceRevision:11});
assert.equal(projected.rows['TAXIAPP_印刷データ'].length,2);
assert.equal(projected.rows['TAXIAPP_決済内訳'].length,2);
assert.equal(projected.rows['TAXIAPP_印刷データ'][1][3],'キャンセル');
assert.equal(projected.rows['TAXIAPP_印刷データ'][1][4],0);
assert.equal(projected.rows['TAXIAPP_乗務一覧'][0][8],1000);
assert.equal(projected.rows['TAXIAPP_乗務一覧'][0][12],700);
const v2=prepareV2({sourceUid:uid,sourceRevision:11,
 expectedCommittedRevision:0,virtual:projected});
const decoded=decodeV2(v2,uid);
assert.equal(decoded.rows['TAXIAPP_集計'].find(row=>row[1]==='cashRemittance')[2],700);
assert.equal(decoded.rows['TAXIAPP_集計'].find(row=>row[1]==='paymentAllocated')[2],1200);
assert.equal(decoded.rows['TAXIAPP_印刷データ'][1][4],0);
assert.equal(v2.chunks.join('').includes('syntheticSplit'),false,
 'debug-only synthetic payment data must not leak into print stage');
console.log('Production googleShiftPacket/totals contract PASS: 2 payment parts, GO company deposit, cancelled dispatch zero, V2 conversion');
