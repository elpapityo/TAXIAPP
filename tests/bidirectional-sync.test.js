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
  if(action==='syncList')return {shifts:[...cloud].map(([id,r])=>({id,revision:r.revision}))};
  if(action==='syncGet'){
   const entry=cloud.get(data.shiftId);
   if(!entry)throw Error('not found');
   return {id:data.shiftId,revision:entry.revision,shift:clone(entry.shift)};
  }
  if(action==='syncPut'){
   const shift=JSON.parse(data.payload).shift;
   const prior=cloud.get(shift.id),version=prior?.revision||0;
   if(Number(data.baseRevision)!==version)throw Error('SYNC_CONFLICT:'+version);
   const entry={revision:version+1,shift:clone(shift)};
   cloud.set(shift.id,entry);
   return {id:shift.id,revision:entry.revision};
  }
  throw Error('unexpected '+action);
 }
 return {cloud,request,events};
}
function client(name,svc,model,failReceive=false){
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
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 for(const literal of ['bidirectional-sync.js?v=0.3.37','cloud-sync-ui.js?v=0.3.39',
  'syncUI.panel()','syncUI.run(true)','syncMode','googlePostRequest(',
  'if(sheetTargetPrefs().syncMode===\'on\'){syncUI.schedule();return;}']){
  assert.ok(html.includes(literal),'missing '+literal);
 }
 const pageVersion=html.match(/<title>TAXIAPP (v\d+\.\d+\.\d+) — 乗務日報<\/title>/)?.[1];
 assert.ok(pageVersion,'document title must contain the release version');
 assert.ok(html.includes('乗務日報 · ${displayVersion}'),
  'header must display the version read from the title, not a hard-coded older version');
 assert.ok(html.includes('document.title.match(/v\\d+\\.\\d+\\.\\d+/)'),
  'header must derive version from document title');
 assert.match(html,/setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'/);
 console.log('Bidirectional sync tests passed: send, receive, CAS, conflict hold and resolution, first-use guard, offline safety, web wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
