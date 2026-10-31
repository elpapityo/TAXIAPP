// 実Firestoreルールの期限/本人分離を検証。Google/GASは呼ばない。
const {test,before,after}=require('node:test');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,Timestamp}=require('firebase/firestore');
const fs=require('node:fs');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-taxiapp-gps',firestore:{rules:fs.readFileSync(process.env.GPS_TEST_RULES,'utf8')}});});
after(async()=>{await env?.cleanup();});
const db=id=>id?env.authenticatedContext(id).firestore():env.unauthenticatedContext().firestore();
const lease=(extra={})=>({status:'active',diaryUid:'diary-synthetic',googleSubject:'synthetic',isAdmin:false,
 updatedAt:Timestamp.fromMillis(Date.now()-1000),accessExpiresAt:Timestamp.fromMillis(Date.now()+60000),...extra});
const seed=(uid,data,admin)=>env.withSecurityRulesDisabled(async c=>{
 await setDoc(doc(c.firestore(),'users',uid),data);
 if(admin)await setDoc(doc(c.firestore(),'admins',uid),admin);
});
test('資格：有効期限内の本人だけ読める・一覧/自己延長/他人/未認証は拒否',async()=>{
 await seed('member',lease());
 await assertSucceeds(getDoc(doc(db('member'),'users','member')));
 for(const id of ['other',null])await assertFails(getDoc(doc(db(id),'users','member')));
 await assertFails(getDocs(collection(db('member'),'users')));
 await assertFails(setDoc(doc(db('member'),'users','member'),lease()));
});
test('資格：期限切れ・停止・旧形式・過大期限・未来の確認時刻は拒否',async()=>{
 for(const [id,data]of [
  ['expired',lease({accessExpiresAt:Timestamp.fromMillis(1)})],
  ['suspended',lease({status:'suspended'})],['legacy',{status:'active'}],
  ['long',lease({accessExpiresAt:Timestamp.fromMillis(Date.now()+3600000)})],
  ['future',lease({updatedAt:Timestamp.fromMillis(Date.now()+60000)})]
 ]){await seed(id,data);await assertFails(getDoc(doc(db(id),'users',id)));}
});
test('管理者：有効な本人資格と管理者コピー両方が必要・期限だけ/古いフラグでは通らない',async()=>{
 const grant=lease({isAdmin:true}),role={enabled:true,diaryUid:grant.diaryUid,updatedAt:grant.updatedAt,accessExpiresAt:grant.accessExpiresAt};
 await seed('admin',grant,role);await assertSucceeds(getDoc(doc(db('admin'),'admins','admin')));
 await seed('demoted',lease(),role);await assertFails(getDoc(doc(db('demoted'),'admins','demoted')));
 await seed('stale',lease({isAdmin:true,accessExpiresAt:Timestamp.fromMillis(1)}),role);
 await assertFails(getDoc(doc(db('stale'),'admins','stale')));
 await seed('mismatch',grant,{...role,diaryUid:'other'});await assertFails(getDoc(doc(db('mismatch'),'admins','mismatch')));
 await seed('old-admin',grant,{enabled:true});await assertFails(getDoc(doc(db('old-admin'),'admins','old-admin')));
 await assertFails(getDoc(doc(db('member'),'admins','admin')));
});
test('本人も管理者も位置/履歴/対応表/操作端末/日報の直接アクセスは引き続き拒否',async()=>{
 for(const uid of ['member','admin'])for(const p of ['gpsPresence/member','gpsHistory/member/shifts/shift-1','gpsAccountLinks/diary-synthetic','deviceSessions/member','privateDuties/member/shifts/shift-1']){
  await assertFails(getDoc(doc(db(uid),p)));await assertFails(setDoc(doc(db(uid),p),{synthetic:true}));
 }
});
