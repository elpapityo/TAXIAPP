'use strict';
// Executes the actual writer snapshot callback, checking account key capture
// across awaited IndexedDB writes. Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('onWriterSnapshot:async shifts=>{');
const end=html.indexOf('onWriterBootstrapReady:()=>',begin);
assert.ok(begin>=0&&end>begin);
const source='({'+html.slice(begin,end)+'})';
const original={version:1,activeId:null,prefs:{},shifts:[]};
const shift={id:'shift-1792640000000-ownerA',records:[],settings:{},endedAt:'10:00'};
const clone=data=>JSON.parse(JSON.stringify(data));
function create(changeDuringWrite){
 const stored=new Map([['taxiapp-account-state-v1-uid-A',clone(original)]]);
 const writes=[];
 const ctx={
  accountScopeLoaded:true,writerLoadEpoch:2,accountScopeGeneration:5,
  accountScope:{uid:'uid-A',kind:'member',adminFirestore:false},
  writerLoadGate:true,deviceMode:'writer',model:clone(original),
  accountScopeGenerationStable:0,db:{},KEY:'taxiapp-v1',
  MAX_RECORDS:60,JSON,Set,Map,Error,
  deepCopy:clone,memberDiary:()=>true,
  scopedStorageKey:()=> 'taxiapp-account-state-v1-'+ctx.accountScope.uid,
  idbGet:async(_db,key)=>clone(stored.get(key)||original),
  idbPut:async(_db,value,key)=>{
   writes.push(key);stored.set(key,clone(value));
   if(changeDuringWrite){
    ctx.accountScopeGeneration++;
    ctx.accountScope={uid:'uid-B',kind:'member',adminFirestore:false};
    ctx.model={...clone(original),shifts:[{...shift,id:'shift-1792640000001-ownerB'}]};
   }
  },
  localStorage:{
   getItem:key=>null,
   setItem:(key,value)=>{if(key.includes('taxiapp-account-state-v1-uid-B'))throw Error('wrong UID');}
  },
  googleShiftPacket:()=>{throw Error('not admin')},
  adminFirestoreManifest:()=>null
 };
 const fn=vm.runInNewContext(source,ctx).onWriterSnapshot;
 return {ctx,writes,stored,fn};
}
(async()=>{
 const normal=create(false);
 assert.equal(await normal.fn([clone(shift)]),true);
 assert.equal(normal.ctx.model.shifts[0].id,shift.id);
 assert.deepEqual(normal.writes,['taxiapp-account-state-v1-uid-A']);
 const race=create(true);
 assert.equal(await race.fn([clone(shift)]),false);
 assert.deepEqual(race.writes,['taxiapp-account-state-v1-uid-A']);
 assert.equal(race.ctx.model.shifts[0].id,'shift-1792640000001-ownerB',
  'former account result must not replace new account UI');
 assert.equal(race.stored.has('taxiapp-account-state-v1-uid-B'),false,
  'former account cloud data must not be written to the new UID');
 console.log('端末クラウド受信：ログイン切替中も旧UID専用キーへの保存に限定');
})().catch(error=>{console.error(error);process.exitCode=1;});
