'use strict';
const assert=require('node:assert/strict');
require('../firebase-trash-login.js');
const maker=globalThis.TAXIAPP_TRASH_LOGIN;
const uid='driver-A';
const auth={currentUser:{uid}};
const firebase={f:{},db:{},auth,session:{sessionId:()=> 's'.repeat(36)}};
(async()=>{
 // Unconfigured is always DISABLED. Never silently start a deletion.
 {
  let attempts=0;
  const login=maker.create({trashFactory:()=>{attempts++;return {};}});
  assert.equal((await login.afterLogin({uid,firebase})).state,'disabled');
  assert.equal(attempts,0);
 }
 // Read-only and wrong UID never instantiate a destructive client.
 {
  let attempts=0,editor=false;
  const login=maker.create({trashFactory:()=>{attempts++;return {};},
   enabled:()=>true,isCurrentEditor:()=>editor});
  assert.equal((await login.afterLogin({uid,firebase})).state,'read-only');
  editor=true;
  assert.equal((await login.afterLogin({uid:'someone-else',firebase})).state,'not-authenticated');
  assert.equal(attempts,0);
 }
 // On verified login, at most twenty expired records are checked per batch,
 // and the client is unbound afterwards.
 {
  const calls=[],notices=[];
  const login=maker.create({
   trashFactory:()=>({
    bind:(...args)=>calls.push(['bind',...args]),
    async purgeExpired(args){calls.push(['purge',args]);return {purged:['shift-100-a'],totalTrashCountAtRead:1};}
   }),
   enabled:()=>true,isCurrentEditor:x=>x===uid,onStatus:x=>notices.push(x)
  });
  const result=await login.afterLogin({uid,firebase});
  assert.equal(result.state,'checked');
  assert.deepEqual(result.purged,['shift-100-a']);
  assert.deepEqual(calls[1],['purge',{max:20}]);
  assert.equal(calls[0][1].uid,uid);
  assert.equal(calls[0][2].readOnly,false);
  assert.equal(calls.at(-1)[1],null);
  assert.equal(notices.length,1);
 }
 // Network/Rules failure is deferred, not a fake success or a login failure.
 {
  const notices=[],login=maker.create({
   trashFactory:()=>({
    bind(){},
    async purgeExpired(){throw Error('permission-denied');}
   }),
   enabled:()=>true,isCurrentEditor:()=>true,onStatus:v=>notices.push(v)
  });
  assert.equal((await login.afterLogin({uid,firebase})).state,'deferred');
  assert.equal(notices[0].state,'deferred');
 }
 // Account switch while Firestore is in flight must not publish a success.
 {
  let resolveRead,unbound=0;
  const login=maker.create({
   trashFactory:()=>({
    bind(x){if(x===null)unbound++;},
    async purgeExpired(){return await new Promise(resolve=>resolveRead=resolve);}
   }),
   enabled:()=>true,isCurrentEditor:()=>true
  });
  const job=login.afterLogin({uid,firebase});
  // afterLogin reaches purgeExpired synchronously before first await.
  login.cancel();
  resolveRead({purged:['shift-100-a']});
  const result=await job;
  assert.equal(result.state,'cancelled');
  assert.ok(unbound>=1);
 }
 // An authorization change while awaiting Firestore prevents success report.
 {
  let complete;
  const login=maker.create({
   trashFactory:()=>({bind(){},async purgeExpired(){
    return await new Promise(resolve=>complete=resolve);
   }}),enabled:()=>true,isCurrentEditor:()=>true
  });
  const job=login.afterLogin({uid,firebase});
  auth.currentUser={uid:'driver-B'};
  complete({purged:['shift-100-a']});
  assert.equal((await job).state,'cancelled');
  auth.currentUser={uid};
 }
 console.log('Post-login free-tier cleanup: disabled, editor-only, deferral and account-switch guards passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
