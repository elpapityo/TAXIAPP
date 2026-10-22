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
