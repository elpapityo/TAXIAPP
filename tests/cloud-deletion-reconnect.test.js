'use strict';
// Device-only duty cleanup must not trash a server original after reconnect.
// An explicit cloudAction('trash') remains a separate owner operation.
const assert=require('node:assert/strict');
require('../bidirectional-sync.js');
require('../cloud-sync-ui.js');
const id='shift-1792600000000-reconnect';
const original={id,date:'2026-10-21',records:[],settings:{},startedAt:'07:00'};
const copy=value=>JSON.parse(JSON.stringify(value));
const storage=new Map();
globalThis.localStorage={
 getItem:key=>storage.get(key)??null,
 setItem:(key,value)=>storage.set(key,String(value))
};
let gate=false;
let revision=1,deleted=false;
const actions=[];
const model={shifts:[copy(original)]};
async function request(action,fields={}){
 actions.push(action);
 if(action==='syncList')return {shifts:[{id,revision,deleted}]};
 if(action==='syncGet'){
  if(deleted)throw Error('gone');
  return {id,revision,shift:copy(original)};
 }
 if(action==='syncTrash'){
  assert.equal(fields.shiftId,id);
  assert.equal(Number(fields.baseRevision),revision);
  revision++;deleted=true;
  return {id,revision,deleted:true};
 }
 throw Error('unexpected action: '+action);
}
function adapter(){
 return globalThis.TAXIAPP_SYNC_UI({
  getModel:()=>model,
  getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:copy(shift)}),
  replace:async(_id,shift)=>{model.shifts.push(copy(shift));},
  request,endpoint:()=>'/synthetic-owner',
  scopeKey:()=> 'uid-synthetic',
  prefs:()=>({syncMode:'on'}),configured:()=>true,
  canSync:()=>!gate,canView:()=>false,
  writerBootstrapAllowed:()=>gate,
  onWriterSnapshot:async shifts=>{
   assert.equal(shifts.length,0,'a deleted duty stays hidden on login');
   return true;
  },
  onWriterBootstrapReady:()=>{gate=false;},
  root:{querySelector:()=>null},
  isSettings:()=>true,
  setStatus:()=>{},toast:()=>{},escape:x=>String(x),
  download:()=>{},dateStamp:()=> '20261021'
 });
}
(async()=>{
 const before=adapter();
 assert.equal(before.markLocalRemoval(id,original),true);
 model.shifts=[];
 // The process restarts: UI queue is empty, marker is durable in localStorage.
 gate=true;
 const restarted=adapter();
 assert.equal(await restarted.bootstrapWriter(),true);
 await new Promise(resolve=>setTimeout(resolve,750));
 assert.equal(deleted,false,'local deletion must never trash a cloud duty');
 assert.equal(revision,1,'local cleanup must not update the remote revision');
 assert.equal(actions.filter(x=>x==='syncTrash').length,0);
 assert.equal(actions.filter(x=>x==='syncPut').length,0);
 assert.deepEqual(model.shifts,[],'must not reimport the deleted duty');
 console.log('再ログイン後も端末の削除マーカーはサーバー原本を変更しない');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 // Cleanup must be explicitly available while background synchronization is OFF.
 const state={shifts:[]};
 let calls=0,manualToasts=[],downloaded=0,backupObject=null,revision=1,deleted=false;
 const cloudId='shift-1792600000020-older';
 const cloudShift={id:cloudId,date:'2026-10-20',records:[],settings:{}};
 const localStore=new Map();
 const localStorage={getItem:k=>localStore.get(k)??null,setItem:(k,v)=>localStore.set(k,String(v))};
 const root={localStorage,confirm:()=>true,TAXIAPP_BIDIRECTIONAL_SYNC:globalThis.TAXIAPP_BIDIRECTIONAL_SYNC};
 const moduleText=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','cloud-sync-ui.js'),'utf8');
 const vm=require('node:vm');
 vm.runInNewContext(moduleText,{window:root,globalThis:root,console,Date,setTimeout,clearTimeout});
 const holder={innerHTML:'',querySelector:()=>({active:true})};
 const sync=root.TAXIAPP_SYNC_UI({
  getModel:()=>state,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift}),
  replace:async(_id,shift)=>{state.shifts.push(copy(shift));},
  request:async(action,fields={})=>{
   calls++;
   if(action==='syncList')return {shifts:[{id:cloudId,revision,deleted}]};
   if(action==='syncGet'){
    if(deleted)throw Error('already trashed');
    return {id:cloudId,revision,shift:copy(cloudShift)};
   }
   if(action==='syncTrash'||action==='syncRestore'){
    assert.equal(fields.shiftId,cloudId);
    assert.equal(Number(fields.baseRevision),revision);
    deleted=action==='syncTrash';revision++;
    return {id:cloudId,revision,deleted};
   }
   throw Error('unexpected action '+action);
  },
  endpoint:()=>'/synthetic-disabled-sync',scopeKey:()=> 'uid-1',
  configured:()=>true,prefs:()=>({syncMode:'off'}),canSync:()=>true,canView:()=>false,
  root:{querySelector:key=>key==='[data-sync-cloud-trash]'?holder:null},
  setStatus:()=>{},toast:text=>manualToasts.push(text),
  escape:x=>String(x),download:text=>{downloaded++;backupObject=JSON.parse(text);},dateStamp:()=> '20261021'
 });
 assert.equal(await sync.cloudAction('load'),true);
 assert.equal(calls,2,'manual cleanup reads the listing and original without auto sync');
 assert.match(holder.innerHTML,/クラウドのゴミ箱へ移動/,'focused cloud button cannot block redraw');
 assert.ok(manualToasts.some(x=>x.includes('クラウド保存')));
 assert.equal(await sync.cloudAction('trash',cloudId),true,'one selected remote-only duty enters trash');
 assert.equal(deleted,true);
 assert.equal(downloaded,1,'before remote trash, a user-controlled backup is exported');
 assert.equal(backupObject.version,1,'remote backup matches native JSON restore format');
 assert.equal(backupObject.ownerUid,'uid-1','remote backup is scoped to the owner');
 assert.equal(backupObject.shifts[0].id,cloudId);
 assert.equal(backupObject.cloudBackup.revision,1);
 assert.deepEqual(state.shifts,[],'manual remote trash must not modify local data');
 assert.match(holder.innerHTML,/クラウドから復元/);
 assert.equal(await sync.cloudAction('restore',cloudId),true);
 assert.equal(deleted,false);
 assert.equal(state.shifts.length,1,'the explicitly restored duty is received');
 assert.equal(state.shifts[0].id,cloudId);
 console.log('手動クラウド日報整理：自動同期OFFでも一覧取得と表示が動作');
})().catch(e=>{console.error(e);process.exitCode=1;});


(async()=>{
 // A confirmed returned duty can be moved to the owner's trash, then
 // released locally; unsynced edits must stop before syncTrash.
 const id='shift-1792700000100-manualtrash';
 const localShift={id,date:'2026-10-22',startedAt:'08:00',endedAt:'18:00',
  records:[],settings:{},startedIso:'2026-10-21T23:00:00.000Z'};
 const local={shifts:[copy(localShift)]};
 let revision=0,trashed=false,original=null,trashCalls=0,cloudReads=0;
 const events=[];
 const request=async(action,fields={})=>{
  events.push(action);
  if(action==='syncList')return {shifts:revision?[{id,revision,deleted:trashed}]:[]};
  if(action==='syncPut'){
   assert.equal(fields.baseRevision,revision);
   original=copy(JSON.parse(fields.payload).shift);
   revision++;
   return {id,revision,confirmed:true};
  }
  if(action==='syncGet'){
   if(trashed)throw Error('already trashed');
   return {id,revision,shift:copy(original)};
  }
  if(action==='syncTrash'){
   assert.equal(fields.shiftId,id);
   assert.equal(fields.baseRevision,revision);
   trashCalls++;trashed=true;revision++;
   return {id,revision,deleted:true};
  }
  throw Error('unexpected '+action);
 };
 const sync=globalThis.TAXIAPP_SYNC_UI({
  getModel:()=>local,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:copy(shift)}),
  replace:async()=>{throw Error('must not overwrite during trash')},
  request,endpoint:()=> 'firestore://synthetic-trash-owner',
  scopeKey:()=> 'synthetic-trash-owner',
  remoteOnDemand:()=>true,prefs:()=>({syncMode:'on'}),
  configured:()=>true,canSync:()=>true,canView:()=>false,
  root:{querySelector:()=>null},setStatus:()=>{},toast:()=>{},
  escape:x=>String(x),download:()=>{},dateStamp:()=> '20261022'
 });
 assert.equal(await sync.run(true,[id]),true);
 assert.equal(sync.verifiedRevision(id),1);
 assert.equal(await sync.cloudAction('trashLocal',id),true);
 assert.equal(trashed,true);
 assert.equal(trashCalls,1);
 assert.equal(revision,2,'only one CAS trash revision');
 assert.equal(local.shifts.length,1,'server trash does not silently erase local recovery copy');
 assert.equal(sync.markLocalRemoval(id,local.shifts[0]),true);
 assert.equal(sync.verifiedRevision(id),null,'manual delete marker prevents automatic reimport');
 const id2='shift-1792700000200-unknowntrash';
 const local2={shifts:[{...localShift,id:id2}]};
 let requests=0;
 const blocked=globalThis.TAXIAPP_SYNC_UI({
  getModel:()=>local2,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:copy(shift)}),
  replace:async()=>{},request:async()=>{requests++;throw Error('network')},
  endpoint:()=> 'firestore://synthetic-trash-unconfirmed',
  scopeKey:()=> 'synthetic-trash-unconfirmed',remoteOnDemand:()=>true,
  prefs:()=>({syncMode:'on'}),configured:()=>true,
  canSync:()=>true,canView:()=>false,root:{querySelector:()=>null},
  setStatus:()=>{},toast:()=>{},escape:x=>String(x),download:()=>{},dateStamp:()=> '20261022'
 });
 assert.equal(await blocked.cloudAction('trashLocal',id2),false);
 assert.equal(requests,0,'unknown revision never contacts server to trash');
 assert.equal(local2.shifts.length,1,'unconfirmed original remains on device');
 console.log('Firestore明示削除：本人CAS・ゴミ箱読戻し・端末控え保護・未同期削除禁止');
})().catch(error=>{console.error(error);process.exitCode=1;});


(async()=>{
 // Actual legacy CAS update handler, with synthetic Google responses.
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const from=index.indexOf('async function legacyCasSaveHistoricalShift(');
 const to=index.indexOf('async function commitHistoryLocationEdit(',from);
 assert.ok(from>0&&to>from,'旧GoogleのCAS更新経路が実装されている');
 const id='shift-1792700000300-googleedit';
 const original={id,date:'2026-10-20',startedAt:'08:00',endedAt:'18:00',records:[],settings:{}};
 const next={...copy(original),startedAt:'09:00'};
 const state={shifts:[copy(original)],activeId:null};
 const cloud={revision:1,shift:copy(original)};
 let calls=0,adopt=0,localWrites=0;
 const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
 const hash=shift=>JSON.stringify(shift);
 const context={
  model:state,accountScope:{uid:'owner-G'},accountScopeGeneration:1,
  currentLoginScope:{admin:true},canEditNow:()=>true,legacyDiary:()=>true,googleIsConfigured:()=>true,
  historyLegacyHash:hash,googleShiftPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:copy(shift),summary:{}}),
  googlePostRequest:async(action,payload)=>{
   calls++;
   if(action==='syncGet')return {data:{id,revision:cloud.revision,shift:copy(cloud.shift)}};
   if(action==='syncPut'){
    assert.equal(payload.baseRevision,cloud.revision);
    const updated=JSON.parse(payload.payload).shift;
    cloud.revision++;cloud.shift=copy(updated);
    return {data:{id,revision:cloud.revision}};
   }
   throw Error('unexpected legacy request');
  },
  canonicalStoredDuty:canon,deepCopy:copy,save:async()=>{localWrites++;return true;},
  syncUI:{adoptHistoryDuty:()=>{adopt++;return true;}},
  cloudLastDigest:new Map(),setGoogleStatus:()=>{},JSON,Number,String,Error,Object
 };
 vm.createContext(context);
 vm.runInContext(index.slice(from,to),context);
 assert.equal((await context.legacyCasSaveHistoricalShift(copy(original),next,hash(original))).revision,2);
 assert.equal(state.shifts[0].startedAt,'09:00');
 assert.equal(cloud.shift.startedAt,'09:00');
 assert.equal(localWrites,1);
 assert.equal(adopt,1);
 const conflicting={...copy(next),startedAt:'10:00'};
 cloud.revision=3;cloud.shift.startedAt='11:00';
 await assert.rejects(context.legacyCasSaveHistoricalShift(copy(next),conflicting,hash(next)),/異なります/);
 assert.equal(cloud.shift.startedAt,'11:00','other device original must never be overwritten');
 assert.equal(state.shifts[0].startedAt,'09:00','local recovery original must be preserved');
 console.log('旧Google日報：既存原本のCAS保存・読戻し、別端末改版の無断上書き防止');
})().catch(error=>{console.error(error);process.exitCode=1;});
