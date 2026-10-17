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
 console.log('Device sessions passed: last login wins, viewer remains read-only, explicit takeover, stale reload protection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
