'use strict';
// Execute actual UI cutover function with synthetic UID/session and Firestore
// responses, without touching real storage or changing production permissions.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const first=html.indexOf('async function startAdminFirestoreCutover(){');
const last=html.indexOf('async function returnAdminToLegacy(){',first);
assert.ok(first>0&&last>first);
const src=html.slice(first,last);
const id='shift-1792630000000-selected';
function context(mode){
 const saved=new Map(),cloud=new Map(),events=[];
 const uid='uid-owner-A',scope={uid,admin:true,firebase:{auth:{currentUser:{uid}}}};
 const shift={id,date:'2026-10-21',records:[],settings:{},endedAt:'11:00'};
 const data={version:1,shifts:[shift],activeId:null,
  prefs:{driver:'利用者本人',waitPlaces:['登録済み待機所'],ui:{screenMode:'phone'},
   sheetTarget:{webAppUrl:'legacy-url'}}};
 const c={
  adminCutoverBusy:false,accountScopeGeneration:4,currentLoginScope:scope,
  accountScope:{uid,kind:'legacy',adminFirestore:false},
  model:data,deviceMode:'writer',JSON,Date,Set,Map,Error,console,
  appEl:{querySelectorAll:()=>[{dataset:{firestoreMigrateId:id}}]},
  localStorage:{
   getItem:key=>saved.get(key)??null,
   setItem:(key,value)=>saved.set(key,String(value)),
   removeItem:key=>saved.delete(key)
  },
  window:{TAXIAPP_ACCOUNT_DIARY:{create:()=>({
   bind(user,options){assert.equal(user.uid,uid);assert.equal(options.storageBackend,'firestore');},
   ready:()=>true,
   async request(action,fields){
    events.push('firestore:'+action);
    if(action==='syncList'){
     if(mode==='switch-on-list'){
      c.currentLoginScope={uid:'uid-other',admin:true,firebase:{auth:{currentUser:{uid:'uid-other'}}}};
      c.accountScope.uid='uid-other';
      c.accountScopeGeneration++;
     }
     return {shifts:[]};
    }
    if(action==='syncPut'){
     const packet=JSON.parse(fields.payload);cloud.set(packet.shift.id,packet.shift);
     if(mode==='switch-on-write'){
      c.currentLoginScope={uid:'uid-other',admin:true,firebase:{auth:{currentUser:{uid:'uid-other'}}}};
      c.accountScope.uid='uid-other';
      c.accountScopeGeneration++;
     }
     return {id,revision:1};
    }
    if(action==='syncGet')return {id,shift:cloud.get(id)};
    throw Error('unexpected '+action);
   }
  })}},
  ADMIN_FIRESTORE_PREF_PREFIX:'test-admin-firestore-optin:',
  // This synthetic legacy-import scenario assumes a distinct owner approval.
  ADMIN_LEGACY_DUTY_MIGRATION_APPROVED:true,
  deepCopy:o=>JSON.parse(JSON.stringify(o)),
  dateStamp:()=> '20261022',
  download:()=>events.push('backup'),
  confirm:()=>true,
  toast:(msg,err)=>events.push('toast:'+String(msg)),
  legacyDiary:()=>c.accountScope.kind==='legacy',
  canEditNow:()=>true,
  googleShiftPacket:sh=>({kind:'TAXIAPP_SHIFT_V1',
   shift:JSON.parse(JSON.stringify(sh)),summary:{meter:1000}}),
  save:async()=>true,
  async switchAccountScope(target){
   events.push('switch');
   c.accountScopeGeneration++;
   c.currentLoginScope=target;
   c.accountScope={uid:target.uid,
    kind:saved.has('test-admin-firestore-optin:'+target.uid)?'member':'legacy',
    adminFirestore:saved.has('test-admin-firestore-optin:'+target.uid)};
  },
  syncUI:{async bootstrapWriter(){events.push('bootstrap');return mode!=='bootstrap-fail';}},
  render:()=>events.push('render')
 };
 vm.createContext(c);vm.runInContext(src,c);
 return {c,saved,cloud,events,uid};
}
(async()=>{
 const ok=context('success');
 await vm.runInContext('startAdminFirestoreCutover()',ok.c);
 assert.equal(ok.c.accountScope.adminFirestore,true,'cutover must bind the selected owner only');
 assert.equal(ok.cloud.size,1);
 assert.equal(ok.saved.has('test-admin-firestore-optin:'+ok.uid),true);
 assert.ok(ok.events.some(x=>x.includes('切り替えました')));
 assert.equal(ok.c.model.prefs.driver,'利用者本人','正式切替で本人の表示・業務設定を維持');
 assert.deepEqual(JSON.parse(JSON.stringify(ok.c.model.prefs.waitPlaces)),['登録済み待機所']);
 assert.equal(ok.c.model.prefs.sheetTarget,undefined,'旧Google接続情報は新Firestoreへ持ち込まない');
 for(const mode of ['switch-on-list','switch-on-write']){
  const t=context(mode);
  await vm.runInContext('startAdminFirestoreCutover()',t.c);
  assert.equal(t.saved.has('test-admin-firestore-optin:'+t.uid),false,
   'changed login must not persist old owner cutover manifest: '+mode);
  assert.equal(t.events.filter(x=>x==='switch').length,0,
   'old transaction must not switch the newly logged-in account');
  assert.ok(t.events.some(x=>x.includes('ログイン')));
  if(mode==='switch-on-write')assert.equal(t.cloud.size,1,
   'completed remote original remains intact, never deleted on abort');
 }
 const failed=context('bootstrap-fail');
 await vm.runInContext('startAdminFirestoreCutover()',failed.c);
 assert.equal(failed.saved.has('test-admin-firestore-optin:'+failed.uid),false,
  'failed first bootstrap must roll back the local cutover preference');
 assert.equal(failed.c.accountScope.kind,'legacy');
 assert.equal(failed.cloud.size,1,'partial remote copy is never destroyed');
 console.log('管理者保存先切替：正常成功、UID変更中止、失敗時旧Google復帰を確認');
})().catch(e=>{console.error(e);process.exitCode=1;});
