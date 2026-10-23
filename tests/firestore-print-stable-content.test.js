'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('google-apps-script/FirestorePrintPullDraft.gs','utf8');
const shiftId='shift-1792665840000-synthetic';
const first={
 kind:'TAXIAPP_SHIFT_V1',
 shift:{id:shiftId,date:'2026-10-22',
  records:[{raw:{A:'09:00',E:'流し',K:1230,AL:'神戸',AM:'伊丹'},amounts:{meter:1230,goFee:200},
   payments:[{type:'現',received:1230,company:1230}]}],
  __taxiPrintSummary:{meter:1230,goFee:200,cashRemittance:1230}},
 summary:{meter:1230,goFee:200,cashRemittance:1230},
 printRecordedAt:'2026-10-22T12:34:56.000Z'
};
const reordered={
 printRecordedAt:'2026-10-22T12:34:56.000Z',
 summary:{cashRemittance:1230,goFee:200,meter:1230},
 shift:{__taxiPrintSummary:{cashRemittance:1230,meter:1230,goFee:200},
  records:[{payments:[{company:1230,received:1230,type:'現'}],
   amounts:{goFee:200,meter:1230},
   raw:{AM:'伊丹',K:1230,AL:'神戸',A:'09:00',E:'流し'}}],
  date:'2026-10-22',id:shiftId},
 kind:'TAXIAPP_SHIFT_V1'
};
const ctx={JSON,Number,Object,Array,String,Date,RegExp,Error,console,
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 firestorePrintConfigDraft_:()=>({uid:'owner',project:'test'})};
vm.createContext(ctx);vm.runInContext(source,ctx);
// Local test synthetic config overrides the script-property lookup only.
ctx.firestorePrintConfigDraft_=()=>({uid:'owner',project:'test'});
assert.equal(ctx.firestorePrintSamePacketDraft_(first,reordered),true,
 'Firestore map property order must not make the same revision look changed');
const actuallyDifferent=JSON.parse(JSON.stringify(reordered));
actuallyDifferent.shift.records[0].raw.AL='大阪';
assert.equal(ctx.firestorePrintSamePacketDraft_(first,actuallyDifferent),false,
 'real passenger location changes must never be masked');
actuallyDifferent.shift.records[0].raw.AL='神戸';
actuallyDifferent.shift.records[0].amounts.meter=1200;
assert.equal(ctx.firestorePrintSamePacketDraft_(first,actuallyDifferent),false,
 'financial changes must never be masked');
actuallyDifferent.shift.records[0].amounts.meter=1230;
actuallyDifferent.printRecordedAt='2026-10-22T12:34:57.000Z';
assert.equal(ctx.firestorePrintSamePacketDraft_(first,actuallyDifferent),false,
 'stored update time change must not be masked');
let reads=0,printWrites=0;
ctx.firestorePrintDocDraft_=()=>{
 reads++;
 return {id:shiftId,revision:7,packet:reads%2?first:reordered};
};
ctx.savePacket_=(packet,options)=>{
 printWrites++;
 assert.equal(options.firestoreRevision,7);
 assert.equal(options.firestoreOwnerUid,'owner');
 options.verifyCurrentSource();
 return '保存完了';
};
assert.equal(ctx.firestorePrintSelectedDutyDraft_(shiftId,'2026-10-22','mock'),'保存完了');
assert.equal(reads,3,'stable matching data requires prelock, inlock, final source checks');
assert.equal(printWrites,1);
reads=0;printWrites=0;
ctx.firestorePrintDocDraft_=()=>{
 reads++;
 return {id:shiftId,revision:7,packet:reads===1?first:actuallyDifferent};
};
assert.throws(()=>ctx.firestorePrintSelectedDutyDraft_(shiftId,'2026-10-22','mock'),
 /同一更新番号でFirestore原本の内容が異なります/);
assert.equal(printWrites,0,'real same-revision divergence must stop before any print-source write');
console.log('Firestore原本同版：順序差は一致、内容差と保存時刻差は安全停止');
