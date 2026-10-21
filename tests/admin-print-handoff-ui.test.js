'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
require('../admin-print-handoff-preflight.js');
require('../admin-firestore-cutover.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function adminPrintHandoffHtml(){');
const b=html.indexOf('function adminCutoverFirebaseHtml(){',a);
assert.ok(a>0&&b>a,'the isolated admin preview is present');
const uid='owner-only',id='shift-777-a';
const shift={id,date:'2026-10-21',startedAt:'08:00',endedAt:'16:00',
 records:[{kind:'ride',status:'complete',raw:{K:1800,N:'現',E:'G'}}],settings:{}};
const clone=x=>JSON.parse(JSON.stringify(x));
let requests=0,sourceUpdates=0;
const ctx={
 window:{TAXIAPP_ADMIN_PRINT_PREFLIGHT:globalThis.TAXIAPP_ADMIN_PRINT_PREFLIGHT,
  TAXIAPP_ADMIN_CUTOVER:globalThis.TAXIAPP_ADMIN_CUTOVER},
 legacyDiary:()=>true,accountScope:{uid},model:{shifts:[clone(shift)]},
 adminCutoverSelected:new Set([id]),
 adminCutoverFirebaseAudit:null,adminCutoverSheetAudit:null,
 safeText:s=>String(s??''),money:x=>x+'円',
 googleShiftPacket:row=>{
  requests++;
  return {kind:'TAXIAPP_SHIFT_V1',shift:row,summary:{
   meter:1800,goFee:0,uberSurcharge:0,discount:0,
   cashRemittance:1800,etcRemittance:0,totalRemittance:1800,cancellation:0}};
 },
 googlePostRequest:()=>{sourceUpdates++;throw Error('must never request');},
 accountDiary:{request:()=>{sourceUpdates++;throw Error('must never request');}},
 Date,JSON,Map,Set,Object
};
vm.createContext(ctx);vm.runInContext(html.slice(a,b),ctx);
const preview=()=>vm.runInContext('adminPrintHandoffHtml()',ctx);
const unknown=preview();
assert.match(unknown,/要確認/);
assert.match(unknown,/本人Firebase原本が未照合/);
assert.match(unknown,/Google同期原本が未照合/);
assert.equal(requests,0);
const signature=JSON.stringify(ctx.model.shifts);
ctx.adminCutoverFirebaseAudit={uid,localSignature:signature,cloudShifts:[clone(shift)],
 cloudRevisions:{[id]:3}};
const partly=preview();
assert.match(partly,/Google同期原本が未照合/);
assert.doesNotMatch(partly,/三原本と従来の印刷用データ形式は一致しました/);
ctx.adminCutoverSheetAudit={uid,localSignature:signature,sheetShifts:[clone(shift)]};
const passed=preview();
assert.match(passed,/三原本と従来の印刷用データ形式は一致/);
assert.match(passed,/メーター 1800円/);
assert.match(passed,/Firebase更新番号：3/);
assert.match(passed,/書き込み不可/);
ctx.adminCutoverSheetAudit.sheetShifts=[];
assert.match(preview(),/Google同期原本に選択した日報がありません/);
ctx.adminCutoverSheetAudit.sheetShifts=[clone(shift)];
ctx.adminCutoverFirebaseAudit.cloudRevisions={[id]:null};
assert.match(preview(),/更新番号が検証されていません/);
ctx.adminCutoverFirebaseAudit.cloudRevisions={[id]:3};
ctx.adminCutoverFirebaseAudit.localSignature='stale';
assert.match(preview(),/本人Firebase原本が未照合です/);
ctx.adminCutoverFirebaseAudit.localSignature=signature;
ctx.model.shifts[0].records[0].raw.K=1801;
assert.match(preview(),/未照合|一致しません/);
ctx.model.shifts[0].records[0].raw.K=1800;
ctx.adminCutoverSelected.clear();
assert.match(preview(),/1件だけ選択/);
assert.equal(sourceUpdates,0,'never send network requests or writes');
assert.deepEqual(ctx.model.shifts[0].records[0].raw,{K:1800,N:'現',E:'G'});
console.log('Admin print preview UI: disabled, missing/stale sources, version check and pure matching PASS');
