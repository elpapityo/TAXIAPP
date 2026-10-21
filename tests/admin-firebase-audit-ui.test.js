'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
require('../admin-firestore-cutover.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function adminCutoverFirebaseHtml(){');
const b=html.indexOf('function adminCutoverSheetHtml(){',a);
assert.ok(a>0&&b>a,'owner-only Firebase preflight callbacks are present');
const id='shift-111-a',other='shift-999-a';
const shift={id,date:'2026-10-21',startedIso:'2026-10-21T08:00:00+09:00',
 endedIso:'2026-10-21T17:00:00+09:00',startedAt:'08:00',endedAt:'17:00',
 records:[],settings:{}};
const remote={...shift,records:[{raw:{K:999},kind:'ride'}]};
const remoteOnly={...shift,id:other};
const clone=x=>JSON.parse(JSON.stringify(x));
let actions=[],readFailure=false,listRevisionDrift=false,tooMany=false,otherUser=false;
let isLegacy=true,isWriter=true;
const auth={currentUser:{uid:'owner-A'}};
const connection={f:{},db:{},auth,session:{sessionId:()=> 'x'.repeat(36)}};
const messages=[];
const ctx={
 window:{
  TAXIAPP_ADMIN_CUTOVER:globalThis.TAXIAPP_ADMIN_CUTOVER,
  TAXIAPP_ACCOUNT_DIARY:{create(){
   let bound=null;
   return {
    bind(user,opts){
     bound=user?{user,opts}:null;
     if(user){
      assert.equal(opts.admin,true);
      assert.equal(opts.storageBackend,'firestore');
      assert.equal(opts.readOnly,true,'audit client must be forcibly read-only');
      assert.equal(user.uid,'owner-A');
     }
    },
    async request(action,fields){
     actions.push(action);
     assert.ok(bound,'request requires a bound reader');
     assert.ok(['syncList','syncGet'].includes(action),'read-only API actions only');
     if(readFailure)throw Error('permission-denied');
     if(otherUser){auth.currentUser={uid:'owner-B'};otherUser=false;}
     if(action==='syncList'){
      const count=actions.filter(x=>x==='syncList').length;
      const records=tooMany?Array.from({length:26},(_,i)=>({id:'shift-'+(1000+i)+'-a',revision:1})):
       [{id,revision:listRevisionDrift&&count>1?2:1},{id:other,revision:2}];
      return {shifts:records};
     }
     if(action==='syncGet'){
      return fields.shiftId===id?{id,revision:1,shift:clone(remote)}:
       {id:other,revision:2,shift:clone(remoteOnly)};
     }
    }
   };
  }}
 },
 legacyDiary:()=>isLegacy,canEditNow:()=>isWriter,
 accountScope:{uid:'owner-A'},accountScopeGeneration:3,
 adminCutoverSelectionUid:'owner-A',adminCutoverSelected:new Set([id]),
 adminCutoverFirebaseBusy:false,adminCutoverFirebaseAudit:null,
 adminCutoverFirebaseRequestToken:0,adminCutoverFirebaseConnection:connection,
 adminCutoverSheetAudit:null,
 model:{shifts:[clone(shift)]},
 updateAdminCutoverPreview(){},
 toast:(...x)=>messages.push(x),
 safeText:s=>String(s??'').replace(/[&<>"']/g,''),
 Date,JSON,Set,Map,Error,Number,String
};
vm.createContext(ctx);
vm.runInContext(html.slice(a,b),ctx);
const invoke=(name,...args)=>vm.runInContext(name,ctx)(...args);
(async()=>{
 assert.match(invoke('adminCutoverFirebaseHtml'),/未照合/);
 await invoke('compareAdminCutoverFirebase');
 assert.deepEqual(actions,['syncList','syncGet','syncGet','syncList']);
 assert.equal(ctx.adminCutoverFirebaseAudit.cloudShifts.length,2);
 assert.match(invoke('adminCutoverFirebaseHtml'),/本人Firebase原本：2件/);
 assert.match(invoke('adminCutoverFirebaseHtml'),/同ID内容違い/);
 assert.match(invoke('adminCutoverFirebaseHtml'),/Firebaseにだけ存在する日報/);
 assert.match(invoke('adminCutoverFirebaseHtml'),/移行・削除することはできません/);
 assert.equal(ctx.model.shifts.length,1);
 assert.equal(ctx.model.shifts[0].records.length,0,'local original is unchanged');
 assert.equal(ctx.adminCutoverFirebaseBusy,false);
 readFailure=true;
 await invoke('compareAdminCutoverFirebase');
 assert.equal(ctx.adminCutoverFirebaseAudit,null,'permission denied cannot be reported as empty');
 assert.ok(messages.some(x=>String(x[0]).includes('permission-denied')));
 readFailure=false;actions=[];
 listRevisionDrift=true;
 await invoke('compareAdminCutoverFirebase');
 assert.equal(ctx.adminCutoverFirebaseAudit,null,'server revision mismatch must stop audit');
 assert.ok(messages.some(x=>String(x[0]).includes('更新番号')));
 listRevisionDrift=false;actions=[];tooMany=true;
 await invoke('compareAdminCutoverFirebase');
 assert.equal(ctx.adminCutoverFirebaseAudit,null);
 assert.deepEqual(actions,['syncList'],'oversized collections must not be partially read');
 tooMany=false;actions=[];otherUser=true;
 await invoke('compareAdminCutoverFirebase');
 assert.equal(ctx.adminCutoverFirebaseAudit,null,'UID switch must invalidate audit');
 assert.deepEqual(actions,['syncList']);
 auth.currentUser={uid:'owner-A'};otherUser=false;actions=[];
 isWriter=false;
 await invoke('compareAdminCutoverFirebase');
 assert.equal(actions.length,0,'viewer cannot request audit');
 isWriter=true;isLegacy=false;
 await invoke('compareAdminCutoverFirebase');
 assert.equal(actions.length,0,'ordinary user must not enter admin audit');
 isLegacy=true;ctx.accountScope={uid:'owner-B'};
 await invoke('compareAdminCutoverFirebase');
 assert.equal(actions.length,0,'stale account scope must not read');
 console.log('Admin Firebase audit UI passed: read-only, UID, invalid revisions, permission and scope failures');
})().catch(error=>{console.error(error);process.exitCode=1;});
