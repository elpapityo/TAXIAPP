const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto'),sync=require('../gps-history-sync'),adapter=require('../gps-history-gas-adapter');
function fixture(){
 const user=uid=>({uid,emailVerified:true,providerData:[{providerId:'google.com',uid:'subject'}]});
 const diaryAuth={app:{options:{projectId:'taxiapp-2b6bd'}},currentUser:user('diary-user')},gpsAuth={app:{options:{projectId:'taxigps-9f82e'}},currentUser:user('gps-user')};
 const now=Date.now(),row={uid:'diary-user',shiftId:'shift-123',startedAtMs:now-60000,endedAtMs:now-1000,serverStatus:'未送信',points:[{capturedAtMs:now-30000,lat:34,lon:135,accuracy:5,segmentNo:1}]};
 const rows=new Map([[row.shiftId,structuredClone(row)]]),cloud=new Map(),tombs=new Set(),calls=[],writes=[];
 const state={fail:null,wrongUid:false,badPoints:false,beforeResponse:null};
 const store={async fetchOne(uid,id){assert.equal(uid,'diary-user');return rows.get(id)||null;},async list(uid){assert.equal(uid,'diary-user');return [...rows.values()];},async setSyncState(uid,id,status,extra){assert.equal(uid,'diary-user');writes.push(status);rows.set(id,{...rows.get(id),serverStatus:status,...extra});}};
 const client={async call(action,data){
  calls.push({action,data});if(state.fail)throw Object.assign(Error(state.fail),{code:state.fail});let result;
  if(action==='getOwnGpsHistoryTombstone')result={deleted:tombs.has(data.shiftId)};
  if(action==='getOwnGpsHistory'){
   if(!cloud.has(data.shiftId))throw Object.assign(Error('not-found'),{code:'not-found'});
   const history=structuredClone(cloud.get(data.shiftId));if(state.wrongUid)history.uid='other';if(state.badPoints)history.points[0].lat=1;result={history};
  }
  if(action==='saveOwnGpsHistory'){
   cloud.set(data.payload.shiftId,{...structuredClone(data.payload),uid:'gps-user',contentHash:data.contentHash,expiresAt:Date.now()+60000});result={status:'saved',shiftId:data.payload.shiftId,contentHash:data.contentHash};
  }
  if(action==='listOwnGpsHistory')result={targetUid:'gps-user',shifts:[...cloud.values()].map(r=>({shiftId:r.shiftId,startedAtMs:r.startedAtMs,endedAtMs:r.endedAtMs}))};
  if(action==='deleteGpsHistory'){cloud.delete(data.shiftId);tombs.add(data.shiftId);result={targetUid:'gps-user',shiftId:data.shiftId,status:'deleted'};}
  if(action==='recordOwnGpsCsvAudit')result={operationId:data.operationId,status:'saved'};
  await state.beforeResponse?.(action);return result;
 }};
 const remote=adapter.create({diaryAuth,gpsAuth,client,subtle:webcrypto.subtle});
 const session=sync.createGas({diaryAuth,gpsAuth,client,store,subtle:webcrypto.subtle});
 return {diaryAuth,gpsAuth,client,remote,session,store,row,rows,cloud,tombs,calls,state,writes};
}
test('GAS同期：端末は日報UID、クラウドはGPS UIDで保存/読戻し。初期化だけでは通信しない',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.session.localUid,'diary-user');assert.equal(f.session.cloudUid,'gps-user');
 assert.equal((await f.session.one('diary-user','shift-123')).status,'saved');
 assert.equal(f.rows.get('shift-123').uid,'diary-user');assert.equal(f.cloud.get('shift-123').uid,'gps-user');
 assert.deepEqual(f.calls.map(c=>c.action),['getOwnGpsHistoryTombstone','getOwnGpsHistory','saveOwnGpsHistory','getOwnGpsHistory']);
 const row=await f.session.readRemote('diary-user','shift-123');assert.equal(row.uid,'diary-user');assert.equal(row.cloudUid,'gps-user');assert.equal(row.points.length,1);
});
test('GAS同期：一覧はメタデータだけ。選択した1乗務の座標だけ取得',async()=>{
 const f=fixture();await f.session.one('diary-user','shift-123');f.calls.length=0;
 const list=await f.session.listRemote('diary-user');assert.equal(list[0].metadataOnly,true);assert.equal(list[0].points.length,0);assert.deepEqual(f.calls.map(c=>c.action),['listOwnGpsHistory']);
 await f.session.readRemote('diary-user',list[0].shiftId);assert.equal(f.calls.length,2);
});
test('GAS同期：誤UID/改ざん点列/権限エラーでは保存済みにせず端末原本を保持',async()=>{
 for(const kind of ['wrongUid','badPoints','fail']){
  const f=fixture();f.state[kind]=kind==='fail'?'permission-denied':true;
  const r=await f.session.one('diary-user','shift-123');assert.equal(r.status,'error');assert.equal(f.rows.get('shift-123').serverStatus,'エラー');assert.deepEqual(f.rows.get('shift-123').points,f.row.points);
 }
});
test('GAS同期：削除済みは再送せず、GPS UIDを端末所有者として扱わない',async()=>{
 const f=fixture();f.tombs.add('shift-123');assert.equal((await f.session.one('diary-user','shift-123')).status,'deleted');assert.equal(f.cloud.size,0);
 await assert.rejects(f.session.one('gps-user','shift-123'));await assert.rejects(f.remote.get('other','shift-123'));assert.equal(f.calls.length,1);
});
test('GAS同期：取得中のどちらかのログイン切替で結果を破棄、別の利用者へ送らない',async()=>{
 const f=fixture();f.state.beforeResponse=()=>{f.gpsAuth.currentUser={...f.gpsAuth.currentUser};};
 assert.equal((await f.session.one('diary-user','shift-123')).status,'error');assert.equal(f.calls.length,1);assert.equal(f.cloud.size,0);assert.equal(f.writes.includes('保存済み'),false);
});
test('GAS同期：破損した端末行の他UIDを送信しない・Firestoreへの代替接続を行わない',async()=>{
 const f=fixture();f.rows.set('shift-123',{...f.row,uid:'other'});await assert.rejects(f.session.one('diary-user','shift-123'),/所有者/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
test('GAS同期：本人削除/CSV監査も日報UIDからGPS所有者へ対応し、別人監査は拒否',async()=>{
 const f=fixture();await f.session.one('diary-user','shift-123');
 await f.session.removeRemote('diary-user','shift-123','shift-123');assert.equal(f.cloud.size,0);assert.ok(f.tombs.has('shift-123'));
 const row={uid:'diary-user',operationId:'12345678-1234-1234-1234-123456789abc',shiftId:'shift-123',atMs:Date.now()};
 assert.equal((await f.session.recordCsvAudit('diary-user',row)).status,'saved');
 await assert.rejects(f.session.recordCsvAudit('diary-user',{...row,uid:'other'}));
 f.session.dispose();await assert.rejects(f.session.listRemote('diary-user'));
});

test('GAS一括送信：最初の通信/資格エラーで停止し、残りの端末履歴を未送信のまま保護',async()=>{
 const f=fixture();f.rows.set('shift-124',{...structuredClone(f.row),shiftId:'shift-124'});f.state.fail='permission-denied';
 const r=await f.session.all('diary-user');assert.equal(r.length,1);assert.equal(r[0].status,'error');assert.equal(f.calls.length,1);
 assert.equal(f.rows.get('shift-124').serverStatus,'未送信');assert.equal(f.rows.get('shift-124').points.length,1);
});

test('管理者GAS：利用者一覧は許可項目だけ・閲覧ハッシュ/期限・削除対象確認・本人切替を検証',async()=>{
 const f=fixture(),remote=f.remote;
 const payload=sync.prepare({...f.row,uid:'target'}),hash=await sync.sha256(payload,webcrypto.subtle);
 let response={users:[{uid:'target',name:'合成利用者',status:'active',diaryUid:'secret'}],nextAfterUid:null};
 f.client.call=async()=>structuredClone(response);
 assert.deepEqual(await remote.admin('adminListGpsHistoryUsers',{}),{users:[{uid:'target',name:'合成利用者',status:'active'}],nextAfterUid:null});
 response={...payload,targetUid:'target',contentHash:hash,source:'admin_server_audited'};
 assert.equal((await remote.admin('adminViewGpsHistory',{targetUid:'target',shiftId:payload.shiftId})).points.length,1);
 response.points[0].lat=1;await assert.rejects(remote.admin('adminViewGpsHistory',{targetUid:'target',shiftId:payload.shiftId}),/内容/);
 await assert.rejects(remote.admin('deleteGpsHistory',{targetUid:'target',shiftId:payload.shiftId,confirmationShiftId:'shift-999'}),/削除対象/);
 response={targetUid:'wrong',shiftId:payload.shiftId,status:'deleted'};await assert.rejects(remote.admin('deleteGpsHistory',{targetUid:'target',shiftId:payload.shiftId,confirmationShiftId:payload.shiftId}),/確認/);
 f.client.call=async()=>{f.gpsAuth.currentUser={...f.gpsAuth.currentUser};return {users:[],nextAfterUid:null};};await assert.rejects(remote.admin('adminListGpsHistoryUsers',{}),/切り替わり/);
});
