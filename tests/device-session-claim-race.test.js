'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'..','device-session.js'),'utf8');
const user={uid:'user-claim-race'};
const flush=async()=>{for(let n=0;n<20;n++)await new Promise(r=>setImmediate(r));};
function setup({ackFirst=false,cachePulse=false,wrongSession=false,denied=false}={}){
 let mode='pending',listener=null,oldId='old-session',pendingDoc='',serverDoc='old-session',writeResolve=null;
 let ackCount=0,reads=0,writes=0;
 const storage=new Map([['taxiapp-current-session-v1-'+user.uid,oldId]]);
 const c={
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  crypto:{randomUUID:()=> '00000000-0000-4000-a000-000000000555'},Uint8Array,
 };
 vm.createContext(c);vm.runInContext(js,c);
 const snap=(value,hasPendingWrites=false,fromCache=false)=>({
  metadata:{fromCache,hasPendingWrites},
  exists:()=>Boolean(value),
  data:()=>({sessionId:value})
 });
 const f={
  doc:(_db,col,id)=>col+'/'+id,
  serverTimestamp:()=> 'server',
  onSnapshot(_r,_opts,onNext,onError){
   listener={onNext,onError};
   queueMicrotask(()=>onNext(snap(serverDoc)));
   return ()=>{listener=null};
  },
  async setDoc(ref,data){
   writes++;
   if(denied)throw Object.assign(Error('denied'),{code:'permission-denied'});
   pendingDoc=data.sessionId;
   if(cachePulse)listener?.onNext(snap(data.sessionId,true));
   if(!ackFirst){
    serverDoc=wrongSession?'other-owner':pendingDoc;
    listener?.onNext(snap(serverDoc));
    return;
   }
   return new Promise(resolve=>{writeResolve=resolve;});
  },
  async getDocFromServer(){reads++;return snap(serverDoc);}
 };
 const controller=c.TAXIAPP_DEVICE_SESSION.create({f,db:{},auth:{currentUser:user},onMode:next=>{mode=next;}});
 return {
  controller,mode:()=>mode,canWrite:()=>controller.canWrite(),
  writes:()=>writes,reads:()=>reads,
  serverConfirm(){
   serverDoc=wrongSession?'other-owner':pendingDoc;
   listener?.onNext(snap(serverDoc));
  },
  completeWrite(){
   if(!writeResolve)throw Error('nothing to acknowledge');
   writeResolve();writeResolve=null;
  },
  confirmCorrect(){
   serverDoc=pendingDoc;listener?.onNext(snap(serverDoc));
  },
 };
}
(async()=>{
 // Actual Firestore may deliver the authoritative watcher snapshot BEFORE
 // setDoc completes. A local pendingWrites callback must not break takeover.
 const early=setup({cachePulse:true});
 await early.controller.begin(user,{viewer:true});await flush();
 assert.equal(early.mode(),'viewer');
 await early.controller.claim();await flush();
 assert.equal(early.mode(),'writer');
 assert.equal(early.canWrite(),true);
 assert.equal(early.reads(),0,'watcher confirmation must avoid an extra read');
 // In other network order, write completes before watcher server snapshot.
 const late=setup({ackFirst:true,cachePulse:true});
 await late.controller.begin(user,{viewer:true});await flush();
 await late.controller.claim();await flush();
 assert.equal(late.mode(),'pending');
 assert.equal(late.canWrite(),false);
 late.completeWrite();await flush();
 assert.equal(late.canWrite(),false,'write acknowledgement alone grants no edits');
 late.serverConfirm();await flush();
 assert.equal(late.mode(),'writer');
 assert.equal(late.canWrite(),true);
 assert.equal(late.reads(),0);
 // Another owner proves no exclusivity until our session matches the server.
 const other=setup({wrongSession:true});
 await other.controller.begin(user,{viewer:true});await flush();
 await other.controller.claim();await flush();
 assert.equal(other.canWrite(),false);
 other.confirmCorrect();await flush();
 assert.equal(other.canWrite(),true);
 // Permission-denied must never grant edits even for a previously open session.
 const rejected=setup({denied:true});
 await rejected.controller.begin(user,{viewer:true});await flush();
 await rejected.controller.claim();await flush();
 assert.equal(rejected.mode(),'viewer');
 assert.equal(rejected.canWrite(),false);
 assert.equal(rejected.writes(),1);
 console.log('Takeover races passed: pending writes, watcher-before-ack, ack-before-watcher, foreign owner and permission denial.');
})().catch(e=>{console.error(e);process.exitCode=1;});
