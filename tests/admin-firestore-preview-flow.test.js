'use strict';
// 管理者の開発用Firestore検証モード：旧Google運用を維持しながら1乗務を確認。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const beginning=html.indexOf('// Verify the administrator\'s current duty');
const ending=html.indexOf('async function startAdminFirestoreCutover(){',beginning);
assert.ok(beginning>0&&ending>beginning);
const functions=html.slice(beginning,ending);
const id='shift-1792700000999-preview',uid='owner-synthetic';
const shift={id,date:'2026-10-22',settings:{},records:[],endedAt:'',startedAt:'10:00'};
const clone=x=>JSON.parse(JSON.stringify(x)),events=[];
const original={uid,admin:true,firebase:{auth:{currentUser:{uid}}}};
const c={
 console,JSON,Date,Error,
 ADMIN_FIRESTORE_PREVIEW_AVAILABLE:true,
 accountScopeGeneration:7,currentLoginScope:original,
 accountScope:{uid,kind:'legacy',adminFirestore:false,adminFirestorePreview:false},
 adminCutoverBusy:false,deviceMode:'writer',persistTimer:0,localStorage:{
  setItem:()=>{throw Error('切替設定を書き込んではいけません');},
  removeItem:()=>{throw Error('切替設定を削除してはいけません');}
 },
 model:{shifts:[clone(shift)]},
 canEditNow:()=>true,legacyDiary:()=>c.accountScope.kind==='legacy',
 confirm:()=>true,render:()=>events.push('render'),toast:msg=>events.push('toast:'+msg),
 save:async()=>{events.push('device-save');return true;},
 accountDiary:{
  ready:()=>true,
  request:async(action)=>{assert.equal(action,'syncGet');events.push('server-read');
   return {id,revision:3,shift:clone(shift)};}
 },
 getShift:()=>shift,selectedShift:()=>shift,
 localFirestoreOriginal:x=>clone(x),
 canonicalStoredDuty:x=>x,
 syncUI:{
  bootstrapWriter:async()=>{events.push('boot');return true;},
  run:async (_manual,ids)=>{assert.deepEqual(Array.from(ids),[id]);events.push('server-write');return true;},
  verifiedRevision:()=>3
 },
 async switchAccountScope(scope){
  events.push('switch');c.accountScopeGeneration++;
  c.currentLoginScope=scope;
  const preview=vm.runInContext('adminFirestorePreviewActive',c);
  c.accountScope={uid:scope.uid,kind:preview?'member':'legacy',
   adminFirestore:preview,adminFirestorePreview:preview};
 }
};
vm.createContext(c);
vm.runInContext('let adminFirestorePreviewActive=false,adminFirestorePreviewOwnerUid="",adminFirestorePreviewMessage="";'+functions,c);
(async()=>{
 await vm.runInContext('startAdminFirestorePreview()',c);
 assert.equal(c.accountScope.adminFirestorePreview,true,'管理者のみ本人UIDの検証領域へ');
 assert.equal(c.accountScope.kind,'member','既存Firestore処理を利用する');
 assert.ok(events.includes('boot'));
 await vm.runInContext('verifyAdminFirestorePreviewDuty()',c);
 const message=vm.runInContext('adminFirestorePreviewMessage',c);
 assert.match(message,/保存確認済み/);
 assert.match(message,/更新番号 3/);
 assert.match(message,new RegExp(id));
 assert.ok(events.indexOf('device-save')<events.indexOf('server-write'));
 assert.ok(events.indexOf('server-write')<events.indexOf('server-read'));
 await vm.runInContext('exitAdminFirestorePreview()',c);
 assert.equal(c.accountScope.kind,'legacy','正式なGoogle運用へ戻る');
 assert.equal(vm.runInContext('adminFirestorePreviewActive',c),false);
 assert.ok(events.filter(x=>x==='device-save').length>=2,'戻る前に検証用端末原本も保存');
 assert.match(html,/ADMIN_FIRESTORE_CUTOVER_ENABLED=true/,'新規日報の初期保存先をFirestoreとする');
  assert.match(html,/!ADMIN_FIRESTORE_CUTOVER_ENABLED&&!adminFirestoreManifest\(scope.uid\)/,'旧端末原本の自動移行は行わない');
 assert.match(html,/taxiapp-admin-firestore-preview-v1-/,'検証用IndexedDBキーを分離');
 assert.match(html,/accountScope.adminFirestore&&!accountScope.adminFirestorePreview/,
  '従来管理者の原本保護は正式切替時に維持');
 assert.match(html,/ADMIN_FIRESTORE_PREVIEW_AVAILABLE&&adminFirestorePreviewActive&&/,
  'localhost限定の手動開始');
 // Mutated server originals must not show "confirmed".
 await vm.runInContext('startAdminFirestorePreview()',c);
 c.accountDiary.request=async()=>({id,revision:3,shift:{...clone(shift),startedAt:'09:00'}});
 await vm.runInContext('verifyAdminFirestorePreviewDuty()',c);
 assert.match(vm.runInContext('adminFirestorePreviewMessage',c),/保存未確認/,
  'サーバー内容の不一致では成功を表示しない');
 // After approved production cutover, the same UID/revision/content
 // verification must remain available without entering development preview.
 c.accountScope.adminFirestorePreview=false;
 c.accountScope.adminFirestore=true;
 c.accountDiary.request=async()=>({id,revision:3,shift:clone(shift)});
 await vm.runInContext('verifyAdminFirestorePreviewDuty()',c);
 assert.match(vm.runInContext('adminFirestorePreviewMessage',c),/保存確認済み/,
  '正式Firestore運用画面からも原本の読戻しを確認できる');
 assert.match(html,/現在の原本：本人専用Firestore[\s\S]*?adminFirestorePreviewVerify/,
  '正式版の保存先画面に読戻し確認操作を表示する');

 // The remote reception handler must use the UID/preview-scoped IndexedDB
 // key, NOT the legacy owner's 'taxiapp' key.
 const replaceStart=html.indexOf(' replace:async(id,incoming,existing)=>{');
 const replaceEnd=html.indexOf('\n root:appEl',replaceStart);
 assert.ok(replaceStart>0&&replaceEnd>replaceStart);
 const replacement=html.slice(replaceStart,replaceEnd).trim()
  .replace(/^replace:async\(id,incoming,existing\)=>\{/,
   'this.cloudReplace=async(id,incoming,existing)=>{').replace(/},\s*$/,'};');
 const previewKey='taxiapp-admin-firestore-preview-v1-'+uid;
 const persisted=new Map();
 const testDuty={...clone(shift),startedAt:'11:00'};
 const v={
  model:{activeId:null,shifts:[]},accountScope:{uid},
  accountScopeGeneration:5,MAX_RECORDS:60,keypadActive:false,
  appEl:{querySelector:()=>null},deepCopy:clone,
  scopedStorageKey:()=>previewKey,canEditNow:()=>true,
  save:async()=>{persisted.set(previewKey,clone(v.model));return true;},
  db:{},idbGet:async(_db,key)=>{
   assert.equal(key,previewKey,'本人UIDの検証保存先から読み戻す');
   return clone(persisted.get(key));
  },
  render:()=>{},localStorage:{getItem:()=>{throw Error('旧Google原本を読んではいけない');}},
  Error,Array,JSON,String
 };
 vm.createContext(v);
 vm.runInContext(replacement,v);
 await v.cloudReplace(id,testDuty);
 assert.equal(persisted.get(previewKey).shifts[0].startedAt,'11:00');
 assert.equal(v.model.shifts[0].startedAt,'11:00');
 // An obsolete response after account switching cannot roll back the new UID.
 const foreign={id:'shift-1792700001999-foreign',records:[],settings:{}};
 v.save=async()=>{
  v.accountScopeGeneration++;
  v.accountScope.uid='other-synthetic';
  v.model={activeId:null,shifts:[clone(foreign)]};
  return true;
 };
 await assert.rejects(()=>v.cloudReplace(id,{...clone(testDuty),startedAt:'12:00'}),
  /ログイン利用者が変更/);
 assert.equal(v.model.shifts[0].id,foreign.id,'遅延した旧UIDの受信は新アカウントを戻さない');
 console.log('管理者Firestore開発モード：旧原本を変更せず開始→保存→読戻し照合→旧Googleへ復帰');
})().catch(e=>{console.error(e);process.exitCode=1;});
