'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'..','device-session.js'),'utf8');
const sourceContext={};
vm.createContext(sourceContext);
vm.runInContext(js,sourceContext);
const create=sourceContext.TAXIAPP_DEVICE_SESSION.create;
const user={uid:'uid-same-account'},current={sessionId:null},subscribers=new Set();
let writeCount=0, seq=0,listenerCount=0;
function snapshot(){
 return {exists:()=>!!current.sessionId,
  data:()=>({sessionId:current.sessionId}),metadata:{fromCache:false,hasPendingWrites:false}};
}
const f={
 async getDocFromServer(){return snapshot();},
 doc(_db,path,uid){assert.equal(path,'deviceSessions');assert.equal(uid,user.uid);return path+'/'+uid;},
 serverTimestamp(){return 'server';},
 async setDoc(ref,data){
  assert.equal(ref,'deviceSessions/'+user.uid);
  assert.equal(data.updatedAt,'server');
  assert.ok(data.sessionId.length>=32);
  writeCount++;
  current.sessionId=data.sessionId;
  for(const fn of subscribers)fn(snapshot());
 },
 onSnapshot(ref,options,fn){
  assert.equal(ref,'deviceSessions/'+user.uid);
  assert.equal(options.includeMetadataChanges,true);
  listenerCount++;subscribers.add(fn);
  queueMicrotask(()=>{if(subscribers.has(fn))fn(snapshot());});
  return ()=>subscribers.delete(fn);
 }
};
function client(storage,viewer=false){
 let mode='legacy';
 const auth={currentUser:user};
 const sessionStorage={
  getItem(k){return storage.get(k)||null;},
  setItem(k,v){storage.set(k,v);}
 };
 const crypto={randomUUID(){
  seq++;return '00000000-0000-4000-a000-'+String(seq).padStart(12,'0');
 }};
 const codeContext={sessionStorage,crypto,Uint8Array,auth};
 // Controller resolves browser globals where the factory is created,
 // so execute a separate copy in the client-specific global.
 vm.createContext(codeContext);vm.runInContext(js,codeContext);
 const obj=codeContext.TAXIAPP_DEVICE_SESSION.create({
  f,db:{},auth,onMode(next){mode=next;}
 });
 return {obj,mode:()=>mode,auth,viewer};
}
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
(async()=>{
 const a=client(new Map()),b=client(new Map()),c=client(new Map());
 await a.obj.begin(user);await flush();
 assert.equal(a.mode(),'writer','first login must become editor');
 assert.equal(writeCount,1);
 await b.obj.begin(user);await flush();
 assert.equal(b.mode(),'writer','last device login takes over');
 assert.equal(a.mode(),'viewer','previous owner becomes view-only');
 assert.equal(a.obj.canWrite(),false);
 assert.equal(b.obj.canWrite(),true);
 assert.equal(writeCount,2);
 await c.obj.begin(user,{viewer:true});await flush();
 assert.equal(c.mode(),'viewer','explicit viewer must not evict editor');
 assert.equal(b.mode(),'writer');
 assert.equal(writeCount,2);
 await a.obj.claim();await flush();
 assert.equal(a.mode(),'writer');
 assert.equal(b.mode(),'viewer');
 assert.equal(c.mode(),'viewer');
 assert.equal(writeCount,3);
 // Reloading a superseded browser tab must not reclaim the session.
 const storage=new Map();
 const oldTab=client(storage);
 await oldTab.obj.begin(user);await flush();
 assert.equal(oldTab.mode(),'writer');
 const newTab=client(new Map());
 await newTab.obj.begin(user);await flush();
 assert.equal(newTab.mode(),'writer');
 const before=writeCount;
 oldTab.obj.clear();
 const refreshed=client(storage);
 await refreshed.obj.begin(user);await flush();
 assert.equal(refreshed.mode(),'viewer','old session stays viewer after a reload');
 assert.equal(writeCount,before,'old session reload must not write');
 const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');
 assert.match(rules,/match \/deviceSessions\/\{uid\}/);
 assert.match(rules,/request\.resource\.data\.writerSessionId/);
 assert.match(rules,/isCurrentEditor\(uid\)/);
 assert.match(rules,/allow list, delete: if false/);
 assert.equal(listenerCount,6,'only one listener per new authenticated browser instance');
 // Explicit viewing must stay non-editable even when the Firestore rules
 // have not been deployed and the browser has a formerly valid session ID.
 function denied(viewer){
  const fakeStorage=new Map([['taxiapp-current-session-v1-'+user.uid,
    '00000000-0000-4000-a000-000000000123']]);
  const ctx={
   sessionStorage:{getItem:k=>fakeStorage.get(k)||null,setItem:(k,v)=>fakeStorage.set(k,v)},
   crypto:{randomUUID:()=> '00000000-0000-4000-a000-000000000321'},
   Uint8Array
  };
  vm.createContext(ctx);vm.runInContext(js,ctx);
  let state='pending';
  const deniedFirestore={
   doc:()=> 'deviceSessions/'+user.uid,
   onSnapshot:(_ref,_options,_onNext,onError)=>{
    queueMicrotask(()=>onError({code:'permission-denied'}));
    return ()=>{};
   },
   serverTimestamp:()=> 'server',
   setDoc:async()=>{throw Error('must not claim without server rules');}
  };
  const obj=ctx.TAXIAPP_DEVICE_SESSION.create({
   f:deniedFirestore,db:{},auth:{currentUser:user},onMode:next=>{state=next;}
  });
  return {obj,state:()=>state,viewer};
 }
 const deniedViewer=denied(true);
 await deniedViewer.obj.begin(user,{viewer:true});await flush();
 assert.equal(deniedViewer.state(),'viewer','requested viewer must not fall into editable legacy mode');
 assert.equal(deniedViewer.obj.canWrite(),false);
 const deniedWriter=denied(false);
 await deniedWriter.obj.begin(user,{viewer:false});await flush();
 assert.equal(deniedWriter.state(),'viewer','unverified writer must not fall back to editing');
 assert.equal(deniedWriter.obj.canWrite(),false);

 // A denied server listener plus a successful write must never grant editing.
 const suspicious=(()=>{
  const c={sessionStorage:{getItem:()=>null,setItem(){}},
    crypto:{randomUUID:()=> '00000000-0000-4000-a000-000000000432'},Uint8Array};
  vm.createContext(c);vm.runInContext(js,c);
  let state='pending',writes=0;
  const obj=c.TAXIAPP_DEVICE_SESSION.create({
   auth:{currentUser:user},db:{},
   f:{doc:()=> 'session',serverTimestamp:()=> 'server',
    onSnapshot(_ref,_opts,_next,fail){
     queueMicrotask(()=>fail({code:'permission-denied'}));
     return ()=>{};
    },
    async setDoc(){writes++;},
    async getDocFromServer(){return {exists:()=>true,data:()=>({sessionId:'00000000-0000-4000-a000-000000000432'})};}},
   onMode:next=>{state=next;}
  });
  return {obj,state:()=>state,writes:()=>writes};
 })();
 await suspicious.obj.begin(user,{viewer:false});await flush();
 await suspicious.obj.claim();await flush();
 assert.equal(suspicious.writes(),0,'a denied watcher must prevent even attempting a takeover write');
 assert.equal(suspicious.state(),'viewer');
 assert.equal(suspicious.obj.canWrite(),false);
 // Regression: on a denied listener, clicking takeover re-subscribes.
 // Once server permissions are corrected, the SAME tab must recover without
 // logging out or reloading; until then both devices stay read-only.
 let permit=false,reconnections=0,deniedWriteCount=0;
 const recoverContext={sessionStorage:{getItem:()=>null,setItem(){}},
  crypto:{randomUUID:()=> '00000000-0000-4000-a000-000000000777'},Uint8Array};
 vm.createContext(recoverContext);vm.runInContext(js,recoverContext);
 let recoverMode='pending',recoverDoc='',recoverNotify=null;
 const recovery=recoverContext.TAXIAPP_DEVICE_SESSION.create({
  auth:{currentUser:user},db:{},
  f:{
   doc:()=> 'deviceSessions/'+user.uid,serverTimestamp:()=> 'server',
   onSnapshot(_r,_o,next,error){
    reconnections++;recoverNotify=next;
    queueMicrotask(()=>{
     if(permit)next({exists:()=>Boolean(recoverDoc),
      data:()=>({sessionId:recoverDoc}),
      metadata:{fromCache:false,hasPendingWrites:false}});
     else error({code:'permission-denied'});
    });
    return ()=>{};
   },
   async setDoc(_r,data){
    if(!permit)throw Object.assign(Error('denied'),{code:'permission-denied'});
    deniedWriteCount++;recoverDoc=data.sessionId;
    queueMicrotask(()=>recoverNotify?.({exists:()=>true,data:()=>({sessionId:recoverDoc}),metadata:{fromCache:false,hasPendingWrites:false}}));
   },
   async getDocFromServer(){
    if(!permit)throw Object.assign(Error('denied'),{code:'permission-denied'});
    return {exists:()=>true,data:()=>({sessionId:recoverDoc})};
   }
  },
  onMode:next=>{recoverMode=next;}
 });
 await recovery.begin(user,{viewer:true});await flush();
 assert.equal(recoverMode,'viewer');
 await recovery.claim();await flush();
 assert.equal(recoverMode,'viewer','denied takeover must remain view-only');
 assert.equal(deniedWriteCount,0,'cannot write without server permission');
 assert.equal(reconnections,2,'explicit click retries exactly one listener');
 permit=true;await recovery.claim();await flush();
 assert.equal(recoverMode,'writer','same tab must recover after permission repair');
 assert.equal(recovery.canWrite(),true);
 assert.equal(deniedWriteCount,1);
 assert.equal(reconnections,3,'no periodic reader/poller needed');
 // Restored authentication without explicit user action cannot take over
 // another device, even when the Google account remains signed in.
 const beforePassiveWrites=writeCount;
 const passive=client(new Map());
 await passive.obj.begin(user,{viewer:false,claimOnLogin:false});await flush();
 assert.equal(passive.mode(),'viewer');
 assert.equal(writeCount,beforePassiveWrites,
  'restored login without a stored session must not evict the editor');
 console.log('Device sessions passed: single editor, no legacy bypass, denied watcher and takeover safety.');
})().catch(e=>{console.error(e);process.exitCode=1;});
