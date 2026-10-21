'use strict';
/* Real client delete/import functions, synthetic duty and scoped localStorage. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('async function deleteWholeShift(shiftId){');
const end=html.indexOf("appEl.addEventListener('click',event=>{",begin);
assert.ok(begin>0&&end>begin);
const source=html.slice(begin,end);
const original={id:'shift-1792680000000-recovery',date:'2026-10-22',
 startedAt:'08:00',endedAt:'10:00',records:[],settings:{},startedIso:'2026-10-21T23:00:00.000Z'};
const copy=x=>JSON.parse(JSON.stringify(x));
const store=new Map(),marked=new Set(),downloads=[],notices=[];
let uid='user-A',generation=3,editor=true;
const ctx={
 JSON,Array,Set,Map,Number,String,console,Date,Error,
 model:{version:1,activeId:null,shifts:[copy(original)],prefs:{}},
 accountScope:{uid},accountScopeGeneration:generation,db:null,
 MAX_RECORDS:60,cloudRunning:false,persistTimer:0,cloudTimer:null,
 historyShiftId:'',printShiftId:'',historyDate:'',tab:'settings',
 window:{TAXIAPP_DEVICE_DATA:{deleteShift:(model,id)=>({
  model:{...model,shifts:model.shifts.filter(shift=>shift.id!==id),activeId:null}
 })}},
 totals:()=>({meter:0}),shortTime:t=>String(t||''),money:n=>String(n),
 deepCopy:copy,confirm:()=>true,toast:(s,error)=>notices.push({s,error}),
 render:()=>{},clearTimeout:()=>{},
 dateStamp:()=> '20261022',
 getShift:()=>null,nativeDiaryGpsEnabled:()=>false,
 googleIsConfigured:()=>true,memberDiary:()=>true,
 canEditNow:()=>editor,
 scopedStorageKey:()=> 'owner:'+ctx.accountScope.uid,
 localStorage:{
  getItem:key=>store.get(key)??null,
  setItem:(key,v)=>store.set(key,String(v))
 },
 download:(text,filename,mime)=>downloads.push({text,filename,mime}),
 syncUI:{
  markLocalRemoval:(id)=>{marked.add(id);return true;},
  undoLocalRemoval:(id)=>marked.delete(id),
  enabled:()=>false,schedule:()=>{throw Error('sync is disabled');}
 },
 save:async()=>store.set('owner:'+ctx.accountScope.uid,JSON.stringify(ctx.model)),
 upgradeWaitingHistory:()=>{}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
(async()=>{
 assert.equal(ctx.model.shifts.length,1);
 await ctx.deleteWholeShift(original.id);
 assert.equal(ctx.model.shifts.length,0);
 assert.ok(marked.has(original.id));
 assert.equal(downloads.length,1);
 assert.match(downloads[0].filename,/削除前/);
 assert.equal(JSON.parse(downloads[0].text).shifts[0].id,original.id);
 assert.equal(JSON.parse(downloads[0].text).ownerUid,'user-A');
 const foreign=JSON.stringify({version:1,ownerUid:'user-B',shifts:[{...original,id:'shift-1792680000100-other'}]});
 await ctx.importBackup({size:foreign.length,text:async()=>foreign});
 assert.equal(ctx.model.shifts.length,0,'another UID backup must never import');
 assert.ok(notices.some(x=>String(x.s).includes('利用者UIDが現在のアカウントと一致しません')));
 const invalid=JSON.stringify({version:1,ownerUid:'user-A',shifts:[{...original,id:'evil'}]});
 await ctx.importBackup({size:invalid.length,text:async()=>invalid});
 assert.equal(ctx.model.shifts.length,0,'invalid duty ID must never import');
 const backup={size:downloads[0].text.length,text:async()=>downloads[0].text};
 await ctx.importBackup(backup);
 assert.equal(ctx.model.shifts.length,1);
 assert.equal(ctx.model.shifts[0].id,original.id);
 assert.equal(marked.has(original.id),false,
  'restoring a duty explicitly lifts its old local deletion marker');
 assert.equal(JSON.parse(store.get('owner:user-A')).shifts.length,1);
 await ctx.deleteWholeShift(original.id);
 const old=ctx.model.shifts.length;
 let complete;
 const interrupted={size:100,text:()=>new Promise(resolve=>{complete=resolve;})};
 const task=ctx.importBackup(interrupted);
 ctx.accountScope={uid:'user-B'};ctx.accountScopeGeneration++;
 ctx.model={version:1,activeId:null,shifts:[],prefs:{}};
 complete(downloads[0].text);
 await task;
 assert.equal(ctx.model.shifts.length,0);
 assert.equal(ctx.localStorage.getItem('owner:user-B'),null);
 assert.equal(old,0);
 console.log('削除前個別バックアップ→端末復元→削除マーカー解除、UIDの異なるバックアップを拒否');
})().catch(e=>{console.error(e);process.exitCode=1;});
