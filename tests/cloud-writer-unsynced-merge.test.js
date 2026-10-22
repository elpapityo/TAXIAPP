'use strict';
// Synthetic login replay through the real adapter and real per-duty sync.
// Local-only duty must survive the first cloud pull and be uploaded once
// writer access is confirmed. Conflicting content must never overwrite.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const root={
 localStorage:(()=>{
  const map=new Map();
  return {getItem:key=>map.get(key)??null,
   setItem:(key,value)=>map.set(key,String(value))};
 })()
};
vm.runInNewContext(fs.readFileSync('bidirectional-sync.js','utf8'),
 {window:root,globalThis:root,Date,Math,JSON,console});
vm.runInNewContext(fs.readFileSync('cloud-sync-ui.js','utf8'),
 {window:root,globalThis:root,Date,Math,JSON,console,setTimeout,clearTimeout});
const clone=o=>JSON.parse(JSON.stringify(o));
const local={id:'shift-1792640000000-unsynced',date:'2026-10-21',records:[],settings:{},startedAt:'09:00'};
const cloud={id:'shift-1792640000001-cloud',date:'2026-10-21',records:[],settings:{},startedAt:'10:00'};
const model={shifts:[clone(local)]},store=new Map([[cloud.id,{revision:1,shift:clone(cloud)}]]);
const actions=[];let writerGate=true;
const request=async(action,fields={})=>{
 actions.push(action+':'+String(fields.shiftId||''));
 if(action==='syncList')return {shifts:[...store.entries()].map(([id,row])=>({id,revision:row.revision}))};
 if(action==='syncGet'){
  const row=store.get(fields.shiftId);
  if(!row)throw Error('missing');
  return {id:fields.shiftId,revision:row.revision,shift:clone(row.shift)};
 }
 if(action==='syncPut'){
  const packet=JSON.parse(fields.payload),id=packet.shift.id;
  const prev=store.get(id);
  if((prev?.revision||0)!==Number(fields.baseRevision))throw Error('SYNC_CONFLICT');
  store.set(id,{revision:(prev?.revision||0)+1,shift:clone(packet.shift)});
  return {id,revision:(prev?.revision||0)+1};
 }
 throw Error('unexpected '+action);
};
const d=root.TAXIAPP_SYNC_UI({
 getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
 endpoint:()=>'/synthetic-uid-merge',scopeKey:()=> 'synthetic-uid-merge',
 request,configured:()=>true,prefs:()=>({syncMode:'on'}),
 canSync:()=>!writerGate,canView:()=>false,
 writerBootstrapAllowed:()=>writerGate,
 onWriterSnapshot:async incoming=>{
  // This callback stands in for the app's durable read-back of IndexedDB.
  model.shifts=clone(incoming);
  return true;
 },
 onWriterBootstrapReady:()=>{writerGate=false;},
 onWriterSynced:async()=>{},
 root:{querySelector:()=>null},setStatus:()=>{},toast:()=>{},escape:x=>String(x),
 isSettings:()=>true,dateStamp:()=> '20261022'
});
(async()=>{
 assert.equal(await d.bootstrapWriter(),true,'local-only duty must not lock the writer out');
 assert.deepEqual(new Set(model.shifts.map(x=>x.id)),new Set([local.id,cloud.id]),
  'neither cloud-only nor local-only duties may be lost in bootstrap');
 assert.equal(store.has(local.id),false,'the local-only duty is not uploaded before editor unlock');
 await new Promise(resolve=>setTimeout(resolve,900));
 assert.equal(store.get(local.id)?.shift?.startedAt,local.startedAt,
  'queued local-only duty reaches owner cloud after unlock');
 assert.equal(store.get(cloud.id)?.shift?.startedAt,cloud.startedAt);
 assert.equal(actions.filter(x=>x.startsWith('syncPut:')).length,1);
 console.log('初回受信：未同期日報を端末に保持してクラウド原本を追加し、操作権確認後に1件送信');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 // A restored local duty whose old server copy is trashed or absent remains
 // editable on login, but must never be resurrected by an automatic upload.
 const local={id:'shift-1792640001000-held',date:'2026-10-21',
  records:[],settings:{},startedAt:'06:00'};
 const scope='isolated-held-local-original';
 const store=new Map([[local.id,{revision:1,shift:JSON.parse(JSON.stringify(local))}]]);
 const saved=new Map();
 const root={localStorage:{
  getItem:k=>saved.get(k)??null,
  setItem:(k,v)=>saved.set(k,String(v))
 }};
 const vm2=require('node:vm');
 const fs2=require('node:fs');
 vm2.runInNewContext(fs2.readFileSync('bidirectional-sync.js','utf8'),
  {window:root,globalThis:root,JSON,Date,Math,console});
 const model={shifts:[JSON.parse(JSON.stringify(local))]};
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:()=>model,
  getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:JSON.parse(JSON.stringify(shift))}),
  getEndpoint:()=>scope,
  getScopeKey:()=> 'owner',
  localStorage:root.localStorage,
  request:async(action,params={})=>{
   if(action==='syncList')return {shifts:[...store].map(([id,x])=>({id,revision:x.revision}))};
   if(action==='syncGet'){
    const x=store.get(params.shiftId);
    return {id:params.shiftId,revision:x.revision,shift:x.shift};
   }
   if(action==='syncPut')throw Error('unexpected auto upload');
   throw Error('unexpected '+action);
  },
  replaceRemoteShift:async()=>{}
 });
 assert.equal(await engine.run(),true,'establish original revision baseline');
 store.clear();
 const plan=engine.planSafeWriterSnapshot([]);
 assert.deepEqual([...plan.heldIds],[local.id]);
 assert.equal(plan.pendingIds.length,0);
 assert.equal(plan.shifts.length,1);
 console.log('復元済みの端末日報はサーバー不在でも保持し、自動再アップロードを防ぐ');
})().catch(error=>{console.error(error);process.exitCode=1;});


// Firestore on-demand login: when this device already has local originals,
// list only those exact IDs, including any number of protected exceptions.
// Fetching every historical shift would violate the decided on-demand policy.
(async()=>{
 const ids=Array.from({length:61},(_,i)=>'shift-'+(1792641000000+i));
 const model={shifts:ids.map(id=>({id,date:'2026-10-22',settings:{},records:[]}))};
 const listCalls=[];
 const scoped=root.TAXIAPP_SYNC_UI({
  getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift}),
  endpoint:()=>'/firestore-scoped-login',scopeKey:()=> 'uid-private',
  remoteOnDemand:()=>true,
  request:async(action,params={})=>{
   assert.equal(action,'syncList','ログイン時に保存済み原本を勝手に送信しない');
   assert.ok(Array.isArray(params.shiftIds),'端末に原本があるときは全件一覧を要求しない');
   listCalls.push([...params.shiftIds]);
   return {shifts:[]};
  },
  configured:()=>true,prefs:()=>({syncMode:'on'}),
  canSync:()=>false,canView:()=>false,
  writerBootstrapAllowed:()=>true,
  onWriterSnapshot:async shifts=>{
   assert.equal(shifts.length,61,'未照合の端末原本を整理・削除しない');
   return true;
  },
  onWriterBootstrapReady:()=>{},
  setStatus:()=>{},toast:()=>{},dateStamp:()=> '20261022'
 });
 assert.equal(await scoped.bootstrapWriter(),true);
 assert.deepEqual(listCalls.map(chunk=>chunk.length),[60,1],
  '1乗務制限の例外が60件を超えても分割して照合する');
 assert.deepEqual(listCalls.flat(),ids,'別UIDや端末にない過去乗務を検索しない');
 console.log('Firestore再ログイン：端末内原本61件だけを分割照合・全履歴取得なし');
})().catch(error=>{console.error(error);process.exitCode=1;});


// A fresh phone restores one known server duty. A local edit afterwards must
// use the read-back revision as CAS rather than becoming a false conflict.
(async()=>{
 const shift={id:'shift-1792702000000',date:'2026-10-22',
  startedIso:'2026-10-22T10:00:00Z',endedAt:'',records:[],settings:{},driver:'元'};
 const model={shifts:[]},server={revision:4,shift:clone(shift)};
 let gate=true;
 const actions=[];
 const d=root.TAXIAPP_SYNC_UI({
  getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
  endpoint:()=>'/fresh-phone-uid',scopeKey:()=> 'fresh-phone-uid',
  remoteOnDemand:()=>true,
  request:async(action,params={})=>{
   actions.push({action,params});
   if(action==='syncList'){
    if(params.resumeOnly)return {shifts:[{id:shift.id,revision:server.revision,ended:false}]};
    assert.deepEqual([...params.shiftIds],[shift.id]);
    return {shifts:[{id:shift.id,revision:server.revision,ended:false}]};
   }
   if(action==='syncGet')return {id:shift.id,revision:server.revision,shift:clone(server.shift)};
   if(action==='syncPut'){
    assert.equal(params.baseRevision,4,'復元した原本の読戻し更新番号でCASを実施');
    server.shift=clone(JSON.parse(params.payload).shift);
    server.revision=5;
    return {id:shift.id,revision:5,confirmed:true};
   }
   throw Error('unexpected '+action);
  },
  configured:()=>true,prefs:()=>({syncMode:'on'}),
  canSync:()=>!gate,canView:()=>false,
  writerBootstrapAllowed:()=>gate,
  onWriterSnapshot:async shifts=>{model.shifts=clone(shifts);return true;},
  onWriterBootstrapReady:()=>{gate=false;},
  onWriterSynced:async()=>{},
  setStatus:()=>{},toast:()=>{},dateStamp:()=> '20261022',
  isSettings:()=>true,root:{querySelector:()=>null}
 });
 assert.equal(await d.bootstrapWriter(),true,'入庫前の原本1件を端末へ復旧する');
 assert.equal(model.shifts.length,1);
 assert.equal(d.verifiedRevision(shift.id),4,'Firestore読戻し更新番号を端末同期基準へ保持');
 assert.equal(actions.filter(x=>x.action==='syncPut').length,0,'復旧だけではクラウドを書き換えない');
 model.shifts[0].driver='修正後';
 assert.equal(await d.run(false,[shift.id]),true,'新端末で復元した乗務を通常の1乗務CASで更新');
 assert.equal(server.shift.driver,'修正後');
 assert.equal(server.revision,5);
 assert.equal(d.verifiedRevision(shift.id),5);
 assert.deepEqual(actions.filter(x=>x.action==='syncList').map(x=>Boolean(x.params.resumeOnly)),
  [true,false],'ログインでは候補限定、変更時には対象ID限定で照合');
 console.log('Firestore新端末：1乗務復元→保存済み版でCAS更新→読戻し基準を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});


// More than 60 protected offline duties must be retried in bounded groups.
// Never silently drop IDs from the event queue after the first successful run.
(async()=>{
 const duties=Array.from({length:61},(_,i)=>({
  id:'shift-'+(1792703000000+i),date:'2026-10-22',startedIso:'2026-10-22T09:00:00Z',
  endedAt:'',settings:{},records:[],driver:'旧'
 }));
 const model={shifts:clone(duties)},store=new Map(),batches=[];
 const adapter=root.TAXIAPP_SYNC_UI({
  getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
  endpoint:()=>'/firestore-many-offline-duties',scopeKey:()=> 'uid-many',
  remoteOnDemand:()=>true,
  request:async(action,params={})=>{
   if(action==='syncList'){
    assert.ok(Array.isArray(params.shiftIds),'再送時に過去日報全件を取得しない');
    assert.ok(params.shiftIds.length<=60,'Firestore一覧の取得上限を守る');
    batches.push(params.shiftIds.length);
    return {shifts:params.shiftIds.filter(id=>store.has(id)).map(id=>({
     id,revision:store.get(id).revision
    }))};
   }
   if(action==='syncPut'){
    const packet=JSON.parse(params.payload),id=packet.shift.id;
    assert.equal(params.baseRevision,0);
    store.set(id,{revision:1,shift:clone(packet.shift)});
    return {id,revision:1,confirmed:true};
   }
   throw Error('unexpected '+action);
  },
  configured:()=>true,prefs:()=>({syncMode:'on'}),canSync:()=>true,
  canView:()=>false,
  setStatus:()=>{},toast:()=>{},dateStamp:()=> '20261022',
  isSettings:()=>true,root:{querySelector:()=>null}
 });
 adapter.schedule();
 model.shifts.forEach(shift=>shift.driver='変更済み');
 adapter.schedule();
 assert.equal(await adapter.run(false),true);
 await new Promise(resolve=>setTimeout(resolve,700));
 assert.deepEqual(batches,[60,1],'61件の保護日報を60件＋1件で照合');
 assert.equal(store.size,61,'保留した最後の1乗務も再送される');
 assert.equal(adapter.verifiedRevision(duties[60].id),1);
 console.log('未同期61件：端末原本を減らさず60件と1件へ分割再送');
})().catch(error=>{console.error(error);process.exitCode=1;});
