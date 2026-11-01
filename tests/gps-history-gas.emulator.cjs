// 新履歴GAS候補を実Firestore REST Emulatorで検証。Google本人認証だけは合成。
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const code=fs.readFileSync(path.join(__dirname,'../google-apps-script/gps-account-broker/history/Code.candidate.gs'),'utf8');
const validation=require('../functions/gps-history-validation');
const prefix='https://firestore.googleapis.com/v1/projects/taxigps-9f82e/databases/(default)/documents';
function fixture({archive=false,manager=false,presence=false}={}){
 const calls=[],state={auditFails:false,sourceSuspended:false,sourceDemoted:false,loseResponse:false,auditReadFails:false,suspendOnAudit:false,writerSession:'w'.repeat(32),sourceReadonly:false,diaryReads:0,writerReads:0,sourceReads:0,changeWriterOnRead:false};
 const c=vm.createContext({Date,TextEncoder,console:{log(){throw Error('非公開データをログしない');}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
 Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
  computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],
  newBlob:text=>({getBytes:()=>[...Buffer.from(text)]})},
 ScriptApp:{getOAuthToken:()=> 'owner'},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 UrlFetchApp:{fetch:(url,req)=>{
  assert.ok(url.startsWith(prefix),url);assert.equal(req.headers.Authorization,'Bearer owner');
  calls.push({url,body:req.payload?JSON.parse(req.payload):null});
  if(process.env.GPS_GAS_TRACE==='1')console.error(req.method,url.replace(prefix,'').split('?')[0]);
  const body=req.payload?JSON.parse(req.payload):null;
  if(state.auditFails&&body?.writes?.some(w=>w.update?.name.includes('/gpsHistoryAudit/')))
   return {getResponseCode:()=>403,getContentText:()=>'{"error":{}}'};
  if(state.auditReadFails&&req.method==='get'&&url.includes('/gpsHistoryAudit/'))return {getResponseCode:()=>503,getContentText:()=>'{"error":{}}'};
  const mapped=url.replace('https://firestore.googleapis.com','http://'+process.env.FIRESTORE_EMULATOR_HOST).replace('projects/taxigps-9f82e/','projects/demo-taxiapp-gps/');
  // URL以外のリソース名も、試験用demoプロジェクトへだけ置換する。
  const args=['--silent','--show-error','--noproxy','*','--max-time','8','-X',req.method.toUpperCase(),'-H','Authorization: Bearer owner','-H','Content-Type: application/json','-w','\n%{http_code}',mapped];
  if(req.payload)args.push('--data-binary','@-');
  const output=execFileSync('curl',args,{input:req.payload?.replaceAll('projects/taxigps-9f82e/','projects/demo-taxiapp-gps/'),encoding:'utf8',maxBuffer:5000000});
  const split=output.lastIndexOf('\n'),status=Number(output.slice(split+1)),text=output.slice(0,split).replaceAll('projects/demo-taxiapp-gps/','projects/taxigps-9f82e/');
  if(state.suspendOnAudit&&url.endsWith(':commit')&&status===200&&body?.writes?.some(w=>w.update?.name.includes('/gpsHistoryAudit/')))state.sourceSuspended=true;
  if(state.loseResponse&&url.endsWith(':commit')&&status===200){state.loseResponse=false;throw Error('合成の応答消失');}
  return {getResponseCode:()=>status,getContentText:()=>text};
 }}});
 vm.runInContext(presence?fs.readFileSync(path.join(__dirname,'../google-apps-script/gps-account-broker/history/Code.presence-candidate.gs'),'utf8'):manager?fs.readFileSync(path.join(__dirname,'../google-apps-script/gps-account-broker/history/Code.manager-candidate.gs'),'utf8'):archive?fs.readFileSync(path.join(__dirname,'../google-apps-script/gps-account-broker/history/Code.archive-candidate.gs'),'utf8'):code,c);if(!archive)c.GPS_HISTORY_TRIAL_ONLY_=false; // 全機能の実REST回帰は試験環境だけで解除。
 c.gpsBridgeVerified_=(project,token)=>{
  const [kind,id]=String(token).split(':');if(kind!==(project===c.GPS_BRIDGE_DIARY_?'d':'g')||!id)throw Object.assign(Error('unauthenticated'),{gpsCode:'unauthenticated'});
  return {uid:(kind==='d'?'diary-':'')+id,subject:'subject-'+id,email:id+'@example.invalid'};
 };
 c.gpsBridgeSource_=(source,request,writer)=>{state.diaryReads+=writer===null?2:3;state.sourceReads+=writer===null?2:3;return {editor:!state.sourceReadonly&&writer===state.writerSession,eligible:!state.sourceSuspended,isAdmin:source.uid==='diary-admin-12345678'&&!state.sourceDemoted,name:'合成利用者'};};
 const originalRead=c.gpsBridgeRead_;
 c.gpsBridgeRead_=(project,p,token)=>{
  if(project!==c.GPS_BRIDGE_DIARY_)return originalRead(project,p,token);
  assert.match(p,/^deviceSessions\/diary-/);assert.ok(String(token).startsWith('d:'));
  state.diaryReads++;state.writerReads++;
  if(state.changeWriterOnRead){state.changeWriterOnRead=false;state.writerSession='changed-writer-session'.padEnd(32,'x');}
  return {fields:{sessionId:{stringValue:state.sourceReadonly?'readonly':state.writerSession}}};
 };
 const auth={ownerToken:'owner'};
 function seed(uid){
  const name=c.gpsBridgeName_(c.GPS_BRIDGE_GPS_,'users/'+uid),fields={status:{stringValue:'active'},diaryUid:{stringValue:'diary-'+uid},googleSubject:{stringValue:'subject-'+uid},accessExpiresAt:{timestampValue:new Date(Date.now()+300000).toISOString()}};
  c.gpsBridgeRequest_(prefix+':commit','post','owner',{writes:[{update:{name,fields}}]});
 }
 function post(action,data={},actor='driver-12345678',extra={}){
  return JSON.parse(c.doPost({postData:{contents:JSON.stringify({action,actorUid:actor,diaryIdToken:'d:'+actor,gpsIdToken:'g:'+actor,data,...extra})}}).text);
 }
 function read(p){return c.gpsHistoryData_(c.gpsHistoryRead_(p,auth));}
 function rawCommit(writes){return c.gpsBridgeRequest_(prefix+':commit','post','owner',{writes});}
 return {c,calls,state,post,read,seed,rawCommit,auth};
}
function sample(id){const now=Date.now();const payload=validation.prepare({uid:'synthetic',shiftId:id,startedAtMs:now-60000,endedAtMs:now-1000,points:[{capturedAtMs:now-30000,lat:34.5,lon:135.5,accuracy:5,segmentNo:1}]});return {payload,contentHash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')};}
test('実REST：保存/同一再送/本人読戻し/別人拒否/監査先行の管理者閲覧とCSV',()=>{
 const f=fixture();for(const uid of ['driver-12345678','other-12345678','admin-12345678'])f.seed(uid);
 const data=sample('shift-8100');let result=f.post('saveOwnGpsHistory',data);assert.equal(result.ok,true,JSON.stringify({result,paths:f.calls.slice(-8).map(x=>x.url.replace(prefix,'').split('?')[0])}));assert.equal(result.data.history.points.length,1);
 result=f.post('saveOwnGpsHistory',data);assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(f.post('getOwnGpsHistory',{shiftId:'shift-8100'}).ok,true);
 assert.equal(f.post('getOwnGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8100'},'other-12345678').code,'permission-denied');
 assert.equal(f.post('adminViewGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8100'}).code,'permission-denied');
 f.state.auditFails=true;
 result=f.post('adminViewGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8100'},'admin-12345678');assert.equal(result.ok,false);assert.equal(JSON.stringify(result).includes('points'),false);
 f.state.auditFails=false;
 result=f.post('adminViewGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8100'},'admin-12345678');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.points.length,1);
 result=f.post('adminExportGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8100'},'admin-12345678');assert.equal(result.code,'failed-precondition');
 result=f.post('adminExportGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8100',confirmedExport:true},'admin-12345678');assert.equal(result.ok,true,JSON.stringify(result));
 result=f.post('adminListGpsHistoryAudit',{},'admin-12345678');assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.data.entries.some(r=>r.action==='view'));assert.ok(result.data.entries.some(r=>r.action==='csv_export'));
 result=f.post('adminListGpsHistory',{targetUid:'driver-12345678'},'admin-12345678');assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.data.shifts.some(s=>s.shiftId==='shift-8100'));assert.equal(JSON.stringify(result).includes('lat'),false);
});
test('実REST：監査と墓標と削除を原子的に保存・応答消失の再送・削除済み再アップロード拒否',()=>{
 const f=fixture();f.seed('driver-12345678');const data=sample('shift-8200');
 assert.equal(f.post('saveOwnGpsHistory',data).ok,true);f.state.auditFails=true;
 let r=f.post('deleteGpsHistory',{shiftId:'shift-8200',confirmationShiftId:'shift-8200'});assert.equal(r.ok,false);
 assert.ok(f.read('gpsHistory/driver-12345678/shifts/shift-8200'));assert.equal(f.read('gpsHistoryTombstones/driver-12345678/shifts/shift-8200'),null);
 f.state.auditFails=false;f.state.loseResponse=true;
 r=f.post('deleteGpsHistory',{shiftId:'shift-8200',confirmationShiftId:'shift-8200'});assert.equal(r.ok,false);
 r=f.post('deleteGpsHistory',{shiftId:'shift-8200',confirmationShiftId:'shift-8200'});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.status,'already-deleted');
 assert.equal(f.read('gpsHistory/driver-12345678/shifts/shift-8200'),null);
 assert.equal(f.post('saveOwnGpsHistory',data).code,'failed-precondition');
 assert.equal(f.post('getOwnGpsHistoryTombstone',{shiftId:'shift-8200'}).data.deleted,true);
});
test('実REST：本人CSV監査の冪等性・ID競合・停止/降格/期限切れ/actor取り違えを拒否',()=>{
 const f=fixture();f.seed('driver-12345678');f.seed('admin-12345678');
 const data={operationId:crypto.randomUUID(),shiftId:'shift-8300',atMs:Date.now()-1000};
 assert.equal(f.post('recordOwnGpsCsvAudit',data).ok,true);assert.equal(f.post('recordOwnGpsCsvAudit',data).ok,true);
 assert.equal(f.post('recordOwnGpsCsvAudit',{...data,atMs:data.atMs-1}).code,'already-exists');
 assert.equal(f.post('listOwnGpsHistory',{},'driver-12345678',{actorUid:'other-12345678'}).code,'failed-precondition');
 f.state.sourceSuspended=true;assert.equal(f.post('listOwnGpsHistory').code,'permission-denied');f.state.sourceSuspended=false;
 f.state.sourceDemoted=true;assert.equal(f.post('adminListGpsHistoryAudit',{},'admin-12345678').code,'permission-denied');
 const name=f.c.gpsBridgeName_(f.c.GPS_BRIDGE_GPS_,'users/driver-12345678');
 f.rawCommit([{update:{name,fields:{accessExpiresAt:{timestampValue:new Date(1).toISOString()}}},updateMask:{fieldPaths:['accessExpiresAt']}}]);
 assert.equal(f.post('listOwnGpsHistory').code,'permission-denied');
});
test('実REST：ハッシュ不一致/期限切れ/既存履歴の上書き/別Google本人/不正経路を拒否',()=>{
 const f=fixture();f.seed('driver-12345678');const data=sample('shift-8400');
 assert.equal(f.post('saveOwnGpsHistory',{...data,contentHash:'0'.repeat(64)}).code,'invalid-argument');
 assert.equal(f.post('saveOwnGpsHistory',data).ok,true);
 const changed={...data.payload,points:[{...data.payload.points[0],lat:35}]},hash=crypto.createHash('sha256').update(JSON.stringify(changed)).digest('hex');
 assert.equal(f.post('saveOwnGpsHistory',{payload:changed,contentHash:hash}).code,'already-exists');
 assert.equal(f.post('getOwnGpsHistory',{shiftId:'../privateDuties'}).code,'invalid-argument');
 assert.equal(f.post('listOwnGpsHistory',{},'driver-12345678',{gpsIdToken:'g:other-12345678'}).code,'account-mismatch');
 const name=f.c.gpsHistoryName_('gpsHistory/driver-12345678/shifts/shift-8400');
 f.rawCommit([{update:{name,fields:{expiresAt:{timestampValue:new Date(1).toISOString()}}},updateMask:{fieldPaths:['expiresAt']}}]);
 assert.equal(f.post('getOwnGpsHistory',{shiftId:'shift-8400'}).code,'not-found');
 assert.equal(f.post('listOwnGpsHistory').data.shifts.some(s=>s.shiftId==='shift-8400'),false);
 for(const call of f.calls)assert.ok(call.url.startsWith(prefix));
});

test('実REST：期限整理はGPS期限切れ履歴/監査だけを削除し、墓標/有効履歴/別領域を保護',()=>{
 const f=fixture(),base='projects/taxigps-9f82e/databases/(default)/documents/';
 f.rawCommit([{update:{name:base+'gpsHistoryAudit/expired-synthetic',fields:{expiresAt:{timestampValue:new Date(1).toISOString()}}}},
  {update:{name:base+'privateDuties/driver-12345678/shifts/shift-1',fields:{sentinel:{stringValue:'保護対象'}}}}]);
 assert.equal(f.post('cleanupGpsHistoryAndAudit').code,'invalid-argument');
 const result=f.c.cleanupGpsHistoryAndAudit();assert.ok(result.expired>=1);assert.ok(result.logs>=1);assert.equal(result.complete,true);
 assert.equal(f.read('gpsHistory/driver-12345678/shifts/shift-8400'),null);
 assert.ok(f.read('gpsHistory/driver-12345678/shifts/shift-8100'));
 assert.ok(f.read('gpsHistoryTombstones/driver-12345678/shifts/shift-8200'));
 const protectedDoc=f.c.gpsBridgeRequest_(prefix+'/privateDuties/driver-12345678/shifts/shift-1','get','owner');
 assert.equal(protectedDoc.fields.sentinel.stringValue,'保護対象');
});

test('実REST：監査読戻し失敗/監査保存中の資格停止では座標を返さない',()=>{
 const f=fixture();f.seed('driver-12345678');f.seed('admin-12345678');assert.equal(f.post('saveOwnGpsHistory',sample('shift-8500')).ok,true);
 f.state.auditReadFails=true;
 let r=f.post('adminViewGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8500'},'admin-12345678');
 assert.equal(r.ok,false);assert.equal(JSON.stringify(r).includes('points'),false);
 f.state.auditReadFails=false;f.state.suspendOnAudit=true;
 r=f.post('adminViewGpsHistory',{targetUid:'driver-12345678',shiftId:'shift-8500'},'admin-12345678');
 assert.equal(r.code,'permission-denied');assert.equal(JSON.stringify(r).includes('points'),false);
});
test('実REST：13時間30秒間隔の1560点を共有検証/ハッシュ/保存読戻しで確認',()=>{
 const f=fixture();f.seed('driver-12345678');const end=Date.now()-1000,start=end-13*3600000;
 const payload=validation.prepare({uid:'synthetic',shiftId:'shift-8600',startedAtMs:start,endedAtMs:end,
  points:Array.from({length:1560},(_,i)=>({capturedAtMs:start+(i+1)*30000,lat:34.5+i/100000,lon:135.5,accuracy:5,segmentNo:1}))});
 const contentHash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const r=f.post('saveOwnGpsHistory',{payload,contentHash});assert.equal(r.ok,true,JSON.stringify(r).slice(0,150));assert.equal(r.data.history.points.length,1560);
});

test('公開候補の合成限定：実履歴/実座標/整理実行を拒否、固定0地点だけ保存可能',()=>{
 const f=fixture();f.seed('driver-12345678');f.c.GPS_HISTORY_TRIAL_ONLY_=true;
 assert.equal(f.post('saveOwnGpsHistory',sample('shift-8700')).code,'failed-precondition');
 const id='shift-8700-gastrial'+crypto.randomUUID().replaceAll('-','');const d=sample(id);
 assert.equal(f.post('saveOwnGpsHistory',d).code,'failed-precondition');
 const payload={...d.payload,points:[{...d.payload.points[0],lat:0,lon:0,accuracy:1}]},contentHash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const r=f.post('saveOwnGpsHistory',{payload,contentHash});assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(f.post('getOwnGpsHistory',{shiftId:'shift-8100'}).code,'failed-precondition');
 assert.throws(()=>f.c.cleanupGpsHistoryAndAudit());
 assert.equal(f.post('deleteGpsHistory',{shiftId:id,confirmationShiftId:id}).ok,true);
});

test('通常アーカイブ候補：非0地点の履歴を保存・照合・削除できるが、整理実行は常時拒否',()=>{
 const f=fixture({archive:true});f.seed('driver-12345678');
 const health=JSON.parse(f.c.doGet().text);assert.equal(health.revision,'history-v4-archive');assert.equal(health.historyTrialOnly,false);
 const data=sample('shift-8900');assert.equal(f.post('saveOwnGpsHistory',data).ok,true);
 assert.equal(f.post('getOwnGpsHistory',{shiftId:'shift-8900'}).data.history.points[0].lat,34.5);
 assert.throws(()=>f.c.cleanupGpsHistoryAndAudit());
 assert.equal(f.post('deleteGpsHistory',{shiftId:'shift-8900',confirmationShiftId:'shift-8900'}).ok,true);
});

test('通常アーカイブ結合：実IndexedDB互換→日報/GPS別UIDの実クライアント→GAS→実REST保存照合削除',async()=>{
 const f=fixture({archive:true});f.seed('driver-12345678');
 const {indexedDB}=require('fake-indexeddb');global.indexedDB=indexedDB;
 const store=require('../gps-history-store'),sync=require('../gps-history-sync'),bridge=require('../gps-account-bridge'),{webcrypto}=require('node:crypto');
 const user=(uid,token)=>({uid,emailVerified:true,providerData:[{providerId:'google.com',uid:'subject-driver-12345678'}],getIdToken:async()=>token});
 const diaryAuth={app:{options:{projectId:bridge.DIARY_PROJECT}},currentUser:user('diary-driver-12345678','d:driver-12345678')};
 const gpsAuth={app:{options:{projectId:bridge.GPS_PROJECT}},currentUser:user('driver-12345678','g:driver-12345678')};
 const client=bridge.create({diaryAuth,gpsAuth,endpoint:'https://script.google.com/macros/s/mock-history/exec',fetch:async(url,options)=>{
  assert.equal(options.credentials,'omit');assert.equal(url.includes('token'),false);
  const result=JSON.parse(f.c.doPost({postData:{contents:options.body}}).text);return {ok:true,json:async()=>result};
 }});
 const session=sync.createGas({diaryAuth,gpsAuth,client,store,subtle:webcrypto.subtle}),uid=diaryAuth.currentUser.uid,id='shift-9000',now=Date.now();
 await store.record(uid,id,now-60000,{capturedAtMs:now-30000,lat:34.5,lon:135.5,accuracy:5,segmentNo:1});await store.finish(uid,id,now-1000);
 assert.equal((await session.one(uid,id)).status,'saved');
 assert.equal((await store.fetchOne(uid,id)).uid,uid);assert.equal(f.read('gpsHistory/driver-12345678/shifts/'+id).uid,'driver-12345678');
 assert.equal((await session.listRemote(uid)).some(r=>r.shiftId===id&&r.uid===uid&&r.cloudUid==='driver-12345678'),true);
 assert.equal((await session.readRemote(uid,id)).points[0].lat,34.5);
 await session.removeRemote(uid,id,id);assert.equal(f.read('gpsHistory/driver-12345678/shifts/'+id),null);
 await store.setSyncState(uid,id,'未送信');assert.equal((await session.one(uid,id)).status,'deleted');assert.equal((await store.fetchOne(uid,id)).points.length,1);
 session.dispose();client.dispose();
});

test('実REST：管理者だけ利用者40名ずつ取得・続き重複なし・内部資格/座標を返さず降格を拒否',()=>{
 const f=fixture({manager:true});f.seed('admin-12345678');f.seed('driver-12345678');
 const names=[];
 for(let i=0;i<42;i++){
  const uid='paged-user-'+String(i).padStart(3,'0');names.push(uid);
  const name=f.c.gpsBridgeName_(f.c.GPS_BRIDGE_GPS_,'users/'+uid);
  f.rawCommit([{update:{name,fields:{openChatName:{stringValue:'合成'+i},status:{stringValue:'active'},diaryUid:{stringValue:'private-diary'},googleSubject:{stringValue:'private-subject'},email:{stringValue:'private@example.invalid'}}}}]);
 }
 assert.equal(f.post('adminListGpsHistoryUsers').code,'permission-denied');
 const first=f.post('adminListGpsHistoryUsers',{},'admin-12345678');assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.data.users.length,40);
 const second=f.post('adminListGpsHistoryUsers',{afterUid:first.data.nextAfterUid},'admin-12345678');assert.equal(second.ok,true,JSON.stringify(second));assert.equal(second.data.nextAfterUid,null);
 const all=[...first.data.users,...second.data.users];assert.equal(new Set(all.map(u=>u.uid)).size,all.length);
 for(const name of names)assert.ok(all.some(u=>u.uid===name));
 assert.equal(JSON.stringify(first).includes('private'),false);assert.equal(JSON.stringify(first).includes('points'),false);
 assert.ok(f.calls.some(c=>c.body?.structuredQuery?.select?.fields?.length===2));
 assert.equal(f.post('adminListGpsHistoryUsers',{afterUid:'../users'},'admin-12345678').code,'invalid-argument');
 f.state.sourceDemoted=true;assert.equal(f.post('adminListGpsHistoryUsers',{},'admin-12345678').code,'permission-denied');
});

test('実REST：現在地GASの操作端末/送信元排他・公開CAS・本人だけ送信・停止で座標を消去',()=>{
 const f=fixture({presence:true});for(const uid of ['driver-12345678','viewer-12345678'])f.seed(uid);
 const writerSessionId=f.state.writerSession,a=crypto.randomUUID(),b=crypto.randomUUID(),post=(action,data={})=>f.post(action,{writerSessionId,...data});
 const payload={public:true,onDuty:true,status:'空車',shiftId:'shift-9001',lat:34.5,lon:135.5,accuracy:5,capturedAtMs:Date.now()-1000,name:'偽の名前'};
 assert.equal(post('acquireGpsSender',{senderId:a}).data.status,'claimed');assert.equal(post('acquireGpsSender',{senderId:b}).data.status,'standby');
 assert.equal(post('sendGpsPresence',{senderId:a,payload}).code,'failed-precondition');
 const operationId=crypto.randomUUID();let r=post('setOwnGpsSharePrefs',{public:true,baseRevision:0,operationId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.preference.revision,1);
 assert.equal(post('setOwnGpsSharePrefs',{public:true,baseRevision:0,operationId}).ok,true);
 assert.equal(post('setOwnGpsSharePrefs',{public:false,baseRevision:0,operationId:crypto.randomUUID()}).code,'already-exists');
 assert.equal(post('sendGpsPresence',{senderId:a,payload,targetUid:'viewer-12345678'}).data.status,'sent');
 r=f.post('listGpsPresence',{},'viewer-12345678');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.vehicles.length,1);assert.equal(r.data.vehicles[0].uid,'driver-12345678');assert.notEqual(r.data.vehicles[0].name,'偽の名前');assert.equal(JSON.stringify(r).includes('writerSessionId'),false);
 f.state.sourceReadonly=true;assert.equal(post('acquireGpsSender',{senderId:b}).code,'permission-denied');assert.equal(f.post('listGpsPresence',{},'viewer-12345678').ok,true);f.state.sourceReadonly=false;
 r=post('setOwnGpsSharePrefs',{public:false,baseRevision:1,operationId:crypto.randomUUID()});assert.equal(r.ok,true,JSON.stringify(r));
 const closed=f.c.gpsHistoryData_(f.c.gpsPresenceRead_('gpsPresence/driver-12345678',f.auth));assert.equal(closed.lat,null);assert.equal(closed.lon,null);assert.equal(f.c.gpsPresenceRead_('gpsSenderSessions/driver-12345678',f.auth),null);assert.equal(f.post('listGpsPresence').data.vehicles.length,0);
});
test('実REST：現在地GASの期限後送信元交代・旧端末の停止拒否・不正点・5分非表示',()=>{
 const f=fixture({presence:true});f.seed('driver-moving-12345678');const w=f.state.writerSession,a=crypto.randomUUID(),b=crypto.randomUUID();
 const post=(action,data={})=>f.post(action,{writerSessionId:w,...data},'driver-moving-12345678');
 const payload={public:true,onDuty:true,status:'実車',shiftId:'shift-9002',lat:34.5,lon:135.5,accuracy:5,capturedAtMs:Date.now()-1000};
 const initialized=post('setOwnGpsSharePrefs',{public:true,baseRevision:0,operationId:crypto.randomUUID()});assert.equal(initialized.ok,true,JSON.stringify(initialized));assert.equal(post('acquireGpsSender',{senderId:a}).ok,true);
 assert.equal(post('sendGpsPresence',{senderId:a,payload:{...payload,lat:91}}).code,'invalid-argument');
 const name=f.c.gpsPresenceName_('gpsSenderSessions/driver-moving-12345678');f.rawCommit([{update:{name,fields:{updatedAt:{timestampValue:new Date(Date.now()-121000).toISOString()}}},updateMask:{fieldPaths:['updatedAt']}}]);
 assert.equal(post('acquireGpsSender',{senderId:b}).data.status,'claimed');assert.equal(post('sendGpsPresence',{senderId:a,payload}).data.status,'not-sender');assert.equal(post('stopGpsPresence',{senderId:a}).data.stopped,false);
 assert.equal(post('sendGpsPresence',{senderId:b,payload}).data.status,'sent');
 const presenceName=f.c.gpsPresenceName_('gpsPresence/driver-moving-12345678');f.rawCommit([{update:{name:presenceName,fields:{updatedAt:{timestampValue:new Date(Date.now()-300001).toISOString()}}},updateMask:{fieldPaths:['updatedAt']}}]);
 assert.equal(post('listGpsPresence').data.vehicles.length,0);
 f.state.writerSession='n'.repeat(32);assert.equal(post('stopGpsPresence',{senderId:b}).code,'permission-denied');
 assert.equal(post('acquireGpsSender',{writerSessionId:f.state.writerSession,senderId:a}).data.status,'claimed');assert.equal(post('stopGpsPresence',{writerSessionId:f.state.writerSession,senderId:a}).data.stopped,true);
 assert.equal(f.c.gpsHistoryData_(f.c.gpsPresenceRead_('gpsPresence/driver-moving-12345678',f.auth)).public,false);
});

test('実クライアント→GAS→実REST：現在地送信元と既存公開設定をUID分離して接続',async()=>{
 const f=fixture({presence:true}),actor='driver-client-12345678';f.seed(actor);
 const account=require('../gps-account-bridge'),presence=require('../gps-presence-gas-adapter'),prefs=require('../gps-sharing-preferences');
 const user=(uid,kind)=>({uid,emailVerified:true,providerData:[{providerId:'google.com',uid:'same-subject'}],getIdToken:async()=>kind+':'+actor});
 const diaryAuth={app:{options:{projectId:'taxiapp-2b6bd'}},currentUser:user('diary-'+actor,'d')},gpsAuth={app:{options:{projectId:'taxigps-9f82e'}},currentUser:user(actor,'g')};
 const client=account.create({diaryAuth,gpsAuth,endpoint:'https://script.google.com/macros/s/synthetic-presence-test/exec',fetch:async(url,options)=>({ok:true,json:async()=>JSON.parse(f.c.doPost({postData:{contents:options.body}}).text)})});
 const sender=presence.createSender({diaryAuth,gpsAuth,client,session:{canWrite:()=>true,sessionId:()=>f.state.writerSession},senderId:crypto.randomUUID()});
 const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const preference=prefs.create({uid:'diary-'+actor,storage,read:sender.readPreference,write:(value,op)=>sender.writePreference(value,op,f.state.writerSession)});
 await preference.sync();assert.equal(preference.state().confirmed,true);assert.equal(await sender.ensure(),true);
 assert.equal((await sender.send({public:true,onDuty:true,status:'待機',shiftId:'shift-9003',lat:34,lon:135,accuracy:5,capturedAtMs:Date.now()-1000})).status,'sent');
 const shared=await sender.list();assert.ok(shared.vehicles.some(row=>row.uid===actor));assert.equal(shared.vehicles.some(row=>row.uid==='diary-'+actor),false);
 preference.choose(false);await preference.sync();assert.equal(sender.canTrack(),false);assert.equal((await sender.list()).vehicles.some(row=>row.uid===actor),false);
 const closed=f.c.gpsHistoryData_(f.c.gpsPresenceRead_('gpsPresence/'+actor,f.auth));assert.equal(closed.lat,null);assert.equal(closed.lon,null);assert.equal(f.c.gpsPresenceRead_('gpsSenderSessions/'+actor,f.auth),null);
 assert.ok(f.calls.every(call=>call.url.startsWith(prefix)));sender.dispose();client.dispose();
});

test('実REST：現在地の資格を5分以内に限定し、日報読取は送信1回・一覧0回、停止/不正対応/端末切替は拒否',()=>{
 const f=fixture({presence:true}),actor='driver-leased-12345678';f.seed(actor);const senderId=crypto.randomUUID(),writerSessionId=f.state.writerSession;
 const post=(action,data={})=>f.post(action,{writerSessionId,...data},actor);
 assert.equal(post('setOwnGpsSharePrefs',{public:true,baseRevision:0,operationId:crypto.randomUUID()}).ok,true);
 assert.equal(post('acquireGpsSender',{senderId}).ok,true);
 const payload={public:true,onDuty:true,status:'空車',shiftId:'shift-9010',lat:34,lon:135,accuracy:5,capturedAtMs:Date.now()-1000};
 f.state.diaryReads=0;f.state.writerReads=0;f.state.sourceReads=0;
 const fetchBefore=f.calls.length;assert.equal(post('sendGpsPresence',{senderId,payload}).data.status,'sent');assert.equal(require('../scripts/gps-presence-capacity').counts.send.urlFetch,f.calls.length-fetchBefore+f.state.diaryReads+2);assert.equal(f.state.diaryReads,1);assert.equal(f.state.writerReads,1);assert.equal(f.state.sourceReads,0);
 f.state.diaryReads=0;assert.equal(post('listGpsPresence').ok,true);assert.equal(post('getOwnGpsSharePrefs').ok,true);assert.equal(f.state.diaryReads,0);
 // 日報資格の変更は5分以内のコピー期限で反映する。古い資格を無期限に延長しない。
 f.state.sourceSuspended=true;assert.equal(post('sendGpsPresence',{senderId,payload}).ok,true);f.state.sourceSuspended=false;
 const userName=f.c.gpsBridgeName_(f.c.GPS_BRIDGE_GPS_,'users/'+actor),patch=fields=>f.rawCommit([{update:{name:userName,fields},updateMask:{fieldPaths:Object.keys(fields)}}]);
 patch({accessExpiresAt:{timestampValue:new Date(1).toISOString()}});assert.equal(post('sendGpsPresence',{senderId,payload}).code,'permission-denied');
 patch({accessExpiresAt:{timestampValue:new Date(Date.now()+600000).toISOString()}});assert.equal(post('listGpsPresence').code,'permission-denied');
 patch({accessExpiresAt:{timestampValue:new Date(Date.now()+300000).toISOString()},diaryUid:{stringValue:'other-diary'}});assert.equal(post('listGpsPresence').code,'permission-denied');
 patch({diaryUid:{stringValue:'diary-'+actor},status:{stringValue:'suspended'}});assert.equal(post('listGpsPresence').code,'permission-denied');
 patch({status:{stringValue:'active'}});f.state.changeWriterOnRead=true;
 assert.equal(post('sendGpsPresence',{senderId,payload:{...payload,lat:35}}).code,'permission-denied');
 assert.equal(f.c.gpsHistoryData_(f.c.gpsPresenceRead_('gpsPresence/'+actor,f.auth)).lat,34);
});
