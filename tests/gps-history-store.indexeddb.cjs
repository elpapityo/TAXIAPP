const {test}=require('node:test');const assert=require('node:assert/strict');
require('fake-indexeddb/auto');
const store=require('../gps-history-store');
const uid='driver',start=Date.now();
const point=t=>({capturedAtMs:start+t,lat:34,lon:135,accuracy:8,speed:null,heading:null});
test('同時書込で点列を失わず、OFF区間・入庫も原子的に記録',async()=>{
 const id='shift-100';
 await Promise.all([store.record(uid,id,start,point(0)),store.record(uid,id,start,point(30000))]);
 assert.equal((await store.fetchOne(uid,id)).points.length,2);
 await Promise.all([store.markGap(uid,id),store.record(uid,id,start,point(60000))]);
 let row=await store.fetchOne(uid,id);assert.equal(row.points[2].segmentNo,2);
 await store.finish(uid,id,start+90000);
 assert.equal(await store.record(uid,id,start,point(120000)),false);
 row=await store.fetchOne(uid,id);assert.equal(row.endedAtMs,start+90000);assert.equal(row.points.length,3);
});
test('未送信と他UIDは7日整理で消さず、削除後の遅延完了で復活しない',async()=>{
 await store.record(uid,'shift-200',start,point(0));
 await store.record('other','shift-201',start,point(0));
 await store.setSyncState('other','shift-201','保存済み',{savedAtMs:start-8*86400000});
 await store.cleanupConfirmed(uid,start);
 assert.ok(await store.fetchOne(uid,'shift-200'));assert.ok(await store.fetchOne('other','shift-201'));
 await store.remove(uid,'shift-200');await store.setSyncState(uid,'shift-200','保存済み');
 assert.equal(await store.fetchOne(uid,'shift-200'),undefined);
});
test('CSV未同期監査は端末履歴の一括削除でも残り、本人の確認成功後だけ消せる',async()=>{
 await store.record(uid,'shift-300',start,point(0));
 await store.setSyncState(uid,'shift-300','保存済み',{savedAtMs:start});
 await store.record(uid,'shift-301',start,point(0));
 const audit=await store.queueCsvAudit(uid,'shift-300');
 await store.removeConfirmed(uid);
 assert.equal(await store.fetchOne(uid,'shift-300'),undefined);
 assert.ok(await store.fetchOne(uid,'shift-301'));
 assert.equal((await store.pendingAudits(uid)).length,1);
 await store.confirmAudit(uid,audit.operationId);assert.equal((await store.pendingAudits(uid)).length,0);
});
