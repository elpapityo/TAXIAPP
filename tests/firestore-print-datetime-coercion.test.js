'use strict';
// 印刷元セルが日時型になっても、同じ日時のみを一致と認める。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={Date,JSON,Number,Error,Object,Array,RegExp,Set,
 Utilities:{formatDate:(d,tz,format)=>{
  assert.equal(tz,'Asia/Tokyo');assert.ok(['yyyy-MM-dd','yyyy-MM-dd HH:mm:ss'].includes(format));
  return new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d).replace('T',' ').slice(0,format==='yyyy-MM-dd'?10:19);
 }}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('google-apps-script/FirestorePrintSourcesDraft.gs','utf8'),context);
const date=new Date('2026-10-22T08:30:00+09:00');
assert.equal(context.firestorePrintSameCellDraft_(date,'2026-10-22 08:30:00'),true);
assert.equal(context.firestorePrintSameCellDraft_(date,'2026-10-22'),true);
assert.equal(context.firestorePrintSameCellDraft_(date,'2026-10-23'),false);
assert.equal(context.firestorePrintSameCellDraft_(date,'2026-10-22 08:30:01'),false);
assert.equal(context.firestorePrintSameCellDraft_(date,'2026-10-22 08:30:00=1'),false);
assert.equal(context.firestorePrintSameCellDraft_('abc','abc'),true);
assert.equal(context.firestorePrintSameRowsDraft_([['id',date]],[['id','2026-10-22 08:30:00']]),true);
assert.equal(context.firestorePrintSameRowsDraft_([['id',date]],[['id','2026-10-22 08:30:01']]),false);
console.log('日時型セルは日本時間の秒まで一致した場合だけ転送確認に合格');
