'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('   if(accountScope.adminFirestore){',html.indexOf('onWriterSnapshot:async shifts=>'));
// Limit execution to the real legacy-protection guard; the snapshot overwrite follows 'const next'.
// The former storageKey anchor was removed when scoped storage was refactored.
const b=html.indexOf('   const next={...previous,shifts:',a);
assert.ok(a>0&&b>a,'legacy administrator guard must run before the Firestore snapshot replaces the local model');
const source=html.slice(a,b);
const clone=x=>JSON.parse(JSON.stringify(x));
const id='shift-1792500000000-owner';
const sourceDuty={id,date:'2026-10-21',startedAt:'09:00',endedAt:'12:00',
 records:[{kind:'ride',raw:{A:1,K:1000},status:'complete'}],settings:{}};
async function run(legacy,remote){
 const calls=[];
 const context={accountScope:{adminFirestore:true},db:{},
 KEY:'taxiapp-v1',idbGet:async (db,key)=>{calls.push(key);return {shifts:clone(legacy)};},
 localStorage:{getItem:()=>null},JSON,Map,Error,
 googleShiftPacket:shift=>({shift:clone(shift)})};
 const fn=vm.runInNewContext('(async function(shifts){'+source+' return true;})',context);
 let result,error;
 try{result=await fn(remote);}catch(e){error=String(e.message);}
 return {result,error,calls};
}
(async()=>{
 const missing=await run([sourceDuty],[]);
 assert.match(missing.error,/未保存1件/,'empty Firestore must not erase the one original');
 const mixed=await run([sourceDuty],[{...sourceDuty,id:'shift-1792500000001-other'}]);
 assert.match(mixed.error,/未保存1件/);
 const different=await run([sourceDuty],[{...sourceDuty,startingOdo:'999'}]);
 assert.match(different.error,/内容相違1件/);
 const good=await run([sourceDuty],[{...clone(sourceDuty),__taxiPrintSummary:{meter:1000},
   records:[{...sourceDuty.records[0],amounts:{meter:1000},payments:[]}]}]);
 assert.equal(good.result,true,'the same confirmed duty can enter Firestore mode');
 assert.deepEqual(good.calls,['taxiapp-v1'],'always compare the preserved legacy IndexedDB key');
 assert.match(html,/ADMIN_FIRESTORE_CUTOVER_ENABLED=false/,'production storage switch remains OFF');
 console.log('管理者の旧日報をFirestore空一覧・欠落・内容相違で保護し、同じ乗務だけ照合を通す');
})().catch(e=>{console.error(e);process.exitCode=1;});
