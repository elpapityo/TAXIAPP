const {test,after,before}=require('node:test');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,query,where,Timestamp,serverTimestamp}=require('firebase/firestore');
const fs=require('node:fs');
let env;
const uid='driver-12345678',other='other-12345678',admin='admin-12345678';
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-taxiapp-gps',firestore:{rules:fs.readFileSync(process.env.GPS_TEST_RULES,'utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  for(const id of [uid,other])await setDoc(doc(db,'users',id),{status:'active'});
  await setDoc(doc(db,'admins',admin),{enabled:true});
 });
});
after(async()=>{await env?.cleanup();});
const dbFor=id=>id?env.authenticatedContext(id).firestore():env.unauthenticatedContext().firestore();
const sample=()=>({format:'TAXIAPP_GPS_HISTORY_V1',uid,shiftId:'shift-100',startedAtMs:100,endedAtMs:200,
 points:[{lat:34,lon:135,capturedAtMs:150,accuracy:5,segmentNo:1}],contentHash:'a'.repeat(64),
 expiresAt:Timestamp.fromMillis(Date.now()+86400000),uploadedAt:serverTimestamp()});
test('履歴作成・serverTimestamp・本人読戻し・他人と管理者の直接読取拒否',async()=>{
 const db=dbFor(uid),ref=doc(db,'gpsHistory',uid,'shifts','shift-100');
 await assertSucceeds(getDoc(ref));
 await assertFails(setDoc(ref,sample()));
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'gpsHistory',uid,'shifts','shift-100'),sample()));
 await assertSucceeds(getDoc(ref));
 await assertFails(setDoc(ref,sample()));
 for(const id of [other,admin,null,'unregistered-123'])await assertFails(getDoc(doc(dbFor(id),'gpsHistory',uid,'shifts','shift-100')));
});
test('期限切れは本人も読めず、絞らない一覧を拒否する',async()=>{
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'gpsHistory',uid,'shifts','shift-99'),{...sample(),shiftId:'shift-99',expiresAt:Timestamp.fromMillis(1)}));
 const db=dbFor(uid),col=collection(db,'gpsHistory',uid,'shifts');
 await assertFails(getDoc(doc(col,'shift-99')));
 await assertFails(getDocs(col));
 await assertSucceeds(getDocs(query(col,where('expiresAt','>',Timestamp.fromMillis(Date.now())))));
});
test('削除済みマーカーのある履歴は再作成拒否',async()=>{
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'gpsHistoryTombstones',uid,'shifts','shift-101'),{deleted:true}));
 await assertFails(setDoc(doc(dbFor(uid),'gpsHistory',uid,'shifts','shift-101'),{...sample(),shiftId:'shift-101'}));
});
test('位置共有の公開Query・非公開・未登録・管理者を認可',async()=>{
 const db=dbFor(uid),p={public:true,onDuty:true,status:'空車',name:'合成テスト',lat:34,lon:135,accuracy:5,speed:null,heading:null,shiftId:'shift-100',capturedAtMs:Date.now(),updatedAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(db,'gpsPresence',uid),p));
 await assertSucceeds(getDocs(query(collection(dbFor(other),'gpsPresence'),where('public','==',true),where('onDuty','==',true))));
 await assertFails(getDocs(collection(dbFor(other),'gpsPresence')));
 await assertFails(getDoc(doc(dbFor('unregistered-123'),'gpsPresence',uid)));
 await assertSucceeds(setDoc(doc(db,'gpsPresence',uid),{...p,public:false,onDuty:false,lat:null,lon:null,accuracy:null,shiftId:'',capturedAtMs:null}));
 for(const id of [other,admin])await assertFails(getDoc(doc(dbFor(id),'gpsPresence',uid)));
});
test('既存の営業原本・編集セッション・UID分離を保護',async()=>{
 const db=dbFor(uid),session='s'.repeat(32);
 await assertSucceeds(setDoc(doc(db,'deviceSessions',uid),{sessionId:session,updatedAt:serverTimestamp()}));
 const ref=doc(db,'privateDuties',uid,'shifts','shift-200');
 const duty={format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:1,shift:{id:'shift-200',records:[],settings:{}},writerSessionId:session,updatedAt:serverTimestamp()};
 await assertSucceeds(setDoc(ref,duty));
 await assertFails(setDoc(ref,{...duty,revision:2,writerSessionId:'wrong'}));
 await assertSucceeds(setDoc(ref,{...duty,revision:2}));
 for(const id of [other,admin])await assertFails(getDoc(doc(dbFor(id),'privateDuties',uid,'shifts','shift-200')));
});
test('実Admin SDKで監査・削除トランザクション・CSV監査の冪等性と期限整理',async()=>{
 const assert=require('node:assert/strict');
 const {initializeApp,getApps}=require('firebase-admin/app');
 if(!getApps().length)initializeApp({projectId:'demo-taxiapp-gps'});
 const {getFirestore,Timestamp:AdminTimestamp}=require('firebase-admin/firestore');
 const db=getFirestore(),fn=require('../functions/gps-history-operations');
 const id='shift-700',path='gpsHistory/'+uid+'/shifts/'+id;
 const {prepare,sha256}=require('../gps-history-sync');
 const now=Date.now(),payload=prepare({uid,shiftId:id,startedAtMs:now-60000,endedAtMs:now-1000,
  points:[{lat:34,lon:135,accuracy:5,capturedAtMs:now-30000,segmentNo:1}]});
 const contentHash=await sha256(payload,require('node:crypto').webcrypto.subtle);
 const upload={auth:{uid},data:{payload,contentHash}};
 await fn.saveOwnGpsHistory.run(upload);await fn.saveOwnGpsHistory.run(upload);
 assert.equal((await db.doc(path).get()).get('contentHash'),contentHash);
 await assert.rejects(fn.saveOwnGpsHistory.run({...upload,data:{...upload.data,contentHash:'a'.repeat(64)}}),/ハッシュ/);
 const request={auth:{uid:admin},data:{targetUid:uid,shiftId:id}};
 const result=await fn.adminViewGpsHistory.run(request);assert.equal(result.points.length,1);
 assert.equal((await db.collection('gpsHistoryAudit').where('action','==','view').get()).size,1);
 await assert.rejects(fn.adminViewGpsHistory.run({...request,auth:{uid:other}}),/管理者権限/);
 const exportReq={auth:{uid},data:{operationId:'12345678-1234-1234-1234-123456789abc',shiftId:id,atMs:Date.now()}};
 await fn.recordOwnGpsCsvAudit.run(exportReq);await fn.recordOwnGpsCsvAudit.run(exportReq);
 assert.equal((await db.collection('gpsHistoryAudit').where('action','==','csv_export').get()).size,1);
 await fn.deleteGpsHistory.run({...request,data:{...request.data,confirmationShiftId:id}});
 assert.equal((await db.doc(path).get()).exists,false);
 await assert.rejects(fn.saveOwnGpsHistory.run(upload),/削除済み/);
 assert.equal((await db.doc('gpsHistoryTombstones/'+uid+'/shifts/'+id).get()).exists,true);
 await fn.cleanupGpsHistoryAndAudit.run({});
 assert.equal((await db.doc('gpsHistory/'+uid+'/shifts/shift-99').get()).exists,false);
 assert.equal((await db.doc('privateDuties/'+uid+'/shifts/shift-200').get()).exists,true);

});
test('実IndexedDB→Callable→Firestore読戻しで保存確定し、同一乗務の再送を照合',async()=>{
 require('fake-indexeddb/auto');
 const assert=require('node:assert/strict'),store=require('../gps-history-store');
 const sync=require('../gps-history-sync'),f=require('firebase/firestore');
 const fn=require('../functions/gps-history-operations');
 const {getFirestore}=require('firebase-admin/firestore');
 const now=Date.now(),id='shift-800';
 await store.record(uid,id,now-60000,{capturedAtMs:now-30000,lat:34,lon:135,accuracy:5,speed:0,heading:0});
 await store.finish(uid,id,now-1000);
 const client=sync.create({auth:{currentUser:{uid}},db:dbFor(uid),f,store,
  upload:data=>fn.saveOwnGpsHistory.run({auth:{uid},data})});
 assert.equal((await client.one(uid,id)).status,'saved');
 assert.equal((await store.fetchOne(uid,id)).serverStatus,'保存済み');
 await store.setSyncState(uid,id,'未送信');
 assert.equal((await client.one(uid,id)).status,'saved');
 assert.ok((await client.listRemote(uid)).some(row=>row.shiftId===id));
 client.dispose();
});
