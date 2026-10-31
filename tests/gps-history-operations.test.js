const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(){
 const docs=new Map(),writes=[];
 const actor='admin-12345678',target='driver-12345678',shiftId='shift-100';
 docs.set('admins/'+actor,{enabled:true});
 docs.set('users/'+target,{status:'active'});
 const expiresAt={toMillis:()=>Date.now()+86400000};
 docs.set('gpsHistory/'+target+'/shifts/'+shiftId,{
  format:'TAXIAPP_GPS_HISTORY_V1',shiftId,startedAtMs:1,endedAtMs:2,
  points:[{lat:34.7,lon:135.4,accuracy:5,segmentNo:1}],
  expiresAt,contentHash:'test'
 });
 let auditBlocked=false,sequence=0;
 const snapshot=key=>({exists:docs.has(key),data:()=>docs.get(key),
  get:name=>docs.get(key)?.[name]});
 const reference=key=>({path:key,async get(){return snapshot(key)}});
 const db={
  doc:reference,
  collection(name){return {doc(){
   const key=name+'/'+(++sequence);
   return {...reference(key),async create(value){
    if(auditBlocked)throw Error('audit storage unavailable');
    docs.set(key,value);writes.push({kind:'create',key,value});
   }};
  }}},
  async runTransaction(operation){
   const steps=[];
   const tx={
    async get(ref){return snapshot(ref.path)},
    create(ref,value){steps.push({kind:'create',key:ref.path,value})},
    delete(ref){steps.push({kind:'delete',key:ref.path})}
   };
   const answer=await operation(tx);
   for(const step of steps){
    if(step.kind==='create'){
     if(docs.has(step.key))throw Error('document already exists');
     docs.set(step.key,step.value);
    }else docs.delete(step.key);
    writes.push(step);
   }
   return answer;
  }
 };
 function fakeRequire(name){
  if(name==='./gps-history-validation')return require('../functions/gps-history-validation');
  if(name==='node:crypto')return require('node:crypto');
  if(name==='firebase-functions/v2/https')return {onCall:(_options,fn)=>fn,
   HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
  if(name==='firebase-functions/v2/scheduler')return {onSchedule:(_options,fn)=>fn};
  if(name==='firebase-admin/app')return {getApps:()=>[{}],initializeApp:()=>({})};
  if(name==='firebase-admin/firestore')return {
   getFirestore:()=>db,FieldValue:{serverTimestamp:()=>({server:true})},
   Timestamp:{fromMillis:n=>({toMillis:()=>n}),now:()=>({toMillis:()=>Date.now()})}
  };
  throw Error('予期しない読み込み: '+name);
 }
 const code=fs.readFileSync(path.join(__dirname,'..','functions','gps-history-operations.js'),'utf8');
 const context={module:{exports:{}},exports:{},require:fakeRequire,console,Date};
 vm.runInNewContext(code,context,{filename:'gps-history-operations.js'});
 return {fn:context.exports,docs,writes,actor,target,shiftId,
  blockAudit(value){auditBlocked=value;}};
}
test('管理者閲覧は監査ログを保存してから経路を返す',async()=>{
 const f=fixture();
 const query={auth:{uid:f.actor},data:{targetUid:f.target,shiftId:f.shiftId}};
 const r=await f.fn.adminViewGpsHistory(query);
 assert.equal(r.points.length,1);
 const audit=f.writes.find(w=>w.value?.action==='view');
 assert.ok(audit);
 assert.equal(audit.value.targetUid,f.target);
 assert.equal(audit.value.points,undefined);
 f.blockAudit(true);
 await assert.rejects(f.fn.adminViewGpsHistory(query),/audit storage unavailable/);
});
test('管理者CSV出力は確認しない限り許可しない',async()=>{
 const f=fixture(),q={auth:{uid:f.actor},data:{targetUid:f.target,shiftId:f.shiftId}};
 await assert.rejects(f.fn.adminExportGpsHistory(q),/確認してください/);
 const done=await f.fn.adminExportGpsHistory({...q,data:{...q.data,confirmedExport:true}});
 assert.equal(done.points.length,1);
 assert.ok(f.writes.some(w=>w.value?.action==='csv_export'));
});
test('削除は確認と管理者権限を要求し、墓標・監査・削除を同時確定',async()=>{
 const f=fixture(),q={auth:{uid:f.actor},data:{targetUid:f.target,shiftId:f.shiftId}};
 await assert.rejects(f.fn.deleteGpsHistory(q),/確認してください/);
 const result=await f.fn.deleteGpsHistory({...q,data:{...q.data,confirmationShiftId:f.shiftId}});
 assert.equal(result.status,'deleted');
 assert.ok(f.docs.has('gpsHistoryTombstones/'+f.target+'/shifts/'+f.shiftId));
 assert.equal(f.docs.has('gpsHistory/'+f.target+'/shifts/'+f.shiftId),false);
 assert.ok(f.writes.some(w=>w.value?.action==='delete'&&w.value.points===undefined));
});
test('管理者以外の履歴閲覧を拒否',async()=>{
 const f=fixture();
 await assert.rejects(f.fn.adminViewGpsHistory({auth:{uid:'outsider-123'},
  data:{targetUid:f.target,shiftId:f.shiftId}}),/管理者権限/);
});
test('本人CSV監査は再送時に重複せず、内容違いと未登録を拒否',async()=>{
 const f=fixture(),q={auth:{uid:f.target},data:{operationId:'12345678-1234-1234-1234-123456789abc',shiftId:f.shiftId,atMs:Date.now()}};
 assert.equal((await f.fn.recordOwnGpsCsvAudit(q)).status,'saved');
 assert.equal((await f.fn.recordOwnGpsCsvAudit(q)).status,'saved');
 assert.equal(f.writes.filter(w=>w.value?.action==='csv_export').length,1);
 await assert.rejects(f.fn.recordOwnGpsCsvAudit({...q,data:{...q.data,shiftId:'shift-200'}}),/異なる記録/);
 await assert.rejects(f.fn.recordOwnGpsCsvAudit({...q,auth:{uid:'outsider-123'}}),/利用資格/);
});
