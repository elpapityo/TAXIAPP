'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('async function importFirestoreBackup(file){');
const b=html.indexOf('async function importBackup(file){',a);
assert.ok(a>0&&b>a,'正式版JSON取込関数がある');
const code=html.slice(a,b),id='shift-1792600000000-backup',uid='owner-example';
const clone=x=>JSON.parse(JSON.stringify(x));
const shift={id,date:'2026-10-22',startedAt:'09:00',startedIso:'2026-10-22T00:00:00Z',
 endedAt:'17:00',endedIso:'2026-10-22T08:00:00Z',
 records:[{id:'rec-1',kind:'ride',status:'complete',raw:{A:1,K:3000}}],
 settings:{goFee:200}};
async function scenario({ownerUid=uid,exists=false,ambiguous=false,omitUid=false}={}){
 const actions=[],messages=[],storage=new Map([['taxiapp-admin-firestore-optin-v1-'+uid,
  JSON.stringify({mode:'firestore',uid,sourceIds:[],excludedIds:[],at:1})]]);
 const currentLoginScope={admin:true,uid,firebase:{auth:{currentUser:{uid}}}};
 const accountScope={uid,adminFirestore:true,adminFirestorePreview:false};
 const received={id,revision:1,shift:{...clone(shift),__taxiPrintSummary:{meter:3000}}};
 let uploaded=null;
 const c={file:{size:500,text:async()=>JSON.stringify({version:1,
   ...(omitUid?{}:{ownerUid}),shifts:[clone(shift)]})},
  accountScope,accountScopeGeneration:4,currentLoginScope,MAX_RECORDS:60,
  accountDiary:{ready:()=>true,request:async(name,args)=>{
   actions.push(name);
   if(name==='syncList')return {shifts:exists?[{id,revision:4}]:[]};
   if(name==='syncPut'){
    uploaded=JSON.parse(args.payload);
    if(ambiguous)throw Error('通信応答不明');
    return {id,revision:1,confirmed:true};
   }
   if(name==='syncGet')return {id,revision:1,shift:uploaded?.shift||received.shift};
   throw Error('unexpected:'+name);
  }},
  canEditNow:()=>true,toast:(message)=>messages.push(String(message)),
  confirm:()=>true,prompt:(_message,defaultValue)=>defaultValue,
  deepCopy:clone,googleShiftPacket:s=>({kind:'TAXIAPP_SHIFT_V1',
   shift:clone(s),summary:{meter:3000}}),
  canonicalStoredDuty:x=>JSON.stringify(x),
  adminFirestoreManifest:owner=>{
   const value=storage.get('taxiapp-admin-firestore-optin-v1-'+owner);
   return value?JSON.parse(value):null;
  },
  ADMIN_FIRESTORE_PREF_PREFIX:'taxiapp-admin-firestore-optin-v1-',
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  historyDate:'',historyShiftId:'',tab:'settings',historyCloudMessage:'',
  loadHistoryFromCloud:async date=>{actions.push('syncHistoryDate');},
  render:()=>{},JSON,Set,String,Date,RegExp,Error,Number,Array};
 vm.createContext(c);vm.runInContext(code,c);
 await vm.runInContext('importFirestoreBackup(file)',c);
 return {actions,messages,uploaded,c,manifest:JSON.parse(storage.get(
  'taxiapp-admin-firestore-optin-v1-'+uid))};
}
(async()=>{
 const normal=await scenario();
 assert.deepEqual(normal.actions,['syncList','syncPut','syncGet','syncHistoryDate']);
 assert.equal(normal.uploaded.kind,'TAXIAPP_SHIFT_V1');
 assert.equal(normal.uploaded.shift.__taxiPrintSummary.meter,3000);
 assert.equal(normal.c.historyShiftId,id);
 assert.ok(normal.manifest.excludedIds.includes(id),'過去JSON日報は通常1乗務の再開候補から除外');
 const duplicate=await scenario({exists:true});
 assert.deepEqual(duplicate.actions,['syncList'],'既存の同じIDを上書きしない');
 const wrong=await scenario({ownerUid:'other-user'});
 assert.deepEqual(wrong.actions,[],'異なるUIDのJSONはFirebaseへ送らない');
 const unknown=await scenario({ambiguous:true});
 assert.deepEqual(unknown.actions,['syncList','syncPut','syncGet','syncHistoryDate'],
  'CAS成功後に応答が失われても読戻し確認し、二重送信しない');
 await scenario({omitUid:true});
 console.log('管理者JSON日報：本人UID分離・単独CAS取込・履歴取得・再開除外・通信結果不明を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});
