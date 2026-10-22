'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../bidirectional-sync.js');
const factory=globalThis.TAXIAPP_BIDIRECTIONAL_SYNC;
const clone=x=>JSON.parse(JSON.stringify(x));
const store=new Map();
function server(){
 const cloud=new Map();
 const events=[];
 async function request(action,data){
  events.push(action);
  if(action==='syncList')return {shifts:[...cloud].map(([id,r])=>({id,revision:r.revision,deleted:r.deleted===true}))};
  if(action==='syncGet'){
   const entry=cloud.get(data.shiftId);
   if(!entry||entry.deleted)throw Error('not found');
   return {id:data.shiftId,revision:entry.revision,shift:clone(entry.shift)};
  }
  if(action==='syncPut'){
   const shift=JSON.parse(data.payload).shift;
   const prior=cloud.get(shift.id),version=prior?.revision||0;
   if(Number(data.baseRevision)!==version)throw Error('SYNC_CONFLICT:'+version);
   if(prior?.deleted)throw Error('deleted');
   const entry={revision:version+1,shift:clone(shift)};
   cloud.set(shift.id,entry);
   return {id:shift.id,revision:entry.revision,confirmed:true};
  }
  if(action==='syncTrash'||action==='syncRestore'){
   const row=cloud.get(data.shiftId);
   if(!row)throw Error('missing original');
   if(row.revision!==Number(data.baseRevision))throw Error('SYNC_CONFLICT:'+row.revision);
   const deleted=action==='syncTrash';
   if(Boolean(row.deleted)!==deleted){row.revision++;row.deleted=deleted;}
   return {id:data.shiftId,revision:row.revision,deleted};
  }
  throw Error('unexpected '+action);
 }
 return {cloud,request,events};
}
function client(name,svc,model,failReceive=false,remoteOnDemand=false){
 const localStorage={
  getItem:key=>store.get(name+key)||null,
  setItem:(key,value)=>store.set(name+key,value)
 };
 const getPacket=s=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(s)});
 const app=factory.create({
  getModel:()=>model,
  getPacket,
  request:svc.request,
  getEndpoint:()=>'/same-endpoint',
  getRemoteOnDemand:()=>remoteOnDemand,
  localStorage,
  replaceRemoteShift:async(id,s)=>{
   if(failReceive)throw Error('local save refused');
   const index=model.shifts.findIndex(x=>x.id===id);
   if(index>=0)model.shifts[index]=clone(s);
   else model.shifts.push(clone(s));
  },
  saveLocal:async()=>{}
 });
 return {app,model};
}
(async()=>{
 const svc=server();
 const id='shift-111-xyz';
 const A=client('a',svc,{shifts:[{id,records:[],settings:{},startingOdo:'0'}]});
 const B=client('b',svc,{shifts:[]});
 assert.equal(await A.app.run(),true);
 assert.equal(svc.cloud.get(id).revision,1);
 assert.equal(await B.app.run(),true);
 assert.equal(B.model.shifts.length,1);
 assert.equal(B.model.shifts[0].startingOdo,'0');
 const onDemand=client('on-demand-reader',svc,{shifts:[]},false,true);
 assert.equal(await onDemand.app.run(),true);
 assert.equal(onDemand.model.shifts.length,0,
  'オンデマンド方式では過去の日報を端末のモデルに自動取込しない');
 A.model.shifts[0].startingOdo='2';
 assert.equal(await A.app.run(),true);
 assert.equal(svc.cloud.get(id).revision,2);
 assert.equal(await B.app.run(),true);
 assert.equal(B.model.shifts[0].startingOdo,'2');
 // Two clients modify the same duty; no last-write-wins data loss.
 A.model.shifts[0].startingOdo='5';
 B.model.shifts[0].startingOdo='3';
 assert.equal(await A.app.run(),true);
 assert.equal(svc.cloud.get(id).shift.startingOdo,'5');
 assert.equal(await B.app.run(),false);
 assert.equal(svc.cloud.get(id).shift.startingOdo,'5');
 assert.equal(B.model.shifts[0].startingOdo,'3');
 assert.equal(B.app.status().conflicts.length,1);
 assert.equal(B.app.status().conflicts[0].id,id);
 let encryptedBackupAccepted=false;
 assert.equal(await B.app.resolve(id,true,async data=>{
  assert.equal(data.local.startingOdo,'3');
  assert.equal(data.remote.startingOdo,'5');
  encryptedBackupAccepted=true;
  return true;
 }),true);
 assert.ok(encryptedBackupAccepted);
 assert.equal(svc.cloud.get(id).shift.startingOdo,'3');
 assert.equal(svc.cloud.get(id).revision,4);
 assert.equal(await A.app.run(),true);
 assert.equal(A.model.shifts[0].startingOdo,'3');
 // A device with unknown ancestry must pause, never overwrite an old record.
 const C=client('c',svc,{shifts:[{id,records:[],settings:{},startingOdo:'7'}]});
 assert.equal(await C.app.run(),false);
 assert.equal(C.app.status().conflicts.length,1);
 assert.equal(svc.cloud.get(id).shift.startingOdo,'3');
 const D=client('d',svc,{shifts:[{id,records:[],settings:{},startingOdo:'3'}]});
 assert.equal(await D.app.run(),true);
 assert.equal(D.app.status().conflicts.length,0);
 // A failed download/import must NOT turn an old local duty into
 // a valid base for overwriting the newer cloud copy.
 const svc2=server(),fid='shift-222-abc';
 const F=client('fail-receive',svc2,{shifts:[{id:fid,records:[],settings:{},startingOdo:'1'}]},true);
 assert.equal(await F.app.run(),true); // initial upload does not call the receiver
 svc2.cloud.set(fid,{revision:2,shift:{id:fid,records:[],settings:{},startingOdo:'20'}});
 assert.equal(await F.app.run(),false);
 assert.equal(F.model.shifts[0].startingOdo,'1');
 assert.equal(await F.app.run(),false);
 assert.equal(F.app.status().conflicts.length,1);
 assert.equal(svc2.cloud.get(fid).shift.startingOdo,'20');
 // Offline server read failure does not delete local contents.
 const E=client('e',{request:()=>Promise.reject(Error('offline'))},{shifts:[{id,records:[],settings:{},startingOdo:'8'}]});
 assert.equal(await E.app.run(),false);
 assert.equal(E.model.shifts[0].startingOdo,'8');
 // Local edits while the final cloud revision check is in flight must survive.
 const raceServer=server();
 const raceModel={shifts:[{id,records:[],settings:{},startingOdo:'10'}]};
 raceServer.cloud.set(id,{revision:1,shift:{id,records:[],settings:{},startingOdo:'20'}});
 let editDuringList=false;
 const race=client('resolve-race',{request:async(action,data)=>{
  const result=await raceServer.request(action,data);
  if(editDuringList&&action==='syncList')raceModel.shifts[0].startingOdo='30';
  return result;
 }},raceModel);
 assert.equal(await race.app.run(),false);
 editDuringList=true;
 assert.equal(await race.app.resolve(id,false,async()=>true),false);
 assert.equal(raceModel.shifts[0].startingOdo,'30','new input cannot be replaced by the backed-up cloud copy');
 assert.equal(raceServer.cloud.get(id).shift.startingOdo,'20');
 assert.equal(race.app.status().conflicts.length,1);
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 for(const literal of ['bidirectional-sync.js?v=20261023-bootstrap-conflict','cloud-sync-ui.js?v=20261023-auto-key',
  'syncUI.panel()','syncUI.run(true)','syncMode','googlePostRequest(',
  'if(sheetTargetPrefs().syncMode===\'on\'){syncUI.schedule();return;}']){
  assert.ok(html.includes(literal),'missing '+literal);
 }
 const pageVersion=html.match(/<title>TAXIAPP (v\d+\.\d+\.\d+(?:-dev\.\d+)?) — 乗務日報<\/title>/)?.[1];
 assert.equal(pageVersion,'v0.3.135','10月16日日報のFirestore移行操作を含む正式版を識別する');
 assert.ok(html.includes('乗務日報 · ${displayVersion}'),
  '画面上部にバージョンを表示する');
 assert.ok(html.includes('document.title.match(/v\\d+\\.\\d+\\.\\d+(?:-dev\\.\\d+)?/)'),
  '開発版のバージョン文字列をtitleから取得する');
 assert.doesNotMatch(html,/setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'/,
  'periodic bidirectional cloud polling must stay disabled');
 assert.match(html,/data-action="viewerRefresh"/,'viewer refresh control must exist');
 assert.match(html,/if\(action==='viewerRefresh'\)/,'viewer refresh must have an action');
 assert.match(html,/syncUI\.viewNow\(true\)/,'manual reload must receive from cloud');
 assert.match(html,/if\(!canEditNow\(\)\)return;[\s\S]*syncUI\.schedule\(\)/,
  'offline to online retry is for writer only');
 console.log('Bidirectional sync tests passed: send, receive, CAS, conflict hold and resolution, first-use guard, offline safety, web wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});

const LOCAL_REMOVAL_TEST_CASE=true;
(async()=>{
 const svc=server(),id='shift-2212212212212-removed';
 svc.cloud.set(id,{revision:1,shift:{id,records:[],settings:{}}});
 const C=client('localHide',svc,{shifts:[]});
 assert.equal(await C.app.run(),true);
 assert.equal(C.model.shifts.length,1);
 assert.equal(C.app.markLocalRemoval(id),true);
 C.model.shifts=[];
 assert.equal(await C.app.run(),true);
 assert.equal(C.model.shifts.length,0,'removed duty must never reappear after sync');
 assert.equal(C.app.excludeLocalRemovals([svc.cloud.get(id).shift]).length,0);
 assert.equal(svc.cloud.size,1,'the original remains on the server');
 C.app.undoLocalRemoval(id);
 assert.equal(await C.app.run(),true);
 assert.equal(C.model.shifts.length,1,'explicit undo restores the hidden duty');
 console.log('削除済み日報の再取得防止を合成検証');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const svc=server(),id='shift-998877665544-test';
 const original={id,date:'2026-10-21',records:[],settings:{},startingOdo:'0'};
 const owner=client('realTrash',svc,{shifts:[clone(original)]});
 assert.equal(await owner.app.run(),true);
 assert.equal(svc.cloud.get(id).revision,1);
 assert.equal(owner.app.markLocalRemoval(id,original),true);
 assert.deepEqual(owner.app.localRemovalIds(),[id],'local hide marker survives account restart');
 owner.model.shifts=[];
 assert.equal(await owner.app.run(),true,'local removal never calls remote trash');
 assert.notEqual(svc.cloud.get(id).deleted,true,'the server original is not trashed');
 assert.equal(svc.cloud.get(id).revision,1,'local cleanup cannot alter remote revision');
 const another=client('otherReader',svc,{shifts:[]});
 assert.equal(await another.app.run(),true);
 assert.equal(another.model.shifts.length,1,'another device sees the intact cloud original');
 assert.equal((await another.app.readOnly()).length,1,'read-only viewer can still read it');
 // Explicit server trash is a separate owner-confirmed action.
 const hidden=await svc.request('syncTrash',{shiftId:id,baseRevision:1});
 assert.equal(hidden.deleted,true);
 assert.equal(hidden.revision,2);
 const after=await svc.request('syncRestore',{shiftId:id,baseRevision:2});
 assert.equal(after.deleted,false);
 owner.app.undoLocalRemoval(id);
 assert.equal(await owner.app.run(),true);
 assert.equal(owner.model.shifts.length,1,'the local marker can be cleared independently');
 const changedId='shift-998877665544-race';
 const changed={...original,id:changedId};
 const racer=client('trashRace',svc,{shifts:[clone(changed)]});
 assert.equal(await racer.app.run(),true);
 assert.equal(racer.app.markLocalRemoval(changedId,changed),true);
 racer.model.shifts=[];
 svc.cloud.get(changedId).revision++;
 svc.cloud.get(changedId).shift.startingOdo='8';
 assert.equal(await racer.app.run(),true,'local cleanup does not overwrite concurrent cloud edits');
 assert.notEqual(svc.cloud.get(changedId).deleted,true);
 console.log('端末日報の整理とサーバーゴミ箱は別操作：原本・CAS版番号・他端末受信を保護');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Bootstrapping a writer must not silently discard a local-only or modified duty.
(async()=>{
 const svc=server();
 const original={id:'shift-7777-protect',date:'2026-10-21',records:[],settings:{},startedAt:'10:00'};
 const localOnly=client('writerLocalOnly',svc,{shifts:[clone(original)]});
 assert.deepEqual(localOnly.app.planSafeWriterSnapshot([]).pendingIds,[original.id]);
 assert.equal(localOnly.app.planSafeWriterSnapshot([]).shifts[0].id,original.id);
 const uploaded=client('writerEdited',svc,{shifts:[clone(original)]});
 assert.equal(await uploaded.app.run(),true);
 uploaded.model.shifts[0].startedAt='11:00';
 assert.throws(()=>uploaded.app.assertSafeWriterSnapshot([original]),/競合/);
 uploaded.model.shifts[0].startedAt='10:00';
 assert.equal(uploaded.app.assertSafeWriterSnapshot([{...original,startedAt:'12:00'}]),true,
  'an unchanged local version may accept a newer cloud version');
 const noPrior=client('writerSame',svc,{shifts:[clone(original)]});
 assert.equal(noPrior.app.assertSafeWriterSnapshot([clone(original)]),true);
 assert.throws(()=>noPrior.app.assertSafeWriterSnapshot([{...original,startedAt:'12:00'}]),/競合/);
 const recovered=client('writerHeld',svc,{shifts:[clone(original)]});
 assert.equal(await recovered.app.run(),true);
 svc.cloud.delete(original.id);
 const held=recovered.app.planSafeWriterSnapshot([]);
 assert.deepEqual(held.heldIds,[original.id]);
 assert.equal(held.pendingIds.length,0,'deleted synced original cannot be auto-reuploaded');
 assert.equal(held.shifts[0].id,original.id,'local recovered duty remains editable');
 console.log('編集端末の起動受信：未同期と端末固有の日報を上書きしない');
})().catch(error=>{console.error(error);process.exitCode=1;});


 
// Past-duty release requires a confirmed local packet AND the same server revision.
// Successful upload alone, unsent edits, and a removed duty are not sufficient.
(async()=>{
 const svc=server(),id='shift-20261022-retain';
 const shift={id,date:'2026-10-21',records:[],settings:{},startedAt:'08:00',endedAt:'18:00'};
 const C=client('confirmedRetentionRevision',svc,{shifts:[clone(shift)]},false,true);
 assert.equal(C.app.verifiedRevision(id),null,'new unsent duty has no confirmed revision');
 assert.equal(await C.app.run(),true);
 assert.equal(C.app.verifiedRevision(id),1,'matching saved packet has confirmed revision');
 C.model.shifts[0].startedAt='09:00';
 assert.equal(C.app.verifiedRevision(id),null,'local edits invalidate retention approval');
 assert.equal(await C.app.run(),true);
 assert.equal(C.app.verifiedRevision(id),2,'new confirmed version may be released after server check');
 C.app.markLocalRemoval(id,C.model.shifts[0]);
 assert.equal(C.app.verifiedRevision(id),null,'deletion intent blocks automatic release');
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 assert.match(html,/const confirmedRevision=syncUI\.verifiedRevision\(old\.id\)/);
 assert.match(html,/confirmedRevision===null\|\|server\.revision!==confirmedRevision/);
 console.log('前回乗務の端末整理：確認済み更新番号と未同期状態を検証');
})().catch(e=>{console.error(e);process.exitCode=1;});


// A successful Firestore write with a lost response must be confirmed by
// reading the original, not duplicated or automatically treated as conflict.
(async()=>{
 const svc=server(),id='shift-20261022-unknown';
 const local={shifts:[{id,date:'2026-10-22',records:[],settings:{},startedAt:'07:00'}]};
 let loseReply=false,uploads=0;
 const api={request:async(action,data)=>{
  if(action==='syncPut'){
   uploads++;
   const result=await svc.request(action,data);
   if(loseReply){loseReply=false;throw Error('保存後の読戻し応答を受信できません');}
   return result;
  }
  return svc.request(action,data);
 }};
 const owner=client('lostReceiptRecovery',api,local,false,true);
 assert.equal(await owner.app.run(),true);
 local.shifts[0].startedAt='08:00';
 loseReply=true;
 assert.equal(await owner.app.run(),false,'応答喪失時は保存済みと即断しない');
 assert.equal(svc.cloud.get(id).revision,2,'原本自体は確定している');
 assert.equal(await owner.app.run(),true,'再試行で同じ原本の読み戻しに成功する');
 assert.equal(uploads,2,'同一内容を重複送信しない');
 assert.equal(owner.app.verifiedRevision(id),2,'版番号と内容を確定済みとして扱える');
 local.shifts[0].startedAt='09:00';
 svc.cloud.get(id).revision=3;
 svc.cloud.get(id).shift.startedAt='10:00';
 assert.equal(await owner.app.run(),false,'端末とサーバーの異なる変更は保留する');
 assert.equal(owner.app.status().conflicts.length,1);
 assert.equal(svc.cloud.get(id).shift.startedAt,'10:00','別端末の内容を上書きしない');
 console.log('Firestore送信応答不明：同内容読戻しで復旧・異内容は競合保護');
})().catch(e=>{console.error(e);process.exitCode=1;});
