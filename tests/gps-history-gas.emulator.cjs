// 新履歴GAS候補を実Firestore REST Emulatorで検証。Google本人認証だけは合成。
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const code=fs.readFileSync(path.join(__dirname,'../google-apps-script/gps-account-broker/history/Code.candidate.gs'),'utf8');
const validation=require('../functions/gps-history-validation');
const prefix='https://firestore.googleapis.com/v1/projects/taxigps-9f82e/databases/(default)/documents';
function fixture(){
 const calls=[],state={auditFails:false,sourceSuspended:false,sourceDemoted:false,loseResponse:false,auditReadFails:false,suspendOnAudit:false};
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
 vm.runInContext(code,c);c.GPS_HISTORY_TRIAL_ONLY_=false; // 全機能の実REST回帰は試験環境だけで解除。
 c.gpsBridgeVerified_=(project,token)=>{
  const [kind,id]=String(token).split(':');if(kind!==(project===c.GPS_BRIDGE_DIARY_?'d':'g')||!id)throw Object.assign(Error('unauthenticated'),{gpsCode:'unauthenticated'});
  return {uid:(kind==='d'?'diary-':'')+id,subject:'subject-'+id,email:id+'@example.invalid'};
 };
 c.gpsBridgeSource_=(source)=>({eligible:!state.sourceSuspended,isAdmin:source.uid==='diary-admin-12345678'&&!state.sourceDemoted});
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
